/**
 * @fileoverview Tests for anime_get_media tool.
 * @module tests/tools/anime-get-media.tool.test
 */

import { JsonRpcErrorCode } from '@cyanheads/mcp-ts-core/errors';
import { createMockContext, runToolContract } from '@cyanheads/mcp-ts-core/testing';
import { escapeMarkdownInline as escapeProviderText } from '@cyanheads/mcp-ts-core/utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { animeGetMedia } from '@/mcp-server/tools/definitions/anime-get-media.tool.js';
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
  countryOfOrigin: 'JP',
  duration: 24,
  synonyms: ['Alternate [title]'],
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
          countryOfOrigin: 'JP',
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
    { id: '1', url: 'https://crunchyroll.com/steins-gate', subs: ['en'], dubs: ['en'] },
  ],
};

describe('animeGetMedia', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('rejects an adult root with recovery before supplements and allows opt-in', async () => {
    vi.mocked(anilist.getMediaById).mockResolvedValue({ ...mockDetail, isAdult: true });
    const blocked = await runToolContract(animeGetMedia, { id: 11757 });
    expect(blocked.structuredContent).toMatchObject({
      error: {
        data: {
          reason: 'adult_content',
          recovery: { hint: expect.stringContaining('include_adult: true') },
        },
      },
    });
    expect(blocked.content).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ text: expect.stringContaining('include_adult: true') }),
      ]),
    );
    expect(anilist.getMediaById).toHaveBeenCalledExactlyOnceWith(
      11757,
      true,
      expect.any(AbortSignal),
    );
    expect(jikan.getMediaFull).not.toHaveBeenCalled();
    expect(kitsu.getAnimeStreamingByMalId).not.toHaveBeenCalled();
    const allowed = await runToolContract(animeGetMedia, { id: 11757, include_adult: true });
    expect(allowed.structuredContent).toMatchObject({ is_adult: true });
  });

  it('omits adult direct relations by default and discloses the omitted count', async () => {
    const visible = mockDetail.relations.edges[0]!;
    const adult = {
      ...visible,
      node: {
        ...visible.node,
        id: 8861,
        isAdult: true,
        title: { ...visible.node.title, romaji: 'Adult relation' },
      },
    };
    vi.mocked(anilist.getMediaById).mockResolvedValue({
      ...mockDetail,
      relations: { edges: [visible, adult] },
    });
    const result = await runToolContract(animeGetMedia, { id: 11757 });
    expect(result.structuredContent).toMatchObject({
      relations: [expect.objectContaining({ id: visible.node.id })],
      notice: expect.stringContaining('Omitted 1 adult relation'),
    });
    expect(result.content).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ text: expect.stringContaining('Omitted 1 adult relation') }),
      ]),
    );
    expect(JSON.stringify(result.content)).not.toContain('Adult relation');
    const allowed = await runToolContract(animeGetMedia, { id: 11757, include_adult: true });
    expect(allowed.structuredContent).toMatchObject({
      relations: [
        expect.objectContaining({ id: visible.node.id }),
        expect.objectContaining({ id: 8861 }),
      ],
    });
  });

  it('merges Kitsu metadata with enabled AniList-only platforms on both surfaces', async () => {
    const link = mockDetail.externalLinks[0]!;
    vi.mocked(anilist.getMediaById).mockResolvedValue({
      ...mockDetail,
      externalLinks: [
        link,
        { ...link, id: 2, site: 'Hulu', url: 'https://hulu.com/steins-gate' },
        { ...link, id: 3, site: 'Disabled', url: 'https://disabled.example/a', isDisabled: true },
      ],
    });
    vi.mocked(kitsu.getAnimeStreamingByMalId).mockResolvedValue(mockKitsuStreaming);
    const result = await runToolContract(animeGetMedia, { id: 11757 });
    expect(result.structuredContent).toMatchObject({
      streaming_links: [
        { site: 'Crunchyroll', source: 'kitsu', subs: ['en'], dubs: ['en'] },
        { site: 'Hulu', source: 'anilist', subs: [], dubs: [] },
      ],
    });
    expect(JSON.stringify(result.content)).toContain('https://hulu.com/steins-gate');
    expect(JSON.stringify(result.content)).toContain(
      'Crunchyroll(url:[stream](<https://crunchyroll.com/steins-gate>) subs:en dubs:en src:kitsu)',
    );
    expect(JSON.stringify(result.content)).toContain(
      'Hulu(url:[stream](<https://hulu.com/steins-gate>) subs: dubs: src:anilist)',
    );
    expect(JSON.stringify(result.content)).not.toContain('disabled.example');
  });

  it('reports failed supplements and uses the five-second no-retry options', async () => {
    vi.mocked(anilist.getMediaById).mockResolvedValue(mockDetail);
    vi.mocked(jikan.getMediaFull).mockRejectedValue(new Error('Jikan down'));
    vi.mocked(kitsu.getAnimeStreamingByMalId).mockRejectedValue(new Error('Kitsu down'));
    const result = await runToolContract(animeGetMedia, { id: 11757 });
    const options = { signal: expect.any(AbortSignal), deadlineMs: 5000, maxRetries: 0 };
    expect(jikan.getMediaFull).toHaveBeenCalledExactlyOnceWith(9253, 'ANIME', options);
    expect(kitsu.getAnimeStreamingByMalId).toHaveBeenCalledExactlyOnceWith(9253, options);
    expect(result.structuredContent).toMatchObject({
      scores: { mal_score: null },
      streaming_links: [expect.objectContaining({ source: 'anilist' })],
      notice: expect.stringMatching(/Jikan.*Kitsu/),
    });
    expect(JSON.stringify(result.content)).toMatch(/Jikan.*Kitsu/);
  });

  it('propagates caller cancellation during supplements through the raw handler', async () => {
    const caller = new AbortController();
    const reason = new DOMException('caller cancelled', 'AbortError');
    vi.mocked(anilist.getMediaById).mockResolvedValue(mockDetail);
    vi.mocked(jikan.getMediaFull).mockImplementation(async () => {
      caller.abort(reason);
      throw reason;
    });
    const ctx = createMockContext({ errors: animeGetMedia.errors, signal: caller.signal });
    await expect(animeGetMedia.handler(animeGetMedia.input.parse({ id: 11757 }), ctx)).rejects.toBe(
      reason,
    );
  });

  it('preserves metadata and exact airing seconds in summary and full text', async () => {
    vi.mocked(anilist.getMediaById).mockResolvedValue({
      ...mockDetail,
      startDate: { year: 2011, month: 4, day: null },
      endDate: { year: 2011, month: null, day: null },
      trailer: { site: 'youtube', id: 'tR8YH0G67Rk' },
      nextAiringEpisode: { airingAt: 1720000000, episode: 6, timeUntilAiring: 3408 },
    });
    const expected = {
      start_date: '2011-04',
      end_date: '2011',
      duration_minutes: 24,
      country_of_origin: 'JP',
      synonyms: ['Alternate [title]'],
      trailer_url: 'https://www.youtube.com/watch?v=tR8YH0G67Rk',
      next_airing: {
        episode: 6,
        time_until_airing_seconds: 3408,
        airing_at_utc: new Date(1720000000000).toISOString(),
      },
    };
    const summary = await runToolContract(animeGetMedia, { id: 11757 });
    expect(summary.structuredContent).toMatchObject(expected);
    const summaryText = summary.content
      .map((block) => (block.type === 'text' ? block.text : ''))
      .join('\n');
    for (const value of [
      '2011-04',
      '2011',
      '24 min',
      'JP',
      escapeProviderText('Alternate [title]'),
      expected.trailer_url,
      'Episode 6 in 56m',
      'time_until_airing_seconds=3408',
    ]) {
      expect(summaryText).toContain(value);
    }
    const full = await runToolContract(animeGetMedia, { id: 11757, full_text: true });
    const json = full.content[0]!;
    expect(json.type).toBe('text');
    if (json.type !== 'text') throw new Error('Missing full-text JSON');
    expect(JSON.parse(json.text.slice(8, -4))).toEqual(full.structuredContent);
    expect(full.structuredContent).toMatchObject(expected);
  });

  it.each([
    [{ site: 'unknown', id: 'tR8YH0G67Rk' }, null],
    [{ site: 'youtube', id: 'tR8YH0G67Rk\n' }, null],
    [{ site: 'youtube', id: '../x?foo=bar' }, null],
    [{ site: 'dailymotion', id: 'x8abc9' }, 'https://www.dailymotion.com/video/x8abc9'],
  ])('accepts only recognized trailer providers and valid IDs: %j', async (trailer, url) => {
    vi.mocked(anilist.getMediaById).mockResolvedValue({
      ...mockDetail,
      trailer,
      startDate: { year: null, month: null, day: null },
      endDate: null,
      duration: null,
      countryOfOrigin: null,
      synonyms: [],
    });
    const result = await runToolContract(animeGetMedia, { id: 11757 });
    expect(result.structuredContent).toMatchObject({
      trailer_url: url,
      start_date: null,
      end_date: null,
      duration_minutes: null,
      country_of_origin: null,
      synonyms: [],
    });
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
      code: JsonRpcErrorCode.NotFound,
      message: 'No media found with AniList ID 99999',
      data: { reason: 'not_found' },
    });
  });

  it('returns the declared recovery hint on both contract error surfaces', async () => {
    vi.mocked(anilist.getMediaById).mockResolvedValue(null);

    const result = await runToolContract(animeGetMedia, { id: 99999 });
    const recovery = 'Use anime_search_media to find a valid AniList ID and retry.';

    expect(result).toMatchObject({
      isError: true,
      structuredContent: {
        error: {
          code: JsonRpcErrorCode.NotFound,
          message: 'No media found with AniList ID 99999',
          data: { reason: 'not_found', recovery: { hint: recovery } },
        },
      },
    });
    expect(result.content).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'text',
          text: expect.stringContaining(`Recovery: ${recovery}`),
        }),
      ]),
    );
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
    vi.mocked(kitsu.getAnimeStreamingByMalId).mockResolvedValue({
      kitsuId: '',
      streamingLinks: [],
    });

    const ctx = createMockContext({ errors: animeGetMedia.errors });
    const input = animeGetMedia.input.parse({ id: 11757 });
    const result = await animeGetMedia.handler(input, ctx);

    expect(result.streaming_links).toHaveLength(1);
    expect(result.streaming_links[0]!.source).toBe('anilist');
    expect(result.streaming_links[0]!.site).toBe('Crunchyroll');
  });

  it('does not report an outage for successful empty supplement data', async () => {
    vi.mocked(anilist.getMediaById).mockResolvedValue(mockDetail);
    vi.mocked(jikan.getMediaFull).mockResolvedValue(null);
    vi.mocked(kitsu.getAnimeStreamingByMalId).mockResolvedValue(null);
    const result = await runToolContract(animeGetMedia, { id: 11757 });
    expect(result.structuredContent).toMatchObject({
      start_date: '2011-04-06',
      end_date: '2011-09-14',
      scores: { mal_score: null },
      streaming_links: [expect.objectContaining({ source: 'anilist' })],
    });
    expect(result.structuredContent).not.toHaveProperty('notice');
    expect(JSON.stringify(result.content)).not.toContain('unavailable');
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
    const result = await animeGetMedia.handler(input, ctx);

    expect(vi.mocked(kitsu.getAnimeStreamingByMalId)).not.toHaveBeenCalled();
    expect(result.streaming_links).toEqual([]);
  });

  it('formats output containing IDs, scores, and data sources', async () => {
    vi.mocked(anilist.getMediaById).mockResolvedValue(mockDetail);
    vi.mocked(jikan.getMediaFull).mockResolvedValue(mockJikanFull);
    vi.mocked(kitsu.getAnimeStreamingByMalId).mockResolvedValue(mockKitsuStreaming);

    const ctx = createMockContext({ errors: animeGetMedia.errors });
    const input = animeGetMedia.input.parse({ id: 11757 });
    const result = await animeGetMedia.handler(input, ctx);

    const blocks = animeGetMedia.format!(result);
    const text = (blocks[0] as { text: string }).text;
    expect(text).toContain('AL:11757');
    expect(text).toContain('MAL:9253');
    expect(text).toContain('anilist_mean=');
    expect(text).toContain('mal_score=');
    expect(text).toContain('anilist=true');
  });

  it('keeps the full normalized synopsis in structured output and caps rendered text', async () => {
    const description = `First paragraph.\n\n${'x'.repeat(550)}`;
    vi.mocked(anilist.getMediaById).mockResolvedValue({ ...mockDetail, description });
    vi.mocked(jikan.getMediaFull).mockResolvedValue(null);
    vi.mocked(kitsu.getAnimeStreamingByMalId).mockResolvedValue(null);
    const ctx = createMockContext({ errors: animeGetMedia.errors });

    const result = await animeGetMedia.handler(animeGetMedia.input.parse({ id: 11757 }), ctx);
    const text = (animeGetMedia.format!(result)[0] as { text: string }).text;

    expect(result.description).toBe(description);
    expect(text).toContain(`${escapeProviderText(description.slice(0, 500))}…`);
    expect(text).not.toContain(description);
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
    vi.mocked(kitsu.getAnimeStreamingByMalId).mockResolvedValue({
      kitsuId: '',
      streamingLinks: [],
    });

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
