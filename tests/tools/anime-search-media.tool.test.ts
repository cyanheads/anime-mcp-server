/**
 * @fileoverview Tests for anime_search_media tool.
 * @module tests/tools/anime-search-media.tool.test
 */

import { createMockContext } from '@cyanheads/mcp-ts-core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { animeSearchMedia } from '@/mcp-server/tools/definitions/anime-search-media.tool.js';

// Mock the service modules at the boundary
vi.mock('@/services/anilist/anilist-service.js');
vi.mock('@/services/jikan/jikan-service.js');

import * as anilist from '@/services/anilist/anilist-service.js';
import * as jikan from '@/services/jikan/jikan-service.js';

const mockAnilistPage = {
  pageInfo: { total: 1, currentPage: 1, lastPage: 1, hasNextPage: false, perPage: 20 },
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
      title: { romaji: 'Steins;Gate', english: 'Steins;Gate', native: 'シュタインズ・ゲート' },
      coverImage: {
        large: 'https://example.com/cover.jpg',
        extraLarge: null,
        medium: null,
        color: null,
      },
    },
  ],
};

const emptyAnilistPage = {
  pageInfo: { total: 0, currentPage: 1, lastPage: 1, hasNextPage: false, perPage: 20 },
  media: [],
};

const mockJikanResult = {
  pagination: {
    current_page: 1,
    has_next_page: false,
    items: { total: 1, count: 1, per_page: 20 },
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
    },
  ],
};

describe('animeSearchMedia', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('returns AniList results when AniList has matches', async () => {
    vi.mocked(anilist.searchMedia).mockResolvedValue(mockAnilistPage);
    const ctx = createMockContext();
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

  it('falls back to Jikan when AniList returns empty results', async () => {
    vi.mocked(anilist.searchMedia).mockResolvedValue(emptyAnilistPage);
    vi.mocked(jikan.searchMedia).mockResolvedValue(mockJikanResult);
    const ctx = createMockContext();
    const input = animeSearchMedia.input.parse({ media_type: 'ANIME', query: 'Steins;Gate' });

    const result = await animeSearchMedia.handler(input, ctx);

    expect(result.source).toBe('jikan');
    expect(result.results).toHaveLength(1);
    expect(result.results[0]!.id_mal).toBe(9253);
    expect(vi.mocked(jikan.searchMedia)).toHaveBeenCalled();
  });

  it('returns empty results when AniList is empty and no query is provided', async () => {
    vi.mocked(anilist.searchMedia).mockResolvedValue(emptyAnilistPage);
    const ctx = createMockContext();
    const input = animeSearchMedia.input.parse({ media_type: 'ANIME', genre: 'Action' });

    const result = await animeSearchMedia.handler(input, ctx);

    expect(result.source).toBe('anilist');
    expect(result.results).toHaveLength(0);
    expect(result.total_results).toBe(0);
    expect(vi.mocked(jikan.searchMedia)).not.toHaveBeenCalled();
  });

  it('applies defaults: page=1, per_page=20, include_adult=false', () => {
    const input = animeSearchMedia.input.parse({ media_type: 'MANGA' });
    expect(input.page).toBe(1);
    expect(input.per_page).toBe(20);
    expect(input.include_adult).toBe(false);
  });

  it('formats output with IDs, scores, and season label', async () => {
    vi.mocked(anilist.searchMedia).mockResolvedValue(mockAnilistPage);
    const ctx = createMockContext();
    const input = animeSearchMedia.input.parse({ media_type: 'ANIME', query: 'Steins;Gate' });
    const result = await animeSearchMedia.handler(input, ctx);

    const blocks = animeSearchMedia.format!(result);
    expect(blocks).toHaveLength(1);
    const text = blocks[0]!.text as string;
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
    expect(blocks[0]!.text as string).toContain('No results found');
  });

  it('handles sparse payload: missing optional fields do not break output', async () => {
    const sparsePage = {
      pageInfo: { total: null, currentPage: 1, lastPage: null, hasNextPage: false, perPage: 20 },
      media: [
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
      ],
    };
    vi.mocked(anilist.searchMedia).mockResolvedValue(sparsePage);
    const ctx = createMockContext();
    const input = animeSearchMedia.input.parse({ media_type: 'ANIME', query: 'sparse' });
    const result = await animeSearchMedia.handler(input, ctx);

    expect(result.results[0]!.id).toBe(999);
    expect(result.results[0]!.id_mal).toBeNull();
    expect(result.results[0]!.cover_image_url).toBeNull();
    expect(result.total_results).toBeNull();
  });
});
