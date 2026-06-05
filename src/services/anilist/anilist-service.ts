/**
 * @fileoverview AniList service — GraphQL client wrapping https://graphql.anilist.co.
 * Primary source for all anime/manga data: search, detail, relations, schedule,
 * characters, recommendations, rankings, and studio filmography.
 * @module services/anilist/anilist-service
 */

import { JsonRpcErrorCode, McpError, serviceUnavailable } from '@cyanheads/mcp-ts-core/errors';
import { fetchWithTimeout, requestContextService, withRetry } from '@cyanheads/mcp-ts-core/utils';
import type {
  AiringSchedule,
  CharacterEdge,
  CharacterWithMedia,
  MediaDetail,
  MediaFormat,
  MediaNode,
  MediaPage,
  MediaRelationEdge,
  MediaSeason,
  MediaStatus,
  MediaType,
  RecommendationNode,
  StaffWithRoles,
  StudioDetail,
} from './types.js';

// ─── Constants ────────────────────────────────────────────────────────────────

const ANILIST_URL = 'https://graphql.anilist.co';
const TIMEOUT_MS = 15_000;
const REQUEST_CONTEXT = requestContextService.createRequestContext({
  operation: 'anilist-service',
});

// ─── Rate-limit state ─────────────────────────────────────────────────────────

/** Simple in-process rate-limit guard: 30 req / 30s. */
let _windowStart = 0;
let _windowCount = 0;

/**
 * Block if we've hit the AniList rate limit.
 * Waits out the current 30s window before resuming.
 */
async function checkRateLimit(): Promise<void> {
  const now = Date.now();
  if (now - _windowStart > 30_000) {
    _windowStart = now;
    _windowCount = 0;
  }
  _windowCount++;
  if (_windowCount > 29) {
    const wait = 30_000 - (now - _windowStart) + 100;
    await new Promise((r) => setTimeout(r, wait));
    _windowStart = Date.now();
    _windowCount = 1;
  }
}

// ─── Core query executor ──────────────────────────────────────────────────────

/** Execute a GraphQL query against AniList. Returns the `data` payload. */
async function query<T>(gql: string, variables: Record<string, unknown>): Promise<T> {
  await checkRateLimit();

  return withRetry(
    async () => {
      const resp = await fetchWithTimeout(ANILIST_URL, TIMEOUT_MS, REQUEST_CONTEXT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ query: gql, variables }),
      });

      if (resp.status === 429) {
        // Back off the full 30s window
        await new Promise((r) => setTimeout(r, 30_000));
        throw serviceUnavailable('AniList rate limit exceeded', { status: 429 });
      }

      // AniList sends 404 with data.{entity}: null for nonexistent IDs — read the body
      // before deciding whether to treat it as an error.
      if (!resp.ok && resp.status !== 200 && resp.status !== 404) {
        throw serviceUnavailable(`AniList returned HTTP ${resp.status}`, { status: resp.status });
      }

      const json = (await resp.json()) as {
        data: T;
        errors?: Array<{ message: string; status: number }>;
      };

      // AniList returns HTTP 200 (or 404) even on GraphQL errors.
      // When data is present (e.g. data.Media: null on not-found), return it so
      // callers can check for null and throw the appropriate domain error.
      if (json.errors?.length && !json.data) {
        const firstErr = json.errors[0];
        throw serviceUnavailable(`AniList GraphQL error: ${firstErr?.message ?? 'unknown'}`, {
          status: firstErr?.status,
        });
      }

      return json.data;
    },
    {
      maxRetries: 3,
      baseDelayMs: 1000,
      maxDelayMs: 30_000,
      operation: 'anilist-query',
      context: REQUEST_CONTEXT,
    },
  );
}

// ─── GraphQL fragments ────────────────────────────────────────────────────────

const MEDIA_NODE_FRAGMENT = `
  id idMal type format status season seasonYear episodes chapters volumes
  isAdult meanScore
  title { romaji english native }
  coverImage { extraLarge large medium color }
`;

