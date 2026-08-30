/**
 * @fileoverview anime_get_relations tool — franchise watch/read order via multi-hop relation graph traversal.
 * BFS over AniList relation edges up to max_depth, then topological sort for recommended order.
 * @module mcp-server/tools/definitions/anime-get-relations.tool
 */

import { tool, z } from '@cyanheads/mcp-ts-core';
import { JsonRpcErrorCode } from '@cyanheads/mcp-ts-core/errors';
import * as anilist from '@/services/anilist/anilist-service.js';
import type { MediaNode, MediaRelationEdge, MediaRelationType } from '@/services/anilist/types.js';

/** Priority for topological watch-order sort. Lower = watch earlier. */
const RELATION_ORDER: Record<string, number> = {
  SOURCE: 0,
  ADAPTATION: 1,
  PREQUEL: 2,
  PARENT: 3,
  SUMMARY: 4,
  COMPILATION: 5,
  CONTAINS: 6,
  ALTERNATIVE: 7,
  SIDE_STORY: 8,
  CHARACTER: 9,
  SPIN_OFF: 10,
  OTHER: 11,
  SEQUEL: 12,
};

const SUPPLEMENTARY_TYPES = new Set([
  'SIDE_STORY',
  'SPIN_OFF',
  'CHARACTER',
  'OTHER',
  'COMPILATION',
  'SUMMARY',
  'CONTAINS',
  'ALTERNATIVE',
]);

