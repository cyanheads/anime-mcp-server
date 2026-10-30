/**
 * @fileoverview Source-specific AniList or Jikan recommendations with vote provenance.
 * @module mcp-server/tools/definitions/anime-get-recommendations.tool
 */

import { tool, z } from '@cyanheads/mcp-ts-core';
import { JsonRpcErrorCode, McpError } from '@cyanheads/mcp-ts-core/errors';
import {
  markdownImage,
  escapeMarkdownInline as text,
  withRetry,
} from '@cyanheads/mcp-ts-core/utils';
import * as anilist from '@/services/anilist/anilist-service.js';
import type { RecommendationNode } from '@/services/anilist/types.js';
import * as jikan from '@/services/jikan/jikan-service.js';

export const animeGetRecommendations = tool('anime_get_recommendations', {
  description:
    'Find recommendations for an AniList media ID. source anilist (default) pages AniList community recommendations and adds matching MAL vote counts when available. source jikan deduplicates the list supplied by Jikan using maximum votes, sorts by votes descending then MAL ID ascending, pages those candidates locally, and resolves up to 25 selected IDs through AniList; adult and unresolved candidates are omitted without changing candidate pagination. Jikan pages do not guarantee a global ranking or a snapshot across calls. Check source, jikan_status and has_next_page; repeat the same source, id and per_page with the next page to continue. Ratings and vote counts stay separate. Selected-source failures require retrying or switching to anilist; optional annotation failure is reported as unavailable.',
  annotations: { readOnlyHint: true, idempotentHint: true },

  input: z.object({
    source: z
      .enum(['anilist', 'jikan'])
      .default('anilist')
      .describe(
        'Recommendation source and paging strategy. AniList pages its recommendations; Jikan locally pages its supplied candidate list.',
      ),
    id: z
      .number()
      .int()
      .min(1)
      .max(2147483647)
      .describe('AniList media ID of the title to get recommendations for.'),
    liked_aspects: z
      .string()
      .max(500)
      .optional()
      .describe(
        'What you liked about this title, such as the slow-burn romance or mecha action. Returned as-is in the response.',
      ),
    page: z
      .number()
      .int()
      .min(1)
      .default(1)
      .describe(
        '1-based page number within the selected source; Jikan pages its supplied list locally.',
      ),
    per_page: z
      .number()
      .int()
      .min(1)
      .max(25)
      .default(25)
      .describe(
        'Recommendations per AniList page or Jikan candidates per local page before adult/unresolved omissions. Maximum 25.',
      ),
  }),

  enrichment: {
    truncated: z
      .boolean()
      .optional()
      .describe(
        'True when this page of recommendations was capped at per_page. Present only when the cap was hit.',
      ),
    shown: z
      .number()
      .int()
      .optional()
      .describe('Number of recommendations returned on this page. Present alongside truncated.'),
    cap: z
      .number()
      .int()
      .optional()
      .describe('The per-page limit applied. Present alongside truncated.'),
    notice: z
      .string()
      .optional()
      .describe('Next-page guidance. Present only when the recommendations page was capped.'),
  },

  output: z.object({
    source: z.enum(['anilist', 'jikan']).describe('Selected recommendation source.'),
    jikan_status: z
      .enum(['available', 'unavailable', 'not_applicable'])
      .describe(
        'Whether Jikan supplied its list, failed as an optional supplement, or the source has no MAL mapping.',
      ),
    source_id: z.number().int().describe('AniList ID of the source title.'),
    source_id_mal: z.number().int().nullable().describe('MAL ID of the source title, or null.'),
    source_type: z.string().nullable().describe('Source media type: ANIME or MANGA.'),
    liked_aspects: z.string().nullable().describe('Liked aspects provided by the caller, or null.'),
    has_next_page: z
      .boolean()
      .describe(
        'Whether the selected source has another page. Jikan follows candidate slicing even when selected candidates do not resolve.',
      ),
    recommendations: z
      .array(
        z
          .object({
            id: z.number().int().describe('AniList media ID of the recommended title.'),
            id_mal: z
              .number()
              .int()
              .nullable()
              .describe('MAL ID of the recommended title, or null.'),
            title: z.string().nullable().describe('Romanized title.'),
            title_english: z.string().nullable().describe('English title, or null.'),
            type: z.string().nullable().describe('Media type.'),
            format: z.string().nullable().describe('Format: TV, MOVIE, OVA, etc.'),
            status: z.string().nullable().describe('Production status.'),
            mean_score: z.number().nullable().describe('AniList mean score 0–100, or null.'),
            cover_image_url: z.string().nullable().describe('Cover image URL, or null.'),
            anilist_rating: z
              .number()
              .int()
              .nullable()
              .describe('AniList community recommendation rating. Higher = more recommended.'),
            jikan_votes: z
              .number()
              .int()
              .nullable()
              .describe('MAL user recommendation vote count, or null when not in Jikan results.'),
            sources: z
              .array(
                z
                  .enum(['anilist', 'jikan'])
                  .describe('A source that includes this recommendation.'),
              )
              .describe('Which sources include this recommendation.'),
          })
          .describe('A recommendation entry.'),
      )
      .describe(
        'Recommendations in selected-source order: AniList rating descending, or Jikan maximum votes descending then MAL ID ascending. Jikan-only pages omit adult/unresolved candidates and retain sources jikan with null anilist_rating.',
      ),
  }),

  errors: [
    {
      reason: 'not_found',
      code: JsonRpcErrorCode.NotFound,
      when: 'AniList has no media record for the requested source ID',
      recovery: 'Use anime_search_media to find a valid AniList ID and retry.',
    },
    {
      reason: 'jikan_unavailable',
      code: JsonRpcErrorCode.ServiceUnavailable,
      when: 'The selected Jikan recommendation source is unavailable.',
      retryable: true,
      recovery: 'Retry the same request or use source anilist for AniList recommendations.',
    },
    {
      reason: 'resolution_unavailable',
      code: JsonRpcErrorCode.ServiceUnavailable,
      when: 'AniList could not resolve the selected Jikan candidates.',
      retryable: true,
      recovery: 'Retry the same Jikan page or use source anilist for AniList recommendations.',
    },
    {
      reason: 'retry_deadline_exceeded',
      code: JsonRpcErrorCode.Timeout,
      when: 'The complete recommendation operation exceeds its shared time budget.',
      retryable: true,
      thrownBy: 'service',
      recovery: 'Retry the same page or use source anilist if Jikan is unavailable.',
    },
  ],

  handler(input, ctx) {
    ctx.log.info('Fetching recommendations', { id: input.id });
    // One budget includes source lookup, retries, pacing, resolution and optional annotations.
    return withRetry(
      async ({ signal }) => {
        const mediaDetail = await anilist.getMediaById(input.id, false, signal);
        if (!mediaDetail) {
          throw ctx.fail('not_found', `No media found with AniList ID ${input.id}`);
        }
        const idMal = mediaDetail.idMal ?? null;
        const mediaType = mediaDetail.type;

        let nodes: RecommendationNode[] = [];
        let hasNextPage = false;
        if (input.source === 'anilist') {
          const recommendations = await anilist.getRecommendations({
            mediaId: input.id,
            page: input.page,
            perPage: input.per_page,
            signal,
          });
          nodes = recommendations.nodes;
          hasNextPage = recommendations.hasNextPage;
        }

        let jikanStatus: 'available' | 'unavailable' | 'not_applicable' = 'not_applicable';
        let jikanRecs: Awaited<ReturnType<typeof jikan.getRecommendations>> = [];
        if (idMal) {
          try {
            jikanRecs = await jikan.getRecommendations(
              idMal,
              mediaType,
              input.source === 'anilist' ? { signal, maxRetries: 0, deadlineMs: 5000 } : { signal },
            );
            jikanStatus = 'available';
          } catch (err) {
            ctx.signal.throwIfAborted();
            signal.throwIfAborted();
            if (err instanceof Error && err.name === 'AbortError') throw err;
            if (
              err instanceof McpError &&
              (err.code === JsonRpcErrorCode.InvalidParams ||
                err.code === JsonRpcErrorCode.ValidationError)
            )
              throw err;
            if (input.source === 'jikan')
              throw ctx.fail(
                'jikan_unavailable',
                'Jikan recommendations could not be retrieved.',
                undefined,
                { cause: err },
              );
            jikanStatus = 'unavailable';
          }
        }

        // Build Jikan vote map keyed by MAL ID
        const jikanVoteMap = new Map<number, number>();
        for (const rec of jikanRecs) {
          jikanVoteMap.set(
            rec.entry.mal_id,
            Math.max(jikanVoteMap.get(rec.entry.mal_id) ?? rec.votes, rec.votes),
          );
        }

        if (input.source === 'jikan' && idMal) {
          const candidates = [...jikanVoteMap].sort(
            ([idA, votesA], [idB, votesB]) => votesB - votesA || idA - idB,
          );
          const offset = (input.page - 1) * input.per_page;
          const selected = candidates.slice(offset, offset + input.per_page);
          hasNextPage = offset + selected.length < candidates.length;
          if (selected.length) {
            try {
              const resolved = await anilist.getMediaByMalIds(
                selected.map(([id]) => id),
                mediaType,
                false,
                signal,
              );
              nodes = selected.flatMap(([id]) => {
                const media = resolved.get(id);
                return media ? [{ rating: null, mediaRecommendation: media }] : [];
              });
            } catch (err) {
              ctx.signal.throwIfAborted();
              signal.throwIfAborted();
              if (err instanceof Error && err.name === 'AbortError') throw err;
              if (
                err instanceof McpError &&
                (err.code === JsonRpcErrorCode.InvalidParams ||
                  err.code === JsonRpcErrorCode.ValidationError)
              )
                throw err;
              throw ctx.fail(
                'resolution_unavailable',
                'AniList could not resolve this Jikan recommendation page.',
                undefined,
                { cause: err },
              );
            }
          }
        }

        const merged = nodes.flatMap((n) => {
          if (n.mediaRecommendation === null) return [];
          const m = n.mediaRecommendation;
          const jikanVotes = m.idMal ? (jikanVoteMap.get(m.idMal) ?? null) : null;
          const sources: Array<'anilist' | 'jikan'> =
            input.source === 'jikan'
              ? ['jikan']
              : jikanVotes !== null
                ? ['anilist', 'jikan']
                : ['anilist'];

          return [
            {
              id: m.id,
              id_mal: m.idMal ?? null,
              title: m.title.romaji,
              title_english: m.title.english,
              type: m.type ?? null,
              format: m.format ?? null,
              status: m.status ?? null,
              mean_score: m.meanScore ?? null,
              cover_image_url: m.coverImage?.large ?? null,
              anilist_rating: n.rating ?? null,
              jikan_votes: jikanVotes,
              sources,
            },
          ];
        });

        // Sort by AniList rating descending
        if (input.source === 'anilist')
          merged.sort((a, b) => (b.anilist_rating ?? 0) - (a.anilist_rating ?? 0));

        if (hasNextPage) {
          ctx.enrich.truncated({
            shown: merged.length,
            cap: input.per_page,
            guidance: `More recommendations are available. Call anime_get_recommendations with page ${input.page + 1}, source ${input.source}, the same id, and the same per_page to continue.`,
          });
        }

        return {
          source: input.source,
          jikan_status: jikanStatus,
          source_id: input.id,
          source_id_mal: idMal,
          source_type: mediaType,
          liked_aspects: input.liked_aspects ?? null,
          has_next_page: hasNextPage,
          recommendations: merged,
        };
      },
      {
        signal: ctx.signal,
        deadlineMs: 50000,
        maxRetries: 0,
        operation: 'recommendations',
        context: ctx,
      },
    );
  },

  format: (result) => {
    const lines: string[] = [
      `## Recommendations for AL:${result.source_id}${result.source_id_mal ? ` / MAL:${result.source_id_mal}` : ''}`,
      `source_type: ${text(result.source_type ?? 'N/A')}`,
      `source: ${result.source} | jikan_status: ${result.jikan_status} | has_next_page: ${result.has_next_page}`,
    ];

    if (result.liked_aspects) {
      lines.push(`_Based on liking: "${text(result.liked_aspects)}"_`);
    }

    lines.push('');

    if (result.recommendations.length === 0) {
      lines.push('No recommendations found.');
      return [{ type: 'text', text: lines.join('\n') }];
    }

    for (const rec of result.recommendations) {
      const title = rec.title_english ?? rec.title ?? 'Unknown';
      const score = rec.mean_score !== null ? ` · ${rec.mean_score}/100` : '';
      const fmt = rec.format ? ` · ${text(rec.format)}` : '';
      const alRating = rec.anilist_rating !== null ? ` · AL rating: ${rec.anilist_rating}` : '';
      const jVotes = rec.jikan_votes !== null ? ` · MAL votes: ${rec.jikan_votes}` : '';
      const sources = rec.sources.join('+');
      lines.push(
        `**${text(title)}** (${text(rec.title ?? '?')}) [AL:${rec.id}${rec.id_mal !== null ? `/MAL:${rec.id_mal}` : ''}] type:${text(rec.type ?? 'N/A')}${fmt}${score}${alRating}${jVotes} _(${sources})_`,
        `  status: ${text(rec.status ?? 'N/A')} | cover: ${rec.cover_image_url ? markdownImage('cover', rec.cover_image_url) : 'none'}`,
      );
    }

    if (result.has_next_page) {
      lines.push(
        '',
        `_More ${result.source} recommendation candidates are available; continue with the next page and the same source._`,
      );
    }

    return [{ type: 'text', text: lines.join('\n') }];
  },
});
