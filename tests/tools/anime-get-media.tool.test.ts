/**
 * @fileoverview Tests for anime_get_media tool.
 * @module tests/tools/anime-get-media.tool.test
 */

import { createMockContext } from '@cyanheads/mcp-ts-core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { animeGetMedia } from '@/mcp-server/tools/definitions/anime-get-media.tool.js';

vi.mock('@/services/anilist/anilist-service.js');
vi.mock('@/services/jikan/jikan-service.js');
vi.mock('@/services/kitsu/kitsu-service.js');

import * as anilist from '@/services/anilist/anilist-service.js';
import * as jikan from '@/services/jikan/jikan-service.js';
import * as kitsu from '@/services/kitsu/kitsu-service.js';

const mockDetail = {
  id: 11757,
  idMal: 9253,
  type: 'ANIME' as const,
  format: 'TV',
  status: 'FINISHED',
  season: 'FALL',
  seasonYear: 2011,
  episodes: 25,
  chapters: null,
  volumes: null,
  meanScore: 90,
  averageScore: 89,
  popularity: 500000,
  isAdult: false,
  title: { romaji: 'Steins;Gate', english: 'Steins;Gate', native: 'シュタインズ・ゲート' },
  coverImage: {
    extraLarge: 'https://example.com/xl.jpg',
    large: 'https://example.com/l.jpg',
    medium: null,
    color: null,
  },
  bannerImage: 'https://example.com/banner.jpg',
  description: 'A time travel story.',
  source: 'VISUAL_NOVEL',
  genres: ['Sci-Fi', 'Drama'],
  tags: [
    {
      id: 1,
      name: 'Time Travel',
      category: 'Theme',
      rank: 95,
      isGeneralSpoiler: false,
      isAdult: false,
      description: null,
    },
    {
      id: 2,
      name: 'Spoiler Tag',
      category: 'Plot',
      rank: 80,
      isGeneralSpoiler: true,
      isAdult: false,
      description: null,
    },
  ],
  studios: {
    edges: [{ isMain: true, node: { id: 21, name: 'White Fox', isAnimationStudio: true } }],
  },
  relations: {
    edges: [
      {
        relationType: 'SEQUEL',
        node: {
          id: 14247,
          idMal: 20911,
          type: 'ANIME' as const,
          format: 'TV',
          status: 'FINISHED',
          season: 'SPRING',
          seasonYear: 2015,
          episodes: 23,
          chapters: null,
          volumes: null,
          meanScore: 92,
          isAdult: false,
          title: { romaji: 'Steins;Gate 0', english: 'Steins;Gate 0', native: null },
          coverImage: null,
        },
      },
    ],
  },
  externalLinks: [
    {
      id: 1,
      url: 'https://crunchyroll.com/steins-gate',
      site: 'Crunchyroll',
      type: 'STREAMING',
      language: null,
      icon: null,
      color: null,
      siteId: null,
      isDisabled: false,
    },
  ],
  siteUrl: 'https://anilist.co/anime/11757',
  nextAiringEpisode: null,
  isFavourite: false,
  favourites: 99999,
  hashtag: null,
  trailer: null,
  startDate: { year: 2011, month: 4, day: 6 },
  endDate: { year: 2011, month: 9, day: 14 },
};

const mockJikanFull = {
  score: 9.09,
  scored_by: 700000,
  rank: 2,
  popularity: 3,
};

const mockKitsuStreaming = {
  streamingLinks: [{ url: 'https://crunchyroll.com/steins-gate', subs: ['en'], dubs: ['en'] }],
};

