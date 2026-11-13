/**
 * @fileoverview AniList service — GraphQL client wrapping https://graphql.anilist.co.
 * Primary source for all anime/manga data: search, detail, relations, schedule,
 * characters, recommendations, rankings, and studio filmography.
 * @module services/anilist/anilist-service
 */

import { z } from '@cyanheads/mcp-ts-core';
import { JsonRpcErrorCode, McpError, serviceUnavailable } from '@cyanheads/mcp-ts-core/errors';
import {
  createPacer,
  fetchWithTimeout,
  requestContextService,
  withRetry,
} from '@cyanheads/mcp-ts-core/utils';
import { normalizeAniListDescription } from './normalize-description.js';
import { toPageDepthError } from './pagination.js';
import type {
  AiringSchedule,
  CharacterEdge,
  CharacterWithMedia,
  MediaDetail,
  MediaFilterCatalog,
  MediaFormat,
  MediaNode,
  MediaPage,
  MediaRelationEdge,
  MediaSeason,
  MediaStatus,
  MediaType,
  PersonSuggestions,
  RecommendationNode,
  StaffWithRoles,
  StudioDetail,
} from './types.js';

// ─── Constants ────────────────────────────────────────────────────────────────

const ANILIST_URL = 'https://graphql.anilist.co';
const TIMEOUT_MS = 15_000;
const ADVISORY_QUERY = { maxRetries: 0, deadlineMs: 5_000 };
const CATALOG_TTL_MS = 24 * 60 * 60 * 1000;
const REQUEST_CONTEXT = requestContextService.createRequestContext({
  operation: 'anilist-service',
});

const pacer = createPacer({
  name: 'anilist',
  limits: [{ requests: 30, perMs: 30_000 }],
  cooldown: { baseMs: 30_000, maxMs: 30_000 },
});

/** Release queued AniList work during server shutdown. */
export function shutdownAniList(): void {
  pacer.dispose();
}

// ─── Core query executor ──────────────────────────────────────────────────────

const graphQlEnvelope = z.object({
  data: z.record(z.string(), z.unknown()).nullish(),
  errors: z.unknown().optional(),
});
const graphQlErrors = z.array(z.object({ message: z.string(), status: z.number().optional() }));

/**
 * Execute a GraphQL query against AniList. Returns the `data` payload.
 * AniList's page-depth refusal (HTTP 400) surfaces as a typed, non-retried
 * `page_depth_exceeded` ValidationError; every other HTTP failure keeps the
 * `fetchWithTimeout` classification.
 */
function query<T>(
  gql: string,
  variables: Record<string, unknown>,
  callerSignal?: AbortSignal,
  { maxRetries = 3, deadlineMs }: { maxRetries?: number; deadlineMs?: number } = {},
): Promise<T> {
  return withRetry(
    ({ signal }) =>
      pacer.run(
        async () => {
          const resp = await fetchWithTimeout(ANILIST_URL, TIMEOUT_MS, REQUEST_CONTEXT, {
            signal,
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
            body: JSON.stringify({ query: gql, variables }),
          }).catch((error: unknown) => {
            throw toPageDepthError(error) ?? error;
          });

          const raw: unknown = await resp.json().catch((error: unknown) => {
            if (!(error instanceof SyntaxError)) throw error;
            throw serviceUnavailable(
              'AniList returned invalid JSON.',
              { retryable: false },
              { cause: error },
            );
          });
          signal.throwIfAborted();
          const envelope = graphQlEnvelope.safeParse(raw);
          if (!envelope.success) {
            throw serviceUnavailable('AniList returned an invalid GraphQL envelope.', {
              retryable: false,
            });
          }
          const json = envelope.data;

          // AniList can return HTTP 200 on GraphQL errors.
          // When data is present (e.g. data.Media: null on not-found), return it so
          // callers can check for null and throw the appropriate domain error.
          if (!json.data) {
            const errors = graphQlErrors.safeParse(json.errors);
            const firstError = errors.success ? errors.data[0] : undefined;
            if (firstError) {
              throw serviceUnavailable(`AniList GraphQL error: ${firstError.message}`, {
                status: firstError.status,
              });
            }
            throw serviceUnavailable('AniList returned no GraphQL data.', { retryable: false });
          }
          return json.data as T;
        },
        { signal },
      ),
    {
      maxRetries,
      ...(deadlineMs === undefined ? {} : { deadlineMs }),
      baseDelayMs: 1000,
      maxDelayMs: 30_000,
      operation: 'anilist-query',
      context: REQUEST_CONTEXT,
      ...(callerSignal ? { signal: callerSignal } : {}),
    },
  );
}

