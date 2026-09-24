/**
 * @fileoverview anime_search_media tool — search anime or manga by title, genre, tag, season, etc.
 * AniList primary. When AniList has no match for a title-only query, an optional
 * Jikan (MyAnimeList) fallback runs; its failure degrades to the AniList empty page
 * with a notice rather than failing the call.
 * @module mcp-server/tools/definitions/anime-search-media.tool
 */

import { tool, z } from '@cyanheads/mcp-ts-core';
import { JsonRpcErrorCode } from '@cyanheads/mcp-ts-core/errors';
import * as anilist from '@/services/anilist/anilist-service.js';
import {
  exactResultCount,
  nextPageOutOfReach,
  nextPageReachable,
  PAGE_DEPTH_EDGE_NOTICE,
  pastEndNotice,
} from '@/services/anilist/pagination.js';
import type { MediaNode, MediaType } from '@/services/anilist/types.js';
import * as jikan from '@/services/jikan/jikan-service.js';

const MediaTypeEnum = z.enum(['ANIME', 'MANGA']).describe('Media type to search: anime or manga.');
const SeasonEnum = z
  .enum(['WINTER', 'SPRING', 'SUMMER', 'FALL'])
  .describe(
    'Anime broadcast season. WINTER=Jan–Mar, SPRING=Apr–Jun, SUMMER=Jul–Sep, FALL=Oct–Dec.',
  );
const FormatEnum = z
  .enum(['TV', 'TV_SHORT', 'MOVIE', 'SPECIAL', 'OVA', 'ONA', 'MUSIC', 'MANGA', 'NOVEL', 'ONE_SHOT'])
  .describe('Publication/broadcast format filter.');
const StatusEnum = z
  .enum(['FINISHED', 'RELEASING', 'NOT_YET_RELEASED', 'CANCELLED', 'HIATUS'])
  .describe('Production status filter.');
const SortEnum = z
  .enum(['SEARCH_MATCH', 'SCORE_DESC', 'POPULARITY_DESC', 'TRENDING_DESC', 'START_DATE_DESC'])
  .describe('Search sort field.');

/** Trim a free-text filter; blank values (form clients send `""`) count as absent. */
function present(value: string | undefined): string | undefined {
  return value?.trim() || undefined;
}

/** One AniList media node as a search result row. */
function toResult(m: MediaNode) {
  return {
    id: m.id,
    id_mal: m.idMal ?? null,
    title_romaji: m.title.romaji,
    title_english: m.title.english,
    title_native: m.title.native,
    type: m.type,
    format: m.format ?? null,
    status: m.status ?? null,
    season: m.season && m.seasonYear ? `${m.season} ${m.seasonYear}` : (m.season ?? null),
    episodes: m.episodes ?? null,
    chapters: m.chapters ?? null,
    mean_score: m.meanScore ?? null,
    is_adult: m.isAdult,
    cover_image_url: m.coverImage?.large ?? null,
  };
}

/**
 * The MyAnimeList fallback as one unit: the Jikan search, then one batched AniList
 * lookup resolving its MAL IDs to AniList media. Both honor `includeAdult`: Jikan
 * gets `sfw` and the lookup excludes adult media. Either step may reject.
 */
async function searchMyAnimeList(params: {
  query: string;
  mediaType: MediaType;
  page: number;
  perPage: number;
  includeAdult: boolean;
}) {
  const found = await jikan.searchMedia({
    query: params.query,
    mediaType: params.mediaType,
    page: params.page,
    limit: params.perPage,
    sfw: !params.includeAdult,
  });
  const resolvedByMalId = await anilist.getMediaByMalIds(
    found.results.map((result) => result.mal_id),
    params.mediaType,
    params.includeAdult,
  );
  return { found, resolvedByMalId };
}

