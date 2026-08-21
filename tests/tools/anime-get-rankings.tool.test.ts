/**
 * @fileoverview Tests for anime_get_rankings tool.
 * @module tests/tools/anime-get-rankings.tool.test
 */

import { createMockContext } from '@cyanheads/mcp-ts-core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { animeGetRankings } from '@/mcp-server/tools/definitions/anime-get-rankings.tool.js';
import type { MediaPage } from '@/services/anilist/types.js';

vi.mock('@/services/anilist/anilist-service.js');

import * as anilist from '@/services/anilist/anilist-service.js';

const mockPage: MediaPage = {
  pageInfo: { total: 100, currentPage: 1, lastPage: 4, hasNextPage: true, perPage: 25 },
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
    const ctx = createMockContext();
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
    const ctx = createMockContext();
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
    const ctx = createMockContext();
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
    const ctx = createMockContext();
    const input = animeGetRankings.input.parse({ mode: 'seasonal', media_type: 'ANIME' });

    const result = await animeGetRankings.handler(input, ctx);

    expect(result.season_label).toMatch(/^(WINTER|SPRING|SUMMER|FALL) \d{4}$/);
  });

  it('trending mode has null season_label', async () => {
    vi.mocked(anilist.getRankings).mockResolvedValue(mockPage);
    const ctx = createMockContext();
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
    const ctx = createMockContext();
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
      pageInfo: { total: null, currentPage: 1, lastPage: null, hasNextPage: false, perPage: 25 },
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
    const ctx = createMockContext();
    const input = animeGetRankings.input.parse({ mode: 'trending', media_type: 'ANIME' });
    const result = await animeGetRankings.handler(input, ctx);

    expect(result.entries[0]!.id_mal).toBeNull();
    expect(result.entries[0]!.mean_score).toBeNull();
    expect(result.total_results).toBeNull();
  });
});
