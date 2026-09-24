/**
 * @fileoverview Tests for anime_get_rankings tool.
 * @module tests/tools/anime-get-rankings.tool.test
 */

import { JsonRpcErrorCode, McpError } from '@cyanheads/mcp-ts-core/errors';
import { createMockContext, runToolContract } from '@cyanheads/mcp-ts-core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { animeGetRankings } from '@/mcp-server/tools/definitions/anime-get-rankings.tool.js';
import {
  PAGE_DEPTH_EDGE_NOTICE,
  PAGE_DEPTH_RECOVERY,
  toPageDepthError,
} from '@/services/anilist/pagination.js';
import type { MediaNode, MediaPage } from '@/services/anilist/types.js';

vi.mock('@/services/anilist/anilist-service.js');

import * as anilist from '@/services/anilist/anilist-service.js';

const mockPage: MediaPage = {
  pageInfo: { currentPage: 1, hasNextPage: true, perPage: 25 },
  media: [
    {
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
      title: { romaji: 'Steins;Gate', english: 'Steins;Gate', native: null },
      coverImage: {
        large: 'https://example.com/cover.jpg',
        extraLarge: null,
        medium: null,
        color: null,
      },
    },
  ],
};

describe('animeGetRankings', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('returns top rankings with rank positions starting from 1', async () => {
    vi.mocked(anilist.getRankings).mockResolvedValue(mockPage);
    const ctx = createMockContext({ errors: animeGetRankings.errors });
    const input = animeGetRankings.input.parse({ mode: 'top', media_type: 'ANIME' });

    const result = await animeGetRankings.handler(input, ctx);

    expect(result.mode).toBe('top');
    expect(result.media_type).toBe('ANIME');
    expect(result.entries).toHaveLength(1);
    expect(result.entries[0]!.rank).toBe(1);
    expect(result.entries[0]!.id).toBe(11757);
    expect(result.season_label).toBeNull();
  });

  it('computes correct rank offset on page 2', async () => {
    vi.mocked(anilist.getRankings).mockResolvedValue({
      ...mockPage,
      pageInfo: { ...mockPage.pageInfo, currentPage: 2 },
    });
    const ctx = createMockContext({ errors: animeGetRankings.errors });
    const input = animeGetRankings.input.parse({
      mode: 'top',
      media_type: 'ANIME',
      page: 2,
      per_page: 25,
    });

    const result = await animeGetRankings.handler(input, ctx);

    expect(result.entries[0]!.rank).toBe(26); // (page-1) * per_page + 1
  });

  it('includes season_label for seasonal mode', async () => {
    vi.mocked(anilist.getRankings).mockResolvedValue(mockPage);
    const ctx = createMockContext({ errors: animeGetRankings.errors });
    const input = animeGetRankings.input.parse({
      mode: 'seasonal',
      media_type: 'ANIME',
      season: 'FALL',
      season_year: 2024,
    });

    const result = await animeGetRankings.handler(input, ctx);

    expect(result.mode).toBe('seasonal');
    expect(result.season_label).toBe('FALL 2024');
  });

  it('computes current season_label when not explicitly provided in seasonal mode', async () => {
    vi.mocked(anilist.getRankings).mockResolvedValue(mockPage);
    const ctx = createMockContext({ errors: animeGetRankings.errors });
    const input = animeGetRankings.input.parse({ mode: 'seasonal', media_type: 'ANIME' });

    const result = await animeGetRankings.handler(input, ctx);

    expect(result.season_label).toMatch(/^(WINTER|SPRING|SUMMER|FALL) \d{4}$/);
  });

  it('trending mode has null season_label', async () => {
    vi.mocked(anilist.getRankings).mockResolvedValue(mockPage);
    const ctx = createMockContext({ errors: animeGetRankings.errors });
    const input = animeGetRankings.input.parse({ mode: 'trending', media_type: 'MANGA' });

    const result = await animeGetRankings.handler(input, ctx);

    expect(result.mode).toBe('trending');
    expect(result.media_type).toBe('MANGA');
    expect(result.season_label).toBeNull();
  });

  it('applies defaults: page=1, per_page=25', () => {
    const input = animeGetRankings.input.parse({ mode: 'top', media_type: 'ANIME' });
    expect(input.page).toBe(1);
    expect(input.per_page).toBe(25);
    expect(input.include_adult).toBe(false);
  });

  it('formats output with rank numbers and AniList IDs', async () => {
    vi.mocked(anilist.getRankings).mockResolvedValue(mockPage);
    const ctx = createMockContext({ errors: animeGetRankings.errors });
    const input = animeGetRankings.input.parse({ mode: 'top', media_type: 'ANIME' });
    const result = await animeGetRankings.handler(input, ctx);

    const blocks = animeGetRankings.format!(result);
    const text = (blocks[0] as { text: string }).text;
    expect(text).toContain('1.');
    expect(text).toContain('AL:11757');
    expect(text).toContain('90/100');
    expect(text).toContain('All-Time Top');
  });

  it('handles sparse payload: null idMal, null scores', async () => {
    const sparsePage = {
      pageInfo: { currentPage: 1, hasNextPage: false, perPage: 25 },
      media: [
        {
          id: 12345,
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
          title: { romaji: 'Unknown Anime', english: null, native: null },
          coverImage: null,
        },
      ],
    };
    vi.mocked(anilist.getRankings).mockResolvedValue(sparsePage);
    const ctx = createMockContext({ errors: animeGetRankings.errors });
    const input = animeGetRankings.input.parse({ mode: 'trending', media_type: 'ANIME' });
    const result = await animeGetRankings.handler(input, ctx);

    expect(result.entries[0]!.id_mal).toBeNull();
    expect(result.entries[0]!.mean_score).toBeNull();
    // A single final page: the count is exact.
    expect(result.total_results).toBe(1);
  });
});

