/**
 * @fileoverview Tests for anime_get_studio tool.
 * @module tests/tools/anime-get-studio.tool.test
 */

import { JsonRpcErrorCode } from '@cyanheads/mcp-ts-core/errors';
import { createMockContext, runToolContract } from '@cyanheads/mcp-ts-core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { animeGetStudio } from '@/mcp-server/tools/definitions/anime-get-studio.tool.js';
import type { StudioDetail } from '@/services/anilist/types.js';

vi.mock('@/services/anilist/anilist-service.js');

import * as anilist from '@/services/anilist/anilist-service.js';

const mockStudioDetail: StudioDetail = {
  id: 21,
  name: 'White Fox',
  isAnimationStudio: true,
  siteUrl: 'https://anilist.co/studio/21',
  media: {
    pageInfo: { total: 2, currentPage: 1, lastPage: 1, hasNextPage: false },
    nodes: [
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
          large: 'https://example.com/sg.jpg',
          extraLarge: null,
          medium: null,
          color: null,
        },
      },
      {
        id: 20787,
        idMal: 31240,
        type: 'ANIME' as const,
        format: 'TV',
        status: 'FINISHED',
        season: 'SUMMER',
        seasonYear: 2016,
        episodes: 12,
        chapters: null,
        volumes: null,
        meanScore: 78,
        isAdult: false,
        title: { romaji: 'Re:Zero', english: 'Re:Zero', native: null },
        coverImage: null,
      },
    ],
  },
};

