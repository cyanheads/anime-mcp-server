/**
 * @fileoverview anime_get_studio tool — studio filmography by name or AniList studio ID.
 * @module mcp-server/tools/definitions/anime-get-studio.tool
 */

import { tool, z } from '@cyanheads/mcp-ts-core';
import { JsonRpcErrorCode } from '@cyanheads/mcp-ts-core/errors';
import * as anilist from '@/services/anilist/anilist-service.js';

export const animeGetStudio = tool('anime_get_studio', {
  description:
    "A studio's full filmography by name or AniList studio ID. " +
    'Returns all titles the studio produced, sortable by year or score, ' +
    'with format, status, and episode count. ' +
    'Provide "name" for a name-based search, or "id" for direct lookup by AniList studio ID.',
  annotations: { readOnlyHint: true, openWorldHint: true },

  input: z.object({
    name: z
      .string()
      .max(200)
      .optional()
      .describe('Studio name to search for, e.g. "MAPPA", "Kyoto Animation", "ufotable".'),
    id: z
      .number()
      .int()
      .min(1)
      .optional()
      .describe('AniList studio ID for direct lookup. More precise than name search.'),
    sort: z
      .enum(['POPULARITY_DESC', 'SCORE_DESC', 'START_DATE_DESC', 'START_DATE'])
      .default('POPULARITY_DESC')
      .describe(
        'Sort order for the filmography. ' +
          'POPULARITY_DESC: most popular first (default). ' +
          'SCORE_DESC: highest-scored first. ' +
          'START_DATE_DESC: newest first. ' +
          'START_DATE: oldest first (release chronology).',
      ),
    page: z.number().int().min(1).default(1).describe('1-based page number.'),
    per_page: z.number().int().min(1).max(50).default(25).describe('Results per page. Maximum 50.'),
  }),

  enrichment: {
    totalCount: z
      .number()
      .int()
      .optional()
      .describe('Total titles in the filmography, when AniList reports it.'),
  },

  output: z.object({
    studio_id: z.number().int().describe('AniList studio ID.'),
    studio_name: z.string().describe('Studio name.'),
    is_animation_studio: z
      .boolean()
      .describe('True when this is classified as an animation studio.'),
    studio_site_url: z.string().nullable().describe('AniList studio page URL, or null.'),
    page: z.number().int().describe('Current page number.'),
    has_next_page: z.boolean().describe('Whether more pages are available.'),
    total_titles: z.number().int().nullable().describe('Total titles in filmography, or null.'),
    filmography: z
      .array(
        z
          .object({
            id: z.number().int().describe('AniList media ID.'),
            id_mal: z.number().int().nullable().describe('MyAnimeList ID, or null.'),
            title: z.string().nullable().describe('Romanized title.'),
            title_english: z.string().nullable().describe('English title, or null.'),
            type: z.enum(['ANIME', 'MANGA']).describe('Media type.'),
            format: z.string().nullable().describe('Format: TV, MOVIE, OVA, etc.'),
            status: z.string().nullable().describe('Production status.'),
            season: z
              .string()
              .nullable()
              .describe('Broadcast season label, e.g. "FALL 2023", or null.'),
            season_year: z.number().int().nullable().describe('Season year, or null.'),
            episodes: z.number().int().nullable().describe('Episode count, or null.'),
            mean_score: z.number().nullable().describe('AniList mean score 0–100, or null.'),
            is_adult: z.boolean().describe('Whether marked adult/NSFW.'),
            cover_image_url: z.string().nullable().describe('Cover image URL, or null.'),
          })
          .describe('A filmography entry.'),
      )
      .describe('Studio filmography entries.'),
  }),

  errors: [
    {
      reason: 'missing_identifier',
      code: JsonRpcErrorCode.ValidationError,
      when: 'Neither name nor id is provided',
      recovery:
        'Provide either name (e.g. "MAPPA") or id (AniList studio ID) to identify the studio.',
    },
    {
      reason: 'not_found',
      code: JsonRpcErrorCode.NotFound,
      when: 'Neither name search nor ID lookup returns a result on AniList',
      recovery:
        'Check the studio name spelling (e.g. "Kyoto Animation" not "KyoAni") or use the correct AniList studio ID.',
    },
  ],

  async handler(input, ctx) {
    if (!input.name && !input.id) {
      throw ctx.fail('missing_identifier', 'Provide either name or id to look up a studio');
    }

    let studio: Awaited<ReturnType<typeof anilist.getStudioById>>;

    if (input.id) {
      ctx.log.info('Fetching studio by ID', { id: input.id });
      studio = await anilist.getStudioById({
        id: input.id,
        sort: input.sort,
        page: input.page,
        perPage: input.per_page,
      });
    } else {
      ctx.log.info('Searching studio by name', { name: input.name });
      studio = await anilist.searchStudio({
        name: input.name ?? '',
        sort: input.sort,
        page: input.page,
        perPage: input.per_page,
      });
    }

    if (!studio) {
      throw ctx.fail(
        'not_found',
        input.id
          ? `No studio found with AniList ID ${input.id}`
          : `No studio found matching "${input.name}"`,
      );
    }

    if (studio.media.pageInfo.total != null) ctx.enrich.total(studio.media.pageInfo.total);

    return {
      studio_id: studio.id,
      studio_name: studio.name,
      is_animation_studio: studio.isAnimationStudio,
      studio_site_url: studio.siteUrl ?? null,
      page: studio.media.pageInfo.currentPage,
      has_next_page: studio.media.pageInfo.hasNextPage,
      total_titles: studio.media.pageInfo.total ?? null,
      filmography: studio.media.nodes.map((m) => ({
        id: m.id,
        id_mal: m.idMal ?? null,
        title: m.title.romaji,
        title_english: m.title.english,
        type: m.type,
        format: m.format ?? null,
        status: m.status ?? null,
        season: m.season && m.seasonYear ? `${m.season} ${m.seasonYear}` : (m.season ?? null),
        season_year: m.seasonYear ?? null,
        episodes: m.episodes ?? null,
        mean_score: m.meanScore ?? null,
        is_adult: m.isAdult,
        cover_image_url: m.coverImage?.large ?? null,
      })),
    };
  },

  format: (result) => {
    const lines: string[] = [
      `## ${result.studio_name} Filmography`,
      `AniList ID: ${result.studio_id}${result.is_animation_studio ? ' · Animation Studio' : ''} | studio_site_url: ${result.studio_site_url ?? 'none'}`,
      `${result.total_titles !== null ? `${result.total_titles} titles` : 'Titles'} · page ${result.page}`,
      '',
    ];

    if (result.filmography.length === 0) {
      lines.push('No titles found.');
      return [{ type: 'text', text: lines.join('\n') }];
    }

    for (const m of result.filmography) {
      const displayTitle = m.title_english ?? m.title ?? 'Unknown';
      const score = m.mean_score !== null ? ` · ${m.mean_score}/100` : '';
      const fmt = m.format ? ` · ${m.format}` : '';
      const ep = m.episodes !== null ? ` · ${m.episodes} eps` : '';
      const season = m.season ? ` · ${m.season}` : '';
      const adult = m.is_adult ? ' · [Adult]' : '';
      const malId = m.id_mal !== null ? `/MAL:${m.id_mal}` : '';
      const typeLabel = ` type:${m.type}`;
      const status = m.status ? ` status:${m.status}` : '';
      const seasonYear = m.season_year !== null ? ` season_year:${m.season_year}` : '';
      const cover = m.cover_image_url ? ` cover:${m.cover_image_url}` : '';
      const titleRomaji = m.title ? ` title:${m.title}` : '';
      lines.push(
        `**${displayTitle}** [AL:${m.id}${malId}]${typeLabel}${fmt}${status}${season}${seasonYear}${ep}${score}${adult}${titleRomaji}${cover}`,
      );
    }

    if (result.has_next_page) {
      lines.push('', `_More titles available (page ${result.page + 1})._`);
    }

    return [{ type: 'text', text: lines.join('\n') }];
  },
});
