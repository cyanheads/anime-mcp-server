/**
 * @fileoverview Tests for anime://media/{id} resource.
 * @module tests/resources/anime-media.resource.test
 */

import { createMockContext } from '@cyanheads/mcp-ts-core/testing';
import { createWorkerHandler } from '@cyanheads/mcp-ts-core/worker';
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

  it('preserves leading-zero decimal spelling', async () => {
    vi.mocked(anilist.getMediaById).mockResolvedValue(mockDetail);
    const result = await animeMediaResource.handler(
      { id: '00011757' },
      createMockContext({ errors: animeMediaResource.errors }),
    );
    expect(result.id).toBe(11757);
    expect(anilist.getMediaById).toHaveBeenCalledWith(11757);
  });

  it('fills declared resource recovery through the real resource factory', async () => {
    const worker = createWorkerHandler({
      name: 'anime-mcp-server',
      title: 'anime-mcp-server',
      resources: [animeMediaResource],
    });
    const request = new Request('https://example.test/mcp', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
        'MCP-Protocol-Version': '2026-07-28',
        'Mcp-Method': 'resources/read',
        'Mcp-Name': 'anime://media/16498junk',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'resources/read',
        params: {
          uri: 'anime://media/16498junk',
          _meta: {
            'io.modelcontextprotocol/protocolVersion': '2026-07-28',
            'io.modelcontextprotocol/clientCapabilities': {},
          },
        },
      }),
    });
    const response = await worker.fetch(
      request,
      { MCP_AUTH_MODE: 'none', LOG_LEVEL: 'fatal' },
      { waitUntil: vi.fn(), passThroughOnException: vi.fn(), props: {} },
    );
    const raw = await response.text();
    const frame = raw.split('\n').find((line) => line.startsWith('data: '));
    const payload = JSON.parse(frame ? frame.slice(6) : raw);
    expect(payload).toMatchObject({
      error: {
        code: -32007,
        data: {
          reason: 'invalid_id',
          recovery: {
            hint: animeMediaResource.errors?.find((entry) => entry.reason === 'invalid_id')
              ?.recovery,
          },
        },
      },
    });
    expect(anilist.getMediaById).not.toHaveBeenCalled();
  });

  it('bounds decimal-segment validation thread CPU through a 64x span', async () => {
    const ctx = createMockContext({ errors: animeMediaResource.errors });
    const measurements = [];
    for (const length of [5000, 20000, 80000, 320000]) {
      const id = `${'0'.repeat(length - 1)}x`;
      const start = process.threadCpuUsage();
      for (let repeat = 0; repeat < 20; repeat++)
        await expect(animeMediaResource.handler({ id }, ctx)).rejects.toMatchObject({
          data: { reason: 'invalid_id' },
        });
      const usage = process.threadCpuUsage(start);
      measurements.push({ length, microseconds: (usage.user + usage.system) / 20 });
    }
    expect(measurements[3]!.microseconds / measurements[0]!.microseconds).toBeLessThan(256);
    expect(measurements[3]!.microseconds).toBeLessThan(500000);
    console.info('decimal-segment thread CPU microseconds/call', measurements);
    expect(anilist.getMediaById).not.toHaveBeenCalled();
  });

  it.each([
    '16498junk',
    '+16498',
    '-16498',
    '16498.0',
    '16498e2',
    ' 16498',
    '16498 ',
    '16498\n',
    '16498\r',
    '16498\u2028',
    '16498\u2029',
    '0',
    '2147483648',
    '9'.repeat(100),
  ])('rejects the complete invalid segment %j before service work', async (id) => {
    await expect(
      animeMediaResource.handler({ id }, createMockContext({ errors: animeMediaResource.errors })),
    ).rejects.toMatchObject({ code: -32007, data: { reason: 'invalid_id' } });
    expect(anilist.getMediaById).not.toHaveBeenCalled();
  });

  it('returns full media record for a valid numeric string ID', async () => {
    vi.mocked(anilist.getMediaById).mockResolvedValue(mockDetail);
    vi.mocked(jikan.getMediaFull).mockResolvedValue(mockJikanFull);
    vi.mocked(kitsu.getAnimeStreamingByMalId).mockResolvedValue(mockKitsuStreaming);

    const ctx = createMockContext({ tenantId: 'test-tenant', errors: animeMediaResource.errors });
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
      createMockContext({ tenantId: 'test-tenant', errors: animeMediaResource.errors }),
    );

    expect(result.description).toBe(description);
  });

  it('throws notFound for a non-numeric ID string', async () => {
    const ctx = createMockContext({ tenantId: 'test-tenant', errors: animeMediaResource.errors });
    const params = animeMediaResource.params!.parse({ id: 'not-a-number' });

    await expect(animeMediaResource.handler(params, ctx)).rejects.toThrow();
  });

  it('throws notFound when ID is zero or negative (invalid)', async () => {
    const ctx = createMockContext({ tenantId: 'test-tenant', errors: animeMediaResource.errors });
    const params = animeMediaResource.params!.parse({ id: '0' });

    await expect(animeMediaResource.handler(params, ctx)).rejects.toThrow();
  });

  it('throws notFound when AniList returns null for the ID', async () => {
    vi.mocked(anilist.getMediaById).mockResolvedValue(null);

    const ctx = createMockContext({ tenantId: 'test-tenant', errors: animeMediaResource.errors });
    const params = animeMediaResource.params!.parse({ id: '99999' });

    await expect(animeMediaResource.handler(params, ctx)).rejects.toThrow();
  });

  it('degrades gracefully when Jikan and Kitsu both fail', async () => {
    vi.mocked(anilist.getMediaById).mockResolvedValue(mockDetail);
    vi.mocked(jikan.getMediaFull).mockRejectedValue(new Error('Jikan down'));
    vi.mocked(kitsu.getAnimeStreamingByMalId).mockRejectedValue(new Error('Kitsu down'));

    const ctx = createMockContext({ tenantId: 'test-tenant', errors: animeMediaResource.errors });
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

    const ctx = createMockContext({ tenantId: 'test-tenant', errors: animeMediaResource.errors });
    const params = animeMediaResource.params!.parse({ id: '11757' });
    const result = await animeMediaResource.handler(params, ctx);

    expect(result.streaming_count).toBe(1); // from Kitsu
  });

  it('skips Kitsu for manga type', async () => {
    const mangaDetail = { ...mockDetail, type: 'MANGA' as const, idMal: 123, externalLinks: [] };
    vi.mocked(anilist.getMediaById).mockResolvedValue(mangaDetail);
    vi.mocked(jikan.getMediaFull).mockResolvedValue(null);

    const ctx = createMockContext({ tenantId: 'test-tenant', errors: animeMediaResource.errors });
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

    const ctx = createMockContext({ tenantId: 'test-tenant', errors: animeMediaResource.errors });
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