const MEDIA_DETAIL_FRAGMENT = `
  ${MEDIA_NODE_FRAGMENT}
  description(asHtml: false)
  source hashtag bannerImage
  averageScore popularity favourites isFavourite
  startDate { year month day }
  endDate { year month day }
  genres
  tags { id name description category rank isGeneralSpoiler isAdult }
  studios { edges { isMain node { id name isAnimationStudio } } }
  externalLinks { id url site siteId type language icon color isDisabled }
  relations { edges { relationType node { ${MEDIA_NODE_FRAGMENT} } } }
  siteUrl
  trailer { id site }
  nextAiringEpisode { airingAt episode timeUntilAiring }
`;

// ─── Service methods ──────────────────────────────────────────────────────────

/** Search anime or manga by various filters. Returns a page of results. */
export async function searchMedia(params: {
  mediaType: MediaType;
  query?: string | undefined;
  genre?: string | undefined;
  tag?: string | undefined;
  season?: MediaSeason | undefined;
  seasonYear?: number | undefined;
  format?: MediaFormat | undefined;
  status?: MediaStatus | undefined;
  sort?: string[] | undefined;
  page?: number | undefined;
  perPage?: number | undefined;
  includeAdult?: boolean | undefined;
}): Promise<MediaPage> {
  const gql = `
    query SearchMedia(
      $type: MediaType, $search: String, $genre: String, $tag: String,
      $season: MediaSeason, $seasonYear: Int, $format: MediaFormat,
      $status: MediaStatus, $sort: [MediaSort], $page: Int, $perPage: Int,
      $isAdult: Boolean
    ) {
      Page(page: $page, perPage: $perPage) {
        pageInfo { total currentPage lastPage hasNextPage perPage }
        media(
          type: $type, search: $search, genre: $genre, tag: $tag,
          season: $season, seasonYear: $seasonYear, format: $format,
          status: $status, sort: $sort, isAdult: $isAdult
        ) { ${MEDIA_NODE_FRAGMENT} }
      }
    }
  `;

  const data = await query<{ Page: MediaPage }>(gql, {
    type: params.mediaType,
    search: params.query || undefined,
    genre: params.genre || undefined,
    tag: params.tag || undefined,
    season: params.season || undefined,
    seasonYear: params.seasonYear || undefined,
    format: params.format || undefined,
    status: params.status || undefined,
    sort: params.sort || ['SEARCH_MATCH'],
    page: params.page ?? 1,
    perPage: Math.min(params.perPage ?? 20, 50),
    isAdult: params.includeAdult ? undefined : false,
  });

  return data.Page;
}

/** Get full detail for one media item by AniList ID. Returns null if not found. */
export async function getMediaById(id: number, includeAdult = false): Promise<MediaDetail | null> {
  const gql = `
    query GetMedia($id: Int, $isAdult: Boolean) {
      Media(id: $id, isAdult: $isAdult) { ${MEDIA_DETAIL_FRAGMENT} }
    }
  `;

  try {
    const data = await query<{ Media: MediaDetail | null }>(gql, {
      id,
      isAdult: includeAdult ? undefined : false,
    });
    return data.Media;
  } catch (err) {
    // AniList sends HTTP 404 for nonexistent IDs — fetchWithTimeout converts this to
    // a NotFound McpError before we can read the body. Translate to null so callers
    // can throw the appropriate domain error.
    if (err instanceof McpError && err.code === JsonRpcErrorCode.NotFound) return null;
    throw err;
  }
}

/** Get relation edges for a media entry (one hop). Returns null if not found. */
export async function getMediaRelations(id: number): Promise<MediaRelationEdge[] | null> {
  const gql = `
    query GetRelations($id: Int) {
      Media(id: $id) {
        id
        relations { edges { relationType node { ${MEDIA_NODE_FRAGMENT} } } }
      }
    }
  `;

  try {
    const data = await query<{
      Media: { id: number; relations: { edges: MediaRelationEdge[] } } | null;
    }>(gql, { id });
    return data.Media?.relations.edges ?? null;
  } catch (err) {
    if (err instanceof McpError && err.code === JsonRpcErrorCode.NotFound) return null;
    throw err;
  }
}

