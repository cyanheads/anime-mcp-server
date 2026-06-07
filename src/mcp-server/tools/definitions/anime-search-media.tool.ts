/**
 * @fileoverview anime_search_media tool — search anime or manga by title, genre, tag, season, etc.
 * AniList primary; Jikan fallback on empty results.
 * @module mcp-server/tools/definitions/anime-search-media.tool
 */

import { tool, z } from '@cyanheads/mcp-ts-core';
import * as anilist from '@/services/anilist/anilist-service.js';
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

export const animeSearchMedia = tool('anime_search_media', {
  description:
    'Search anime or manga by title, genre, tag, season, year, format, or status. ' +
    'Returns ranked results with AniList IDs, titles, scores, format, and episode/chapter counts.',
  annotations: { readOnlyHint: true, openWorldHint: true },

  input: z.object({
    media_type: MediaTypeEnum,
    query: z.string().max(200).optional().describe('Title search query. Supports partial matches.'),
    genre: z
      .string()
      .max(100)
      .optional()
      .describe('Genre filter, e.g. "Action", "Romance", "Slice of Life".'),
    tag: z
      .string()
      .max(100)
      .optional()
      .describe('Tag filter, e.g. "Isekai", "Mecha", "School Life".'),
    season: SeasonEnum.optional(),
    season_year: z
      .number()
      .int()
      .min(1940)
      .max(2100)
      .optional()
      .describe('4-digit year for the broadcast season, e.g. 2024. Required when season is set.'),
    format: FormatEnum.optional(),
    status: StatusEnum.optional(),
    sort: z
      .array(
        z.string().max(50).describe('A sort field string, e.g. "SCORE_DESC" or "POPULARITY_DESC".'),
      )
      .max(5)
      .optional()
      .describe(
        'Sort order list. Common values: SEARCH_MATCH (default), SCORE_DESC, POPULARITY_DESC, TRENDING_DESC, START_DATE_DESC.',
      ),
    page: z.number().int().min(1).default(1).describe('1-based page number for paginated results.'),
    per_page: z.number().int().min(1).max(50).default(20).describe('Results per page. Maximum 50.'),
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
        'Recovery guidance when results is empty — echoes applied filters and suggests how to broaden the search.',
      ),
  },

  output: z.object({
    source: z
      .enum(['anilist', 'jikan'])
      .describe('Which API provided these results: "anilist" (primary) or "jikan" (fallback).'),
    page: z.number().int().describe('Current page number.'),
    has_next_page: z.boolean().describe('Whether more pages are available.'),
    total_results: z
      .number()
      .int()
      .nullable()
      .describe('Total matching results, or null when unknown.'),
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
    ctx.log.info('Searching anime/manga', {
      mediaType: input.media_type,
      query: input.query,
      genre: input.genre,
      tag: input.tag,
      season: input.season,
    });

    const page = await anilist.searchMedia({
      mediaType: input.media_type,
      query: input.query,
      genre: input.genre,
      tag: input.tag,
      season: input.season,
      seasonYear: input.season_year,
      format: input.format,
      status: input.status,
      sort: input.sort,
      page: input.page,
      perPage: input.per_page,
      includeAdult: input.include_adult,
    });

    // AniList returned results
    if (page.media.length > 0) {
      return {
        source: 'anilist' as const,
        page: page.pageInfo.currentPage,
        has_next_page: page.pageInfo.hasNextPage,
        total_results: page.pageInfo.total ?? null,
        results: page.media.map((m) => ({
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
        })),
      };
    }

    // Fallback to Jikan when AniList returns nothing and there's a text query
    if (input.query) {
      ctx.log.info('AniList returned no results, trying Jikan fallback', { query: input.query });
      const jikanResult = await jikan.searchMedia({
        query: input.query,
        mediaType: input.media_type,
        page: input.page,
        limit: input.per_page,
      });

      return {
        source: 'jikan' as const,
        page: jikanResult.pagination?.current_page ?? input.page,
        has_next_page: jikanResult.pagination?.has_next_page ?? false,
        total_results: jikanResult.pagination?.items.total ?? null,
        results: jikanResult.results.map((r) => ({
          id: 0, // Jikan doesn't provide AniList IDs
          id_mal: r.mal_id,
          title_romaji: r.title,
          title_english: r.title_english,
          title_native: null,
          type: input.media_type,
          format: r.type ?? null,
          status: r.status ?? null,
          season: null,
          episodes: r.episodes ?? null,
          chapters: r.chapters ?? null,
          mean_score: r.score ? Math.round(r.score * 10) : null,
          is_adult: false,
          cover_image_url: null,
        })),
      };
    }

    // No results from either source
    const filters: string[] = [];
    if (input.query) filters.push(`query="${input.query}"`);
    if (input.genre) filters.push(`genre="${input.genre}"`);
    if (input.tag) filters.push(`tag="${input.tag}"`);
    if (input.season) filters.push(`season=${input.season}`);
    if (input.season_year) filters.push(`season_year=${input.season_year}`);
    if (input.format) filters.push(`format=${input.format}`);
    if (input.status) filters.push(`status=${input.status}`);
    const filterDesc = filters.length > 0 ? filters.join(', ') : 'the given filters';
    ctx.enrich.notice(
      `No results for ${filterDesc}. Try broadening the search: remove filters, check spelling, or use a genre instead of a tag (e.g. genre="Action" rather than tag="Action").`,
    );
    return {
      source: 'anilist' as const,
      page: input.page,
      has_next_page: false,
      total_results: 0,
      results: [],
    };
  },

  format: (result) => {
    if (result.results.length === 0) {
      return [{ type: 'text', text: `No results found (source: ${result.source}).` }];
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

    if (result.has_next_page) {
      lines.push('', `_More results available (page ${result.page + 1})._`);
    }

    return [{ type: 'text', text: lines.join('\n') }];
  },
});
