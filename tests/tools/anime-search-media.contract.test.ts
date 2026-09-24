/**
 * @fileoverview Wire-level tests for anime_search_media through the real AniList and
 * Jikan services, with only upstream HTTP faked. Covers what module-level service
 * mocks cannot: request variables, the page-depth refusal mapping, and which
 * upstream calls a search makes. Unmatched requests throw, so no test reaches the
 * live APIs.
 * @module tests/tools/anime-search-media.contract.test
 */

import { JsonRpcErrorCode } from '@cyanheads/mcp-ts-core/errors';
import { createFetchMock, runToolContract } from '@cyanheads/mcp-ts-core/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { animeSearchMedia } from '@/mcp-server/tools/definitions/anime-search-media.tool.js';

const ANILIST = 'https://graphql.anilist.co/';
const JIKAN = /^https:\/\/api\.jikan\.moe\/v4\//;

const http = createFetchMock();

beforeEach(() => {
  http.reset();
  http.install();
});

afterEach(() => {
  http.restore();
});

const mediaNode = (id: number) => ({
  id,
  idMal: id,
  type: 'ANIME',
  format: 'TV',
  status: 'FINISHED',
  season: 'FALL',
  seasonYear: 2011,
  episodes: 24,
  chapters: null,
  volumes: null,
  isAdult: false,
  meanScore: 90,
  title: { romaji: `Title ${id}`, english: null, native: null },
  coverImage: { extraLarge: null, large: null, medium: null, color: null },
});

async function variablesOf(request: Request): Promise<Record<string, unknown>> {
  return ((await request.clone().json()) as { variables: Record<string, unknown> }).variables;
}

function contentText(result: { content: unknown[] }): string {
  return result.content.map((block) => (block as { text?: string }).text ?? '').join('\n');
}

const anilistCalls = () => http.calls.filter((call) => call.request.url === ANILIST);
const jikanCalls = () => http.calls.filter((call) => JIKAN.test(call.request.url));