describe('animeGetStudio', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('returns studio filmography by name', async () => {
    vi.mocked(anilist.searchStudio).mockResolvedValue(mockStudioDetail);
    const ctx = createMockContext({ errors: animeGetStudio.errors });
    const input = animeGetStudio.input.parse({ name: 'White Fox' });

    const result = await animeGetStudio.handler(input, ctx);

    expect(result.studio_id).toBe(21);
    expect(result.studio_name).toBe('White Fox');
    expect(result.is_animation_studio).toBe(true);
    expect(result.filmography).toHaveLength(2);
    expect(vi.mocked(anilist.searchStudio)).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'White Fox' }),
    );
  });

  it('returns studio filmography by ID using getStudioById', async () => {
    vi.mocked(anilist.getStudioById).mockResolvedValue(mockStudioDetail);
    const ctx = createMockContext({ errors: animeGetStudio.errors });
    const input = animeGetStudio.input.parse({ id: 21 });

    const result = await animeGetStudio.handler(input, ctx);

    expect(result.studio_id).toBe(21);
    expect(vi.mocked(anilist.getStudioById)).toHaveBeenCalledWith(
      expect.objectContaining({ id: 21 }),
    );
    expect(vi.mocked(anilist.searchStudio)).not.toHaveBeenCalled();
  });

  it('throws ctx.fail("not_found") when name search returns null', async () => {
    vi.mocked(anilist.searchStudio).mockResolvedValue(null);
    const ctx = createMockContext({ errors: animeGetStudio.errors });
    const input = animeGetStudio.input.parse({ name: 'NonExistentStudio99999' });

    await expect(animeGetStudio.handler(input, ctx)).rejects.toMatchObject({
      code: JsonRpcErrorCode.NotFound,
      message: 'No studio found matching "NonExistentStudio99999"',
      data: { reason: 'not_found' },
    });
  });

  it('throws ctx.fail("not_found") when ID lookup returns null', async () => {
    vi.mocked(anilist.getStudioById).mockResolvedValue(null);
    const ctx = createMockContext({ errors: animeGetStudio.errors });
    const input = animeGetStudio.input.parse({ id: 99999 });

    await expect(animeGetStudio.handler(input, ctx)).rejects.toMatchObject({
      code: JsonRpcErrorCode.NotFound,
      message: 'No studio found with AniList ID 99999',
      data: { reason: 'not_found' },
    });
  });

  it('throws ctx.fail("missing_identifier") when neither name nor id is provided', async () => {
    const ctx = createMockContext({ errors: animeGetStudio.errors });
    // Neither name nor id — but the Zod schema allows it (both optional)
    const input = animeGetStudio.input.parse({ sort: 'SCORE_DESC' });

    await expect(animeGetStudio.handler(input, ctx)).rejects.toMatchObject({
      code: JsonRpcErrorCode.ValidationError,
      message: 'Provide either name or id to look up a studio',
      data: { reason: 'missing_identifier' },
    });
  });

  it('returns the missing-identifier recovery hint on both contract error surfaces', async () => {
    const result = await runToolContract(animeGetStudio, {});
    const recovery =
      'Provide either name (e.g. "MAPPA") or id (AniList studio ID) to identify the studio.';

    expect(result).toMatchObject({
      isError: true,
      structuredContent: {
        error: {
          code: JsonRpcErrorCode.ValidationError,
          message: 'Provide either name or id to look up a studio',
          data: { reason: 'missing_identifier', recovery: { hint: recovery } },
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

  it('returns the not-found recovery hint on both contract error surfaces', async () => {
    vi.mocked(anilist.getStudioById).mockResolvedValue(null);

    const result = await runToolContract(animeGetStudio, { id: 99999 });
    const recovery =
      'Check the studio name spelling (e.g. "Kyoto Animation" not "KyoAni") or use the correct AniList studio ID.';

    expect(result).toMatchObject({
      isError: true,
      structuredContent: {
        error: {
          code: JsonRpcErrorCode.NotFound,
          message: 'No studio found with AniList ID 99999',
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

  it('applies default sort: POPULARITY_DESC', () => {
    const input = animeGetStudio.input.parse({ name: 'MAPPA' });
    expect(input.sort).toBe('POPULARITY_DESC');
  });

  it('formats output with studio info and filmography titles', async () => {
    vi.mocked(anilist.searchStudio).mockResolvedValue(mockStudioDetail);
    const ctx = createMockContext({ errors: animeGetStudio.errors });
    const input = animeGetStudio.input.parse({ name: 'White Fox' });
    const result = await animeGetStudio.handler(input, ctx);

    const blocks = animeGetStudio.format!(result);
    const text = (blocks[0] as { text: string }).text;
    expect(text).toContain('White Fox');
    expect(text).toContain('AniList ID: 21');
    expect(text).toContain('AL:11757');
    expect(text).toContain('Steins;Gate');
    expect(text).toContain('90/100');
  });

  it('formats empty filmography without crashing', async () => {
    const emptyStudio = {
      ...mockStudioDetail,
      media: {
        ...mockStudioDetail.media,
        nodes: [],
        pageInfo: { ...mockStudioDetail.media.pageInfo, total: 0 },
      },
    };
    vi.mocked(anilist.searchStudio).mockResolvedValue(emptyStudio);
    const ctx = createMockContext({ errors: animeGetStudio.errors });
    const input = animeGetStudio.input.parse({ name: 'EmptyStudio' });
    const result = await animeGetStudio.handler(input, ctx);

    const blocks = animeGetStudio.format!(result);
    expect((blocks[0] as { text: string }).text).toContain('No titles found');
  });

  it('handles sparse filmography entries: null optional fields', async () => {
    const sparseStudio = {
      ...mockStudioDetail,
      media: {
        pageInfo: { total: null, currentPage: 1, lastPage: null, hasNextPage: false },
        nodes: [
          {
            id: 1,
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
      },
    };
    vi.mocked(anilist.searchStudio).mockResolvedValue(sparseStudio);
    const ctx = createMockContext({ errors: animeGetStudio.errors });
    const input = animeGetStudio.input.parse({ name: 'AnyStudio' });
    const result = await animeGetStudio.handler(input, ctx);

    expect(result.filmography[0]!.id_mal).toBeNull();
    expect(result.filmography[0]!.format).toBeNull();
    expect(result.total_titles).toBeNull();
  });
});
