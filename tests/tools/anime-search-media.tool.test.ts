/**
 * @fileoverview Tests for anime_search_media tool with the AniList and Jikan
 * services mocked at the module boundary. Wire-level behavior through the real
 * services lives in anime-search-media.contract.test.ts.
 * @module tests/tools/anime-search-media.tool.test
 */

import { JsonRpcErrorCode } from '@cyanheads/mcp-ts-core/errors';
import {
  createMockContext,
  getEnrichment,
  type MockContextLogger,
  runToolContract,
} from '@cyanheads/mcp-ts-core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { animeSearchMedia } from '@/mcp-server/tools/definitions/anime-search-media.tool.js';
import { PAGE_DEPTH_EDGE_NOTICE } from '@/services/anilist/pagination.js';
import type { MediaNode, MediaPage } from '@/services/anilist/types.js';
import type { JikanPagination, JikanSearchResult } from '@/services/jikan/types.js';

// Mock the service modules at the boundary
vi.mock('@/services/anilist/anilist-service.js');
vi.mock('@/services/jikan/jikan-service.js');

import * as anilist from '@/services/anilist/anilist-service.js';
import * as jikan from '@/services/jikan/jikan-service.js';

const steinsGate: MediaNode = {
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
  isAdult: false,
  title: { romaji: 'Steins;Gate', english: 'Steins;Gate', native: 'シュタインズ・ゲート' },
  coverImage: {
    large: 'https://example.com/cover.jpg',
    extraLarge: null,
    medium: null,
    color: null,
  },
};

function anilistPage(media: MediaNode[], pageInfo: Partial<MediaPage['pageInfo']> = {}): MediaPage {
  return {
    pageInfo: { currentPage: 1, hasNextPage: false, perPage: 20, ...pageInfo },
    media,
  };
}

/** `count` distinct media nodes derived from the Steins;Gate fixture. */
function nodes(count: number): MediaNode[] {
  return Array.from({ length: count }, (_, i) => ({ ...steinsGate, id: 1000 + i }));
}

const mockAnilistPage = anilistPage([steinsGate]);
const emptyAnilistPage = anilistPage([]);

const mockJikanResult: {
  results: JikanSearchResult[];
  pagination: JikanPagination | null;
} = {
  pagination: {
    current_page: 1,
    has_next_page: false,
    items: { total: 1, count: 1, per_page: 20 },
    last_visible_page: 1,
  },
  results: [
    {
      mal_id: 9253,
      title: 'Steins;Gate',
      title_english: 'Steins;Gate',
      type: 'TV',
      status: 'Finished Airing',
      episodes: 25,
      chapters: null,
      score: 9.08,
      rank: 2,
      scored_by: 700000,
      url: 'https://myanimelist.net/anime/9253',
    },
  ],
};

function contentText(result: { content: unknown[] }): string {
  return result.content
    .filter(
      (block): block is { type: 'text'; text: string } =>
        (block as { type?: string }).type === 'text',
    )
    .map((block) => block.text)
    .join('\n');
}

