/**
 * @fileoverview anime://media/{id} resource — compact media record by AniList ID.
 * @module mcp-server/resources/definitions/anime-media.resource
 */

import { resource, z } from '@cyanheads/mcp-ts-core';
import { JsonRpcErrorCode } from '@cyanheads/mcp-ts-core/errors';
import * as anilist from '@/services/anilist/anilist-service.js';
import * as jikan from '@/services/jikan/jikan-service.js';
import * as kitsu from '@/services/kitsu/kitsu-service.js';
import { mergeStreamingLinks } from '@/services/streaming-links.js';

export const animeMediaResource = resource('anime://media/{id}', {
  name: 'anime-media',
  description:
    'Compact record for a non-adult anime or manga by AniList ID: titles, full normalized synopsis, format, status, season, episode/chapter counts, genres, AniList/MAL scores, streaming count, cover and site URLs. Use anime_get_media for tags, studios, streaming links, or adult titles with include_adult: true.',
  mimeType: 'application/json',
  params: z.object({
    id: z
      .string()
      .describe('AniList media ID as a string, e.g. "16498". Obtain from anime_search_media.'),
  }),
  errors: [
    {
      reason: 'adult_content',
      code: JsonRpcErrorCode.ValidationError,
      when: 'The requested title is adult content',
      recovery: 'Call anime_get_media for the same ID with include_adult: true.',
    },
    {
      reason: 'not_found',
      code: JsonRpcErrorCode.NotFound,
      when: 'A valid media ID has no AniList record',
      recovery: 'Use anime_search_media to find an existing AniList media ID and retry.',
    },
    {
      reason: 'invalid_id',
      code: JsonRpcErrorCode.ValidationError,
      when: 'The complete SDK-parsed ID segment is not ASCII decimal digits representing 1–2147483647',
      recovery:
        'Use an AniList ID containing only decimal digits with a value from 1 to 2147483647; leading zeros are allowed.',
    },
  ],
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
    const numericId = Number(params.id);
    if (!/^[0-9]+(?![\s\S])/.test(params.id) || numericId < 1 || numericId > 2147483647) {
      throw ctx.fail(
        'invalid_id',
        'AniList media ID must be decimal digits with a value from 1 to 2147483647.',
      );
    }

    ctx.log.info('Fetching anime media resource', { id: numericId });

    const detail = await anilist.getMediaById(numericId, true, ctx.signal);
    ctx.signal.throwIfAborted();
    if (!detail) {
      throw ctx.fail('not_found', `No media found with AniList ID ${numericId}`, { id: numericId });
    }
    if (detail.isAdult) {
      throw ctx.fail('adult_content', 'The requested title is adult content.');
    }

    const supplementOptions = { signal: ctx.signal, deadlineMs: 5000, maxRetries: 0 };
    const [jikanResult, kitsuResult] = await Promise.allSettled([
      detail.idMal ? jikan.getMediaFull(detail.idMal, detail.type, supplementOptions) : null,
      detail.type === 'ANIME' && detail.idMal
        ? kitsu.getAnimeStreamingByMalId(detail.idMal, supplementOptions)
        : null,
    ]);
    ctx.signal.throwIfAborted();

    const jikanData = jikanResult.status === 'fulfilled' ? jikanResult.value : null;
    const kitsuData = kitsuResult.status === 'fulfilled' ? kitsuResult.value : null;

    if (jikanResult.status === 'rejected') ctx.log.warning('Jikan MAL data is unavailable.');
    if (kitsuResult.status === 'rejected') ctx.log.warning('Kitsu streaming data is unavailable.');
    const streamingCount =
      detail.type === 'ANIME'
        ? mergeStreamingLinks(kitsuData?.streamingLinks ?? [], detail.externalLinks ?? []).length
        : 0;

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