// ─── Shared fixtures for the contract-level cases below ───────────────────────

const baseNode = mockPage.media[0]!;

/** `count` distinct media nodes derived from the Steins;Gate fixture. */
function nodes(count: number): MediaNode[] {
  return Array.from({ length: count }, (_, i) => ({ ...baseNode, id: 1000 + i }));
}

/** A page of rankings; `total` stands in for AniList's placeholder count, which the tool must ignore. */
function rankingPage(
  media: MediaNode[],
  pageInfo: Partial<MediaPage['pageInfo']> & { total?: number } = {},
): MediaPage {
  return { pageInfo: { currentPage: 1, hasNextPage: false, perPage: 25, ...pageInfo }, media };
}

function contentText(result: { content: unknown[] }): string {
  return result.content.map((block) => (block as { text?: string }).text ?? '').join('\n');
}

/** The error the AniList service throws for its page-depth refusal. */
function pageDepthError() {
  return toPageDepthError(
    new McpError(
      JsonRpcErrorCode.InvalidParams,
      'Fetch failed for https://graphql.anilist.co. Status: 400',
      {
        status: 400,
        body: '{"errors":[{"message":"Page depth exceeds maximum allowed for API requests (5000 entries)","status":400}]}',
      },
    ),
  )!;
}

describe('animeGetRankings filters and contracts', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  // ─── characterization: behavior that holds before and after ─────────────────

  it('forwards genre and format to AniList in top mode', async () => {
    vi.mocked(anilist.getRankings).mockResolvedValue(mockPage);

    await runToolContract(animeGetRankings, {
      mode: 'top',
      media_type: 'ANIME',
      genre: 'Romance',
      format: 'MOVIE',
    });

    expect(anilist.getRankings).toHaveBeenCalledWith(
      expect.objectContaining({ mode: 'top', genre: 'Romance', format: 'MOVIE' }),
    );
  });

  it.each(['top', 'trending'] as const)(
    '%s mode forwards season and season_year as filters',
    async (mode) => {
      vi.mocked(anilist.getRankings).mockResolvedValue(mockPage);

      await runToolContract(animeGetRankings, {
        mode,
        media_type: 'ANIME',
        season: 'FALL',
        season_year: 2011,
      });

      expect(anilist.getRankings).toHaveBeenCalledWith(
        expect.objectContaining({ mode, season: 'FALL', seasonYear: 2011 }),
      );
    },
  );

  // ─── #24: tag filter ────────────────────────────────────────────────────────

  describe('tag filter', () => {
    it.each([
      ['top', 'ANIME'],
      ['trending', 'MANGA'],
      ['seasonal', 'ANIME'],
    ] as const)('forwards tag in %s mode for %s', async (mode, mediaType) => {
      vi.mocked(anilist.getRankings).mockResolvedValue(mockPage);

      const result = await runToolContract(animeGetRankings, {
        mode,
        media_type: mediaType,
        tag: 'Isekai',
      });

      expect(result.isError).toBeFalsy();
      expect(anilist.getRankings).toHaveBeenCalledWith(
        expect.objectContaining({ mode, mediaType, tag: 'Isekai' }),
      );
    });

    it('trims a padded tag before sending it', async () => {
      vi.mocked(anilist.getRankings).mockResolvedValue(mockPage);

      await runToolContract(animeGetRankings, {
        mode: 'top',
        media_type: 'ANIME',
        tag: ' Isekai ',
      });

      expect(anilist.getRankings).toHaveBeenCalledWith(expect.objectContaining({ tag: 'Isekai' }));
    });

    it.each(['', '   '])('sends no tag for the blank value %o', async (tag) => {
      vi.mocked(anilist.getRankings).mockResolvedValue(mockPage);

      const result = await runToolContract(animeGetRankings, {
        mode: 'top',
        media_type: 'ANIME',
        tag,
        genre: ' ',
      });

      expect(result.isError).toBeFalsy();
      const params = vi.mocked(anilist.getRankings).mock.calls[0]![0];
      expect(params.tag).toBeUndefined();
      expect(params.genre).toBeUndefined();
    });

    it('echoes the tag in the empty-result notice and says genres are not tags', async () => {
      vi.mocked(anilist.getRankings).mockResolvedValue(rankingPage([]));

      const result = await runToolContract(animeGetRankings, {
        mode: 'trending',
        media_type: 'ANIME',
        tag: ' Qzxv ',
        genre: 'Action',
      });

      const notice = (result.structuredContent as { notice: string }).notice;
      expect(notice).toContain('tag="Qzxv"');
      expect(notice).toContain('genre="Action"');
      expect(notice).toMatch(/AniList tag name/);
      expect(notice).toMatch(/genres such as "Action" or "Mecha" are not tags/);
      expect(contentText(result)).toContain('tag="Qzxv"');
    });
  });

  // ─── #25: season inputs ─────────────────────────────────────────────────────

  describe('season inputs', () => {
    it.each([{ season: 'WINTER' }, { season_year: 2024 }] as const)(
      'seasonal mode with only %o fails invalid_season before any AniList call',
      async (partial) => {
        const declared = animeGetRankings.errors?.find((e) => e.reason === 'invalid_season');

        const result = await runToolContract(animeGetRankings, {
          mode: 'seasonal',
          media_type: 'ANIME',
          ...partial,
        });

        expect(declared).toMatchObject({ code: JsonRpcErrorCode.ValidationError });
        expect(result.isError).toBe(true);
        expect(result.structuredContent).toMatchObject({
          error: {
            code: JsonRpcErrorCode.ValidationError,
            data: { reason: 'invalid_season', recovery: { hint: declared?.recovery } },
          },
        });
        expect(contentText(result)).toContain(`Recovery: ${declared?.recovery}`);
        expect(anilist.getRankings).not.toHaveBeenCalled();
      },
    );

    it.each([
      [{ season: 'FALL', season_year: 2011 }, 'FALL 2011'],
      [{ season: 'FALL' }, 'FALL (any year)'],
      [{ season_year: 2011 }, '2011'],
    ] as const)('top mode labels the applied season filter %o as %s', async (filter, label) => {
      vi.mocked(anilist.getRankings).mockResolvedValue(mockPage);

      const result = await runToolContract(animeGetRankings, {
        mode: 'top',
        media_type: 'ANIME',
        ...filter,
      });

      expect(result.structuredContent).toMatchObject({ season_label: label });
      const text = contentText(result);
      expect(text).not.toContain('All-Time Top');
      expect(text).not.toContain('season_label: none');
      expect(text).toContain(`## Top ANIME · ${label}`);
    });

    it('trending mode labels a season filter', async () => {
      vi.mocked(anilist.getRankings).mockResolvedValue(mockPage);

      const result = await runToolContract(animeGetRankings, {
        mode: 'trending',
        media_type: 'ANIME',
        season: 'SPRING',
        season_year: 2024,
      });

      expect(result.structuredContent).toMatchObject({ season_label: 'SPRING 2024' });
      expect(contentText(result)).toContain('## Trending ANIME · SPRING 2024');
    });

    it('top mode without a season filter stays "All-Time Top" with a null label', async () => {
      vi.mocked(anilist.getRankings).mockResolvedValue(mockPage);

      const result = await runToolContract(animeGetRankings, { mode: 'top', media_type: 'ANIME' });

      expect(result.structuredContent).toMatchObject({ season_label: null });
      expect(contentText(result)).toContain('## All-Time Top ANIME');
    });
  });

  // ─── #26: exact counts only ─────────────────────────────────────────────────

  describe('result counts', () => {
    it('reports no count while more pages remain', async () => {
      vi.mocked(anilist.getRankings).mockResolvedValue(
        rankingPage(nodes(25), { hasNextPage: true, total: 5000 }),
      );

      const result = await runToolContract(animeGetRankings, { mode: 'top', media_type: 'ANIME' });

      expect(result.structuredContent).toMatchObject({ total_results: null });
      expect(result.structuredContent).not.toHaveProperty('totalCount');
      expect(contentText(result)).not.toMatch(/\d+ total/);
    });

    it('reports the exact count on a non-empty final page, using the echoed page size', async () => {
      vi.mocked(anilist.getRankings).mockResolvedValue(
        rankingPage(nodes(17), { currentPage: 3, perPage: 50 }),
      );

      const result = await runToolContract(animeGetRankings, {
        mode: 'top',
        media_type: 'ANIME',
        page: 3,
        per_page: 50,
      });

      expect(result.structuredContent).toMatchObject({ total_results: 117, totalCount: 117 });
      expect(contentText(result)).toContain('117 total');
    });

    it('reports 0 for an empty first page', async () => {
      vi.mocked(anilist.getRankings).mockResolvedValue(rankingPage([]));

      const result = await runToolContract(animeGetRankings, {
        mode: 'top',
        media_type: 'ANIME',
        genre: 'Qzxv',
      });

      expect(result.structuredContent).toMatchObject({ total_results: 0, totalCount: 0 });
      expect((result.structuredContent as { notice: string }).notice).toContain(
        'No entries for mode=top, genre="Qzxv"',
      );
    });

    it('reports null and a past-the-end notice for an empty later page', async () => {
      vi.mocked(anilist.getRankings).mockResolvedValue(rankingPage([], { currentPage: 9 }));

      const result = await runToolContract(animeGetRankings, {
        mode: 'top',
        media_type: 'ANIME',
        page: 9,
      });

      expect(result.structuredContent).toMatchObject({ total_results: null, entries: [] });
      expect(result.structuredContent).not.toHaveProperty('totalCount');
      const notice = (result.structuredContent as { notice: string }).notice;
      expect(notice).toContain('Page 9 is past the end of the rankings for mode=top');
      expect(notice).toContain('exactly full');
      expect(notice).not.toContain('is the one with has_next_page false');
      expect(notice).not.toContain('No entries for');
      expect(contentText(result)).toContain('Page 9 is past the end');
    });
  });

  // ─── #30: AniList's 5,000-entry reach ───────────────────────────────────────

  describe('page depth', () => {
    it('declares page_depth_exceeded as a service-thrown ValidationError', () => {
      expect(animeGetRankings.errors).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            reason: 'page_depth_exceeded',
            code: JsonRpcErrorCode.ValidationError,
            recovery: PAGE_DEPTH_RECOVERY,
            thrownBy: 'service',
          }),
        ]),
      );
    });

    it('surfaces the refusal with its recovery hint on both surfaces', async () => {
      vi.mocked(anilist.getRankings).mockRejectedValue(pageDepthError());

      const result = await runToolContract(animeGetRankings, {
        mode: 'top',
        media_type: 'ANIME',
        page: 101,
        per_page: 50,
      });

      expect(result.isError).toBe(true);
      expect(result.structuredContent).toMatchObject({
        error: {
          code: JsonRpcErrorCode.ValidationError,
          data: { reason: 'page_depth_exceeded', recovery: { hint: PAGE_DEPTH_RECOVERY } },
        },
      });
      expect(contentText(result)).toContain(`Recovery: ${PAGE_DEPTH_RECOVERY}`);
    });

    it('states the 5,000-entry reach on page and per_page', () => {
      const shape = animeGetRankings.input.shape;
      expect(shape.page.description).toContain('5,000');
      expect(shape.per_page.description).toContain('5,000');
    });

    it.each([
      [100, 50],
      [102, 49],
    ])(
      'page %i at %i per page carries the out-of-reach notice instead of a next-page hint',
      async (page, perPage) => {
        vi.mocked(anilist.getRankings).mockResolvedValue(
          rankingPage(nodes(perPage), { currentPage: page, hasNextPage: true, perPage }),
        );

        const result = await runToolContract(animeGetRankings, {
          mode: 'top',
          media_type: 'ANIME',
          page,
          per_page: perPage,
        });

        expect(result.structuredContent).toMatchObject({
          has_next_page: true,
          notice: PAGE_DEPTH_EDGE_NOTICE,
        });
        const text = contentText(result);
        expect(text).toContain(PAGE_DEPTH_EDGE_NOTICE);
        expect(text).not.toContain('More results available');
      },
    );

    it('page 99 at 50 per page keeps the next-page hint and no notice', async () => {
      vi.mocked(anilist.getRankings).mockResolvedValue(
        rankingPage(nodes(50), { currentPage: 99, hasNextPage: true, perPage: 50 }),
      );

      const result = await runToolContract(animeGetRankings, {
        mode: 'top',
        media_type: 'ANIME',
        page: 99,
        per_page: 50,
      });

      expect(result.structuredContent).not.toHaveProperty('notice');
      expect(contentText(result)).toContain('More results available (page 100)');
    });
  });
});
