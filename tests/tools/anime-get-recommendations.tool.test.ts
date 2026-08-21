/**
 * @fileoverview Tests for anime_get_recommendations tool.
 * @module tests/tools/anime-get-recommendations.tool.test
 */

import { createMockContext, runToolContract } from '@cyanheads/mcp-ts-core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { animeGetRecommendations } from '@/mcp-server/tools/definitions/anime-get-recommendations.tool.js';
import type { RecommendationNode } from '@/services/anilist/types.js';
import type { JikanRecommendation } from '@/services/jikan/types.js';

vi.mock('@/services/anilist/anilist-service.js');
vi.mock('@/services/jikan/jikan-service.js');

import * as anilist from '@/services/anilist/anilist-service.js';
import * as jikan from '@/services/jikan/jikan-service.js';

const sourceDetail = {
  id: 11757,
  idMal: 9253,
  type: 'ANIME' as const,
  format: 'TV',
  status: 'FINISHED',
  season: null,
  seasonYear: null,
  episodes: 25,
  chapters: null,
  volumes: null,
  meanScore: 90,
  isAdult: false,
  title: { romaji: 'Steins;Gate', english: 'Steins;Gate', native: null },
  coverImage: null,
};

const mockAnilistRecs: { nodes: RecommendationNode[]; hasNextPage: boolean } = {
  nodes: [
    {
      rating: 100,
      mediaRecommendation: {
        id: 9756,
        idMal: 4654,
        type: 'ANIME' as const,
        format: 'TV',
        status: 'FINISHED',
        season: null,
        seasonYear: null,
        episodes: 24,
        chapters: null,
        volumes: null,
        meanScore: 85,
        isAdult: false,
        title: {
          romaji: 'Fullmetal Alchemist: Brotherhood',
          english: 'Fullmetal Alchemist: Brotherhood',
          native: null,
        },
        coverImage: {
          large: 'https://example.com/fma.jpg',
          extraLarge: null,
          medium: null,
          color: null,
        },
      },
    },
  ],
  hasNextPage: false,
};

const mockJikanRecs: JikanRecommendation[] = [
  {
    entry: {
      mal_id: 4654,
      title: 'Fullmetal Alchemist: Brotherhood',
      url: 'https://myanimelist.net/anime/4654',
      images: null,
    },
    votes: 25,
  },
];

