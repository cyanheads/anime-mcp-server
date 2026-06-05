/**
 * @fileoverview Tests for anime_get_schedule tool.
 * @module tests/tools/anime-get-schedule.tool.test
 */

import { createMockContext } from '@cyanheads/mcp-ts-core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { animeGetSchedule } from '@/mcp-server/tools/definitions/anime-get-schedule.tool.js';

vi.mock('@/services/anilist/anilist-service.js');

import * as anilist from '@/services/anilist/anilist-service.js';

const mockMediaNode = {
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

const mockSeasonPage = {
  pageInfo: { total: 1, currentPage: 1, lastPage: 1, hasNextPage: false, perPage: 25 },
  media: [mockMediaNode],
};

const mockAiringSchedules = [
  {
    id: 1,
    airingAt: Math.floor(Date.now() / 1000) + 3600,
    episode: 5,
    timeUntilAiring: 3600,
    media: mockMediaNode,
  },
];

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
      data: { reason: 'invalid_season' },
    });
  });

  it('throws ctx.fail("invalid_season") when mode is "season" but season_year is missing', async () => {
    const ctx = createMockContext({ errors: animeGetSchedule.errors });
    const input = animeGetSchedule.input.parse({ mode: 'season', season: 'FALL' });

    await expect(animeGetSchedule.handler(input, ctx)).rejects.toMatchObject({
      data: { reason: 'invalid_season' },
    });
  });

  it('returns upcoming episodes when mode is "upcoming"', async () => {
    vi.mocked(anilist.getUpcomingEpisodes).mockResolvedValue(mockAiringSchedules);
    const ctx = createMockContext({ errors: animeGetSchedule.errors });
    const input = animeGetSchedule.input.parse({ mode: 'upcoming', days_ahead: 7 });

    const result = await animeGetSchedule.handler(input, ctx);

    expect(result.mode).toBe('upcoming');
    expect(result.season_label).toBeNull();
    expect(result.entries).toHaveLength(1);
    expect(result.entries[0]!.next_episode).toBe(5);
    expect(result.entries[0]!.next_airing_at_utc).toBeTruthy();
  });

  it('applies defaults: mode defaults parsed correctly', () => {
    const input = animeGetSchedule.input.parse({ mode: 'upcoming' });
    expect(input.days_ahead).toBe(7);
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
    const text = blocks[0]!.text as string;
    expect(text).toContain('FALL 2024');
    expect(text).toContain('AL:154587');
  });

  it('formats upcoming schedule output with countdown', async () => {
    vi.mocked(anilist.getUpcomingEpisodes).mockResolvedValue(mockAiringSchedules);
    const ctx = createMockContext({ errors: animeGetSchedule.errors });
    const input = animeGetSchedule.input.parse({ mode: 'upcoming' });
    const result = await animeGetSchedule.handler(input, ctx);

    const blocks = animeGetSchedule.format!(result);
    const text = blocks[0]!.text as string;
    expect(text).toContain('Ep 5');
    expect(text).toContain('AL:154587');
  });

  it('handles empty season schedule', async () => {
    vi.mocked(anilist.getSeasonSchedule).mockResolvedValue({
      pageInfo: { total: 0, currentPage: 1, lastPage: 1, hasNextPage: false, perPage: 25 },
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
    expect(blocks[0]!.text as string).toContain('No entries found');
  });
});