/** Get seasonal airing schedule. */
export async function getSeasonSchedule(params: {
  season: MediaSeason;
  seasonYear: number;
  page?: number;
  perPage?: number;
  includeAdult?: boolean;
}): Promise<MediaPage> {
  const gql = `
    query SeasonSchedule(
      $season: MediaSeason!, $seasonYear: Int!, $page: Int, $perPage: Int, $isAdult: Boolean
    ) {
      Page(page: $page, perPage: $perPage) {
        pageInfo { total currentPage lastPage hasNextPage perPage }
        media(
          type: ANIME, season: $season, seasonYear: $seasonYear,
          sort: [POPULARITY_DESC], isAdult: $isAdult
        ) {
          ${MEDIA_NODE_FRAGMENT}
          nextAiringEpisode { airingAt episode timeUntilAiring }
        }
      }
    }
  `;

  const data = await query<{
    Page: MediaPage & {
      media: Array<
        MediaNode & {
          nextAiringEpisode?: { airingAt: number; episode: number; timeUntilAiring: number } | null;
        }
      >;
    };
  }>(gql, {
    season: params.season,
    seasonYear: params.seasonYear,
    page: params.page ?? 1,
    perPage: Math.min(params.perPage ?? 20, 50),
    isAdult: params.includeAdult ? undefined : false,
  });

  return data.Page;
}

/** Get upcoming airing episodes within a time window. */
export async function getUpcomingEpisodes(params: {
  daysAhead?: number;
  page?: number;
  perPage?: number;
}): Promise<AiringSchedule[]> {
  const now = Math.floor(Date.now() / 1000);
  const end = now + (params.daysAhead ?? 7) * 86_400;

  const gql = `
    query UpcomingEpisodes($greaterThan: Int!, $lessThan: Int!, $page: Int, $perPage: Int) {
      Page(page: $page, perPage: $perPage) {
        airingSchedules(airingAt_greater: $greaterThan, airingAt_lesser: $lessThan) {
          id airingAt episode timeUntilAiring
          media { ${MEDIA_NODE_FRAGMENT} }
        }
      }
    }
  `;

  const data = await query<{ Page: { airingSchedules: AiringSchedule[] } }>(gql, {
    greaterThan: now,
    lessThan: end,
    page: params.page ?? 1,
    perPage: Math.min(params.perPage ?? 50, 50),
  });

  return data.Page.airingSchedules;
}

/** Get characters for a media item. */
export async function getMediaCharacters(params: {
  mediaId: number;
  language?: string | undefined;
  page?: number | undefined;
  perPage?: number | undefined;
}): Promise<{ characters: CharacterEdge[]; hasNextPage: boolean }> {
  const gql = `
    query GetCharacters($id: Int!, $language: StaffLanguage, $page: Int, $perPage: Int) {
      Media(id: $id) {
        characters(page: $page, perPage: $perPage, sort: [ROLE, RELEVANCE]) {
          pageInfo { hasNextPage }
          edges {
            role
            node {
              id
              name { full native }
              image { large medium }
              description(asHtml: false)
              siteUrl
            }
            voiceActors(language: $language, sort: [RELEVANCE]) {
              id
              name { full native }
              language
              image { large medium }
              siteUrl
            }
          }
        }
      }
    }
  `;

  try {
    const data = await query<{
      Media: {
        characters: {
          pageInfo: { hasNextPage: boolean };
          edges: CharacterEdge[];
        };
      } | null;
    }>(gql, {
      id: params.mediaId,
      language: params.language || undefined,
      page: params.page ?? 1,
      perPage: Math.min(params.perPage ?? 25, 25),
    });

    if (!data.Media) return { characters: [], hasNextPage: false };

    return {
      characters: data.Media.characters.edges,
      hasNextPage: data.Media.characters.pageInfo.hasNextPage,
    };
  } catch (err) {
    if (err instanceof McpError && err.code === JsonRpcErrorCode.NotFound)
      return { characters: [], hasNextPage: false };
    throw err;
  }
}