export const animeSearchMedia = tool('anime_search_media', {
  description:
    'Search anime or manga by title, genre, tag, season, year, format, or status. Needs at least one criterion — a sort other than SEARCH_MATCH alone browses the whole catalog. Returns ranked results with AniList IDs, titles, scores, format, and episode/chapter counts. When AniList has no match for a title-only query, falls back to MyAnimeList (via Jikan) and maps its rows to AniList IDs.',
  annotations: { readOnlyHint: true, openWorldHint: true },

  input: z.object({
    media_type: MediaTypeEnum,
    query: z
      .string()
      .max(200)
      .optional()
      .describe('Title search query. Supports partial matches. Trimmed; blank counts as absent.'),
    genre: z
      .string()
      .max(100)
      .optional()
      .describe(
        'Genre filter, e.g. "Action", "Romance", "Slice of Life", "Mecha". Trimmed; blank counts as absent.',
      ),
    tag: z
      .string()
      .max(100)
      .optional()
      .describe(
        'AniList tag filter, e.g. "Isekai", "School", "Time Manipulation". Genres such as "Action" are not tags. Trimmed; blank counts as absent.',
      ),
    season: SeasonEnum.optional(),
    season_year: z
      .number()
      .int()
      .min(1940)
      .max(2100)
      .optional()
      .describe(
        '4-digit year of the broadcast season, e.g. 2024. Without it, season matches that season in every year.',
      ),
    format: FormatEnum.optional(),
    status: StatusEnum.optional(),
    sort: z
      .array(SortEnum)
      .max(5)
      .optional()
      .describe(
        'Sort order list. Default: SEARCH_MATCH (title relevance) when query is set, otherwise POPULARITY_DESC. SEARCH_MATCH ranks only against a query.',
      ),
    page: z
      .number()
      .int()
      .min(1)
      .default(1)
      .describe(
        '1-based page number. AniList serves only the first 5,000 results, so page × per_page must stay at or below 5,000.',
      ),
    per_page: z
      .number()
      .int()
      .min(1)
      .max(50)
      .default(20)
      .describe(
        'Results per page. Maximum 50; page × per_page must stay at or below 5,000. The MyAnimeList fallback runs only at 25 or fewer.',
      ),
    include_adult: z
      .boolean()
      .default(false)
      .describe(
        'Include adult/NSFW content, including in MyAnimeList fallback results. Default false.',
      ),
  }),

  enrichment: {
    notice: z
      .string()
      .optional()
      .describe(
        'Set when results is empty: echoes the applied criteria and how to broaden them, says when the page is past the end of the results, and says when the MyAnimeList fallback was skipped or could not be checked. Also set on the last page AniList serves (its 5,000-entry reach) while has_next_page is still true.',
      ),
    totalCount: z
      .number()
      .int()
      .optional()
      .describe(
        'Exact number of matching results, set only on the final AniList page (0 for an empty first page). Use has_next_page to paginate.',
      ),
  },

  errors: [
    {
      reason: 'missing_criteria',
      code: JsonRpcErrorCode.ValidationError,
      when: 'No search criterion remains after blank query, genre, and tag values are dropped',
      recovery:
        'Provide at least one criterion: query, genre, tag, season, season_year, format, status, or a sort other than SEARCH_MATCH.',
    },
    {
      reason: 'page_depth_exceeded',
      code: JsonRpcErrorCode.ValidationError,
      when: 'page × per_page reaches past the first 5,000 results, which AniList refuses to serve',
      recovery:
        'AniList serves only the first 5,000 entries of a result list, so page × per_page must stay at or below 5,000. Narrow the criteria so fewer entries match, or request a lower page.',
      thrownBy: 'service',
    },
  ],

  output: z.object({
    source: z
      .enum(['anilist', 'jikan'])
      .describe(
        'Which API provided these results: "anilist" (primary) or "jikan" (MyAnimeList fallback for a title-only query AniList has no match for).',
      ),
    page: z.number().int().describe('Current page number.'),
    has_next_page: z
      .boolean()
      .describe('Whether more pages are available. Drives pagination; stop when false.'),
    total_results: z
      .number()
      .int()
      .nullable()
      .describe(
        'Exact number of matching results, present only on the final AniList page (has_next_page false) and 0 for an empty first page. Null on every other page and on MyAnimeList-sourced pages.',
      ),
    results: z
      .array(
        z
          .object({
            id: z
              .number()
              .int()
              .describe('AniList media ID. Use with anime_get_media for full detail.'),
            id_mal: z.number().int().nullable().describe('MyAnimeList ID, or null if unavailable.'),
            title_romaji: z.string().nullable().describe('Romanized title.'),
            title_english: z.string().nullable().describe('English title, or null.'),
            title_native: z
              .string()
              .nullable()
              .describe('Native script title (Japanese, Korean, etc.), or null.'),
            type: z.enum(['ANIME', 'MANGA']).describe('Media type.'),
            format: z
              .string()
              .nullable()
              .describe('Format: TV, MOVIE, OVA, ONA, MANGA, NOVEL, etc.'),
            status: z.string().nullable().describe('Production status.'),
            season: z.string().nullable().describe('Broadcast season label, e.g. "FALL 2023".'),
            episodes: z.number().int().nullable().describe('Episode count (anime), or null.'),
            chapters: z.number().int().nullable().describe('Chapter count (manga), or null.'),
            mean_score: z
              .number()
              .nullable()
              .describe(
                'AniList mean score 0–100, or null. Use anime_get_media for MAL score too.',
              ),
            is_adult: z.boolean().describe('Whether this entry is marked adult/NSFW.'),
            cover_image_url: z.string().nullable().describe('Cover image URL (large), or null.'),
          })
          .describe('A matching media entry.'),
      )
      .describe('Matching media entries.'),
  }),

  async handler(input, ctx) {
    const query = present(input.query);
    const genre = present(input.genre);
    const tag = present(input.tag);
    const sort = input.sort?.length ? input.sort : undefined;

    const filters: string[] = [];
    if (genre) filters.push(`genre="${genre}"`);
    if (tag) filters.push(`tag="${tag}"`);
    if (input.season) filters.push(`season=${input.season}`);
    if (input.season_year) filters.push(`season_year=${input.season_year}`);
    if (input.format) filters.push(`format=${input.format}`);
    if (input.status) filters.push(`status=${input.status}`);

    const browses = sort?.some((field) => field !== 'SEARCH_MATCH') ?? false;
    if (!query && filters.length === 0 && !browses) {
      throw ctx.fail(
        'missing_criteria',
        'anime_search_media needs at least one search criterion; blank query, genre, and tag values are ignored.',
        ctx.recoveryFor('missing_criteria'),
      );
    }

    const criteria =
      [...(query ? [`query="${query}"`] : []), ...filters].join(', ') || `sort=${sort?.join(',')}`;
    ctx.log.info('Searching anime/manga', { mediaType: input.media_type, criteria });

    const search = {
      mediaType: input.media_type,
      query,
      genre,
      tag,
      season: input.season,
      seasonYear: input.season_year,
      format: input.format,
      status: input.status,
      includeAdult: input.include_adult,
    };
    const anilistPage = await anilist.searchMedia({
      ...search,
      sort,
      page: input.page,
      perPage: input.per_page,
    });

    const { currentPage, hasNextPage, perPage } = anilistPage.pageInfo;
    const total = exactResultCount({
      page: currentPage,
      perPage,
      hasNextPage,
      entriesOnPage: anilistPage.media.length,
    });
    /**
     * The AniList page as the response, with its exact count when known. Notice
     * segments are joined into one `notice` (enrichment is last-wins), followed by
     * the out-of-reach notice on the last page AniList serves.
     */
    const answerFromAniList = (notices: string[] = []) => {
      if (total !== null) ctx.enrich.total(total);
      if (nextPageOutOfReach({ page: currentPage, perPage, hasNextPage })) {
        notices.push(PAGE_DEPTH_EDGE_NOTICE);
      }
      if (notices.length > 0) ctx.enrich.notice(notices.join(' '));
      return {
        source: 'anilist' as const,
        page: currentPage,
        has_next_page: hasNextPage,
        total_results: total,
        results: anilistPage.media.map(toResult),
      };
    };
    if (anilistPage.media.length > 0) return answerFromAniList();

    // Empty page. The fallback forwards only the query, so it runs only when the
    // query is the sole filter and AniList has no match for it at all — on a later
    // page, a one-row page-1 check decides that — and only at a page size Jikan serves.
    const noResults =
      filters.length === 0
        ? `No results for ${criteria}. Check the spelling or try another title (English, romaji, or native).`
        : `No results for ${criteria}. Try broadening the search: remove filters, check spelling, or use a genre instead of a tag (e.g. genre="Action" rather than tag="Action").`;
    const pastEnd = pastEndNotice(input.page, `the results for ${criteria}`);

    const noAniListMatch =
      query !== undefined &&
      filters.length === 0 &&
      (input.page === 1 ||
        (await anilist.searchMedia({ ...search, page: 1, perPage: 1 })).media.length === 0);

    if (!noAniListMatch) return answerFromAniList([input.page === 1 ? noResults : pastEnd]);

    if (input.per_page > jikan.JIKAN_SEARCH_PAGE_MAX) {
      return answerFromAniList([
        noResults,
        `The MyAnimeList fallback serves per_page up to ${jikan.JIKAN_SEARCH_PAGE_MAX}, so it was skipped; retry with per_page ${jikan.JIKAN_SEARCH_PAGE_MAX} or less to check MyAnimeList.`,
      ]);
    }

    ctx.log.info('AniList has no match; trying the MyAnimeList fallback', { query });
    const [fallback] = await Promise.allSettled([
      searchMyAnimeList({
        query,
        mediaType: input.media_type,
        page: input.page,
        perPage: input.per_page,
        includeAdult: input.include_adult,
      }),
    ]);

    if (fallback.status === 'rejected') {
      ctx.log.warning('MyAnimeList fallback failed', { query, error: String(fallback.reason) });
      return answerFromAniList([
        noResults,
        'The MyAnimeList fallback search was unavailable, so zero matches is unconfirmed; retry later to check MyAnimeList.',
      ]);
    }

    const { found, resolvedByMalId } = fallback.value;
    const results = found.results.flatMap((result) => {
      const resolved = resolvedByMalId.get(result.mal_id);
      if (!resolved) return [];
      return [
        {
          id: resolved.id,
          id_mal: result.mal_id,
          title_romaji: result.title,
          title_english: result.title_english,
          title_native: null,
          type: input.media_type,
          format: result.type ?? null,
          status: result.status ?? null,
          season: null,
          episodes: result.episodes ?? null,
          chapters: result.chapters ?? null,
          mean_score: result.score ? Math.round(result.score * 10) : null,
          is_adult: resolved.isAdult,
          cover_image_url: null,
        },
      ];
    });
    if (results.length === 0) ctx.enrich.notice(noResults);

    return {
      source: 'jikan' as const,
      page: found.pagination?.current_page ?? input.page,
      has_next_page: found.pagination?.has_next_page ?? false,
      total_results: null,
      results,
    };
  },

  format: (result) => {
    if (result.results.length === 0) {
      return [
        { type: 'text', text: `No results found (source: ${result.source}, page ${result.page}).` },
      ];
    }

    const lines: string[] = [
      `**Search Results** (source: ${result.source}, page ${result.page}${result.total_results !== null ? `, ${result.total_results} total` : ''})`,
      '',
    ];

    for (const r of result.results) {
      const title = r.title_english ?? r.title_romaji ?? r.title_native ?? 'Unknown';
      const score = r.mean_score !== null ? ` · Score: ${r.mean_score}/100` : '';
      const fmt = r.format ? ` · ${r.format}` : '';
      const status = r.status ? ` · ${r.status}` : '';
      const ep =
        r.type === 'ANIME' && r.episodes !== null
          ? ` · ${r.episodes} eps`
          : r.type === 'MANGA' && r.chapters !== null
            ? ` · ${r.chapters} ch`
            : '';
      const season = r.season ? ` · ${r.season}` : '';
      const adult = r.is_adult ? ' · [Adult]' : '';
      const ids =
        r.id > 0
          ? `[AL:${r.id}${r.id_mal !== null ? `/MAL:${r.id_mal}` : ''}]`
          : r.id_mal !== null
            ? `[MAL:${r.id_mal}]`
            : '';
      const native = r.title_native ? ` (${r.title_native})` : '';
      const img = r.cover_image_url ? ` | cover_image_url: ${r.cover_image_url}` : '';

      const chap = r.chapters !== null ? ` chapters:${r.chapters}` : '';
      const typeLabel = ` type:${r.type}`;
      const romaji = r.title_romaji ? ` title_romaji:${r.title_romaji}` : '';
      lines.push(
        `**${title}**${native} ${ids}${fmt}${status}${score}${ep}${chap}${season}${adult}${typeLabel}${romaji}${img}`,
      );
    }

    const nextReachable =
      result.source === 'anilist'
        ? nextPageReachable({
            page: result.page,
            hasNextPage: result.has_next_page,
            rowsOnPage: result.results.length,
          })
        : result.has_next_page;
    if (nextReachable) {
      lines.push('', `_More results available (page ${result.page + 1})._`);
    }

    return [{ type: 'text', text: lines.join('\n') }];
  },
});