// ─── GraphQL fragments ────────────────────────────────────────────────────────

const MEDIA_NODE_FRAGMENT = `
  id idMal type format status season seasonYear episodes chapters volumes
  isAdult meanScore countryOfOrigin
  title { romaji english native }
  coverImage { extraLarge large medium color }
`;

const MEDIA_DETAIL_FRAGMENT = `
  ${MEDIA_NODE_FRAGMENT}
  description(asHtml: false)
  source hashtag bannerImage duration synonyms
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

/**
 * Search anime or manga by various filters. Returns a page of results.
 * Filters are sent as given — callers pass normalized values and omit absent ones.
 * An omitted `sort` defaults to `SEARCH_MATCH` with a `query` and `POPULARITY_DESC`
 * without one, since `SEARCH_MATCH` only ranks when there is a search term.
 */
export async function searchMedia(params: {
  mediaType: MediaType;
  query?: string | undefined;
  genre?: string | undefined;
  tag?: string | undefined;
  season?: MediaSeason | undefined;
  seasonYear?: number | undefined;
  startYear?: number | undefined;
  countryOfOrigin?: string | undefined;
  format?: MediaFormat | undefined;
  status?: MediaStatus | undefined;
  sort?: string[] | undefined;
  page?: number | undefined;
  perPage?: number | undefined;
  includeAdult?: boolean | undefined;
  signal?: AbortSignal | undefined;
}): Promise<MediaPage> {
  const gql = `
    query SearchMedia(
      $type: MediaType, $search: String, $genre: String, $tag: String,
      $season: MediaSeason, $seasonYear: Int, $format: MediaFormat,
      $status: MediaStatus, $sort: [MediaSort], $page: Int, $perPage: Int,
      $isAdult: Boolean, $startDateGreater: FuzzyDateInt, $startDateLesser: FuzzyDateInt,
      $countryOfOrigin: CountryCode
    ) {
      Page(page: $page, perPage: $perPage) {
        pageInfo { currentPage hasNextPage perPage }
        media(
          type: $type, search: $search, genre: $genre, tag: $tag,
          season: $season, seasonYear: $seasonYear, format: $format,
          status: $status, sort: $sort, isAdult: $isAdult,
          startDate_greater: $startDateGreater, startDate_lesser: $startDateLesser,
          countryOfOrigin: $countryOfOrigin
        ) { ${MEDIA_NODE_FRAGMENT} }
      }
    }
  `;

  const yearStart = params.startYear === undefined ? undefined : params.startYear * 10_000;
  const data = await query<{ Page: MediaPage }>(
    gql,
    {
      type: params.mediaType,
      search: params.query,
      genre: params.genre,
      tag: params.tag,
      season: params.season,
      seasonYear: params.seasonYear,
      // AniList compares fuzzy dates as YYYYMMDD, using zeroes for unknown components.
      startDateGreater: yearStart === undefined ? undefined : yearStart - 1,
      startDateLesser: yearStart === undefined ? undefined : yearStart + 10_000,
      countryOfOrigin: params.countryOfOrigin,
      format: params.format,
      status: params.status,
      sort: params.sort ?? (params.query ? ['SEARCH_MATCH'] : ['POPULARITY_DESC']),
      page: params.page ?? 1,
      perPage: Math.min(params.perPage ?? 20, 50),
      isAdult: params.includeAdult ? undefined : false,
    },
    params.signal,
  );

  return data.Page;
}

/** Get full detail for one media item by AniList ID. Returns null if not found. */
export async function getMediaById(
  id: number,
  includeAdult = false,
  signal?: AbortSignal,
): Promise<MediaDetail | null> {
  const gql = `
    query GetMedia($id: Int, $isAdult: Boolean) {
      Media(id: $id, isAdult: $isAdult) { ${MEDIA_DETAIL_FRAGMENT} }
    }
  `;

  try {
    const data = await query<{ Media: MediaDetail | null }>(
      gql,
      {
        id,
        isAdult: includeAdult ? undefined : false,
      },
      signal,
    );
    return data.Media
      ? { ...data.Media, description: normalizeAniListDescription(data.Media.description) }
      : null;
  } catch (err) {
    // AniList sends HTTP 404 for nonexistent IDs — fetchWithTimeout converts this to
    // a NotFound McpError before we can read the body. Translate to null so callers
    // can throw the appropriate domain error.
    if (err instanceof McpError && err.code === JsonRpcErrorCode.NotFound) return null;
    throw err;
  }
}

/** Get relation edges for a media entry (one hop). Returns null if not found. */
export async function getMediaRelations(
  id: number,
  signal?: AbortSignal,
): Promise<MediaRelationEdge[] | null> {
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
    }>(gql, { id }, signal);
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
        pageInfo { currentPage hasNextPage perPage }
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
}): Promise<{ airingSchedules: AiringSchedule[]; hasNextPage: boolean }> {
  const now = Math.floor(Date.now() / 1000);
  const end = now + (params.daysAhead ?? 7) * 86_400;

  const gql = `
    query UpcomingEpisodes($greaterThan: Int!, $lessThan: Int!, $page: Int, $perPage: Int) {
      Page(page: $page, perPage: $perPage) {
        pageInfo { hasNextPage }
        airingSchedules(airingAt_greater: $greaterThan, airingAt_lesser: $lessThan, sort: [TIME]) {
          id airingAt episode timeUntilAiring
          media { ${MEDIA_NODE_FRAGMENT} }
        }
      }
    }
  `;

  const data = await query<{
    Page: { airingSchedules: AiringSchedule[]; pageInfo: { hasNextPage: boolean } };
  }>(gql, {
    greaterThan: now,
    lessThan: end,
    page: params.page ?? 1,
    perPage: Math.min(params.perPage ?? 50, 50),
  });

  return {
    airingSchedules: data.Page.airingSchedules,
    hasNextPage: data.Page.pageInfo.hasNextPage,
  };
}

/** Get characters for a media item. */
export async function getMediaCharacters(params: {
  mediaId: number;
  language?: string | undefined;
  page?: number | undefined;
  perPage?: number | undefined;
  signal?: AbortSignal | undefined;
}): Promise<{ characters: CharacterEdge[]; hasNextPage: boolean } | null> {
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
    }>(
      gql,
      {
        id: params.mediaId,
        language: params.language || undefined,
        page: params.page ?? 1,
        perPage: Math.min(params.perPage ?? 25, 25),
      },
      params.signal,
    );

    if (!data.Media) return null;

    return {
      characters: data.Media.characters.edges,
      hasNextPage: data.Media.characters.pageInfo.hasNextPage,
    };
  } catch (err) {
    if (err instanceof McpError && err.code === JsonRpcErrorCode.NotFound) return null;
    throw err;
  }
}

/** Find a character by name, or load an exact character when given an ID. */
async function lookupCharacter(
  selector: string | number,
  page = 1,
  perPage = 10,
  signal?: AbortSignal,
): Promise<CharacterWithMedia | null> {
  const byId = typeof selector === 'number';
  const gql = `
    query ${byId ? 'GetCharacter($id: Int!' : 'SearchCharacter($search: String!'}, $page: Int, $perPage: Int) {
      Character(${byId ? 'id: $id' : 'search: $search'}) {
        id
        name { full native }
        image { large medium }
        description(asHtml: false)
        siteUrl
        media(page: $page, perPage: $perPage, sort: [POPULARITY_DESC]) {
          pageInfo { hasNextPage currentPage }
          edges {
            node { ${MEDIA_NODE_FRAGMENT} }
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
    const data = await query<{ Character: CharacterWithMedia | null }>(
      gql,
      {
        ...(byId ? { id: selector } : { search: selector }),
        page,
        perPage: Math.min(perPage, 25),
      },
      signal,
    );
    return data.Character
      ? { ...data.Character, description: normalizeAniListDescription(data.Character.description) }
      : null;
  } catch (err) {
    if (err instanceof McpError && err.code === JsonRpcErrorCode.NotFound) return null;
    throw err;
  }
}

/** Use AniList's singleton name match and page its appearances. */
export function searchCharacter(
  name: string,
  page?: number,
  perPage?: number,
  signal?: AbortSignal,
): Promise<CharacterWithMedia | null> {
  return lookupCharacter(name, page, perPage, signal);
}

/** Get the exact character and a page of appearances. */
export function getCharacterById(
  id: number,
  page?: number,
  perPage?: number,
  signal?: AbortSignal,
): Promise<CharacterWithMedia | null> {
  return lookupCharacter(id, page, perPage, signal);
}

/** Find AniList staff by name or exact ID, paging their voice acting roles. */
async function lookupStaff(
  selector: string | number,
  page = 1,
  perPage = 10,
  signal?: AbortSignal,
): Promise<StaffWithRoles | null> {
  const byId = typeof selector === 'number';
  const gql = `
    query ${byId ? 'GetStaff($id: Int!' : 'SearchStaff($search: String!'}, $page: Int, $perPage: Int) {
      Staff(${byId ? 'id: $id' : 'search: $search'}) {
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
    const data = await query<{ Staff: StaffWithRoles | null }>(
      gql,
      {
        ...(byId ? { id: selector } : { search: selector }),
        page,
        perPage: Math.min(perPage, 25),
      },
      signal,
    );
    return data.Staff
      ? { ...data.Staff, description: normalizeAniListDescription(data.Staff.description) }
      : null;
  } catch (err) {
    if (err instanceof McpError && err.code === JsonRpcErrorCode.NotFound) return null;
    throw err;
  }
}

/** Use AniList's singleton name match and page its voice roles. */
export function searchStaff(
  name: string,
  page?: number,
  perPage?: number,
  signal?: AbortSignal,
): Promise<StaffWithRoles | null> {
  return lookupStaff(name, page, perPage, signal);
}

/** Get the exact staff member and a page of voice roles. */
export function getStaffById(
  id: number,
  page?: number,
  perPage?: number,
  signal?: AbortSignal,
): Promise<StaffWithRoles | null> {
  return lookupStaff(id, page, perPage, signal);
}

const optionalText = z.string().nullish();
const suggestionPageSchema = z.object({
  Page: z.object({
    pageInfo: z.object({ hasNextPage: z.boolean() }),
    matches: z.array(
      z
        .object({
          id: z.number().int().positive(),
          name: z.object({ full: optionalText, native: optionalText }).nullish(),
          popularMedia: z
            .object({
              edges: z
                .array(
                  z
                    .object({
                      node: z
                        .object({
                          id: z.number().int().positive(),
                          title: z
                            .object({
                              romaji: optionalText,
                              english: optionalText,
                              native: optionalText,
                            })
                            .nullish(),
                        })
                        .nullish(),
                    })
                    .nullable(),
                )
                .nullish(),
            })
            .nullish(),
        })
        .nullable(),
    ),
  }),
});

async function searchPersonSuggestions(
  field: 'characters' | 'staff',
  name: string,
  perPage: number,
  signal?: AbortSignal,
): Promise<PersonSuggestions> {
  const connection = field === 'characters' ? 'media' : 'characterMedia';
  const gql = `
    query PersonSuggestions($search: String!, $perPage: Int!) {
      Page(page: 1, perPage: $perPage) {
        pageInfo { hasNextPage }
        matches: ${field}(search: $search) {
          id
          name { full native }
          popularMedia: ${connection}(perPage: 1, sort: [POPULARITY_DESC]) {
            edges { node { id title { romaji english native } } }
          }
        }
      }
    }
  `;
  const data = await query<unknown>(
    gql,
    { search: name, perPage: Math.min(perPage, 25) },
    signal,
    ADVISORY_QUERY,
  );
  const parsed = suggestionPageSchema.safeParse(data);
  if (!parsed.success)
    throw serviceUnavailable('AniList returned an invalid person suggestion page.');
  const { Page } = parsed.data;
  return {
    matches: Page.matches
      .filter((match) => match !== null)
      .map(({ id, name, popularMedia }) => {
        const node = popularMedia?.edges?.[0]?.node;
        return {
          id,
          name: { full: name?.full ?? null, native: name?.native ?? null },
          popularMedia: node
            ? {
                id: node.id,
                title: {
                  romaji: node.title?.romaji ?? null,
                  english: node.title?.english ?? null,
                  native: node.title?.native ?? null,
                },
              }
            : null,
        };
      }),
    hasNextPage: Page.pageInfo.hasNextPage,
  };
}

/** Read the first character suggestion page without changing the selected match. */
export function searchCharacterSuggestions(
  name: string,
  perPage: number,
  signal?: AbortSignal,
): Promise<PersonSuggestions> {
  return searchPersonSuggestions('characters', name, perPage, signal);
}

/** Read the first staff suggestion page without changing the selected match. */
export function searchStaffSuggestions(
  name: string,
  perPage: number,
  signal?: AbortSignal,
): Promise<PersonSuggestions> {
  return searchPersonSuggestions('staff', name, perPage, signal);
}

const catalogSchema = z.object({
  GenreCollection: z.array(z.string().trim().min(1)).min(1),
  MediaTagCollection: z.array(z.object({ name: z.string().trim().min(1) })).min(1),
});
let cachedCatalog: { value: MediaFilterCatalog; expiresAt: number } | undefined;

/** Read the AniList vocabulary lazily, caching only a completed and valid response. */
export async function getMediaFilterCatalog(signal?: AbortSignal): Promise<MediaFilterCatalog> {
  signal?.throwIfAborted();
  if (cachedCatalog && Date.now() < cachedCatalog.expiresAt) return cachedCatalog.value;

  const data = await query<unknown>(
    'query MediaFilterCatalog { GenreCollection MediaTagCollection { name } }',
    {},
    signal,
    ADVISORY_QUERY,
  );
  const parsed = catalogSchema.safeParse(data);
  if (!parsed.success)
    throw serviceUnavailable('AniList returned an invalid media filter catalog.');
  signal?.throwIfAborted();
  const value = {
    genres: parsed.data.GenreCollection,
    tags: parsed.data.MediaTagCollection.map(({ name }) => name),
  };
  cachedCatalog = { value, expiresAt: Date.now() + CATALOG_TTL_MS };
  return value;
}

/** Suggest the matching tag, or explain an unrecognized genre, after an empty result. */
export async function getGenreAdvice(
  genre: string,
  signal: AbortSignal,
): Promise<string | undefined> {
  let catalog: MediaFilterCatalog;
  try {
    catalog = await getMediaFilterCatalog(signal);
  } catch (error) {
    signal.throwIfAborted();
    if (error instanceof Error && error.name === 'AbortError') throw error;
    if (error instanceof McpError && error.code === JsonRpcErrorCode.RequestCancelled) throw error;
    if (error instanceof McpError || error instanceof SyntaxError) return undefined;
    throw error;
  }
  signal.throwIfAborted();
  const normalized = genre.toLowerCase();
  if (catalog.genres.some((name) => name.toLowerCase() === normalized)) return undefined;
  if (catalog.tags.some((name) => name.toLowerCase() === normalized)) {
    return 'AniList recognizes this filter as a tag. Try the same value in tag instead of genre.';
  }
  return 'AniList does not recognize this genre. Check the genre name or remove the genre filter.';
}

/**
 * Resolve distinct MyAnimeList IDs to AniList media in one batched query.
 * Without `includeAdult`, adult media are excluded, so their MAL IDs stay unresolved.
 */
export async function getMediaByMalIds(
  malIds: number[],
  mediaType: MediaType,
  includeAdult: boolean,
  signal?: AbortSignal,
  options?: { maxRetries?: number },
): Promise<Map<number, MediaNode>> {
  signal?.throwIfAborted();
  const idMalIn = [...new Set(malIds)].filter((id) => id > 0);
  if (idMalIn.length === 0) return new Map();

  const gql = `
    query GetMediaByMalIds($idMalIn: [Int], $type: MediaType, $isAdult: Boolean) {
      Page(page: 1, perPage: 50) {
        media(idMal_in: $idMalIn, type: $type, isAdult: $isAdult) { ${MEDIA_NODE_FRAGMENT} }
      }
    }
  `;

  const data = await query<{ Page: { media: MediaNode[] } }>(
    gql,
    {
      idMalIn,
      type: mediaType,
      isAdult: includeAdult ? undefined : false,
    },
    signal,
    options,
  );
  const mediaByMalId = new Map<number, MediaNode>();
  for (const media of data.Page.media) {
    if (media.idMal !== null) mediaByMalId.set(media.idMal, media);
  }
  return mediaByMalId;
}

/** Get recommendations for a media entry. */
export async function getRecommendations(params: {
  mediaId: number;
  page?: number;
  perPage?: number;
  signal?: AbortSignal;
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
    }>(
      gql,
      {
        id: params.mediaId,
        page: params.page ?? 1,
        perPage: Math.min(params.perPage ?? 25, 25),
      },
      params.signal,
    );

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
  /** AniList tag name; sent only when non-empty. */
  tag?: string | undefined;
  season?: MediaSeason | undefined;
  seasonYear?: number | undefined;
  page?: number | undefined;
  perPage?: number | undefined;
  includeAdult?: boolean | undefined;
  signal?: AbortSignal | undefined;
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
      $tag: String, $season: MediaSeason, $seasonYear: Int, $page: Int, $perPage: Int,
      $isAdult: Boolean
    ) {
      Page(page: $page, perPage: $perPage) {
        pageInfo { currentPage hasNextPage perPage }
        media(
          type: $type, sort: $sort, format: $format, genre: $genre, tag: $tag,
          season: $season, seasonYear: $seasonYear, isAdult: $isAdult
        ) { ${MEDIA_NODE_FRAGMENT} }
      }
    }
  `;

  const data = await query<{ Page: MediaPage }>(
    gql,
    {
      type: params.mediaType,
      sort,
      format: params.format || undefined,
      genre: params.genre || undefined,
      tag: params.tag || undefined,
      season: season || undefined,
      seasonYear: seasonYear || undefined,
      page: params.page ?? 1,
      perPage: Math.min(params.perPage ?? 25, 50),
      isAdult: params.includeAdult ? undefined : false,
    },
    params.signal,
  );

  return data.Page;
}

/** AniList serves at most this many credits per page of a studio's `media`. */
const STUDIO_MEDIA_PAGE_MAX = 25;

/**
 * A studio's filmography page: one edge per credit, carrying `isMainStudio`.
 * AniList echoes the applied page size in `pageInfo.perPage`.
 */
const STUDIO_MEDIA_SELECTION = `
  media(page: $page, perPage: $perPage, sort: $mediaSort, isMain: $isMain) {
    pageInfo { currentPage hasNextPage perPage }
    edges { isMainStudio node { ${MEDIA_NODE_FRAGMENT} } }
  }
`;

/** Look up a studio by name (search) and return its filmography. */
export async function searchStudio(params: {
  name: string;
  sort?: string;
  page?: number;
  perPage?: number;
  mainOnly?: boolean | undefined;
  signal?: AbortSignal | undefined;
}): Promise<StudioDetail | null> {
  const gql = `
    query SearchStudio($search: String!, $mediaSort: [MediaSort], $page: Int, $perPage: Int, $isMain: Boolean) {
      Studio(search: $search) {
        id name isAnimationStudio siteUrl
        ${STUDIO_MEDIA_SELECTION}
      }
    }
  `;

  try {
    const data = await query<{ Studio: StudioDetail | null }>(
      gql,
      {
        search: params.name,
        mediaSort: params.sort ? [params.sort] : ['POPULARITY_DESC'],
        page: params.page ?? 1,
        perPage: Math.min(params.perPage ?? STUDIO_MEDIA_PAGE_MAX, STUDIO_MEDIA_PAGE_MAX),
        isMain: params.mainOnly ? true : undefined,
      },
      params.signal,
    );
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
  mainOnly?: boolean | undefined;
  signal?: AbortSignal | undefined;
}): Promise<StudioDetail | null> {
  const gql = `
    query GetStudio($id: Int!, $mediaSort: [MediaSort], $page: Int, $perPage: Int, $isMain: Boolean) {
      Studio(id: $id) {
        id name isAnimationStudio siteUrl
        ${STUDIO_MEDIA_SELECTION}
      }
    }
  `;

  try {
    const data = await query<{ Studio: StudioDetail | null }>(
      gql,
      {
        id: params.id,
        mediaSort: params.sort ? [params.sort] : ['POPULARITY_DESC'],
        page: params.page ?? 1,
        perPage: Math.min(params.perPage ?? STUDIO_MEDIA_PAGE_MAX, STUDIO_MEDIA_PAGE_MAX),
        isMain: params.mainOnly ? true : undefined,
      },
      params.signal,
    );
    return data.Studio;
  } catch (err) {
    if (err instanceof McpError && err.code === JsonRpcErrorCode.NotFound) return null;
    throw err;
  }
}
