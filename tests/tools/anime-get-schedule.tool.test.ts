/**
 * @fileoverview Tests for anime_get_schedule tool.
 * @module tests/tools/anime-get-schedule.tool.test
 */

import { JsonRpcErrorCode, McpError } from '@cyanheads/mcp-ts-core/errors';
import { createMockContext, runToolContract } from '@cyanheads/mcp-ts-core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { animeGetSchedule } from '@/mcp-server/tools/definitions/anime-get-schedule.tool.js';
import {
  PAGE_DEPTH_EDGE_NOTICE,
  PAGE_DEPTH_RECOVERY,
  toPageDepthError,
} from '@/services/anilist/pagination.js';
import type { AiringSchedule, MediaNode, MediaPage } from '@/services/anilist/types.js';

vi.mock('@/services/anilist/anilist-service.js');

import * as anilist from '@/services/anilist/anilist-service.js';

const mockMediaNode: MediaNode & {
  nextAiringEpisode: { airingAt: number; episode: number; timeUntilAiring: number } | null;
} = {
  id: 154587,
  idMal: null,
  type: 'ANIME' as const,
  format: 'TV',
  status: 'RELEASING',
  season: 'FALL',
  seasonYear: 2024,
  episodes: null,
  chapters: null,
  volumes: null,
  meanScore: 78,
  isAdult: false,
  title: { romaji: 'Example Anime', english: 'Example Anime', native: null },
  coverImage: {
    large: 'https://example.com/cover.jpg',
    extraLarge: null,
    medium: null,
    color: null,
  },
  nextAiringEpisode: {
    airingAt: Math.floor(Date.now() / 1000) + 3600, // 1 hour from now
    episode: 5,
    timeUntilAiring: 3600,
  },
};

const mockSeasonPage: MediaPage = {
  pageInfo: { currentPage: 1, hasNextPage: false, perPage: 25 },
  media: [mockMediaNode],
};

const mockAiringSchedules: AiringSchedule[] = [
  {
    id: 1,
    airingAt: Math.floor(Date.now() / 1000) + 3600,
    episode: 5,
    timeUntilAiring: 3600,
    media: mockMediaNode,
  },
];

const adultSchedule: AiringSchedule = {
  ...mockAiringSchedules[0]!,
  id: 2,
  media: {
    ...mockMediaNode,
    id: 999,
    isAdult: true,
    title: { ...mockMediaNode.title, romaji: 'Adult Example', english: null },
  },
};

const upcomingPage = {
  airingSchedules: mockAiringSchedules,
  hasNextPage: false,
};