/** Search for a character by name. */
export async function searchCharacter(name: string): Promise<CharacterWithMedia | null> {
  const gql = `
    query SearchCharacter($search: String!, $page: Int, $perPage: Int) {
      Character(search: $search) {
        id
        name { full native }
        image { large medium }
        description(asHtml: false)
        siteUrl
        media(page: $page, perPage: $perPage, sort: [POPULARITY_DESC]) {
          pageInfo { hasNextPage currentPage }
          nodes { ${MEDIA_NODE_FRAGMENT} }
          edges {
            characterRole
            voiceActors(sort: [RELEVANCE]) {
              id name { full native } language image { large medium } siteUrl
            }
          }
        }
      }
    }
  `;

  try {
    const data = await query<{ Character: CharacterWithMedia | null }>(gql, {
      search: name,
      page: 1,
      perPage: 10,
    });
    return data.Character;
  } catch (err) {
    if (err instanceof McpError && err.code === JsonRpcErrorCode.NotFound) return null;
    throw err;
  }
}

/** Search for a voice actor (staff) by name. */
export async function searchStaff(
  name: string,
  page = 1,
  perPage = 10,
): Promise<StaffWithRoles | null> {
  const gql = `
    query SearchStaff($search: String!, $page: Int, $perPage: Int) {
      Staff(search: $search) {
        id
        name { full native }
        language
        image { large medium }
        description(asHtml: false)
        siteUrl
        characterMedia(page: $page, perPage: $perPage, sort: [POPULARITY_DESC]) {
          pageInfo { hasNextPage currentPage }
          edges {
            characterRole
            node { ${MEDIA_NODE_FRAGMENT} }
            characters { id name { full native } }
          }
        }
      }
    }
  `;

  try {
    const data = await query<{ Staff: StaffWithRoles | null }>(gql, {
      search: name,
      page,
      perPage,
    });
    return data.Staff;
  } catch (err) {
    if (err instanceof McpError && err.code === JsonRpcErrorCode.NotFound) return null;
    throw err;
  }
}

/** Get recommendations for a media entry. */
export async function getRecommendations(params: {
  mediaId: number;
  page?: number;
  perPage?: number;
}): Promise<{ nodes: RecommendationNode[]; hasNextPage: boolean }> {
  const gql = `
    query GetRecommendations($id: Int!, $page: Int, $perPage: Int) {
      Media(id: $id) {
        idMal
        recommendations(page: $page, perPage: $perPage, sort: [RATING_DESC]) {
          pageInfo { hasNextPage }
          nodes {
            rating
            mediaRecommendation { ${MEDIA_NODE_FRAGMENT} }
          }
        }
      }
    }
  `;

  try {
    const data = await query<{
      Media: {
        idMal: number | null;
        recommendations: {
          pageInfo: { hasNextPage: boolean };
          nodes: RecommendationNode[];
        };
      } | null;
    }>(gql, {
      id: params.mediaId,
      page: params.page ?? 1,
      perPage: Math.min(params.perPage ?? 25, 25),
    });

    if (!data.Media) return { nodes: [], hasNextPage: false };

    return {
      nodes: data.Media.recommendations.nodes,
      hasNextPage: data.Media.recommendations.pageInfo.hasNextPage,
    };
  } catch (err) {
    if (err instanceof McpError && err.code === JsonRpcErrorCode.NotFound)
      return { nodes: [], hasNextPage: false };
    throw err;
  }
}

