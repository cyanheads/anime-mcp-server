/**
 * @fileoverview anime_get_studio tool — studio filmography by name or AniList studio ID.
 * @module mcp-server/tools/definitions/anime-get-studio.tool
 */

import { tool, z } from '@cyanheads/mcp-ts-core';
import { JsonRpcErrorCode } from '@cyanheads/mcp-ts-core/errors';
import * as anilist from '@/services/anilist/anilist-service.js';
import { pastEndNotice } from '@/services/anilist/pagination.js';
import type { MediaNode, StudioMediaEdge } from '@/services/anilist/types.js';

/**
 * One row per distinct title on the page, in first-credit order. AniList returns
 * a separate edge per studio credit, so a title with a main and a co-credit arrives
 * twice; the row is main-studio when any of its edges is.
 */
function distinctTitles(edges: StudioMediaEdge[]): { node: MediaNode; isMainStudio: boolean }[] {
  const byId = new Map<number, { node: MediaNode; isMainStudio: boolean }>();
  for (const edge of edges) {
    const row = byId.get(edge.node.id);
    if (row) row.isMainStudio ||= edge.isMainStudio;
    else byId.set(edge.node.id, { node: edge.node, isMainStudio: edge.isMainStudio });
  }
  return [...byId.values()];
}

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
      .describe(
        'Studio name to search for, e.g. "MAPPA", "Kyoto Animation", "ufotable". Trimmed; blank counts as absent. Send either name or id, not both.',
      ),
    id: z
      .number()
      .int()
      .min(1)
      .optional()
      .describe(
        'AniList studio ID for direct lookup. More precise than name search. Send either id or name, not both.',
      ),
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
    per_page: z
      .number()
      .int()
      .min(1)
      .max(25)
      .default(25)
      .describe("Studio credits per page. Maximum 25, AniList's page size for a studio's titles."),
  }),

  enrichment: {
    notice: z
      .string()
      .optional()
      .describe(
        'Set when the page is past the end of the filmography: says to request a lower page.',
      ),
    totalCount: z
      .number()
      .int()
      .optional()
      .describe(
        'Exact number of distinct titles, set only when the whole filmography fits on page 1 (0 for an empty first page). Use has_next_page to paginate.',
      ),
  },

  output: z.object({
    studio_id: z.number().int().describe('AniList studio ID.'),
    studio_name: z.string().describe('Studio name.'),
    is_animation_studio: z
      .boolean()
      .describe('True when this is classified as an animation studio.'),
    studio_site_url: z.string().nullable().describe('AniList studio page URL, or null.'),
    page: z.number().int().describe('Current page number.'),
    has_next_page: z
      .boolean()
      .describe('Whether more pages are available. Drives pagination; stop when false.'),
    total_titles: z
      .number()
      .int()
      .nullable()
      .describe(
        'Exact number of distinct titles, present only when the whole filmography fits on page 1 (0 for an empty first page). Null whenever the filmography spans more than one page.',
      ),
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
            is_main_studio: z
              .boolean()
              .describe(
                'True when this studio is a main studio on the title; false for a co-credit only.',
              ),
            cover_image_url: z.string().nullable().describe('Cover image URL, or null.'),
          })
          .describe('A filmography entry.'),
      )
      .describe(
        "Studio filmography, one row per distinct title within this page. AniList pages the studio's credits rather than its titles, so a title credited on two pages can appear on both.",
      ),
  }),

  errors: [
    {
      reason: 'missing_identifier',
      code: JsonRpcErrorCode.ValidationError,
      when: 'Neither a non-blank name nor an id is provided',
      recovery:
        'Provide either name (e.g. "MAPPA") or id (AniList studio ID) to identify the studio.',
    },
    {
      reason: 'conflicting_inputs',
      code: JsonRpcErrorCode.ValidationError,
      when: 'Both id and a non-blank name are provided',
      recovery:
        'Send either id or name, not both. Use id when you already have it; it is the more precise lookup.',
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
    const name = input.name?.trim() || undefined;

    if (input.id !== undefined && name) {
      throw ctx.fail('conflicting_inputs', 'Send either id or name to look up a studio, not both');
    }
    if (input.id === undefined && !name) {
      throw ctx.fail('missing_identifier', 'Provide either name or id to look up a studio');
    }

    let studio: Awaited<ReturnType<typeof anilist.getStudioById>>;

    if (input.id !== undefined) {
      ctx.log.info('Fetching studio by ID', { id: input.id });
      studio = await anilist.getStudioById({
        id: input.id,
        sort: input.sort,
        page: input.page,
        perPage: input.per_page,
      });
    } else {
      ctx.log.info('Searching studio by name', { name });
      studio = await anilist.searchStudio({
        name: name ?? '',
        sort: input.sort,
        page: input.page,
        perPage: input.per_page,
      });
    }

    if (!studio) {
      throw ctx.fail(
        'not_found',
        input.id !== undefined
          ? `No studio found with AniList ID ${input.id}`
          : `No studio found matching "${name}"`,
      );
    }

    const { currentPage, hasNextPage } = studio.media.pageInfo;
    const rows = distinctTitles(studio.media.edges);

    // AniList counts credits, not titles, and one title's credits can straddle a
    // page boundary, so only a filmography that fits entirely on page 1 has an
    // exact distinct-title count.
    const total = currentPage === 1 && !hasNextPage ? rows.length : null;
    if (total !== null) ctx.enrich.total(total);
    if (rows.length === 0 && currentPage > 1) {
      ctx.enrich.notice(pastEndNotice(currentPage, `${studio.name}'s filmography`));
    }

    return {
      studio_id: studio.id,
      studio_name: studio.name,
      is_animation_studio: studio.isAnimationStudio,
      studio_site_url: studio.siteUrl ?? null,
      page: currentPage,
      has_next_page: hasNextPage,
      total_titles: total,
      filmography: rows.map(({ node: m, isMainStudio }) => ({
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
        is_main_studio: isMainStudio,
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
      const credit = m.is_main_studio ? ' · main studio' : ' · co-credit';
      const malId = m.id_mal !== null ? `/MAL:${m.id_mal}` : '';
      const typeLabel = ` type:${m.type}`;
      const status = m.status ? ` status:${m.status}` : '';
      const seasonYear = m.season_year !== null ? ` season_year:${m.season_year}` : '';
      const cover = m.cover_image_url ? ` cover:${m.cover_image_url}` : '';
      const titleRomaji = m.title ? ` title:${m.title}` : '';
      lines.push(
        `**${displayTitle}** [AL:${m.id}${malId}]${typeLabel}${fmt}${status}${season}${seasonYear}${ep}${score}${adult}${credit}${titleRomaji}${cover}`,
      );
    }

    if (result.has_next_page) {
      lines.push('', `_More titles available (page ${result.page + 1})._`);
    }

    return [{ type: 'text', text: lines.join('\n') }];
  },
});
