/**
 * @fileoverview anime_get_rankings tool — top, trending, or seasonal rankings.
 * @module mcp-server/tools/definitions/anime-get-rankings.tool
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

const SeasonEnum = z
  .enum(['WINTER', 'SPRING', 'SUMMER', 'FALL'])
  .describe(
    'Anime broadcast season. WINTER=Jan–Mar, SPRING=Apr–Jun, SUMMER=Jul–Sep, FALL=Oct–Dec.',
  );
const FormatEnum = z
  .enum(['TV', 'TV_SHORT', 'MOVIE', 'SPECIAL', 'OVA', 'ONA', 'MUSIC', 'MANGA', 'NOVEL', 'ONE_SHOT'])
  .describe('Publication/broadcast format filter.');

/** Trim a free-text filter; blank values (form clients send `""`) count as absent. */
function present(value: string | undefined): string | undefined {
  return value?.trim() || undefined;
}

/** The season the current date falls in, as AniList's seasonal default computes it. */
function currentSeasonLabel(): string {
  const now = new Date();
  const month = now.getMonth() + 1;
  const season = month <= 3 ? 'WINTER' : month <= 6 ? 'SPRING' : month <= 9 ? 'SUMMER' : 'FALL';
  return `${season} ${now.getFullYear()}`;
}

/** Label for a season/year filter in top or trending mode, or null when none is applied. */
function seasonFilterLabel(season: string | undefined, year: number | undefined): string | null {
  if (season && year) return `${season} ${year}`;
  if (season) return `${season} (any year)`;
  if (year) return `${year}`;
  return null;
}

