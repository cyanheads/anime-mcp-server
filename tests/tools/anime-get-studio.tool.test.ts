/**
 * @fileoverview Tests for anime_get_studio tool.
 * @module tests/tools/anime-get-studio.tool.test
 */

import { JsonRpcErrorCode } from '@cyanheads/mcp-ts-core/errors';
import { createMockContext, runToolContract } from '@cyanheads/mcp-ts-core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { animeGetStudio } from '@/mcp-server/tools/definitions/anime-get-studio.tool.js';
import type { MediaNode, StudioDetail, StudioMediaEdge } from '@/services/anilist/types.js';

vi.mock('@/services/anilist/anilist-service.js');

import * as anilist from '@/services/anilist/anilist-service.js';

const mockStudioDetail: StudioDetail = {
  id: 21,
  name: 'White Fox',
  isAnimationStudio: true,
  siteUrl: 'https://anilist.co/studio/21',
  media: {
    pageInfo: { currentPage: 1, hasNextPage: false, perPage: 25 },
    edges: [
      {
        isMainStudio: true,
        node: {
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
      },
      {
        isMainStudio: true,
        node: {
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
        edges: [],
        pageInfo: mockStudioDetail.media.pageInfo,
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
        pageInfo: { currentPage: 1, hasNextPage: false, perPage: 25 },
        edges: [
          {
            isMainStudio: false,
            node: {
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
    expect(result.filmography[0]!.is_main_studio).toBe(false);
    // The whole filmography is on page 1, so the count is exact.
    expect(result.total_titles).toBe(1);
  });
});

// ─── Shared fixtures for the contract-level cases below ───────────────────────

const filmNode: MediaNode = {
  id: 7791,
  idMal: 6547,
  type: 'ANIME',
  format: 'TV',
  status: 'FINISHED',
  season: 'SPRING',
  seasonYear: 2010,
  episodes: 13,
  chapters: null,
  volumes: null,
  meanScore: 78,
  isAdult: false,
  title: { romaji: 'Angel Beats!', english: 'Angel Beats!', native: null },
  coverImage: null,
};

/** One studio credit edge: the media node plus whether this studio is its main studio. */
function credit(id: number, isMainStudio: boolean): StudioMediaEdge {
  return { isMainStudio, node: { ...filmNode, id } };
}

/**
 * A studio whose filmography page carries the given credit edges. `total` stands in
 * for AniList's placeholder count, which the tool must ignore.
 */
function studioWithCredits(
  edges: StudioMediaEdge[],
  pageInfo: Partial<StudioDetail['media']['pageInfo']> & { total?: number } = {},
): StudioDetail {
  return {
    id: 2,
    name: 'Kyoto Animation',
    isAnimationStudio: true,
    siteUrl: 'https://anilist.co/studio/2',
    media: {
      pageInfo: { currentPage: 1, hasNextPage: false, perPage: 25, ...pageInfo },
      edges,
    },
  };
}

function contentText(result: { content: unknown[] }): string {
  return result.content.map((block) => (block as { text?: string }).text ?? '').join('\n');
}

describe('animeGetStudio inputs and contracts', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  // ─── characterization: behavior that holds before and after ─────────────────

  it.each(['', '   '])('an id beside the blank name %o still looks up by id', async (name) => {
    vi.mocked(anilist.getStudioById).mockResolvedValue(mockStudioDetail);

    const result = await runToolContract(animeGetStudio, { id: 21, name });

    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toMatchObject({ studio_id: 21 });
    expect(anilist.getStudioById).toHaveBeenCalledWith(expect.objectContaining({ id: 21 }));
    expect(anilist.searchStudio).not.toHaveBeenCalled();
  });

  it('accepts per_page 25', async () => {
    vi.mocked(anilist.getStudioById).mockResolvedValue(mockStudioDetail);

    const result = await runToolContract(animeGetStudio, { id: 21, per_page: 25 });

    expect(result.isError).toBeFalsy();
    expect(anilist.getStudioById).toHaveBeenCalledWith(expect.objectContaining({ perPage: 25 }));
  });

  // ─── #25: identifier combinations ───────────────────────────────────────────

  describe('identifiers', () => {
    it('rejects id together with name as conflicting_inputs before any AniList call', async () => {
      const declared = animeGetStudio.errors?.find((e) => e.reason === 'conflicting_inputs');

      const result = await runToolContract(animeGetStudio, { id: 2, name: 'MAPPA' });

      expect(declared).toMatchObject({ code: JsonRpcErrorCode.ValidationError });
      expect(result.isError).toBe(true);
      expect(result.structuredContent).toMatchObject({
        error: {
          code: JsonRpcErrorCode.ValidationError,
          data: { reason: 'conflicting_inputs', recovery: { hint: declared?.recovery } },
        },
      });
      expect(contentText(result)).toContain(`Recovery: ${declared?.recovery}`);
      expect(anilist.getStudioById).not.toHaveBeenCalled();
      expect(anilist.searchStudio).not.toHaveBeenCalled();
    });

    it('trims a padded name before searching', async () => {
      vi.mocked(anilist.searchStudio).mockResolvedValue(mockStudioDetail);

      const result = await runToolContract(animeGetStudio, { name: '  MAPPA  ' });

      expect(result.isError).toBeFalsy();
      expect(anilist.searchStudio).toHaveBeenCalledWith(expect.objectContaining({ name: 'MAPPA' }));
    });

    it.each(['', '   '])(
      'a lone blank name %o fails missing_identifier with no AniList call',
      async (name) => {
        const result = await runToolContract(animeGetStudio, { name });

        expect(result.structuredContent).toMatchObject({
          error: { data: { reason: 'missing_identifier' } },
        });
        expect(anilist.searchStudio).not.toHaveBeenCalled();
      },
    );
  });

  // ─── #31: AniList's 25-row page and per-page dedupe ─────────────────────────

  describe('filmography rows', () => {
    it('rejects per_page 26 at the schema', async () => {
      const result = await runToolContract(animeGetStudio, { id: 2, per_page: 26 });

      expect(result.isError).toBe(true);
      expect(result.structuredContent).toMatchObject({
        error: { code: JsonRpcErrorCode.InvalidParams },
      });
      expect(anilist.getStudioById).not.toHaveBeenCalled();
    });

    it('collapses two credits for one title into one main-studio row on both surfaces', async () => {
      vi.mocked(anilist.getStudioById).mockResolvedValue(
        studioWithCredits([credit(7791, false), credit(20, true), credit(7791, true)]),
      );

      const result = await runToolContract(animeGetStudio, { id: 2 });

      const film = (
        result.structuredContent as { filmography: { id: number; is_main_studio: boolean }[] }
      ).filmography;
      expect(film.map((row) => [row.id, row.is_main_studio])).toEqual([
        [7791, true],
        [20, true],
      ]);
      const text = contentText(result);
      expect(text.match(/\[AL:7791\//g)).toHaveLength(1);
      expect(text).toMatch(/\[AL:7791\/[^\n]*main studio/);
    });

    it('keeps a co-credit row that is never the main studio', async () => {
      vi.mocked(anilist.getStudioById).mockResolvedValue(
        studioWithCredits([credit(30, false), credit(30, false)]),
      );

      const result = await runToolContract(animeGetStudio, { id: 2 });

      expect(result.structuredContent).toMatchObject({
        filmography: [{ id: 30, is_main_studio: false }],
      });
      expect(contentText(result)).toMatch(/\[AL:30\/[^\n]*co-credit/);
    });

    it('describes the entries as distinct titles within a page', () => {
      const description = animeGetStudio.output.shape.filmography.description ?? '';
      expect(description).toMatch(/distinct title/i);
      expect(description).toMatch(/can appear on both/);
    });
  });

  // ─── #26 / #31: the count is exact only when page 1 holds everything ────────

  describe('title counts', () => {
    it('reports the distinct count when the whole filmography fits on page 1', async () => {
      vi.mocked(anilist.getStudioById).mockResolvedValue(
        studioWithCredits([credit(1, true), credit(2, true), credit(1, false)], { total: 3 }),
      );

      const result = await runToolContract(animeGetStudio, { id: 2 });

      expect(result.structuredContent).toMatchObject({ total_titles: 2, totalCount: 2 });
      expect(contentText(result)).toContain('2 titles');
    });

    it('reports null on page 1 of a multi-page filmography', async () => {
      vi.mocked(anilist.getStudioById).mockResolvedValue(
        studioWithCredits([credit(1, true), credit(2, true)], { hasNextPage: true, total: 500 }),
      );

      const result = await runToolContract(animeGetStudio, { id: 2 });

      expect(result.structuredContent).toMatchObject({ total_titles: null });
      expect(result.structuredContent).not.toHaveProperty('totalCount');
      expect(contentText(result)).not.toMatch(/\d+ titles/);
    });

    it('reports null on the final page of a multi-page filmography', async () => {
      vi.mocked(anilist.getStudioById).mockResolvedValue(
        studioWithCredits([credit(1, true)], { currentPage: 7, total: 153 }),
      );

      const result = await runToolContract(animeGetStudio, { id: 2, page: 7 });

      expect(result.structuredContent).toMatchObject({ total_titles: null });
      expect(result.structuredContent).not.toHaveProperty('totalCount');
    });

    it('reports 0 for an empty first page', async () => {
      vi.mocked(anilist.getStudioById).mockResolvedValue(studioWithCredits([]));

      const result = await runToolContract(animeGetStudio, { id: 2 });

      expect(result.structuredContent).toMatchObject({ total_titles: 0, totalCount: 0 });
    });

    it('reports null and a past-the-end notice for an empty later page', async () => {
      vi.mocked(anilist.getStudioById).mockResolvedValue(
        studioWithCredits([], { currentPage: 10, total: 225 }),
      );

      const result = await runToolContract(animeGetStudio, { id: 2, page: 10 });

      expect(result.structuredContent).toMatchObject({ total_titles: null, filmography: [] });
      expect(result.structuredContent).not.toHaveProperty('totalCount');
      const notice = (result.structuredContent as { notice: string }).notice;
      expect(notice).toContain("Page 10 is past the end of Kyoto Animation's filmography");
      expect(notice).toContain('exactly full');
      expect(notice).not.toContain('is the one with has_next_page false');
      expect(contentText(result)).toContain('Page 10 is past the end');
    });
  });
});
