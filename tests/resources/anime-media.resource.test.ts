/**
 * @fileoverview Tests for anime://media/{id} resource.
 * @module tests/resources/anime-media.resource.test
 */

import { createMockContext } from '@cyanheads/mcp-ts-core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { animeMediaResource } from '@/mcp-server/resources/definitions/anime-media.resource.js';
import type { MediaDetail } from '@/services/anilist/types.js';
import type { JikanMedia } from '@/services/jikan/types.js';
import type { KitsuStreamingResult } from '@/services/kitsu/types.js';

vi.mock('@/services/anilist/anilist-service.js');
vi.mock('@/services/jikan/jikan-service.js');
vi.mock('@/services/kitsu/kitsu-service.js');

import * as anilist from '@/services/anilist/anilist-service.js';
import * as jikan from '@/services/jikan/jikan-service.js';
import * as kitsu from '@/services/kitsu/kitsu-service.js';

const mockDetail: MediaDetail = {
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
  coverImage: { extraLarge: 'https://example.com/xl.jpg', large: null, medium: null, color: null },
  bannerImage: null,
  description: 'A sci-fi time travel story.',
  source: 'VISUAL_NOVEL',
  genres: ['Sci-Fi', 'Drama'],
  tags: [],
  studios: { edges: [] },
  relations: { edges: [] },
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
  startDate: null,
  endDate: null,
};

const mockJikanFull: JikanMedia = {
  mal_id: 9253,
  title: 'Steins;Gate',
  title_english: 'Steins;Gate',
  title_japanese: 'シュタインズ・ゲート',
  type: 'TV',
  status: 'Finished Airing',
  score: 9.09,
  scored_by: 700000,
  rank: 2,
  popularity: 3,
  episodes: 25,
  chapters: null,
  volumes: null,
  favorites: 100000,
  synopsis: 'A time travel story.',
  url: 'https://myanimelist.net/anime/9253',
  images: null,
  external: null,
  streaming: null,
};
const mockKitsuStreaming: KitsuStreamingResult = {
  kitsuId: '10519',
  streamingLinks: [
    {
      id: '1',
      url: 'https://crunchyroll.com/steins-gate',
      subs: ['en'],
      dubs: [],
    },
  ],
};

