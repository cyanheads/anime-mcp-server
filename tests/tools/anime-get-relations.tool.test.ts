/**
 * @fileoverview Tests for anime_get_relations tool.
 * @module tests/tools/anime-get-relations.tool.test
 */

import { createMockContext } from '@cyanheads/mcp-ts-core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { animeGetRelations } from '@/mcp-server/tools/definitions/anime-get-relations.tool.js';

vi.mock('@/services/anilist/anilist-service.js');

import * as anilist from '@/services/anilist/anilist-service.js';

const rootNode = {
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
};

const sequelNode = {
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
};

const sequelEdges = [{ relationType: 'SEQUEL' as const, node: sequelNode }];

describe('animeGetRelations', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('returns the root entry plus direct relations for depth 1', async () => {
    vi.mocked(anilist.getMediaRelations)
      .mockResolvedValueOnce(sequelEdges) // root call
      .mockResolvedValue([]); // sequel has no further relations
    vi.mocked(anilist.getMediaById).mockResolvedValue(rootNode as any);

    const ctx = createMockContext({ errors: animeGetRelations.errors });
    const input = animeGetRelations.input.parse({ id: 11757, max_depth: 1 });
    const result = await animeGetRelations.handler(input, ctx);

    expect(result.root_id).toBe(11757);
    expect(result.total_entries).toBe(2);
    const ids = result.entries.map((e) => e.id);
    expect(ids).toContain(11757);
    expect(ids).toContain(14247);
  });

  it('throws ctx.fail("not_found") when root ID is not found', async () => {
    vi.mocked(anilist.getMediaRelations).mockResolvedValue(null);

    const ctx = createMockContext({ errors: animeGetRelations.errors });
    const input = animeGetRelations.input.parse({ id: 99999 });

    await expect(animeGetRelations.handler(input, ctx)).rejects.toMatchObject({
      data: { reason: 'not_found' },
    });
  });

  it('marks the root entry with is_root: true', async () => {
    vi.mocked(anilist.getMediaRelations).mockResolvedValueOnce([]); // root has no relations
    vi.mocked(anilist.getMediaById).mockResolvedValue(rootNode as any);

    const ctx = createMockContext({ errors: animeGetRelations.errors });
    const input = animeGetRelations.input.parse({ id: 11757, max_depth: 1 });
    const result = await animeGetRelations.handler(input, ctx);

    const root = result.entries.find((e) => e.id === 11757);
    expect(root?.is_root).toBe(true);
    expect(root?.relation_to_root).toBeNull();
  });

  it('categorizes SEQUEL as "main" and SIDE_STORY as "supplementary"', async () => {
    const sideStoryNode = { ...sequelNode, id: 9999 };
    const edges = [
      { relationType: 'SEQUEL' as const, node: sequelNode },
      { relationType: 'SIDE_STORY' as const, node: sideStoryNode },
    ];
    vi.mocked(anilist.getMediaRelations).mockResolvedValueOnce(edges).mockResolvedValue([]);
    vi.mocked(anilist.getMediaById).mockResolvedValue(rootNode as any);

    const ctx = createMockContext({ errors: animeGetRelations.errors });
    const input = animeGetRelations.input.parse({ id: 11757, max_depth: 1 });
    const result = await animeGetRelations.handler(input, ctx);

    const sequel = result.entries.find((e) => e.id === 14247);
    const sideStory = result.entries.find((e) => e.id === 9999);
    expect(sequel?.watch_order_category).toBe('main');
    expect(sideStory?.watch_order_category).toBe('supplementary');
  });

  it('deduplicates entries when cycles exist in the graph', async () => {
    // Root → sequel; sequel → root (cycle)
    const cycleEdges = [{ relationType: 'PREQUEL' as const, node: rootNode }];
    vi.mocked(anilist.getMediaRelations)
      .mockResolvedValueOnce(sequelEdges) // root call
      .mockResolvedValueOnce(cycleEdges) // sequel points back to root
      .mockResolvedValue([]);
    vi.mocked(anilist.getMediaById).mockResolvedValue(rootNode as any);

    const ctx = createMockContext({ errors: animeGetRelations.errors });
    const input = animeGetRelations.input.parse({ id: 11757, max_depth: 2 });
    const result = await animeGetRelations.handler(input, ctx);

    const ids = result.entries.map((e) => e.id);
    const uniqueIds = new Set(ids);
    expect(uniqueIds.size).toBe(ids.length);
  });

  it('formats output with watch order labels and AniList IDs', async () => {
    vi.mocked(anilist.getMediaRelations).mockResolvedValueOnce(sequelEdges).mockResolvedValue([]);
    vi.mocked(anilist.getMediaById).mockResolvedValue(rootNode as any);

    const ctx = createMockContext({ errors: animeGetRelations.errors });
    const input = animeGetRelations.input.parse({ id: 11757 });
    const result = await animeGetRelations.handler(input, ctx);

    const blocks = animeGetRelations.format!(result);
    const text = blocks[0]!.text as string;
    expect(text).toContain('AL:11757');
    expect(text).toContain('ROOT');
    expect(text).toContain('depth');
  });
});