describe('animeSearchMedia', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('returns AniList results when AniList has matches', async () => {
    vi.mocked(anilist.searchMedia).mockResolvedValue(mockAnilistPage);
    const ctx = createMockContext({ errors: animeSearchMedia.errors });
    const input = animeSearchMedia.input.parse({ media_type: 'ANIME', query: 'Steins;Gate' });

    const result = await animeSearchMedia.handler(input, ctx);

    expect(result.source).toBe('anilist');
    expect(result.results).toHaveLength(1);
    expect(result.results[0]!.id).toBe(11757);
    expect(result.results[0]!.id_mal).toBe(9253);
    expect(result.results[0]!.title_romaji).toBe('Steins;Gate');
    expect(result.results[0]!.mean_score).toBe(90);
    expect(result.has_next_page).toBe(false);
    expect(result.total_results).toBe(1);
  });

  it('falls back to Jikan when AniList has no match for a query-only search', async () => {
    vi.mocked(anilist.searchMedia).mockResolvedValue(emptyAnilistPage);
    vi.mocked(jikan.searchMedia).mockResolvedValue(mockJikanResult);
    vi.mocked(anilist.getMediaByMalIds).mockResolvedValue(new Map([[9253, steinsGate]]));
    const ctx = createMockContext({ errors: animeSearchMedia.errors });
    const input = animeSearchMedia.input.parse({ media_type: 'ANIME', query: 'Steins;Gate' });

    const result = await animeSearchMedia.handler(input, ctx);

    expect(result.source).toBe('jikan');
    expect(result.results).toHaveLength(1);
    expect(result.results[0]!.id_mal).toBe(9253);
    expect(jikan.searchMedia).toHaveBeenCalledWith({
      query: 'Steins;Gate',
      mediaType: 'ANIME',
      page: 1,
      limit: 20,
      sfw: true,
    });
    expect(anilist.searchMedia).toHaveBeenCalledOnce();
  });

  it('resolves Jikan fallback rows to actionable AniList IDs in one batch', async () => {
    vi.mocked(anilist.searchMedia).mockResolvedValue(emptyAnilistPage);
    vi.mocked(jikan.searchMedia).mockResolvedValue({
      ...mockJikanResult,
      results: [
        mockJikanResult.results[0]!,
        {
          ...mockJikanResult.results[0]!,
          mal_id: 999_999,
          title: 'Unmatched title',
          title_english: null,
        },
      ],
    });
    const resolved: MediaNode = { ...steinsGate, id: 314, idMal: 9253 };
    const lookup = vi
      .mocked(anilist.getMediaByMalIds)
      .mockResolvedValue(new Map([[9253, resolved]]));
    const ctx = createMockContext({ errors: animeSearchMedia.errors });
    const input = animeSearchMedia.input.parse({ media_type: 'ANIME', query: 'Steins;Gate' });

    const result = await animeSearchMedia.handler(input, ctx);
    const text = (animeSearchMedia.format!(result)[0] as { text: string }).text;

    expect(lookup).toHaveBeenCalledOnce();
    expect(lookup).toHaveBeenCalledWith([9253, 999_999], 'ANIME', false);
    expect(result).toMatchObject({
      source: 'jikan',
      results: [{ id: 314, id_mal: 9253 }],
    });
    expect(result.results.every((entry) => entry.id > 0)).toBe(true);
    expect(text).toContain('[AL:314/MAL:9253]');
    expect(text).not.toContain('AL:0');
    expect(text).not.toContain('MAL:999999');
  });

  it('returns an empty AniList page when a filter-only search matches nothing', async () => {
    vi.mocked(anilist.searchMedia).mockResolvedValue(emptyAnilistPage);
    const ctx = createMockContext({ errors: animeSearchMedia.errors });
    const input = animeSearchMedia.input.parse({ media_type: 'ANIME', genre: 'Action' });

    const result = await animeSearchMedia.handler(input, ctx);

    expect(result.source).toBe('anilist');
    expect(result.results).toHaveLength(0);
    expect(result.total_results).toBe(0);
    expect(jikan.searchMedia).not.toHaveBeenCalled();
  });

  it('applies defaults: page=1, per_page=20, include_adult=false', () => {
    const input = animeSearchMedia.input.parse({ media_type: 'MANGA' });
    expect(input.page).toBe(1);
    expect(input.per_page).toBe(20);
    expect(input.include_adult).toBe(false);
  });

  it('accepts exactly the five advertised sort values', () => {
    const values = [
      'SEARCH_MATCH',
      'SCORE_DESC',
      'POPULARITY_DESC',
      'TRENDING_DESC',
      'START_DATE_DESC',
    ] as const;

    for (const sort of values) {
      expect(() =>
        animeSearchMedia.input.parse({ media_type: 'ANIME', sort: [sort] }),
      ).not.toThrow();
    }
  });

  it('rejects unsupported sort values before calling AniList', async () => {
    expect(() =>
      animeSearchMedia.input.parse({ media_type: 'ANIME', sort: ['NOT_A_SORT'] }),
    ).toThrow(/SEARCH_MATCH/);
    expect(anilist.searchMedia).not.toHaveBeenCalled();
  });

  it('keeps omitted sort undefined so the service picks the default', async () => {
    vi.mocked(anilist.searchMedia).mockResolvedValue(mockAnilistPage);
    const ctx = createMockContext({ errors: animeSearchMedia.errors });
    const input = animeSearchMedia.input.parse({ media_type: 'ANIME', query: 'Steins;Gate' });

    await animeSearchMedia.handler(input, ctx);

    expect(anilist.searchMedia).toHaveBeenCalledWith(expect.objectContaining({ sort: undefined }));
  });

  it('formats output with IDs, scores, and season label', async () => {
    vi.mocked(anilist.searchMedia).mockResolvedValue(mockAnilistPage);
    const ctx = createMockContext({ errors: animeSearchMedia.errors });
    const input = animeSearchMedia.input.parse({ media_type: 'ANIME', query: 'Steins;Gate' });
    const result = await animeSearchMedia.handler(input, ctx);

    const blocks = animeSearchMedia.format!(result);
    expect(blocks).toHaveLength(1);
    const text = (blocks[0] as { text: string }).text;
    expect(text).toContain('AL:11757');
    expect(text).toContain('MAL:9253');
    expect(text).toContain('90');
    expect(text).toContain('anilist');
  });

  it('formats empty results with source label', () => {
    const emptyResult = {
      source: 'anilist' as const,
      page: 1,
      has_next_page: false,
      total_results: 0,
      results: [],
    };
    const blocks = animeSearchMedia.format!(emptyResult);
    expect((blocks[0] as { text: string }).text).toContain('No results found');
  });

  it('handles sparse payload: missing optional fields do not break output', async () => {
    const sparsePage = anilistPage([
      {
        id: 999,
        idMal: null,
        type: 'ANIME' as const,
        format: null,
        status: null,
        season: null,
        seasonYear: null,
        episodes: null,
        chapters: null,
        volumes: null,
        meanScore: null,
        isAdult: false,
        title: { romaji: null, english: null, native: null },
        coverImage: null,
      },
    ]);
    vi.mocked(anilist.searchMedia).mockResolvedValue(sparsePage);
    const ctx = createMockContext({ errors: animeSearchMedia.errors });
    const input = animeSearchMedia.input.parse({ media_type: 'ANIME', query: 'sparse' });
    const result = await animeSearchMedia.handler(input, ctx);

    expect(result.results[0]!.id).toBe(999);
    expect(result.results[0]!.id_mal).toBeNull();
    expect(result.results[0]!.cover_image_url).toBeNull();
    expect(animeSearchMedia.output.parse(result)).toBeDefined();
    expect((animeSearchMedia.format!(result)[0] as { text: string }).text).toContain('Unknown');
  });

  // ─── #20: criteria are required; blank strings are absent ─────────────────────

  describe('search criteria', () => {
    const missingCriteriaInputs = [
      { media_type: 'ANIME' },
      { media_type: 'ANIME', page: 2, per_page: 5, include_adult: true },
      { media_type: 'ANIME', query: '' },
      { media_type: 'ANIME', query: '   ' },
      { media_type: 'ANIME', genre: '', tag: ' \t ' },
      { media_type: 'MANGA', sort: ['SEARCH_MATCH'] },
      { media_type: 'ANIME', sort: [] },
      { media_type: 'ANIME', query: ' ', sort: ['SEARCH_MATCH'] },
    ];

    it.each(missingCriteriaInputs)(
      'rejects %o with missing_criteria before any upstream call',
      async (raw) => {
        const ctx = createMockContext({ errors: animeSearchMedia.errors });
        const input = animeSearchMedia.input.parse(raw);

        await expect(animeSearchMedia.handler(input, ctx)).rejects.toMatchObject({
          code: JsonRpcErrorCode.ValidationError,
          data: {
            reason: 'missing_criteria',
            recovery: {
              hint: animeSearchMedia.errors?.find((e) => e.reason === 'missing_criteria')?.recovery,
            },
          },
        });
        expect(anilist.searchMedia).not.toHaveBeenCalled();
        expect(anilist.getMediaByMalIds).not.toHaveBeenCalled();
        expect(jikan.searchMedia).not.toHaveBeenCalled();
      },
    );

    it('renders missing_criteria with its recovery on both surfaces', async () => {
      const result = await runToolContract(animeSearchMedia, {
        media_type: 'ANIME',
        query: '   ',
      });
      const declared = animeSearchMedia.errors?.find(
        (e) => e.reason === 'missing_criteria',
      )?.recovery;

      expect(result.isError).toBe(true);
      expect(result.structuredContent).toMatchObject({
        error: {
          code: JsonRpcErrorCode.ValidationError,
          data: { reason: 'missing_criteria', recovery: { hint: declared } },
        },
      });
      expect(contentText(result)).toContain(`Recovery: ${declared}`);
      expect(anilist.searchMedia).not.toHaveBeenCalled();
    });

    it.each([
      [{ season: 'WINTER' }, { season: 'WINTER' }],
      [{ season_year: 2024 }, { seasonYear: 2024 }],
      [{ format: 'MOVIE' }, { format: 'MOVIE' }],
      [{ status: 'RELEASING' }, { status: 'RELEASING' }],
      [{ tag: 'Isekai' }, { tag: 'Isekai' }],
      [{ sort: ['POPULARITY_DESC'] }, { sort: ['POPULARITY_DESC'] }],
      [{ sort: ['SEARCH_MATCH', 'SCORE_DESC'] }, { sort: ['SEARCH_MATCH', 'SCORE_DESC'] }],
    ])('accepts %o as a criterion', async (criterion, forwarded) => {
      vi.mocked(anilist.searchMedia).mockResolvedValue(mockAnilistPage);
      const ctx = createMockContext({ errors: animeSearchMedia.errors });
      const input = animeSearchMedia.input.parse({ media_type: 'ANIME', ...criterion });

      const result = await animeSearchMedia.handler(input, ctx);

      expect(result.results).toHaveLength(1);
      expect(anilist.searchMedia).toHaveBeenCalledWith(expect.objectContaining(forwarded));
    });

    it.each(['', '   '])(
      'runs { genre: "Action", query: %o } as a genre-only search with no fallback',
      async (query) => {
        vi.mocked(anilist.searchMedia).mockResolvedValue(emptyAnilistPage);
        const ctx = createMockContext({ errors: animeSearchMedia.errors });
        const input = animeSearchMedia.input.parse({ media_type: 'ANIME', genre: 'Action', query });

        const result = await animeSearchMedia.handler(input, ctx);

        expect(anilist.searchMedia).toHaveBeenCalledWith(
          expect.objectContaining({ query: undefined, genre: 'Action' }),
        );
        expect(result.source).toBe('anilist');
        expect(jikan.searchMedia).not.toHaveBeenCalled();
      },
    );

    it('trims query, genre, and tag and echoes the trimmed values', async () => {
      vi.mocked(anilist.searchMedia).mockResolvedValue(emptyAnilistPage);
      const ctx = createMockContext({ errors: animeSearchMedia.errors });
      const input = animeSearchMedia.input.parse({
        media_type: 'ANIME',
        query: '  Steins;Gate ',
        genre: ' Action ',
        tag: '\tTime Manipulation ',
      });

      await animeSearchMedia.handler(input, ctx);

      expect(anilist.searchMedia).toHaveBeenCalledWith(
        expect.objectContaining({
          query: 'Steins;Gate',
          genre: 'Action',
          tag: 'Time Manipulation',
        }),
      );
      const notice = getEnrichment(ctx).notice as string;
      expect(notice).toContain('query="Steins;Gate"');
      expect(notice).toContain('genre="Action"');
      expect(notice).toContain('tag="Time Manipulation"');
      expect(notice).not.toContain(' Action ');
    });
  });

  // ─── #21: the Jikan fallback is optional and narrowly triggered ───────────────

  describe('Jikan fallback', () => {
    it('keeps the AniList empty page with a notice when the Jikan search fails', async () => {
      vi.mocked(anilist.searchMedia).mockResolvedValue(emptyAnilistPage);
      vi.mocked(jikan.searchMedia).mockRejectedValue(new Error('Jikan 504'));
      const ctx = createMockContext({ errors: animeSearchMedia.errors });
      const input = animeSearchMedia.input.parse({
        media_type: 'ANIME',
        query: 'qzxvkjwq',
        per_page: 2,
      });

      const result = await animeSearchMedia.handler(input, ctx);

      expect(result).toEqual({
        source: 'anilist',
        page: 1,
        has_next_page: false,
        total_results: 0,
        results: [],
      });
      const notice = getEnrichment(ctx).notice as string;
      expect(notice).toContain('No results for query="qzxvkjwq"');
      expect(notice).toContain('try another title');
      expect(notice).not.toContain('remove filters');
      expect(notice).toMatch(/MyAnimeList fallback .*unavailable/);
      expect(notice).toContain('unconfirmed');
      const log = ctx.log as MockContextLogger;
      expect(log.calls.some((call) => call.level === 'warning')).toBe(true);
    });

    it('keeps the AniList empty page when MAL-ID resolution fails', async () => {
      vi.mocked(anilist.searchMedia).mockResolvedValue(emptyAnilistPage);
      vi.mocked(jikan.searchMedia).mockResolvedValue(mockJikanResult);
      vi.mocked(anilist.getMediaByMalIds).mockRejectedValue(new Error('AniList 500'));
      const ctx = createMockContext({ errors: animeSearchMedia.errors });
      const input = animeSearchMedia.input.parse({ media_type: 'ANIME', query: 'Steins;Gate' });

      const result = await animeSearchMedia.handler(input, ctx);

      expect(result.source).toBe('anilist');
      expect(result.results).toEqual([]);
      expect(getEnrichment(ctx).notice).toMatch(/MyAnimeList fallback .*unavailable/);
    });

    it('still fails the call when the AniList search itself fails', async () => {
      vi.mocked(anilist.searchMedia).mockRejectedValue(new Error('AniList down'));
      const ctx = createMockContext({ errors: animeSearchMedia.errors });
      const input = animeSearchMedia.input.parse({ media_type: 'ANIME', query: 'Steins;Gate' });

      await expect(animeSearchMedia.handler(input, ctx)).rejects.toThrow('AniList down');
      expect(jikan.searchMedia).not.toHaveBeenCalled();
    });

    it('makes no Jikan call for an empty page past the end of AniList matches', async () => {
      vi.mocked(anilist.searchMedia)
        .mockResolvedValueOnce(anilistPage([], { currentPage: 3, perPage: 5 }))
        .mockResolvedValueOnce(anilistPage([steinsGate], { hasNextPage: true, perPage: 1 }));
      const ctx = createMockContext({ errors: animeSearchMedia.errors });
      const input = animeSearchMedia.input.parse({
        media_type: 'ANIME',
        query: 'Steins;Gate',
        page: 3,
        per_page: 5,
      });

      const result = await animeSearchMedia.handler(input, ctx);

      expect(jikan.searchMedia).not.toHaveBeenCalled();
      expect(anilist.searchMedia).toHaveBeenCalledTimes(2);
      expect(anilist.searchMedia).toHaveBeenLastCalledWith(
        expect.objectContaining({ query: 'Steins;Gate', page: 1 }),
      );
      expect(result).toMatchObject({ source: 'anilist', page: 3, total_results: null });
      expect(getEnrichment(ctx).notice).toContain('Page 3 is past the end');
    });

    it('continues from Jikan at a later page when AniList has no match at all', async () => {
      vi.mocked(anilist.searchMedia)
        .mockResolvedValueOnce(anilistPage([], { currentPage: 2 }))
        .mockResolvedValueOnce(anilistPage([], { perPage: 1 }));
      vi.mocked(jikan.searchMedia).mockResolvedValue({
        ...mockJikanResult,
        pagination: { ...mockJikanResult.pagination!, current_page: 2 },
      });
      vi.mocked(anilist.getMediaByMalIds).mockResolvedValue(new Map([[9253, steinsGate]]));
      const ctx = createMockContext({ errors: animeSearchMedia.errors });
      const input = animeSearchMedia.input.parse({
        media_type: 'ANIME',
        query: 'Shutainzu Geto',
        page: 2,
      });

      const result = await animeSearchMedia.handler(input, ctx);

      expect(jikan.searchMedia).toHaveBeenCalledWith(expect.objectContaining({ page: 2 }));
      expect(result).toMatchObject({ source: 'jikan', page: 2 });
    });

    it.each([
      { genre: 'Action' },
      { tag: 'Time Manipulation' },
      { season: 'FALL' },
      { season_year: 2011 },
      { format: 'MUSIC' },
      { status: 'HIATUS' },
    ])('makes no Jikan call for a zero-match query with %o', async (filter) => {
      vi.mocked(anilist.searchMedia).mockResolvedValue(emptyAnilistPage);
      const ctx = createMockContext({ errors: animeSearchMedia.errors });
      const input = animeSearchMedia.input.parse({
        media_type: 'ANIME',
        query: 'Steins;Gate',
        ...filter,
      });

      const result = await animeSearchMedia.handler(input, ctx);

      expect(jikan.searchMedia).not.toHaveBeenCalled();
      expect(anilist.searchMedia).toHaveBeenCalledOnce();
      expect(result.source).toBe('anilist');
      expect(getEnrichment(ctx).notice).toContain('No results for query="Steins;Gate"');
      expect(getEnrichment(ctx).notice).toContain('remove filters');
    });

    it('carries the no-results notice when no fallback row resolves', async () => {
      vi.mocked(anilist.searchMedia).mockResolvedValue(emptyAnilistPage);
      vi.mocked(jikan.searchMedia).mockResolvedValue(mockJikanResult);
      vi.mocked(anilist.getMediaByMalIds).mockResolvedValue(new Map());
      const ctx = createMockContext({ errors: animeSearchMedia.errors });
      const input = animeSearchMedia.input.parse({ media_type: 'ANIME', query: 'Steins;Gate' });

      const result = await animeSearchMedia.handler(input, ctx);

      expect(result).toMatchObject({ source: 'jikan', results: [] });
      expect(getEnrichment(ctx).notice).toContain('No results for query="Steins;Gate"');
    });

    it('carries the no-results notice when Jikan also finds nothing', async () => {
      vi.mocked(anilist.searchMedia).mockResolvedValue(emptyAnilistPage);
      vi.mocked(jikan.searchMedia).mockResolvedValue({ results: [], pagination: null });
      vi.mocked(anilist.getMediaByMalIds).mockResolvedValue(new Map());
      const ctx = createMockContext({ errors: animeSearchMedia.errors });
      const input = animeSearchMedia.input.parse({ media_type: 'ANIME', query: 'qzxvkjwq' });

      const result = await animeSearchMedia.handler(input, ctx);

      expect(result).toMatchObject({ source: 'jikan', results: [], has_next_page: false });
      expect(getEnrichment(ctx).notice).toContain('No results for query="qzxvkjwq"');
    });
  });

  // ─── #26: only exact counts are reported ──────────────────────────────────────

  describe('result counts', () => {
    it('reports no count while more pages remain', async () => {
      vi.mocked(anilist.searchMedia).mockResolvedValue(
        anilistPage(nodes(5), { hasNextPage: true, perPage: 5 }),
      );

      const result = await runToolContract(animeSearchMedia, {
        media_type: 'ANIME',
        query: 'Steins;Gate',
        per_page: 5,
      });

      expect(result.isError).toBeFalsy();
      expect(result.structuredContent).toMatchObject({ total_results: null });
      expect(result.structuredContent).not.toHaveProperty('totalCount');
      expect(contentText(result)).not.toMatch(/\d+ total/);
      expect(contentText(result)).toContain('More results available (page 2)');
    });

    it('reports the exact count on a non-empty final page', async () => {
      vi.mocked(anilist.searchMedia).mockResolvedValue(
        anilistPage(nodes(17), { currentPage: 3, perPage: 50 }),
      );

      const result = await runToolContract(animeSearchMedia, {
        media_type: 'ANIME',
        genre: 'Action',
        page: 3,
        per_page: 50,
      });

      expect(result.structuredContent).toMatchObject({ total_results: 117, totalCount: 117 });
      expect(contentText(result)).toContain('117 total');
    });

    it('uses the page size AniList echoes, not the requested one', async () => {
      vi.mocked(anilist.searchMedia).mockResolvedValue(
        anilistPage(nodes(3), { currentPage: 2, perPage: 40 }),
      );
      const ctx = createMockContext({ errors: animeSearchMedia.errors });
      const input = animeSearchMedia.input.parse({
        media_type: 'ANIME',
        genre: 'Action',
        page: 2,
        per_page: 50,
      });

      const result = await animeSearchMedia.handler(input, ctx);

      expect(result.total_results).toBe(43);
    });

    it('reports 0 for an empty first page', async () => {
      vi.mocked(anilist.searchMedia).mockResolvedValue(emptyAnilistPage);

      const result = await runToolContract(animeSearchMedia, {
        media_type: 'ANIME',
        genre: 'Action',
        format: 'MUSIC',
      });

      expect(result.structuredContent).toMatchObject({ total_results: 0, totalCount: 0 });
      expect(contentText(result)).toContain('No results for genre="Action", format=MUSIC');
    });

    it('reports null and a past-the-end notice for an empty later page', async () => {
      vi.mocked(anilist.searchMedia).mockResolvedValue(anilistPage([], { currentPage: 4 }));

      const result = await runToolContract(animeSearchMedia, {
        media_type: 'ANIME',
        genre: 'Action',
        page: 4,
      });

      expect(result.structuredContent).toMatchObject({ total_results: null, results: [] });
      expect(result.structuredContent).not.toHaveProperty('totalCount');
      const notice = (result.structuredContent as { notice: string }).notice;
      expect(notice).toContain('Page 4 is past the end of the results for genre="Action"');
      // A caller paging forward reaches this page after an exactly full final page,
      // which AniList still reports with has_next_page true.
      expect(notice).toContain('exactly full');
      expect(notice).not.toContain('is the one with has_next_page false');
      expect(contentText(result)).toContain('Page 4 is past the end');
      expect(anilist.searchMedia).toHaveBeenCalledOnce();
    });

    it('reports null for MyAnimeList-sourced pages', async () => {
      vi.mocked(anilist.searchMedia).mockResolvedValue(emptyAnilistPage);
      vi.mocked(jikan.searchMedia).mockResolvedValue(mockJikanResult);
      vi.mocked(anilist.getMediaByMalIds).mockResolvedValue(new Map([[9253, steinsGate]]));

      const result = await runToolContract(animeSearchMedia, {
        media_type: 'ANIME',
        query: 'Steins;Gate',
      });

      expect(result.structuredContent).toMatchObject({ source: 'jikan', total_results: null });
      expect(result.structuredContent).not.toHaveProperty('totalCount');
      expect(contentText(result)).not.toMatch(/\d+ total/);
    });
  });

  // ─── #32: the fallback honors include_adult and the caller's page size ────────

  describe('fallback scope', () => {
    it.each([
      [false, true],
      [true, false],
    ])(
      'with include_adult %s, asks Jikan sfw=%s and the MAL lookup to match',
      async (includeAdult, sfw) => {
        vi.mocked(anilist.searchMedia).mockResolvedValue(emptyAnilistPage);
        vi.mocked(jikan.searchMedia).mockResolvedValue(mockJikanResult);
        vi.mocked(anilist.getMediaByMalIds).mockResolvedValue(new Map([[9253, steinsGate]]));
        const ctx = createMockContext({ errors: animeSearchMedia.errors });
        const input = animeSearchMedia.input.parse({
          media_type: 'MANGA',
          query: 'Steins;Gate',
          include_adult: includeAdult,
        });

        await animeSearchMedia.handler(input, ctx);

        expect(jikan.searchMedia).toHaveBeenCalledWith(expect.objectContaining({ sfw }));
        expect(anilist.getMediaByMalIds).toHaveBeenCalledWith([9253], 'MANGA', includeAdult);
      },
    );

    it('keeps the fallback at per_page 25', async () => {
      vi.mocked(anilist.searchMedia).mockResolvedValue(emptyAnilistPage);
      vi.mocked(jikan.searchMedia).mockResolvedValue(mockJikanResult);
      vi.mocked(anilist.getMediaByMalIds).mockResolvedValue(new Map([[9253, steinsGate]]));
      const ctx = createMockContext({ errors: animeSearchMedia.errors });
      const input = animeSearchMedia.input.parse({
        media_type: 'ANIME',
        query: 'Steins;Gate',
        per_page: 25,
      });

      const result = await animeSearchMedia.handler(input, ctx);

      expect(jikan.searchMedia).toHaveBeenCalledWith(expect.objectContaining({ limit: 25 }));
      expect(result.source).toBe('jikan');
    });

    it('skips the fallback above per_page 25 and says why', async () => {
      vi.mocked(anilist.searchMedia).mockResolvedValue(emptyAnilistPage);

      const result = await runToolContract(animeSearchMedia, {
        media_type: 'ANIME',
        query: 'qzxvkjwq',
        per_page: 26,
      });

      expect(jikan.searchMedia).not.toHaveBeenCalled();
      expect(anilist.getMediaByMalIds).not.toHaveBeenCalled();
      expect(result.structuredContent).toMatchObject({
        source: 'anilist',
        results: [],
        total_results: 0,
      });
      const notice = (result.structuredContent as { notice: string }).notice;
      expect(notice).toContain('No results for query="qzxvkjwq"');
      expect(notice).toMatch(/MyAnimeList fallback .*per_page up to 25/);
      expect(contentText(result)).toContain('per_page up to 25');
    });
  });

  // ─── #30: the last reachable page says further pages are out of reach ─────────

  describe('page-depth edge', () => {
    it.each([
      [100, 50],
      [102, 49],
    ])('page %i at %i per page carries the out-of-reach notice', async (page, perPage) => {
      vi.mocked(anilist.searchMedia).mockResolvedValue(
        anilistPage(nodes(perPage), { currentPage: page, hasNextPage: true, perPage }),
      );

      const result = await runToolContract(animeSearchMedia, {
        media_type: 'ANIME',
        genre: 'Action',
        page,
        per_page: perPage,
      });

      expect(result.structuredContent).toMatchObject({
        has_next_page: true,
        notice: PAGE_DEPTH_EDGE_NOTICE,
      });
      expect(contentText(result)).toContain(PAGE_DEPTH_EDGE_NOTICE);
      expect(contentText(result)).not.toContain('More results available');
    });

    it('page 99 at 50 per page keeps the next-page hint', async () => {
      vi.mocked(anilist.searchMedia).mockResolvedValue(
        anilistPage(nodes(50), { currentPage: 99, hasNextPage: true, perPage: 50 }),
      );

      const result = await runToolContract(animeSearchMedia, {
        media_type: 'ANIME',
        genre: 'Action',
        page: 99,
        per_page: 50,
      });

      expect(contentText(result)).toContain('More results available (page 100)');
    });

    it.each([
      [99, 50, true],
      [100, 50, false],
    ])(
      'page %i at %i per page (has_next_page %s) carries no notice',
      async (page, perPage, hasNextPage) => {
        vi.mocked(anilist.searchMedia).mockResolvedValue(
          anilistPage(nodes(perPage), { currentPage: page, hasNextPage, perPage }),
        );

        const result = await runToolContract(animeSearchMedia, {
          media_type: 'ANIME',
          genre: 'Action',
          page,
          per_page: perPage,
        });

        expect(result.isError).toBeFalsy();
        expect(result.structuredContent).not.toHaveProperty('notice');
        expect(contentText(result)).not.toContain('out of reach');
      },
    );
  });
});