describe('animeMediaResource', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('returns full media record for a valid numeric string ID', async () => {
    vi.mocked(anilist.getMediaById).mockResolvedValue(mockDetail);
    vi.mocked(jikan.getMediaFull).mockResolvedValue(mockJikanFull);
    vi.mocked(kitsu.getAnimeStreamingByMalId).mockResolvedValue(mockKitsuStreaming);

    const ctx = createMockContext({ tenantId: 'test-tenant' });
    const params = animeMediaResource.params!.parse({ id: '11757' });
    const result = await animeMediaResource.handler(params, ctx);

    expect(result.id).toBe(11757);
    expect(result.id_mal).toBe(9253);
    expect(result.type).toBe('ANIME');
    expect(result.title.romaji).toBe('Steins;Gate');
    expect(result.season).toBe('FALL 2011');
    expect(result.mean_score).toBe(90);
    expect(result.mal_score).toBe(9.09);
    expect(result.streaming_count).toBe(1);
  });

  it('preserves the complete normalized AniList description', async () => {
    const description = `First paragraph.\n\n${'x'.repeat(550)}`;
    vi.mocked(anilist.getMediaById).mockResolvedValue({ ...mockDetail, description });
    vi.mocked(jikan.getMediaFull).mockResolvedValue(null);
    vi.mocked(kitsu.getAnimeStreamingByMalId).mockResolvedValue(null);

    const result = await animeMediaResource.handler(
      animeMediaResource.params!.parse({ id: '11757' }),
      createMockContext({ tenantId: 'test-tenant' }),
    );

    expect(result.description).toBe(description);
  });

  it('throws notFound for a non-numeric ID string', async () => {
    const ctx = createMockContext({ tenantId: 'test-tenant' });
    const params = animeMediaResource.params!.parse({ id: 'not-a-number' });

    await expect(animeMediaResource.handler(params, ctx)).rejects.toThrow();
  });

  it('throws notFound when ID is zero or negative (invalid)', async () => {
    const ctx = createMockContext({ tenantId: 'test-tenant' });
    const params = animeMediaResource.params!.parse({ id: '0' });

    await expect(animeMediaResource.handler(params, ctx)).rejects.toThrow();
  });

  it('throws notFound when AniList returns null for the ID', async () => {
    vi.mocked(anilist.getMediaById).mockResolvedValue(null);

    const ctx = createMockContext({ tenantId: 'test-tenant' });
    const params = animeMediaResource.params!.parse({ id: '99999' });

    await expect(animeMediaResource.handler(params, ctx)).rejects.toThrow();
  });

  it('degrades gracefully when Jikan and Kitsu both fail', async () => {
    vi.mocked(anilist.getMediaById).mockResolvedValue(mockDetail);
    vi.mocked(jikan.getMediaFull).mockRejectedValue(new Error('Jikan down'));
    vi.mocked(kitsu.getAnimeStreamingByMalId).mockRejectedValue(new Error('Kitsu down'));

    const ctx = createMockContext({ tenantId: 'test-tenant' });
    const params = animeMediaResource.params!.parse({ id: '11757' });
    const result = await animeMediaResource.handler(params, ctx);

    expect(result.id).toBe(11757);
    expect(result.mal_score).toBeNull();
    // Falls back to AniList externalLinks for streaming count
    expect(result.streaming_count).toBe(1);
  });

  it('uses Kitsu streaming count when available', async () => {
    vi.mocked(anilist.getMediaById).mockResolvedValue(mockDetail);
    vi.mocked(jikan.getMediaFull).mockResolvedValue(mockJikanFull);
    vi.mocked(kitsu.getAnimeStreamingByMalId).mockResolvedValue(mockKitsuStreaming);

    const ctx = createMockContext({ tenantId: 'test-tenant' });
    const params = animeMediaResource.params!.parse({ id: '11757' });
    const result = await animeMediaResource.handler(params, ctx);

    expect(result.streaming_count).toBe(1); // from Kitsu
  });

  it('skips Kitsu for manga type', async () => {
    const mangaDetail = { ...mockDetail, type: 'MANGA' as const, idMal: 123, externalLinks: [] };
    vi.mocked(anilist.getMediaById).mockResolvedValue(mangaDetail);
    vi.mocked(jikan.getMediaFull).mockResolvedValue(null);

    const ctx = createMockContext({ tenantId: 'test-tenant' });
    const params = animeMediaResource.params!.parse({ id: '11757' });
    await animeMediaResource.handler(params, ctx);

    expect(vi.mocked(kitsu.getAnimeStreamingByMalId)).not.toHaveBeenCalled();
  });

  it('handles sparse payload: all optional fields null', async () => {
    const sparseDetail = {
      ...mockDetail,
      idMal: null,
      format: null,
      status: null,
      season: null,
      seasonYear: null,
      description: null,
      genres: [],
      meanScore: null,
      coverImage: null,
      siteUrl: null,
      externalLinks: [],
    };
    vi.mocked(anilist.getMediaById).mockResolvedValue(sparseDetail);
    vi.mocked(jikan.getMediaFull).mockResolvedValue(null);
    vi.mocked(kitsu.getAnimeStreamingByMalId).mockResolvedValue({
      kitsuId: '',
      streamingLinks: [],
    });

    const ctx = createMockContext({ tenantId: 'test-tenant' });
    const params = animeMediaResource.params!.parse({ id: '11757' });
    const result = await animeMediaResource.handler(params, ctx);

    expect(result.id_mal).toBeNull();
    expect(result.season).toBeNull();
    expect(result.genres).toEqual([]);
    expect(result.mean_score).toBeNull();
    expect(result.mal_score).toBeNull();
    expect(result.streaming_count).toBe(0);
    expect(result.cover_image_url).toBeNull();
  });
});