describe('animeGetSchedule', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('returns season schedule when mode is "season" with valid params', async () => {
    vi.mocked(anilist.getSeasonSchedule).mockResolvedValue(mockSeasonPage);
    const ctx = createMockContext({ errors: animeGetSchedule.errors });
    const input = animeGetSchedule.input.parse({
      mode: 'season',
      season: 'FALL',
      season_year: 2024,
    });

    const result = await animeGetSchedule.handler(input, ctx);

    expect(result.mode).toBe('season');
    expect(result.season_label).toBe('FALL 2024');
    expect(result.entries).toHaveLength(1);
    expect(result.entries[0]!.id).toBe(154587);
  });

  it('throws ctx.fail("invalid_season") when mode is "season" but season is missing', async () => {
    const ctx = createMockContext({ errors: animeGetSchedule.errors });
    const input = animeGetSchedule.input.parse({ mode: 'season', season_year: 2024 });

    await expect(animeGetSchedule.handler(input, ctx)).rejects.toMatchObject({
      code: JsonRpcErrorCode.ValidationError,
      message: 'mode "season" requires both season and season_year parameters',
      data: { reason: 'invalid_season' },
    });
  });

  it('throws ctx.fail("invalid_season") when mode is "season" but season_year is missing', async () => {
    const ctx = createMockContext({ errors: animeGetSchedule.errors });
    const input = animeGetSchedule.input.parse({ mode: 'season', season: 'FALL' });

    await expect(animeGetSchedule.handler(input, ctx)).rejects.toMatchObject({
      code: JsonRpcErrorCode.ValidationError,
      message: 'mode "season" requires both season and season_year parameters',
      data: { reason: 'invalid_season' },
    });
  });

  it('returns the declared recovery hint on both invalid-season error surfaces', async () => {
    const result = await runToolContract(animeGetSchedule, {
      mode: 'season',
      season_year: 2024,
    });
    const recovery =
      'Provide both season (WINTER/SPRING/SUMMER/FALL) and season_year (e.g. 2024) when using mode "season".';

    expect(result).toMatchObject({
      isError: true,
      structuredContent: {
        error: {
          code: JsonRpcErrorCode.ValidationError,
          message: 'mode "season" requires both season and season_year parameters',
          data: { reason: 'invalid_season', recovery: { hint: recovery } },
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

  it('returns upcoming episodes when mode is "upcoming"', async () => {
    vi.mocked(anilist.getUpcomingEpisodes).mockResolvedValue(upcomingPage);
    const ctx = createMockContext({ errors: animeGetSchedule.errors });
    const input = animeGetSchedule.input.parse({ mode: 'upcoming', days_ahead: 7 });

    const result = await animeGetSchedule.handler(input, ctx);

    expect(result.mode).toBe('upcoming');
    expect(result.season_label).toBeNull();
    expect(result.entries).toHaveLength(1);
    expect(result.entries[0]!.next_episode).toBe(5);
    expect(result.entries[0]!.next_airing_at_utc).toBeTruthy();
  });

  it('filters adult upcoming schedules by default and includes them when requested', async () => {
    vi.mocked(anilist.getUpcomingEpisodes).mockResolvedValue({
      airingSchedules: [...mockAiringSchedules, adultSchedule],
      hasNextPage: false,
    });
    const defaultResult = await animeGetSchedule.handler(
      animeGetSchedule.input.parse({ mode: 'upcoming' }),
      createMockContext({ errors: animeGetSchedule.errors }),
    );
    const adultResult = await animeGetSchedule.handler(
      animeGetSchedule.input.parse({ mode: 'upcoming', include_adult: true }),
      createMockContext({ errors: animeGetSchedule.errors }),
    );

    expect(defaultResult.entries.map((entry) => entry.id)).toEqual([154587]);
    expect(adultResult.entries.map((entry) => entry.id)).toEqual([154587, 999]);
  });

  it('preserves upstream hasNextPage when filtering leaves an empty visible page', async () => {
    vi.mocked(anilist.getUpcomingEpisodes).mockResolvedValue({
      airingSchedules: [adultSchedule],
      hasNextPage: true,
    });

    const result = await animeGetSchedule.handler(
      animeGetSchedule.input.parse({ mode: 'upcoming', page: 3, per_page: 1 }),
      createMockContext({ errors: animeGetSchedule.errors }),
    );

    expect(result.entries).toEqual([]);
    expect(result.has_next_page).toBe(true);
  });

  it('says a page emptied by the adult filter hid adult titles, not that the window is empty', async () => {
    vi.mocked(anilist.getUpcomingEpisodes).mockResolvedValue({
      airingSchedules: [adultSchedule],
      hasNextPage: true,
    });

    const result = await runToolContract(animeGetSchedule, {
      mode: 'upcoming',
      page: 3,
      per_page: 1,
    });

    const notice = (result.structuredContent as { notice: string }).notice;
    expect(notice).toContain('include_adult');
    expect(notice).toContain('page 4');
    expect(notice).not.toContain('No upcoming episodes found');
  });

  it('says an empty upcoming page past the first is past the end of the window', async () => {
    vi.mocked(anilist.getUpcomingEpisodes).mockResolvedValue({
      airingSchedules: [],
      hasNextPage: false,
    });

    const result = await runToolContract(animeGetSchedule, { mode: 'upcoming', page: 5 });

    const notice = (result.structuredContent as { notice: string }).notice;
    expect(notice).toContain('Page 5 is past the end');
    expect(notice).not.toContain('Try increasing days_ahead');
  });

  it('applies defaults: days_ahead stays unset (7 is applied in the handler)', () => {
    const input = animeGetSchedule.input.parse({ mode: 'upcoming' });
    expect(input.days_ahead).toBeUndefined();
    expect(input.page).toBe(1);
    expect(input.per_page).toBe(25);
    expect(input.include_adult).toBe(false);
  });

  it('formats season schedule output with season label and IDs', async () => {
    vi.mocked(anilist.getSeasonSchedule).mockResolvedValue(mockSeasonPage);
    const ctx = createMockContext({ errors: animeGetSchedule.errors });
    const input = animeGetSchedule.input.parse({
      mode: 'season',
      season: 'FALL',
      season_year: 2024,
    });
    const result = await animeGetSchedule.handler(input, ctx);

    const blocks = animeGetSchedule.format!(result);
    const text = (blocks[0] as { text: string }).text;
    expect(text).toContain('FALL 2024');
    expect(text).toContain('AL:154587');
  });

  it('formats upcoming schedule output with countdown', async () => {
    vi.mocked(anilist.getUpcomingEpisodes).mockResolvedValue(upcomingPage);
    const ctx = createMockContext({ errors: animeGetSchedule.errors });
    const input = animeGetSchedule.input.parse({ mode: 'upcoming' });
    const result = await animeGetSchedule.handler(input, ctx);

    const blocks = animeGetSchedule.format!(result);
    const text = (blocks[0] as { text: string }).text;
    expect(text).toContain('Ep 5');
    expect(text).toContain('AL:154587');
  });

  it('handles empty season schedule', async () => {
    vi.mocked(anilist.getSeasonSchedule).mockResolvedValue({
      pageInfo: { currentPage: 1, hasNextPage: false, perPage: 25 },
      media: [],
    });
    const ctx = createMockContext({ errors: animeGetSchedule.errors });
    const input = animeGetSchedule.input.parse({
      mode: 'season',
      season: 'WINTER',
      season_year: 1940,
    });
    const result = await animeGetSchedule.handler(input, ctx);

    expect(result.entries).toHaveLength(0);
    const blocks = animeGetSchedule.format!(result);
    expect((blocks[0] as { text: string }).text).toContain('No entries found');
  });
});

// ─── Shared fixtures for the contract-level cases below ───────────────────────

/** `count` distinct season-mode nodes derived from the fixture. */
function seasonNodes(count: number): (typeof mockMediaNode)[] {
  return Array.from({ length: count }, (_, i) => ({ ...mockMediaNode, id: 2000 + i }));
}

/** A season page; `total` stands in for AniList's placeholder count, which the tool must ignore. */
function seasonPage(
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

describe('animeGetSchedule inputs and contracts', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  // ─── characterization: behavior that holds before and after ─────────────────

  it('forwards an explicit days_ahead in upcoming mode', async () => {
    vi.mocked(anilist.getUpcomingEpisodes).mockResolvedValue(upcomingPage);

    await runToolContract(animeGetSchedule, { mode: 'upcoming', days_ahead: 3 });

    expect(anilist.getUpcomingEpisodes).toHaveBeenCalledWith(
      expect.objectContaining({ daysAhead: 3 }),
    );
  });

  it('upcoming mode without days_ahead still looks 7 days ahead', async () => {
    vi.mocked(anilist.getUpcomingEpisodes).mockResolvedValue(upcomingPage);

    const result = await runToolContract(animeGetSchedule, { mode: 'upcoming' });

    expect(result.isError).toBeFalsy();
    expect(anilist.getUpcomingEpisodes).toHaveBeenCalledWith(
      expect.objectContaining({ daysAhead: 7 }),
    );
  });

  it('upcoming mode keeps total_results null', async () => {
    vi.mocked(anilist.getUpcomingEpisodes).mockResolvedValue(upcomingPage);

    const result = await runToolContract(animeGetSchedule, { mode: 'upcoming' });

    expect(result.structuredContent).toMatchObject({ mode: 'upcoming', total_results: null });
    expect(result.structuredContent).not.toHaveProperty('totalCount');
  });

  // ─── #25: mode-irrelevant inputs are rejected ───────────────────────────────

  describe('conflicting inputs', () => {
    it.each([
      [{ mode: 'upcoming', season: 'WINTER', season_year: 1999 }, /season, season_year/],
      [{ mode: 'upcoming', season: 'WINTER' }, /season/],
      [{ mode: 'upcoming', season_year: 1999 }, /season_year/],
      [{ mode: 'season', season: 'FALL', season_year: 2024, days_ahead: 3 }, /days_ahead/],
    ] as const)(
      'rejects %o with conflicting_inputs before any AniList call',
      async (raw, named) => {
        const declared = animeGetSchedule.errors?.find((e) => e.reason === 'conflicting_inputs');

        const result = await runToolContract(animeGetSchedule, raw);

        expect(declared).toMatchObject({ code: JsonRpcErrorCode.ValidationError });
        expect(result.isError).toBe(true);
        expect(result.structuredContent).toMatchObject({
          error: {
            code: JsonRpcErrorCode.ValidationError,
            message: expect.stringMatching(named),
            data: { reason: 'conflicting_inputs', recovery: { hint: declared?.recovery } },
          },
        });
        expect(contentText(result)).toContain(`Recovery: ${declared?.recovery}`);
        expect(anilist.getSeasonSchedule).not.toHaveBeenCalled();
        expect(anilist.getUpcomingEpisodes).not.toHaveBeenCalled();
      },
    );

    it('leaves days_ahead unset when the caller omits it', () => {
      const input = animeGetSchedule.input.parse({
        mode: 'season',
        season: 'FALL',
        season_year: 2024,
      });
      expect(input.days_ahead).toBeUndefined();
    });
  });

  // ─── #26: exact counts in season mode ───────────────────────────────────────

  describe('season-mode counts', () => {
    it('reports no count while more pages remain', async () => {
      vi.mocked(anilist.getSeasonSchedule).mockResolvedValue(
        seasonPage(seasonNodes(50), { hasNextPage: true, perPage: 50, total: 5000 }),
      );

      const result = await runToolContract(animeGetSchedule, {
        mode: 'season',
        season: 'FALL',
        season_year: 2024,
        per_page: 50,
      });

      expect(result.structuredContent).toMatchObject({ total_results: null });
      expect(result.structuredContent).not.toHaveProperty('totalCount');
      expect(contentText(result)).not.toMatch(/\d+ titles/);
    });

    it('reports the exact count on a non-empty final page', async () => {
      vi.mocked(anilist.getSeasonSchedule).mockResolvedValue(
        seasonPage(seasonNodes(17), { currentPage: 3, perPage: 50 }),
      );

      const result = await runToolContract(animeGetSchedule, {
        mode: 'season',
        season: 'FALL',
        season_year: 2024,
        page: 3,
        per_page: 50,
      });

      expect(result.structuredContent).toMatchObject({ total_results: 117, totalCount: 117 });
      expect(contentText(result)).toContain('117 titles');
    });

    it('reports 0 for an empty first page', async () => {
      vi.mocked(anilist.getSeasonSchedule).mockResolvedValue(seasonPage([]));

      const result = await runToolContract(animeGetSchedule, {
        mode: 'season',
        season: 'WINTER',
        season_year: 1940,
      });

      expect(result.structuredContent).toMatchObject({ total_results: 0, totalCount: 0 });
      expect((result.structuredContent as { notice: string }).notice).toContain(
        'No entries for WINTER 1940',
      );
    });

    it('reports null and a past-the-end notice for an empty later page', async () => {
      vi.mocked(anilist.getSeasonSchedule).mockResolvedValue(
        seasonPage([], { currentPage: 6, total: 125 }),
      );

      const result = await runToolContract(animeGetSchedule, {
        mode: 'season',
        season: 'FALL',
        season_year: 2024,
        page: 6,
      });

      expect(result.structuredContent).toMatchObject({ total_results: null, entries: [] });
      expect(result.structuredContent).not.toHaveProperty('totalCount');
      const notice = (result.structuredContent as { notice: string }).notice;
      expect(notice).toContain('Page 6 is past the end of the FALL 2024 schedule');
      expect(notice).toContain('exactly full');
      expect(notice).not.toContain('is the one with has_next_page false');
      expect(notice).not.toContain('No entries for');
      expect(contentText(result)).toContain('Page 6 is past the end');
    });
  });

  // ─── #30: AniList's 5,000-entry reach ───────────────────────────────────────

  describe('page depth', () => {
    it('declares page_depth_exceeded as a service-thrown ValidationError', () => {
      expect(animeGetSchedule.errors).toEqual(
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
      vi.mocked(anilist.getSeasonSchedule).mockRejectedValue(pageDepthError());

      const result = await runToolContract(animeGetSchedule, {
        mode: 'season',
        season: 'FALL',
        season_year: 2024,
        page: 250,
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
      const shape = animeGetSchedule.input.shape;
      expect(shape.page.description).toContain('5,000');
      expect(shape.per_page.description).toContain('5,000');
    });

    it.each([
      [100, 50],
      [102, 49],
    ])(
      'season page %i at %i per page carries the out-of-reach notice instead of a next-page hint',
      async (page, perPage) => {
        vi.mocked(anilist.getSeasonSchedule).mockResolvedValue(
          seasonPage(seasonNodes(perPage), { currentPage: page, hasNextPage: true, perPage }),
        );

        const result = await runToolContract(animeGetSchedule, {
          mode: 'season',
          season: 'FALL',
          season_year: 2024,
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

    it('season page 99 at 50 per page keeps the next-page hint and no notice', async () => {
      vi.mocked(anilist.getSeasonSchedule).mockResolvedValue(
        seasonPage(seasonNodes(50), { currentPage: 99, hasNextPage: true, perPage: 50 }),
      );

      const result = await runToolContract(animeGetSchedule, {
        mode: 'season',
        season: 'FALL',
        season_year: 2024,
        page: 99,
        per_page: 50,
      });

      expect(result.structuredContent).not.toHaveProperty('notice');
      expect(contentText(result)).toContain('More results available (page 100)');
    });
  });
});
