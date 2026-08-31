/**
 * @fileoverview anime://media/{id} resource — full media record by AniList ID.
 * Delegates to the same service layer as anime_get_media for stable URI-injectable context.
 * @module mcp-server/resources/definitions/anime-media.resource
 */

import { resource, z } from '@cyanheads/mcp-ts-core';
import { notFound } from '@cyanheads/mcp-ts-core/errors';
import * as anilist from '@/services/anilist/anilist-service.js';
import * as jikan from '@/services/jikan/jikan-service.js';
import * as kitsu from '@/services/kitsu/kitsu-service.js';

export const animeMediaResource = resource('anime://media/{id}', {
  name: 'anime-media',
  description:
    'Full media record for an anime or manga by AniList ID. ' +
    'Returns the same data as anime_get_media — title, synopsis, scores, studios, tags, streaming links. ' +
    'Use as a stable URI for injectable context about a specific title.',
  mimeType: 'application/json',
  params: z.object({
    id: z
      .string()
      .describe('AniList media ID as a string, e.g. "16498". Obtain from anime_search_media.'),
  }),
  output: z.object({
    id: z.number().int().describe('AniList media ID.'),
    id_mal: z.number().int().nullable().describe('MyAnimeList ID, or null.'),
    type: z.string().describe('Media type: ANIME or MANGA.'),
    title: z
      .object({
        romaji: z.string().nullable().describe('Romanized title.'),
        english: z.string().nullable().describe('English title, or null.'),
        native: z.string().nullable().describe('Native script title, or null.'),
      })
      .describe('Title variants.'),
    format: z.string().nullable().describe('Format: TV, MOVIE, OVA, MANGA, etc.'),
    status: z.string().nullable().describe('Production status.'),
    season: z.string().nullable().describe('Broadcast season label, or null.'),
    description: z.string().nullable().describe('Normalized full plot synopsis text, or null.'),
    episodes: z.number().int().nullable().describe('Episode count (anime), or null.'),
    chapters: z.number().int().nullable().describe('Chapter count (manga), or null.'),
    genres: z.array(z.string().describe('A genre label.')).describe('Genre list.'),
    mean_score: z.number().nullable().describe('AniList mean score 0–100, or null.'),
    mal_score: z.number().nullable().describe('MAL score 0–10.0, or null.'),
    streaming_count: z.number().int().describe('Number of streaming platforms found.'),
    cover_image_url: z.string().nullable().describe('Cover image URL, or null.'),
    site_url: z.string().nullable().describe('AniList page URL.'),
  }),

  async handler(params, ctx) {
    const numericId = parseInt(params.id, 10);
    if (Number.isNaN(numericId) || numericId < 1) {
      throw notFound(`Invalid AniList media ID: ${params.id}`);
    }

    ctx.log.info('Fetching anime media resource', { id: numericId });

    const detail = await anilist.getMediaById(numericId);
    if (!detail) {
      throw notFound(`No media found with AniList ID ${numericId}`, { id: numericId });
    }

    // Fan out to supplements in parallel
    const [jikanResult, kitsuResult] = await Promise.allSettled([
      detail.idMal ? jikan.getMediaFull(detail.idMal, detail.type) : Promise.resolve(null),
      detail.type === 'ANIME' && detail.idMal
        ? kitsu.getAnimeStreamingByMalId(detail.idMal)
        : Promise.resolve(null),
    ]);

    const jikanData = jikanResult.status === 'fulfilled' ? jikanResult.value : null;
    const kitsuData = kitsuResult.status === 'fulfilled' ? kitsuResult.value : null;

    // Count streaming links
    let streamingCount = 0;
    if (kitsuData?.streamingLinks?.length) {
      streamingCount = kitsuData.streamingLinks.length;
    } else if (detail.type === 'ANIME') {
      streamingCount = (detail.externalLinks ?? []).filter((l) => l.type === 'STREAMING').length;
    }

    const season =
      detail.season && detail.seasonYear
        ? `${detail.season} ${detail.seasonYear}`
        : (detail.season ?? null);

    return {
      id: detail.id,
      id_mal: detail.idMal ?? null,
      type: detail.type,
      title: {
        romaji: detail.title.romaji,
        english: detail.title.english,
        native: detail.title.native,
      },
      format: detail.format ?? null,
      status: detail.status ?? null,
      season,
      description: detail.description ?? null,
      episodes: detail.episodes ?? null,
      chapters: detail.chapters ?? null,
      genres: detail.genres ?? [],
      mean_score: detail.meanScore ?? null,
      mal_score: jikanData?.score ?? null,
      streaming_count: streamingCount,
      cover_image_url: detail.coverImage?.extraLarge ?? null,
      site_url: detail.siteUrl ?? null,
    };
  },
});