export const animeGetRelations = tool('anime_get_relations', {
  description:
    'Franchise untangler. Walks the related-works graph from a media ID across multiple hops — ' +
    'sequels, prequels, side stories, movies, OVAs, source/adaptation — and returns them ordered ' +
    'into a suggested watch/read order. This is the "how do I watch this whole series" tool. ' +
    'Use anime_get_media first to confirm the ID.',
  annotations: { readOnlyHint: true, idempotentHint: true },

  input: z.object({
    id: z.number().int().min(1).describe('AniList media ID of any entry in the franchise.'),
    max_depth: z
      .number()
      .int()
      .min(1)
      .max(4)
      .default(2)
      .describe(
        'Maximum hops to traverse from the root entry. Default 2. Maximum 4. ' +
          'Deeper traversal makes more AniList requests — use 3–4 only for large franchises.',
      ),
  }),

  output: z.object({
    root_id: z.number().int().describe('The AniList ID used as the traversal root.'),
    total_entries: z.number().int().describe('Total unique entries found across the franchise.'),
    depth_reached: z.number().int().describe('Actual traversal depth reached.'),
    entries: z
      .array(
        z
          .object({
            id: z.number().int().describe('AniList media ID.'),
            id_mal: z.number().int().nullable().describe('MyAnimeList ID, or null.'),
            title: z.string().nullable().describe('Romanized title.'),
            title_english: z.string().nullable().describe('English title, or null.'),
            type: z.string().nullable().describe('Media type: ANIME or MANGA.'),
            format: z
              .string()
              .nullable()
              .describe('Format: TV, MOVIE, OVA, ONA, MANGA, NOVEL, etc.'),
            status: z.string().nullable().describe('Production status.'),
            season: z
              .string()
              .nullable()
              .describe('Broadcast season label, e.g. "FALL 2023", or null.'),
            season_year: z.number().int().nullable().describe('Year of the season, or null.'),
            episodes: z.number().int().nullable().describe('Episode count, or null.'),
            chapters: z.number().int().nullable().describe('Chapter count, or null.'),
            mean_score: z.number().nullable().describe('AniList mean score 0–100, or null.'),
            is_adult: z.boolean().describe('Whether marked adult/NSFW.'),
            cover_image_url: z.string().nullable().describe('Cover image URL, or null.'),
            relation_to_root: z
              .string()
              .nullable()
              .describe('How this entry relates to the root, or null for the root itself.'),
            watch_order_category: z
              .enum(['main', 'supplementary'])
              .describe(
                '"main" for canonical story (prequels, source, sequels). ' +
                  '"supplementary" for side stories, OVAs, specials, and spin-offs.',
              ),
            is_root: z.boolean().describe('True for the traversal root entry.'),
          })
          .describe('A franchise entry in watch/read order.'),
      )
      .describe(
        'All franchise entries in suggested watch/read order. ' +
          'Main entries first, then supplementary. Within each group, ordered by relation type priority then season year.',
      ),
  }),

  enrichment: {
    totalCount: z
      .number()
      .int()
      .describe('Total unique franchise entries found — the response is complete, not paged.'),
  },

  errors: [
    {
      reason: 'not_found',
      code: JsonRpcErrorCode.NotFound,
      when: 'Root media ID not found on AniList',
      recovery: 'Use anime_search_media to find a valid AniList ID and retry.',
    },
  ],

  async handler(input, ctx) {
    ctx.log.info('Walking franchise relations', { id: input.id, maxDepth: input.max_depth });

    type VisitedEntry = {
      node: MediaNode;
      relationType: MediaRelationType | null;
      depth: number;
    };

    // `enqueued` prevents duplicate BFS queue entries. `visited` is the result map —
    // populated as each node is discovered (from parent edge data) and updated with
    // the correct depth as traversal proceeds.
    const enqueued = new Set<number>([input.id]);
    const visited = new Map<number, VisitedEntry>();
    let maxDepthReached = 0;

    // BFS queue: items whose relations we still need to fetch
    const toVisit: Array<{ id: number; depth: number }> = [{ id: input.id, depth: 0 }];

    while (toVisit.length > 0) {
      const item = toVisit.shift();
      if (item === undefined) break;
      if (item.depth > input.max_depth) continue;

      maxDepthReached = Math.max(maxDepthReached, item.depth);

      const edges: MediaRelationEdge[] | null = await anilist.getMediaRelations(item.id);

      if (item.depth === 0 && edges === null) {
        throw ctx.fail('not_found', `No media found with AniList ID ${input.id}`, {
          ...ctx.recoveryFor('not_found'),
        });
      }

      if (edges === null) continue;

      // For the root, fetch full info to have a complete node
      if (item.depth === 0) {
        const rootMedia = await anilist.getMediaById(input.id);
        if (!rootMedia) {
          throw ctx.fail('not_found', `No media found with AniList ID ${input.id}`, {
            ...ctx.recoveryFor('not_found'),
          });
        }
        visited.set(input.id, {
          node: rootMedia as unknown as MediaNode,
          relationType: null,
          depth: 0,
        });
      }

      // Process edges: register unseen nodes and enqueue for further traversal
      for (const edge of edges) {
        const childId = edge.node.id;
        if (!enqueued.has(childId)) {
          enqueued.add(childId);
          visited.set(childId, {
            node: edge.node,
            relationType: edge.relationType,
            depth: item.depth + 1,
          });
          if (item.depth + 1 <= input.max_depth) {
            toVisit.push({ id: childId, depth: item.depth + 1 });
          }
        }
      }
    }

    // Sort for watch order
    const entries = Array.from(visited.values());
    ctx.enrich.total(visited.size);
    entries.sort((a, b) => {
      const aPriority = RELATION_ORDER[a.relationType ?? 'OTHER'] ?? 11;
      const bPriority = RELATION_ORDER[b.relationType ?? 'OTHER'] ?? 11;
      if (aPriority !== bPriority) return aPriority - bPriority;
      const aYear = a.node.seasonYear ?? 9999;
      const bYear = b.node.seasonYear ?? 9999;
      return aYear - bYear;
    });

    return {
      root_id: input.id,
      total_entries: visited.size,
      depth_reached: maxDepthReached,
      entries: entries.map((e) => ({
        id: e.node.id,
        id_mal: e.node.idMal ?? null,
        title: e.node.title.romaji,
        title_english: e.node.title.english,
        type: e.node.type ?? null,
        format: e.node.format ?? null,
        status: e.node.status ?? null,
        season:
          e.node.season && e.node.seasonYear
            ? `${e.node.season} ${e.node.seasonYear}`
            : (e.node.season ?? null),
        season_year: e.node.seasonYear ?? null,
        episodes: e.node.episodes ?? null,
        chapters: e.node.chapters ?? null,
        mean_score: e.node.meanScore ?? null,
        is_adult: e.node.isAdult,
        cover_image_url: e.node.coverImage?.large ?? null,
        relation_to_root: e.relationType ?? null,
        watch_order_category: (SUPPLEMENTARY_TYPES.has(e.relationType ?? '')
          ? 'supplementary'
          : 'main') as 'main' | 'supplementary',
        is_root: e.node.id === input.id,
      })),
    };
  },

  format: (result) => {
    const lines: string[] = [
      `## Franchise Watch Order (root: AL:${result.root_id})`,
      `${result.total_entries} entries · depth ${result.depth_reached}`,
      '',
    ];

    const main = result.entries.filter((e) => e.watch_order_category === 'main');
    const supplementary = result.entries.filter((e) => e.watch_order_category === 'supplementary');

    if (main.length) {
      lines.push('**Main story order:**');
      for (let i = 0; i < main.length; i++) {
        const e = main[i];
        if (!e) continue;
        const title = e.title_english ?? e.title ?? 'Unknown';
        const score = e.mean_score !== null ? ` (${e.mean_score}/100)` : '';
        const ep =
          e.episodes !== null
            ? ` · ${e.episodes} eps`
            : e.chapters !== null
              ? ` · ${e.chapters} ch`
              : '';
        const rel = e.is_root ? ' ← ROOT' : e.relation_to_root ? ` [${e.relation_to_root}]` : '';
        const typeLabel = e.type ? ` type:${e.type}` : '';
        const fmt = e.format ? ` fmt:${e.format}` : '';
        const status = e.status ? ` status:${e.status}` : '';
        const season = e.season ? ` season:${e.season}` : '';
        const seasonYear = e.season_year !== null ? ` season_year:${e.season_year}` : '';
        const adult = e.is_adult ? ' [Adult]' : '';
        const cover = e.cover_image_url ? ` cover:${e.cover_image_url}` : '';
        const malId = e.id_mal !== null ? `/MAL:${e.id_mal}` : '';
        const chap = e.chapters !== null ? ` chapters:${e.chapters}` : '';
        lines.push(
          `${i + 1}. **${title}** (${e.title ?? '?'}) [AL:${e.id}${malId}]${typeLabel}${fmt}${status}${score}${ep}${chap}${season}${seasonYear}${adult}${rel}`,
          `   relation_to_root: ${e.relation_to_root ?? 'root'} | is_root: ${e.is_root} | is_adult: ${e.is_adult}${cover}`,
        );
      }
    }

    if (supplementary.length) {
      lines.push('', '**Supplementary (side stories, OVAs, spin-offs):**');
      for (const e of supplementary) {
        const title = e.title_english ?? e.title ?? 'Unknown';
        const score = e.mean_score !== null ? ` (${e.mean_score}/100)` : '';
        const fmt = e.format ? ` fmt:${e.format}` : '';
        const rel = e.relation_to_root ? ` [${e.relation_to_root}]` : '';
        const typeLabel = e.type ? ` type:${e.type}` : '';
        const status = e.status ? ` status:${e.status}` : '';
        const season = e.season ? ` season:${e.season}` : '';
        const seasonYear = e.season_year !== null ? ` season_year:${e.season_year}` : '';
        const adult = e.is_adult ? ' [Adult]' : '';
        const cover = e.cover_image_url ? ` cover:${e.cover_image_url}` : '';
        const malId = e.id_mal !== null ? `/MAL:${e.id_mal}` : '';
        const chap = e.chapters !== null ? ` chapters:${e.chapters}` : '';
        lines.push(
          `- **${title}** (${e.title ?? '?'}) [AL:${e.id}${malId}]${typeLabel}${fmt}${status}${score}${chap}${season}${seasonYear}${adult}${rel}`,
          `  relation_to_root: ${e.relation_to_root ?? '?'} | is_root: ${e.is_root} | is_adult: ${e.is_adult}${cover}`,
        );
      }
    }

    return [{ type: 'text', text: lines.join('\n') }];
  },
});
