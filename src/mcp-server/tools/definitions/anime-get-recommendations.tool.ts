/**
 * @fileoverview anime_get_recommendations tool — merged recommendations from AniList and Jikan.
 * @module mcp-server/tools/definitions/anime-get-recommendations.tool
 */

import { tool, z } from '@cyanheads/mcp-ts-core';
import * as anilist from '@/services/anilist/anilist-service.js';
import type { MediaType } from '@/services/anilist/types.js';
import * as jikan from '@/services/jikan/jikan-service.js';

export const animeGetRecommendations = tool('anime_get_recommendations', {
  description:
    'Recommendations for a title, merged from AniList and Jikan (MAL), with scores and vote counts. ' +
    'AniList recommendations use community rating scores; Jikan adds MAL user recommendations with vote counts. ' +
    'Both sources are surfaced separately — not blended into a composite score.',
  annotations: { readOnlyHint: true, idempotentHint: true },

  input: z.object({
    id: z
      .number()
      .int()
      .min(1)
      .describe('AniList media ID of the title to get recommendations for.'),
    liked_aspects: z
      .string()
      .max(500)
      .optional()
      .describe(
        'What you liked about this title — e.g. "the slow-burn romance" or "mecha action". ' +
          'Returned as-is in the response.',
      ),
    page: z
      .number()
      .int()
      .min(1)
      .default(1)
      .describe('1-based page number for AniList recommendations.'),
    per_page: z
      .number()
      .int()
      .min(1)
      .max(25)
      .default(25)
      .describe('Recommendations per page from AniList. Maximum 25.'),
  }),

  output: z.object({
    source_id: z.number().int().describe('AniList ID of the source title.'),
    source_id_mal: z.number().int().nullable().describe('MAL ID of the source title, or null.'),
    source_type: z.string().nullable().describe('Source media type: ANIME or MANGA.'),
    liked_aspects: z.string().nullable().describe('Liked aspects provided by the caller, or null.'),
    has_next_page: z.boolean().describe('Whether more AniList recommendations are available.'),
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
        'Merged recommendations, sorted by AniList rating descending. ' +
          'Items appear once even if both sources recommend them; sources array lists all contributors.',
      ),
  }),

  async handler(input, ctx) {
    ctx.log.info('Fetching recommendations', { id: input.id });

    // Get AniList recs — also fetches idMal for Jikan fan-out
    const anilistRecs = await anilist.getRecommendations({
      mediaId: input.id,
      page: input.page,
      perPage: input.per_page,
    });

    // Need media detail for idMal and type
    const mediaDetail = await anilist.getMediaById(input.id);
    const idMal = mediaDetail?.idMal ?? null;
    const mediaType: MediaType = mediaDetail?.type ?? 'ANIME';

    // Fetch Jikan recs (supplement — degrades gracefully)
    let jikanRecs: Awaited<ReturnType<typeof jikan.getRecommendations>> = [];
    if (idMal) {
      try {
        jikanRecs = await jikan.getRecommendations(idMal, mediaType);
      } catch (err) {
        ctx.log.warning('Jikan recommendations failed', { error: String(err) });
      }
    }

    // Build Jikan vote map keyed by MAL ID
    const jikanVoteMap = new Map<number, number>();
    for (const rec of jikanRecs) {
      jikanVoteMap.set(rec.entry.mal_id, rec.votes);
    }

    // Merge: AniList records are primary, supplement with Jikan votes
    const merged = anilistRecs.nodes
      .filter((n) => n.mediaRecommendation !== null)
      .map((n) => {
        const m = n.mediaRecommendation!;
        const jikanVotes = m.idMal ? (jikanVoteMap.get(m.idMal) ?? null) : null;
        // Remove from Jikan map so we know what's left (Jikan-only recs)
        if (m.idMal) jikanVoteMap.delete(m.idMal);

        const sources: Array<'anilist' | 'jikan'> = ['anilist'];
        if (jikanVotes !== null) sources.push('jikan');

        return {
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
        };
      });

    // Sort by AniList rating descending
    merged.sort((a, b) => (b.anilist_rating ?? 0) - (a.anilist_rating ?? 0));

    return {
      source_id: input.id,
      source_id_mal: idMal,
      source_type: mediaType,
      liked_aspects: input.liked_aspects ?? null,
      has_next_page: anilistRecs.hasNextPage,
      recommendations: merged,
    };
  },

  format: (result) => {
    const lines: string[] = [
      `## Recommendations for AL:${result.source_id}${result.source_id_mal ? ` / MAL:${result.source_id_mal}` : ''}`,
      `source_type: ${result.source_type ?? 'N/A'}`,
    ];

    if (result.liked_aspects) {
      lines.push(`_Based on liking: "${result.liked_aspects}"_`);
    }

    lines.push('');

    if (result.recommendations.length === 0) {
      lines.push('No recommendations found.');
      return [{ type: 'text', text: lines.join('\n') }];
    }

    for (const rec of result.recommendations) {
      const title = rec.title_english ?? rec.title ?? 'Unknown';
      const score = rec.mean_score !== null ? ` · ${rec.mean_score}/100` : '';
      const fmt = rec.format ? ` · ${rec.format}` : '';
      const alRating = rec.anilist_rating !== null ? ` · AL rating: ${rec.anilist_rating}` : '';
      const jVotes = rec.jikan_votes !== null ? ` · MAL votes: ${rec.jikan_votes}` : '';
      const sources = rec.sources.join('+');
      lines.push(
        `**${title}** (${rec.title ?? '?'}) [AL:${rec.id}${rec.id_mal !== null ? `/MAL:${rec.id_mal}` : ''}] type:${rec.type ?? 'N/A'}${fmt}${score}${alRating}${jVotes} _(${sources})_`,
        `  status: ${rec.status ?? 'N/A'} | cover: ${rec.cover_image_url ?? 'none'}`,
      );
    }

    if (result.has_next_page) {
      lines.push(
        '',
        `_More recommendations available (page ${result.recommendations.length > 0 ? 'next' : '1'})._`,
      );
    }

    return [{ type: 'text', text: lines.join('\n') }];
  },
});