export const animeGetRankings = tool('anime_get_rankings', {
  description:
    'Top, trending, or seasonal rankings. Filterable by genre, tag, and format. ' +
    '"top" returns all-time by score; "trending" returns current week; ' +
    '"seasonal" returns the current or specified season sorted by popularity.',
  annotations: { readOnlyHint: true, openWorldHint: true },

  input: z.object({
    mode: z
      .enum(['top', 'trending', 'seasonal'])
      .describe(
        '"top": highest-scoring of all time. ' +
          '"trending": most active this week. ' +
          '"seasonal": most popular in the current or specified season/year.',
      ),
    media_type: z.enum(['ANIME', 'MANGA']).describe('Media type to rank.'),
    format: FormatEnum.optional(),
    genre: z
      .string()
      .max(100)
      .optional()
      .describe('Genre filter, e.g. "Action", "Romance". Trimmed; blank counts as absent.'),
    tag: z
      .string()
      .max(100)
      .optional()
      .describe(
        'AniList tag filter, e.g. "Isekai", "Found Family". Genres such as "Action" are not tags. Trimmed; blank counts as absent.',
      ),
    season: SeasonEnum.optional().describe(
      '"seasonal" mode: the season to rank, given together with season_year (omit both for the current season). ' +
        '"top"/"trending": restricts the ranking to titles from this season; without season_year it matches that season in every year.',
    ),
    season_year: z
      .number()
      .int()
      .min(1940)
      .max(2100)
      .optional()
      .describe(
        '"seasonal" mode: the year to rank, given together with season. ' +
          '"top"/"trending": restricts the ranking to titles from this year.',
      ),
    page: z
      .number()
      .int()
      .min(1)
      .default(1)
      .describe(
        '1-based page number. AniList serves only the first 5,000 ranked entries, so page × per_page must stay at or below 5,000.',
      ),
    per_page: z
      .number()
      .int()
      .min(1)
      .max(50)
      .default(25)
      .describe('Results per page. Maximum 50; page × per_page must stay at or below 5,000.'),
    include_adult: z
      .boolean()
      .default(false)
      .describe('Include adult/NSFW content. Default false.'),
  }),

  enrichment: {
    notice: z
      .string()
      .optional()
      .describe(
        'Set when entries is empty — echoes the applied mode/filters and how to broaden them, or says the page is past the end of the rankings. Also set on the last page AniList serves (its 5,000-entry reach) while has_next_page is still true.',
      ),
    totalCount: z
      .number()
      .int()
      .optional()
      .describe(
        'Exact number of ranked entries, set only on the final page (0 for an empty first page). Use has_next_page to paginate.',
      ),
  },

  errors: [
    {
      reason: 'invalid_season',
      code: JsonRpcErrorCode.ValidationError,
      when: 'mode is "seasonal" and exactly one of season / season_year is set',
      recovery:
        'For mode "seasonal", send both season and season_year, or neither to rank the current season.',
    },
    {
      reason: 'page_depth_exceeded',
      code: JsonRpcErrorCode.ValidationError,
      when: 'page × per_page reaches past the first 5,000 ranked entries, which AniList refuses to serve',
      recovery:
        'AniList serves only the first 5,000 entries of a result list, so page × per_page must stay at or below 5,000. Narrow the criteria so fewer entries match, or request a lower page.',
      thrownBy: 'service',
    },
  ],

  output: z.object({
    mode: z.enum(['top', 'trending', 'seasonal']).describe('Ranking mode used.'),
    media_type: z.enum(['ANIME', 'MANGA']).describe('Media type ranked.'),
    season_label: z
      .string()
      .nullable()
      .describe(
        'Season the ranking covers: the ranked season in seasonal mode (e.g. "FALL 2024"), or the season/year filter applied in top or trending mode (e.g. "FALL 2024", "FALL (any year)", "2024"). Null for top or trending without a season filter.',
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
        'Exact number of ranked entries, present only on the final page (has_next_page false) and 0 for an empty first page. Null on every other page.',
      ),
    entries: z
      .array(
        z
          .object({
            rank: z.number().int().describe('1-based rank position across pages.'),
            id: z.number().int().describe('AniList media ID.'),
            id_mal: z.number().int().nullable().describe('MyAnimeList ID, or null.'),
            title: z.string().nullable().describe('Romanized title.'),
            title_english: z.string().nullable().describe('English title, or null.'),
            type: z.enum(['ANIME', 'MANGA']).describe('Media type.'),
            format: z.string().nullable().describe('Format: TV, MOVIE, OVA, etc.'),
            status: z.string().nullable().describe('Production status.'),
            season: z.string().nullable().describe('Broadcast season label, or null.'),
            episodes: z.number().int().nullable().describe('Episode count, or null.'),
            chapters: z.number().int().nullable().describe('Chapter count, or null.'),
            mean_score: z.number().nullable().describe('AniList mean score 0–100, or null.'),
            is_adult: z.boolean().describe('Whether marked adult/NSFW.'),
            cover_image_url: z.string().nullable().describe('Cover image URL, or null.'),
          })
          .describe('A ranked media entry.'),
      )
      .describe('Ranked entries.'),
  }),

  async handler(input, ctx) {
    const genre = present(input.genre);
    const tag = present(input.tag);

    if (input.mode === 'seasonal' && !input.season !== !input.season_year) {
      throw ctx.fail(
        'invalid_season',
        `mode "seasonal" needs season and season_year together; got only ${input.season ? 'season' : 'season_year'}`,
      );
    }

    ctx.log.info('Fetching rankings', { mode: input.mode, mediaType: input.media_type });

    const page = await anilist.getRankings({
      mediaType: input.media_type,
      mode: input.mode,
      format: input.format,
      genre,
      tag,
      season: input.season,
      seasonYear: input.season_year,
      page: input.page,
      perPage: input.per_page,
      includeAdult: input.include_adult,
    });

    const seasonLabel =
      input.mode === 'seasonal'
        ? input.season && input.season_year
          ? `${input.season} ${input.season_year}`
          : currentSeasonLabel()
        : seasonFilterLabel(input.season, input.season_year);

    const { currentPage, hasNextPage, perPage } = page.pageInfo;
    const total = exactResultCount({
      page: currentPage,
      perPage,
      hasNextPage,
      entriesOnPage: page.media.length,
    });
    if (total !== null) ctx.enrich.total(total);

    const notices: string[] = [];
    if (page.media.length === 0) {
      const filters: string[] = [`mode=${input.mode}`];
      if (genre) filters.push(`genre="${genre}"`);
      if (tag) filters.push(`tag="${tag}"`);
      if (input.format) filters.push(`format=${input.format}`);
      if (input.season) filters.push(`season=${input.season}`);
      if (input.season_year) filters.push(`season_year=${input.season_year}`);
      const applied = filters.join(', ');
      notices.push(
        currentPage > 1
          ? pastEndNotice(currentPage, `the rankings for ${applied}`)
          : `No entries for ${applied}. Try removing genre, tag, or format filters, or check that the season/year combination exists.${tag ? ' tag must be an AniList tag name; genres such as "Action" or "Mecha" are not tags.' : ''}`,
      );
    }
    if (nextPageOutOfReach({ page: currentPage, perPage, hasNextPage })) {
      notices.push(PAGE_DEPTH_EDGE_NOTICE);
    }
    if (notices.length > 0) ctx.enrich.notice(notices.join(' '));

    const startRank = (currentPage - 1) * perPage + 1;

    return {
      mode: input.mode,
      media_type: input.media_type,
      season_label: seasonLabel,
      page: currentPage,
      has_next_page: hasNextPage,
      total_results: total,
      entries: page.media.map((m, idx) => ({
        rank: startRank + idx,
        id: m.id,
        id_mal: m.idMal ?? null,
        title: m.title.romaji,
        title_english: m.title.english,
        type: m.type,
        format: m.format ?? null,
        status: m.status ?? null,
        season: m.season && m.seasonYear ? `${m.season} ${m.seasonYear}` : (m.season ?? null),
        episodes: m.episodes ?? null,
        chapters: m.chapters ?? null,
        mean_score: m.meanScore ?? null,
        is_adult: m.isAdult,
        cover_image_url: m.coverImage?.large ?? null,
      })),
    };
  },

  format: (result) => {
    const seasonSuffix = result.season_label ? ` · ${result.season_label}` : '';
    const modeLabel =
      result.mode === 'top'
        ? result.season_label
          ? `Top ${result.media_type}${seasonSuffix}`
          : `All-Time Top ${result.media_type}`
        : result.mode === 'trending'
          ? `Trending ${result.media_type}${seasonSuffix}`
          : `${result.season_label ?? 'Current Season'} ${result.media_type}`;

    const lines: string[] = [
      `## ${modeLabel}`,
      `mode: ${result.mode} | season_label: ${result.season_label ?? 'none'}`,
      `Page ${result.page}${result.total_results !== null ? ` · ${result.total_results} total` : ''}`,
      '',
    ];

    for (const entry of result.entries) {
      const title = entry.title_english ?? entry.title ?? 'Unknown';
      const score = entry.mean_score !== null ? ` · ${entry.mean_score}/100` : '';
      const fmt = entry.format ? ` · ${entry.format}` : '';
      const ep = entry.episodes !== null ? ` · ${entry.episodes} eps` : '';
      const chap = entry.chapters !== null ? ` chapters:${entry.chapters}` : '';
      const adult = entry.is_adult ? ' · [Adult]' : '';
      lines.push(
        `${entry.rank}. **${title}** (${entry.title ?? '?'}) [AL:${entry.id}${entry.id_mal !== null ? `/MAL:${entry.id_mal}` : ''}]${fmt}${score}${ep}${chap}${adult}`,
        `   status: ${entry.status ?? 'N/A'} | season: ${entry.season ?? 'N/A'} | cover: ${entry.cover_image_url ?? 'none'}`,
      );
    }

    const nextReachable = nextPageReachable({
      page: result.page,
      hasNextPage: result.has_next_page,
      rowsOnPage: result.entries.length,
    });
    if (nextReachable) {
      lines.push('', `_More results available (page ${result.page + 1})._`);
    }

    return [{ type: 'text', text: lines.join('\n') }];
  },
});