/** Get rankings by mode: top, trending, or seasonal. */
export async function getRankings(params: {
  mediaType: MediaType;
  mode: 'top' | 'trending' | 'seasonal';
  format?: MediaFormat | undefined;
  genre?: string | undefined;
  season?: MediaSeason | undefined;
  seasonYear?: number | undefined;
  page?: number | undefined;
  perPage?: number | undefined;
  includeAdult?: boolean | undefined;
}): Promise<MediaPage> {
  let sort: string[];
  let season: string | undefined = params.season;
  let seasonYear: number | undefined = params.seasonYear;

  switch (params.mode) {
    case 'top':
      sort = ['SCORE_DESC'];
      break;
    case 'trending':
      sort = ['TRENDING_DESC'];
      break;
    case 'seasonal':
      sort = ['POPULARITY_DESC'];
      // Default to current season if not specified
      if (!season || !seasonYear) {
        const now = new Date();
        const month = now.getMonth() + 1;
        seasonYear = now.getFullYear();
        if (month <= 3) season = 'WINTER';
        else if (month <= 6) season = 'SPRING';
        else if (month <= 9) season = 'SUMMER';
        else season = 'FALL';
      }
      break;
  }

  const gql = `
    query GetRankings(
      $type: MediaType!, $sort: [MediaSort]!, $format: MediaFormat, $genre: String,
      $season: MediaSeason, $seasonYear: Int, $page: Int, $perPage: Int, $isAdult: Boolean
    ) {
      Page(page: $page, perPage: $perPage) {
        pageInfo { total currentPage lastPage hasNextPage perPage }
        media(
          type: $type, sort: $sort, format: $format, genre: $genre,
          season: $season, seasonYear: $seasonYear, isAdult: $isAdult
        ) { ${MEDIA_NODE_FRAGMENT} }
      }
    }
  `;

  const data = await query<{ Page: MediaPage }>(gql, {
    type: params.mediaType,
    sort,
    format: params.format || undefined,
    genre: params.genre || undefined,
    season: season || undefined,
    seasonYear: seasonYear || undefined,
    page: params.page ?? 1,
    perPage: Math.min(params.perPage ?? 25, 50),
    isAdult: params.includeAdult ? undefined : false,
  });

  return data.Page;
}

/** Look up a studio by name (search) and return its filmography. */
export async function searchStudio(params: {
  name: string;
  sort?: string;
  page?: number;
  perPage?: number;
}): Promise<StudioDetail | null> {
  const gql = `
    query SearchStudio($search: String!, $mediaSort: [MediaSort], $page: Int, $perPage: Int) {
      Studio(search: $search) {
        id name isAnimationStudio siteUrl
        media(page: $page, perPage: $perPage, sort: $mediaSort) {
          pageInfo { total currentPage lastPage hasNextPage }
          nodes { ${MEDIA_NODE_FRAGMENT} }
        }
      }
    }
  `;

  try {
    const data = await query<{ Studio: StudioDetail | null }>(gql, {
      search: params.name,
      mediaSort: params.sort ? [params.sort] : ['POPULARITY_DESC'],
      page: params.page ?? 1,
      perPage: Math.min(params.perPage ?? 25, 50),
    });
    return data.Studio;
  } catch (err) {
    if (err instanceof McpError && err.code === JsonRpcErrorCode.NotFound) return null;
    throw err;
  }
}

/** Get studio by AniList ID. */
export async function getStudioById(params: {
  id: number;
  sort?: string;
  page?: number;
  perPage?: number;
}): Promise<StudioDetail | null> {
  const gql = `
    query GetStudio($id: Int!, $mediaSort: [MediaSort], $page: Int, $perPage: Int) {
      Studio(id: $id) {
        id name isAnimationStudio siteUrl
        media(page: $page, perPage: $perPage, sort: $mediaSort) {
          pageInfo { total currentPage lastPage hasNextPage }
          nodes { ${MEDIA_NODE_FRAGMENT} }
        }
      }
    }
  `;

  try {
    const data = await query<{ Studio: StudioDetail | null }>(gql, {
      id: params.id,
      mediaSort: params.sort ? [params.sort] : ['POPULARITY_DESC'],
      page: params.page ?? 1,
      perPage: Math.min(params.perPage ?? 25, 50),
    });
    return data.Studio;
  } catch (err) {
    if (err instanceof McpError && err.code === JsonRpcErrorCode.NotFound) return null;
    throw err;
  }
}