describe('anime_search_media over the wire', () => {
  it('surfaces the AniList page-depth refusal as page_depth_exceeded with its recovery', async () => {
    http.route({
      method: 'POST',
      match: ANILIST,
      respond: () =>
        new Response(
          JSON.stringify({
            errors: [
              {
                message: 'Page depth exceeds maximum allowed for API requests (5000 entries)',
                status: 400,
                locations: [{ line: 2, column: 3 }],
              },
            ],
            data: { Page: null },
          }),
          { status: 400, headers: { 'Content-Type': 'application/json' } },
        ),
    });
    const declared = animeSearchMedia.errors?.find(
      (entry) => entry.reason === 'page_depth_exceeded',
    );

    const result = await runToolContract(animeSearchMedia, {
      media_type: 'ANIME',
      genre: 'Action',
      page: 150,
      per_page: 50,
    });

    expect(declared).toMatchObject({ code: JsonRpcErrorCode.ValidationError });
    expect(result.isError).toBe(true);
    expect(result.structuredContent).toMatchObject({
      error: {
        code: JsonRpcErrorCode.ValidationError,
        data: { reason: 'page_depth_exceeded', recovery: { hint: declared?.recovery } },
      },
    });
    expect(contentText(result)).toContain(`Recovery: ${declared?.recovery}`);
    expect(contentText(result)).toContain('page_depth_exceeded');
    expect(anilistCalls()).toHaveLength(1);
    expect(jikanCalls()).toHaveLength(0);
  });

  it('rejects an input without criteria before any upstream request', async () => {
    const result = await runToolContract(animeSearchMedia, {
      media_type: 'ANIME',
      query: '  ',
      genre: '',
      per_page: 2,
    });

    expect(result.isError).toBe(true);
    expect(result.structuredContent).toMatchObject({
      error: { data: { reason: 'missing_criteria' } },
    });
    expect(http.calls).toHaveLength(0);
  });

  it('sends a queryless search trimmed, without a search term, sorted by popularity', async () => {
    http.route({
      method: 'POST',
      match: ANILIST,
      respond: Response.json({
        data: {
          Page: {
            pageInfo: { currentPage: 1, hasNextPage: true, perPage: 3 },
            media: [mediaNode(1), mediaNode(2), mediaNode(3)],
          },
        },
      }),
    });

    const result = await runToolContract(animeSearchMedia, {
      media_type: 'ANIME',
      genre: ' Action ',
      query: '   ',
      per_page: 3,
    });

    expect(result.isError).toBeFalsy();
    const variables = await variablesOf(anilistCalls()[0]!.request);
    expect(variables).toMatchObject({ genre: 'Action', sort: ['POPULARITY_DESC'], perPage: 3 });
    expect(variables).not.toHaveProperty('search');
    expect(result.structuredContent).toMatchObject({ total_results: null, has_next_page: true });
    expect(jikanCalls()).toHaveLength(0);
  });

  it('checks page 1 instead of calling Jikan for an empty page past the AniList matches', async () => {
    http.route({
      method: 'POST',
      match: ANILIST,
      respond: async (request) => {
        const { page, perPage } = await variablesOf(request);
        const media = page === 1 ? [mediaNode(9253)] : [];
        return Response.json({
          data: {
            Page: {
              pageInfo: { currentPage: page, hasNextPage: page === 1, perPage },
              media,
            },
          },
        });
      },
    });

    const result = await runToolContract(animeSearchMedia, {
      media_type: 'ANIME',
      query: 'Steins;Gate',
      page: 3,
      per_page: 5,
    });

    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toMatchObject({
      source: 'anilist',
      page: 3,
      total_results: null,
      results: [],
    });
    expect(contentText(result)).toContain('Page 3 is past the end');
    expect(anilistCalls()).toHaveLength(2);
    await expect(variablesOf(anilistCalls()[1]!.request)).resolves.toMatchObject({
      search: 'Steins;Gate',
      page: 1,
    });
    expect(jikanCalls()).toHaveLength(0);
  });

  it('returns the AniList empty page with a notice when Jikan answers 504', async () => {
    http.route(
      {
        method: 'POST',
        match: ANILIST,
        respond: Response.json({
          data: {
            Page: { pageInfo: { currentPage: 1, hasNextPage: false, perPage: 2 }, media: [] },
          },
        }),
      },
      {
        method: 'GET',
        match: JIKAN,
        respond: () => new Response('Gateway Timeout', { status: 504 }),
      },
    );

    const result = await runToolContract(animeSearchMedia, {
      media_type: 'ANIME',
      query: 'qzxvkjwq',
      per_page: 2,
    });

    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toMatchObject({
      source: 'anilist',
      results: [],
      has_next_page: false,
      total_results: 0,
    });
    expect(contentText(result)).toMatch(/MyAnimeList fallback .*unavailable/);
    expect(jikanCalls().length).toBeGreaterThan(0);
    expect(new URL(jikanCalls()[0]!.request.url).searchParams.get('q')).toBe('qzxvkjwq');
  });

  /**
   * AniList fake that answers the search with an empty page and the MAL-ID lookup
   * with one adult and one general title, filtering on `isAdult` the way AniList does.
   */
  function routeAdultFallback() {
    const jikanRow = (malId: number) => ({
      mal_id: malId,
      title: `MAL ${malId}`,
      title_english: null,
      type: 'OVA',
      status: 'Finished Airing',
      episodes: 2,
      chapters: null,
      score: 7.1,
      rank: null,
      scored_by: 100,
      url: `https://myanimelist.net/anime/${malId}`,
    });
    http.route(
      {
        method: 'POST',
        match: ANILIST,
        respond: async (request) => {
          const variables = await variablesOf(request);
          if (!('idMalIn' in variables)) {
            return Response.json({
              data: {
                Page: { pageInfo: { currentPage: 1, hasNextPage: false, perPage: 20 }, media: [] },
              },
            });
          }
          const media = [
            { ...mediaNode(501), idMal: 501, isAdult: false },
            { ...mediaNode(502), idMal: 502, isAdult: true },
          ].filter((node) => variables.isAdult !== false || !node.isAdult);
          return Response.json({ data: { Page: { media } } });
        },
      },
      {
        method: 'GET',
        match: JIKAN,
        respond: Response.json({
          data: [jikanRow(501), jikanRow(502)],
          pagination: {
            current_page: 1,
            has_next_page: false,
            last_visible_page: 1,
            items: { count: 2, total: 2, per_page: 20 },
          },
        }),
      },
    );
  }

  it('keeps adult titles out of the fallback when include_adult is false', async () => {
    routeAdultFallback();

    const result = await runToolContract(animeSearchMedia, {
      media_type: 'ANIME',
      query: 'Unmatched on AniList',
    });

    const structured = result.structuredContent as {
      source: string;
      results: { id: number; is_adult: boolean }[];
    };
    expect(structured.source).toBe('jikan');
    expect(structured.results.map((row) => row.id)).toEqual([501]);
    expect(structured.results.some((row) => row.is_adult)).toBe(false);
    expect(new URL(jikanCalls()[0]!.request.url).searchParams.get('sfw')).toBe('true');
    const lookup = anilistCalls()[1]!.request;
    await expect(variablesOf(lookup)).resolves.toMatchObject({
      idMalIn: [501, 502],
      isAdult: false,
    });
  });

  it('returns adult fallback titles when include_adult is true', async () => {
    routeAdultFallback();

    const result = await runToolContract(animeSearchMedia, {
      media_type: 'ANIME',
      query: 'Unmatched on AniList',
      include_adult: true,
    });

    expect(result.structuredContent).toMatchObject({
      source: 'jikan',
      results: [
        { id: 501, is_adult: false },
        { id: 502, is_adult: true },
      ],
    });
    expect(new URL(jikanCalls()[0]!.request.url).searchParams.has('sfw')).toBe(false);
  });

  it('makes no Jikan request above per_page 25', async () => {
    routeAdultFallback();

    const result = await runToolContract(animeSearchMedia, {
      media_type: 'ANIME',
      query: 'Unmatched on AniList',
      per_page: 50,
    });

    expect(result.structuredContent).toMatchObject({ source: 'anilist', results: [] });
    expect(contentText(result)).toContain('per_page up to 25');
    expect(jikanCalls()).toHaveLength(0);
    expect(anilistCalls()).toHaveLength(1);
  });
});