describe('animeGetMedia', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('returns full media detail with all three sources', async () => {
    vi.mocked(anilist.getMediaById).mockResolvedValue(mockDetail);
    vi.mocked(jikan.getMediaFull).mockResolvedValue(mockJikanFull);
    vi.mocked(kitsu.getAnimeStreamingByMalId).mockResolvedValue(mockKitsuStreaming);

    const ctx = createMockContext({ errors: animeGetMedia.errors });
    const input = animeGetMedia.input.parse({ id: 11757 });
    const result = await animeGetMedia.handler(input, ctx);

    expect(result.id).toBe(11757);
    expect(result.id_mal).toBe(9253);
    expect(result.type).toBe('ANIME');
    expect(result.title.romaji).toBe('Steins;Gate');
    expect(result.season).toBe('FALL 2011');
    expect(result.scores.anilist_mean).toBe(90);
    expect(result.scores.mal_score).toBe(9.09);
    expect(result.data_sources.anilist).toBe(true);
    expect(result.data_sources.mal).toBe(true);
    expect(result.data_sources.kitsu).toBe(true);
  });

  it('throws ctx.fail("not_found") when AniList returns null', async () => {
    vi.mocked(anilist.getMediaById).mockResolvedValue(null);
    const ctx = createMockContext({ errors: animeGetMedia.errors });
    const input = animeGetMedia.input.parse({ id: 99999 });

    await expect(animeGetMedia.handler(input, ctx)).rejects.toMatchObject({
      data: { reason: 'not_found' },
    });
  });

  it('degrades gracefully when Jikan and Kitsu both fail', async () => {
    vi.mocked(anilist.getMediaById).mockResolvedValue(mockDetail);
    vi.mocked(jikan.getMediaFull).mockRejectedValue(new Error('Jikan down'));
    vi.mocked(kitsu.getAnimeStreamingByMalId).mockRejectedValue(new Error('Kitsu down'));

    const ctx = createMockContext({ errors: animeGetMedia.errors });
    const input = animeGetMedia.input.parse({ id: 11757 });
    const result = await animeGetMedia.handler(input, ctx);

    expect(result.scores.mal_score).toBeNull();
    expect(result.data_sources.mal).toBe(false);
    expect(result.data_sources.kitsu).toBe(false);
    expect(result.data_sources.anilist).toBe(true);
  });

  it('falls back to AniList externalLinks when Kitsu has no streaming data', async () => {
    vi.mocked(anilist.getMediaById).mockResolvedValue(mockDetail);
    vi.mocked(jikan.getMediaFull).mockResolvedValue(null);
    vi.mocked(kitsu.getAnimeStreamingByMalId).mockResolvedValue({ streamingLinks: [] });

    const ctx = createMockContext({ errors: animeGetMedia.errors });
    const input = animeGetMedia.input.parse({ id: 11757 });
    const result = await animeGetMedia.handler(input, ctx);

    expect(result.streaming_links).toHaveLength(1);
    expect(result.streaming_links[0]!.source).toBe('anilist');
    expect(result.streaming_links[0]!.site).toBe('Crunchyroll');
  });

  it('uses Kitsu streaming links when available (source: kitsu)', async () => {
    vi.mocked(anilist.getMediaById).mockResolvedValue(mockDetail);
    vi.mocked(jikan.getMediaFull).mockResolvedValue(mockJikanFull);
    vi.mocked(kitsu.getAnimeStreamingByMalId).mockResolvedValue(mockKitsuStreaming);

    const ctx = createMockContext({ errors: animeGetMedia.errors });
    const input = animeGetMedia.input.parse({ id: 11757 });
    const result = await animeGetMedia.handler(input, ctx);

    expect(result.streaming_links[0]!.source).toBe('kitsu');
    expect(result.streaming_links[0]!.subs).toContain('en');
  });

  it('skips Kitsu call for manga media type', async () => {
    const mangaDetail = { ...mockDetail, type: 'MANGA' as const, idMal: 123 };
    vi.mocked(anilist.getMediaById).mockResolvedValue(mangaDetail);
    vi.mocked(jikan.getMediaFull).mockResolvedValue(null);

    const ctx = createMockContext({ errors: animeGetMedia.errors });
    const input = animeGetMedia.input.parse({ id: 11757 });
    await animeGetMedia.handler(input, ctx);

    expect(vi.mocked(kitsu.getAnimeStreamingByMalId)).not.toHaveBeenCalled();
  });

  it('formats output containing IDs, scores, and data sources', async () => {
    vi.mocked(anilist.getMediaById).mockResolvedValue(mockDetail);
    vi.mocked(jikan.getMediaFull).mockResolvedValue(mockJikanFull);
    vi.mocked(kitsu.getAnimeStreamingByMalId).mockResolvedValue(mockKitsuStreaming);

    const ctx = createMockContext({ errors: animeGetMedia.errors });
    const input = animeGetMedia.input.parse({ id: 11757 });
    const result = await animeGetMedia.handler(input, ctx);

    const blocks = animeGetMedia.format!(result);
    const text = blocks[0]!.text as string;
    expect(text).toContain('AL:11757');
    expect(text).toContain('MAL:9253');
    expect(text).toContain('anilist_mean=');
    expect(text).toContain('mal_score=');
    expect(text).toContain('anilist=true');
  });

  it('handles sparse payload: all optional fields null', async () => {
    const sparseDetail = {
      ...mockDetail,
      idMal: null,
      format: null,
      status: null,
      season: null,
      seasonYear: null,
      episodes: null,
      description: null,
      source: null,
      genres: [],
      tags: [],
      studios: { edges: [] },
      relations: { edges: [] },
      externalLinks: [],
      coverImage: null,
      bannerImage: null,
      siteUrl: null,
      nextAiringEpisode: null,
      meanScore: null,
      averageScore: null,
      popularity: null,
    };
    vi.mocked(anilist.getMediaById).mockResolvedValue(sparseDetail);
    vi.mocked(jikan.getMediaFull).mockResolvedValue(null);
    vi.mocked(kitsu.getAnimeStreamingByMalId).mockResolvedValue({ streamingLinks: [] });

    const ctx = createMockContext({ errors: animeGetMedia.errors });
    const input = animeGetMedia.input.parse({ id: 11757 });
    const result = await animeGetMedia.handler(input, ctx);

    expect(result.id_mal).toBeNull();
    expect(result.season).toBeNull();
    expect(result.genres).toEqual([]);
    expect(result.streaming_links).toHaveLength(0);
    expect(result.scores.anilist_mean).toBeNull();
    expect(result.scores.mal_score).toBeNull();
  });
});
