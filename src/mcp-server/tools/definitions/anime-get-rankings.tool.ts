/**
 * @fileoverview anime_get_rankings tool — top, trending, or seasonal rankings.
 * @module mcp-server/tools/definitions/anime-get-rankings.tool
 */

import { tool, z } from '@cyanheads/mcp-ts-core';
import * as anilist from '@/services/anilist/anilist-service.js';

const SeasonEnum = z
  .enum(['WINTER', 'SPRING', 'SUMMER', 'FALL'])
  .describe(
    'Anime broadcast season. WINTER=Jan–Mar, SPRING=Apr–Jun, SUMMER=Jul–Sep, FALL=Oct–Dec.',
  );
const FormatEnum = z
  .enum(['TV', 'TV_SHORT', 'MOVIE', 'SPECIAL', 'OVA', 'ONA', 'MUSIC', 'MANGA', 'NOVEL', 'ONE_SHOT'])
  .describe('Publication/broadcast format filter.');

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
    genre: z.string().optional().describe('Genre filter, e.g. "Action", "Romance".'),
    season: SeasonEnum.optional().describe(
      'Season for "seasonal" mode. Defaults to current season.',
    ),
    season_year: z
      .number()
      .int()
      .min(1940)
      .max(2100)
      .optional()
      .describe('Year for "seasonal" mode. Defaults to current year.'),
    page: z.number().int().min(1).default(1).describe('1-based page number.'),
    per_page: z.number().int().min(1).max(50).default(25).describe('Results per page. Maximum 50.'),
    include_adult: z
      .boolean()
      .default(false)
      .describe('Include adult/NSFW content. Default false.'),
  }),

  output: z.object({
    mode: z.enum(['top', 'trending', 'seasonal']).describe('Ranking mode used.'),
    media_type: z.enum(['ANIME', 'MANGA']).describe('Media type ranked.'),
    season_label: z
      .string()
      .nullable()
      .describe('Season label for seasonal mode, e.g. "FALL 2024", or null.'),
    page: z.number().int().describe('Current page number.'),
    has_next_page: z.boolean().describe('Whether more pages are available.'),
    total_results: z.number().int().nullable().describe('Total matching results, or null.'),
    entries: z
      .array(
        z
          .object({
            rank: z.number().int().describe('1-based rank position on this page.'),
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
    ctx.log.info('Fetching rankings', { mode: input.mode, mediaType: input.media_type });

    const page = await anilist.getRankings({
      mediaType: input.media_type,
      mode: input.mode,
      format: input.format,
      genre: input.genre,
      season: input.season,
      seasonYear: input.season_year,
      page: input.page,
      perPage: input.per_page,
      includeAdult: input.include_adult,
    });

    // Compute season label for seasonal mode
    let seasonLabel: string | null = null;
    if (input.mode === 'seasonal') {
      if (input.season && input.season_year) {
        seasonLabel = `${input.season} ${input.season_year}`;
      } else {
        // Auto-computed in service
        const now = new Date();
        const month = now.getMonth() + 1;
        const year = now.getFullYear();
        const season =
          month <= 3 ? 'WINTER' : month <= 6 ? 'SPRING' : month <= 9 ? 'SUMMER' : 'FALL';
        seasonLabel = `${season} ${year}`;
      }
    }

    const startRank = (input.page - 1) * input.per_page + 1;

    return {
      mode: input.mode,
      media_type: input.media_type,
      season_label: seasonLabel,
      page: page.pageInfo.currentPage,
      has_next_page: page.pageInfo.hasNextPage,
      total_results: page.pageInfo.total ?? null,
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
    const modeLabel =
      result.mode === 'top'
        ? `All-Time Top ${result.media_type}`
        : result.mode === 'trending'
          ? `Trending ${result.media_type}`
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

    if (result.has_next_page) {
      lines.push('', `_More results available (page ${result.page + 1})._`);
    }

    return [{ type: 'text', text: lines.join('\n') }];
  },
});