describe('animeGetRecommendations', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('returns merged recommendations from AniList and Jikan', async () => {
    vi.mocked(anilist.getRecommendations).mockResolvedValue(mockAnilistRecs);
    vi.mocked(anilist.getMediaById).mockResolvedValue(sourceDetail as any);
    vi.mocked(jikan.getRecommendations).mockResolvedValue(mockJikanRecs);

    const ctx = createMockContext();
    const input = animeGetRecommendations.input.parse({ id: 11757 });
    const result = await animeGetRecommendations.handler(input, ctx);

    expect(result.source_id).toBe(11757);
    expect(result.source_id_mal).toBe(9253);
    expect(result.recommendations).toHaveLength(1);

    const rec = result.recommendations[0]!;
    expect(rec.id).toBe(9756);
    expect(rec.anilist_rating).toBe(100);
    expect(rec.jikan_votes).toBe(25);
    expect(rec.sources).toContain('anilist');
    expect(rec.sources).toContain('jikan');
  });

  it('includes liked_aspects in the output when provided', async () => {
    vi.mocked(anilist.getRecommendations).mockResolvedValue({ nodes: [], hasNextPage: false });
    vi.mocked(anilist.getMediaById).mockResolvedValue(sourceDetail as any);
    vi.mocked(jikan.getRecommendations).mockResolvedValue([]);

    const ctx = createMockContext();
    const input = animeGetRecommendations.input.parse({
      id: 11757,
      liked_aspects: 'the time travel plot',
    });
    const result = await animeGetRecommendations.handler(input, ctx);

    expect(result.liked_aspects).toBe('the time travel plot');
  });

  it('handles Jikan failure gracefully — AniList results still returned', async () => {
    vi.mocked(anilist.getRecommendations).mockResolvedValue(mockAnilistRecs);
    vi.mocked(anilist.getMediaById).mockResolvedValue(sourceDetail as any);
    vi.mocked(jikan.getRecommendations).mockRejectedValue(new Error('Jikan down'));

    const ctx = createMockContext();
    const input = animeGetRecommendations.input.parse({ id: 11757 });
    const result = await animeGetRecommendations.handler(input, ctx);

    expect(result.recommendations).toHaveLength(1);
    expect(result.recommendations[0]!.jikan_votes).toBeNull();
    expect(result.recommendations[0]!.sources).toEqual(['anilist']);
  });

  it('skips Jikan call when media has no idMal', async () => {
    const detailNoMal = { ...sourceDetail, idMal: null };
    vi.mocked(anilist.getRecommendations).mockResolvedValue(mockAnilistRecs);
    vi.mocked(anilist.getMediaById).mockResolvedValue(detailNoMal as any);

    const ctx = createMockContext();
    const input = animeGetRecommendations.input.parse({ id: 11757 });
    await animeGetRecommendations.handler(input, ctx);

    expect(vi.mocked(jikan.getRecommendations)).not.toHaveBeenCalled();
  });

  it('deduplicates: same title from both sources appears once with both in sources[]', async () => {
    vi.mocked(anilist.getRecommendations).mockResolvedValue(mockAnilistRecs);
    vi.mocked(anilist.getMediaById).mockResolvedValue(sourceDetail as any);
    vi.mocked(jikan.getRecommendations).mockResolvedValue(mockJikanRecs);

    const ctx = createMockContext();
    const input = animeGetRecommendations.input.parse({ id: 11757 });
    const result = await animeGetRecommendations.handler(input, ctx);

    // FMA Brotherhood appears in both sources but only once in the merged output
    const fmaEntries = result.recommendations.filter((r) => r.id_mal === 4654);
    expect(fmaEntries).toHaveLength(1);
    expect(fmaEntries[0]!.sources).toEqual(['anilist', 'jikan']);
  });

  it('formats output with AniList IDs and rating info', async () => {
    vi.mocked(anilist.getRecommendations).mockResolvedValue(mockAnilistRecs);
    vi.mocked(anilist.getMediaById).mockResolvedValue(sourceDetail as any);
    vi.mocked(jikan.getRecommendations).mockResolvedValue(mockJikanRecs);

    const ctx = createMockContext();
    const input = animeGetRecommendations.input.parse({ id: 11757 });
    const result = await animeGetRecommendations.handler(input, ctx);

    const blocks = animeGetRecommendations.format!(result);
    const text = (blocks[0] as { text: string }).text;
    expect(text).toContain('AL:11757');
    expect(text).toContain('AL:9756');
    expect(text).toContain('AL rating: 100');
    expect(text).toContain('MAL votes: 25');
  });

  it('formats empty recommendations without crashing', async () => {
    vi.mocked(anilist.getRecommendations).mockResolvedValue({ nodes: [], hasNextPage: false });
    vi.mocked(anilist.getMediaById).mockResolvedValue(sourceDetail as any);
    vi.mocked(jikan.getRecommendations).mockResolvedValue([]);

    const ctx = createMockContext();
    const input = animeGetRecommendations.input.parse({ id: 11757 });
    const result = await animeGetRecommendations.handler(input, ctx);

    const blocks = animeGetRecommendations.format!(result);
    expect((blocks[0] as { text: string }).text).toContain('No recommendations found');
  });
});

describe('animeGetRecommendations tool contract', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('resolves structuredContent through the framework enrichment merge', async () => {
    vi.mocked(anilist.getRecommendations).mockResolvedValue(mockAnilistRecs);
    vi.mocked(anilist.getMediaById).mockResolvedValue(sourceDetail as any);
    vi.mocked(jikan.getRecommendations).mockResolvedValue(mockJikanRecs);

    const result = await runToolContract(animeGetRecommendations, { id: 11757 });

    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toMatchObject({ source_id: 11757 });
  });

  it('discloses truncation only when the page was capped', async () => {
    vi.mocked(anilist.getMediaById).mockResolvedValue(sourceDetail as any);
    vi.mocked(jikan.getRecommendations).mockResolvedValue([]);

    vi.mocked(anilist.getRecommendations).mockResolvedValue(mockAnilistRecs);
    const uncapped = await runToolContract(animeGetRecommendations, { id: 11757 });
    expect(uncapped.structuredContent).not.toHaveProperty('truncated');

    vi.mocked(anilist.getRecommendations).mockResolvedValue({
      ...mockAnilistRecs,
      hasNextPage: true,
    });
    const capped = await runToolContract(animeGetRecommendations, { id: 11757, per_page: 1 });
    expect(capped.structuredContent).toMatchObject({ truncated: true, shown: 1, cap: 1 });
  });
});
