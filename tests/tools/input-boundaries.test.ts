/**
 * @fileoverview Advertised and executed input boundaries for AniList tools.
 * @module tests/tools/input-boundaries.test
 */
import { z } from '@cyanheads/mcp-ts-core';
import { createFetchMock, runToolContract } from '@cyanheads/mcp-ts-core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { animeGetRankings } from '@/mcp-server/tools/definitions/anime-get-rankings.tool.js';
import { animeSearchMedia } from '@/mcp-server/tools/definitions/anime-search-media.tool.js';
import { allToolDefinitions } from '@/mcp-server/tools/index.js';
import * as anilist from '@/services/anilist/anilist-service.js';

vi.mock('@/services/anilist/anilist-service.js', async (original) => ({
  ...(await original<typeof import('@/services/anilist/anilist-service.js')>()),
  getRankings: vi.fn(async () => ({
    pageInfo: { currentPage: 1, hasNextPage: false, perPage: 25 },
    media: [],
  })),
}));

const http = createFetchMock();
beforeEach(() => {
  vi.clearAllMocks();
  http.reset();
  http.install();
});
afterEach(() => http.restore());
const named = (name: string) => allToolDefinitions.find((definition) => definition.name === name)!;

describe('optional enum sentinels', () => {
  const cases = [
    ['anime_search_media', { media_type: 'ANIME', query: 'Frieren' }, 'season'],
    ['anime_search_media', { media_type: 'ANIME', query: 'Frieren' }, 'format'],
    ['anime_search_media', { media_type: 'ANIME', query: 'Frieren' }, 'status'],
    ['anime_get_rankings', { mode: 'top', media_type: 'ANIME' }, 'season'],
    ['anime_get_rankings', { mode: 'top', media_type: 'ANIME' }, 'format'],
    ['anime_get_schedule', { mode: 'upcoming' }, 'season'],
    ['anime_find_characters', { character_name: 'Edward' }, 'language'],
    ['anime_get_studio', { id: 1 }, 'sort'],
  ] as const;
  it.each(cases)('%s accepts an exact blank %s', (name, base, field) => {
    expect(named(name).input.safeParse({ ...base, [field]: '' }).success).toBe(true);
  });
  it.each(cases)('%s still rejects unsupported nonblank values', async (name, base, field) => {
    for (const value of [' ', 'unsupported']) {
      const result = await runToolContract(named(name), { ...base, [field]: value });
      expect(result.isError).toBe(true);
    }
    expect(http.calls).toHaveLength(0);
  });
  it('retains five search sort choices, drops blanks before missing-criteria checks', async () => {
    for (const value of [
      'SEARCH_MATCH',
      'SCORE_DESC',
      'POPULARITY_DESC',
      'TRENDING_DESC',
      'START_DATE_DESC',
    ]) {
      expect(animeSearchMedia.input.safeParse({ media_type: 'ANIME', sort: [value] }).success).toBe(
        true,
      );
    }
    const result = await runToolContract(animeSearchMedia, { media_type: 'ANIME', sort: ['', ''] });
    expect(result.structuredContent).toMatchObject({
      error: { data: { reason: 'missing_criteria' } },
    });
    expect(http.calls).toHaveLength(0);
    expect(
      animeSearchMedia.input.safeParse({ media_type: 'ANIME', sort: Array(6).fill('') }).success,
    ).toBe(false);
  });
});

describe('GraphQL Int IDs', () => {
  const definitions = allToolDefinitions.filter((definition) => 'id' in definition.input.shape);
  it.each(definitions)(
    '$name advertises and enforces the signed Int ceiling',
    async (definition) => {
      expect(definition.input.safeParse({ id: 2147483647 }).success).toBe(true);
      expect(z.toJSONSchema(definition.input).properties?.id).toMatchObject({
        maximum: 2147483647,
      });
      for (const id of [2147483648, 0, -1, 1.5]) {
        const result = await runToolContract(definition, { id });
        expect(result.isError).toBe(true);
        expect(result.structuredContent).toMatchObject({ error: { code: -32602 } });
      }
      expect(http.calls).toHaveLength(0);
      expect(anilist.getRankings).not.toHaveBeenCalled();
    },
  );
});

describe('anime-only ranking seasons', () => {
  it.each(['top', 'trending'] as const)(
    'allows MANGA %s with blank season as omission',
    async (mode) => {
      const result = await runToolContract(animeGetRankings, {
        mode,
        media_type: 'MANGA',
        season: '',
        format: '',
      });
      expect(result.isError).toBeFalsy();
      expect(anilist.getRankings).toHaveBeenCalledWith(
        expect.objectContaining({ season: undefined, format: undefined }),
      );
    },
  );
  it('normalizes a blank season before seasonal pairing checks', async () => {
    const result = await runToolContract(animeGetRankings, {
      mode: 'seasonal',
      media_type: 'ANIME',
      season: '',
      season_year: 2024,
    });
    expect(result.structuredContent).toMatchObject({
      error: { data: { reason: 'invalid_season' } },
    });
    expect(anilist.getRankings).not.toHaveBeenCalled();
  });
  it.each([
    { mode: 'seasonal' },
    { mode: 'seasonal', season: 'FALL', season_year: 2024 },
    ...(['top', 'trending'] as const).flatMap((mode) => [
      { mode, season: 'FALL' as const },
      { mode, season_year: 2024 },
      { mode, season: 'FALL' as const, season_year: 2024 },
    ]),
  ] as const)('rejects MANGA broadcast criteria before upstream work: %j', async (filters) => {
    const result = await runToolContract(animeGetRankings, { media_type: 'MANGA', ...filters });
    expect(result.structuredContent).toMatchObject({
      error: { code: -32007, data: { reason: 'anime_only_season' } },
    });
    expect(JSON.stringify(result.content)).toContain('broadcast seasons');
    expect(http.calls).toHaveLength(0);
    expect(anilist.getRankings).not.toHaveBeenCalled();
  });
});
