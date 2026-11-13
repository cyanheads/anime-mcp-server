/**
 * @fileoverview Wire-level tests for anime_search_media through the real AniList and
 * Jikan services, with only upstream HTTP faked. Covers what module-level service
 * mocks cannot: request variables, the page-depth refusal mapping, and which
 * upstream calls a search makes. Unmatched requests throw, so no test reaches the
 * live APIs.
 * @module tests/tools/anime-search-media.contract.test
 */

import { JsonRpcErrorCode } from '@cyanheads/mcp-ts-core/errors';
import {
  createFetchMock,
  createMockContext,
  runToolContract,
} from '@cyanheads/mcp-ts-core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { animeGetRankings } from '@/mcp-server/tools/definitions/anime-get-rankings.tool.js';
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
  countryOfOrigin: 'JP',
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

describe('optional title fallback budget', () => {
  let tool: typeof animeSearchMedia;
  let stopAniList: () => void;
  let stopJikan: () => void;

  beforeEach(async () => {
    vi.resetModules();
    vi.useFakeTimers();
    ({ animeSearchMedia: tool } = await import(
      '@/mcp-server/tools/definitions/anime-search-media.tool.js'
    ));
    ({ shutdownAniList: stopAniList } = await import('@/services/anilist/anilist-service.js'));
    ({ shutdownJikan: stopJikan } = await import('@/services/jikan/jikan-service.js'));
  });

  afterEach(() => {
    stopAniList();
    stopJikan();
    vi.useRealTimers();
  });

  const input = { media_type: 'ANIME', query: 'unmatched title' } as const;
  const emptyPage = () =>
    Response.json({
      data: { Page: { pageInfo: { currentPage: 1, hasNextPage: false, perPage: 20 }, media: [] } },
    });
  const throttled = () =>
    new Response('Rate limited', { status: 429, headers: { 'Retry-After': '0' } });

  function delayedJikanBody(signal: AbortSignal) {
    return new Response(
      new ReadableStream({
        start(controller) {
          const timer = setTimeout(() => {
            controller.enqueue(
              new TextEncoder().encode('{"data":[{"mal_id":1,"title":"Fixture"}]}'),
            );
            controller.close();
            signal.removeEventListener('abort', onAbort);
          }, 3000);
          function onAbort() {
            clearTimeout(timer);
            controller.error(signal.reason);
          }
          signal.addEventListener('abort', onAbort, { once: true });
        },
      }),
    );
  }

  it.each(['Jikan', 'AniList'] as const)(
    'makes one attempt when %s rate limits the optional leg',
    async (provider) => {
      http.route(
        {
          match: ANILIST,
          respond: async (request) =>
            'idMalIn' in (await variablesOf(request)) ? throttled() : emptyPage(),
        },
        {
          match: JIKAN,
          respond: () =>
            provider === 'Jikan'
              ? throttled()
              : Response.json({ data: [{ mal_id: 1, title: 'Fixture' }] }),
        },
      );
      const pending = runToolContract(tool, input);
      await vi.advanceTimersByTimeAsync(30000);
      const result = await pending;
      expect(result.structuredContent).toMatchObject({ source: 'anilist', total_results: 0 });
      expect(contentText(result)).toMatch(/MyAnimeList fallback .*unavailable/);
      expect(jikanCalls()).toHaveLength(1);
      expect(anilistCalls()).toHaveLength(provider === 'Jikan' ? 1 : 2);
    },
  );

  it('includes Jikan body reads and AniList resolution in the same five seconds', async () => {
    let resolutionSignal: AbortSignal | undefined;
    http.route(
      { match: JIKAN, respond: (request) => delayedJikanBody(request.signal) },
      {
        match: ANILIST,
        respond: async (request) => {
          if (!('idMalIn' in (await variablesOf(request)))) return emptyPage();
          resolutionSignal = request.signal;
          return new Response(
            new ReadableStream({
              start(controller) {
                request.signal.addEventListener(
                  'abort',
                  () => controller.error(request.signal.reason),
                  { once: true },
                );
              },
            }),
          );
        },
      },
    );
    const pending = runToolContract(tool, input);
    await vi.advanceTimersByTimeAsync(4999);
    expect(resolutionSignal?.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(resolutionSignal?.aborted).toBe(true);
    const result = await pending;
    expect(result.structuredContent).toMatchObject({ source: 'anilist', total_results: 0 });
    expect(contentText(result)).toMatch(/MyAnimeList fallback .*unavailable/);
    await vi.advanceTimersByTimeAsync(15000);
    expect(anilistCalls()).toHaveLength(2);
    expect(jikanCalls()).toHaveLength(1);
  });

  it('propagates caller cancellation during the optional body read', async () => {
    http.route(
      { match: ANILIST, respond: emptyPage },
      { match: JIKAN, respond: (request) => delayedJikanBody(request.signal) },
    );
    const controller = new AbortController();
    const pending = tool.handler(
      tool.input.parse(input),
      createMockContext({ errors: tool.errors, signal: controller.signal }),
    );
    const settled = Promise.resolve(pending).then(
      (value) => ({ value }),
      (error: unknown) => ({ error }),
    );
    await vi.advanceTimersByTimeAsync(0);
    expect(jikanCalls()).toHaveLength(1);
    controller.abort();
    await vi.advanceTimersByTimeAsync(3000);
    expect(await settled).toMatchObject({ error: { name: 'AbortError' } });
    expect(anilistCalls()).toHaveLength(1);
  });

  it('does no provider work when the caller has already cancelled', async () => {
    const signal = AbortSignal.abort();
    await expect(
      tool.handler(tool.input.parse(input), createMockContext({ errors: tool.errors, signal })),
    ).rejects.toBe(signal.reason);
    expect(http.calls).toHaveLength(0);
  });

  it('includes the Jikan pacing wait in the deadline', async () => {
    const { searchMedia } = await import('@/services/jikan/jikan-service.js');
    let jikanSignal: AbortSignal | undefined;
    http.route(
      { match: ANILIST, respond: emptyPage },
      {
        match: JIKAN,
        respond: (request) => {
          if (new URL(request.url).searchParams.get('q') === 'seed')
            return Response.json({ data: [] });
          jikanSignal = request.signal;
          return new Promise<Response>((_resolve, reject) => {
            request.signal.addEventListener('abort', () => reject(request.signal.reason), {
              once: true,
            });
          });
        },
      },
    );
    const seed = searchMedia({ query: 'seed', mediaType: 'ANIME' });
    await vi.advanceTimersByTimeAsync(0);
    await seed;
    const pending = runToolContract(tool, input);
    await vi.advanceTimersByTimeAsync(349);
    expect(jikanCalls()).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(4650);
    expect(jikanCalls()).toHaveLength(2);
    expect(jikanSignal?.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(jikanSignal?.aborted).toBe(true);
    expect(contentText(await pending)).toMatch(/MyAnimeList fallback .*unavailable/);
    expect(anilistCalls()).toHaveLength(1);
  });
});

describe('anime_search_media over the wire', () => {
  it('uses the same vocabulary for search and rankings, only for empty first pages', async () => {
    let catalogReads = 0;
    http.route({
      match: ANILIST,
      respond: async (request) => {
        const { query, variables } = (await request.json()) as {
          query: string;
          variables: { page: number; genre?: string };
        };
        if (query.includes('MediaFilterCatalog')) {
          catalogReads++;
          if (catalogReads === 1) return Response.json({ data: { GenreCollection: [] } });
          return Response.json({
            data: { GenreCollection: ['Action'], MediaTagCollection: [{ name: 'Seinen' }] },
          });
        }
        return Response.json({
          data: {
            Page: {
              pageInfo: { currentPage: variables.page, hasNextPage: false, perPage: 20 },
              media: variables.genre === 'Action' ? [mediaNode(1)] : [],
            },
          },
        });
      },
    });
    const genre = { media_type: 'MANGA', genre: 'sEiNeN' } as const;
    const failedCatalog = await runToolContract(animeSearchMedia, genre);
    expect(failedCatalog.structuredContent).toMatchObject({
      total_results: 0,
      notice: expect.stringContaining('Try broadening the search'),
    });
    expect(contentText(failedCatalog)).toContain('Try broadening the search');
    expect(catalogReads).toBe(1);

    const laterPage = await runToolContract(animeSearchMedia, { ...genre, page: 2 });
    expect(laterPage.structuredContent).toMatchObject({ total_results: null });
    expect(contentText(laterPage)).toContain('Page 2 is past the end');
    await runToolContract(animeSearchMedia, { ...genre, genre: 'Action' });
    expect(catalogReads).toBe(1);

    const rankings = await runToolContract(animeGetRankings, { ...genre, mode: 'top' });
    const search = await runToolContract(animeSearchMedia, genre);
    for (const result of [rankings, search]) {
      expect(result.structuredContent).toMatchObject({
        total_results: 0,
        notice: expect.stringContaining('Try the same value in tag instead of genre'),
      });
      expect(contentText(result)).toContain('Try the same value in tag instead of genre');
    }
    expect(catalogReads).toBe(2);
    expect(jikanCalls()).toHaveLength(0);
  });
  it.each([{ season: 'FALL' }, { season_year: 2020 }] as const)(
    'rejects manga broadcast filters before any upstream call: %j',
    async (filter) => {
      const result = await runToolContract(animeSearchMedia, {
        media_type: 'MANGA',
        genre: 'Romance',
        ...filter,
      });
      expect(result.structuredContent).toMatchObject({
        error: {
          data: {
            reason: 'anime_only_season',
            recovery: { hint: expect.stringContaining('start_year') },
          },
        },
      });
      expect(contentText(result)).toContain('anime_only_season');
      expect(contentText(result)).toContain('start_year');
      expect(http.calls).toHaveLength(0);
    },
  );

  it('echoes normalized release filters on both surfaces when a search finds results', async () => {
    http.route({
      method: 'POST',
      match: ANILIST,
      respond: Response.json({
        data: {
          Page: {
            pageInfo: { currentPage: 1, hasNextPage: false, perPage: 20 },
            media: [{ ...mediaNode(1), type: 'MANGA', countryOfOrigin: 'KR' }],
          },
        },
      }),
    });
    const result = await runToolContract(animeSearchMedia, {
      media_type: 'MANGA',
      start_year: 2020,
      country_of_origin: ' kr ',
    });
    const applied = 'start_year=2020, country_of_origin=KR';
    expect(result.structuredContent).toMatchObject({ total_results: 1, effectiveQuery: applied });
    expect(contentText(result)).toContain(`Query: \`${applied}\``);
  });

  it.each([
    [
      { start_year: 2020 },
      { startDateGreater: 20199999, startDateLesser: 20210000 },
      'start_year=2020',
    ],
    [{ country_of_origin: ' kr ' }, { countryOfOrigin: 'KR' }, 'country_of_origin=KR'],
  ])(
    'uses %j as a standalone manga filter and echoes it on an empty page',
    async (input, expected, echo) => {
      http.route({
        method: 'POST',
        match: ANILIST,
        respond: () =>
          Response.json({
            data: {
              Page: { pageInfo: { currentPage: 1, hasNextPage: false, perPage: 20 }, media: [] },
            },
          }),
      });
      const result = await runToolContract(animeSearchMedia, { media_type: 'MANGA', ...input });
      expect(result.structuredContent).toMatchObject({
        source: 'anilist',
        total_results: 0,
        notice: expect.stringContaining(echo),
        effectiveQuery: echo,
      });
      expect(contentText(result)).toContain(echo);
      await expect(variablesOf(anilistCalls()[0]!.request)).resolves.toMatchObject(expected);
      await runToolContract(animeSearchMedia, {
        media_type: 'MANGA',
        query: 'unmatched',
        ...input,
      });
      expect(jikanCalls()).toHaveLength(0);
    },
  );

  it.each([
    { start_year: 2020.5 },
    { start_year: 999 },
    { country_of_origin: 'JPN' },
    { country_of_origin: '1P' },
  ])('rejects invalid release filters before upstream calls: %j', async (input) => {
    const result = await runToolContract(animeSearchMedia, {
      media_type: 'ANIME',
      query: 'title',
      ...input,
    });
    expect(result.structuredContent).toMatchObject({
      error: { code: JsonRpcErrorCode.InvalidParams },
    });
    expect(http.calls).toHaveLength(0);
  });
  it('allows manga discovery when the broadcast season is blank', async () => {
    http.route({
      method: 'POST',
      match: ANILIST,
      respond: Response.json({
        data: {
          Page: {
            pageInfo: { currentPage: 1, hasNextPage: false, perPage: 20 },
            media: [{ ...mediaNode(1), type: 'MANGA' }],
          },
        },
      }),
    });
    const result = await runToolContract(animeSearchMedia, {
      media_type: 'MANGA',
      genre: 'Romance',
      season: '',
    });
    expect(result.structuredContent).toMatchObject({ source: 'anilist', total_results: 1 });
    expect(contentText(result)).toContain('1 total');
    await expect(variablesOf(anilistCalls()[0]!.request)).resolves.not.toHaveProperty('season');
    expect(jikanCalls()).toHaveLength(0);
  });
  it.each<{ sort: Array<'' | 'SCORE_DESC'> }>([{ sort: ['', 'SCORE_DESC'] }, { sort: [''] }])(
    'normalizes blank enum values before upstream selection: %j',
    async ({ sort }) => {
      http.route({
        method: 'POST',
        match: ANILIST,
        respond: Response.json({
          data: {
            Page: {
              pageInfo: { currentPage: 1, hasNextPage: false, perPage: 1 },
              media: [mediaNode(1)],
            },
          },
        }),
      });
      const result = await runToolContract(animeSearchMedia, {
        media_type: 'ANIME',
        query: 'title',
        season: '',
        format: '',
        status: '',
        sort,
      });
      expect(result.isError).toBeFalsy();
      const variables = await variablesOf(anilistCalls()[0]!.request);
      expect(variables.sort).toEqual(
        sort.includes('SCORE_DESC') ? ['SCORE_DESC'] : ['SEARCH_MATCH'],
      );
      for (const field of ['season', 'format', 'status'])
        expect(variables).not.toHaveProperty(field);
    },
  );
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
            { ...mediaNode(501), idMal: 501, isAdult: false, countryOfOrigin: 'KR' },
            { ...mediaNode(502), idMal: 502, isAdult: true, countryOfOrigin: null },
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
        { id: 501, is_adult: false, country_of_origin: 'KR' },
        { id: 502, is_adult: true, country_of_origin: null },
      ],
    });
    expect(contentText(result)).toContain('country_of_origin: KR');
    expect(contentText(result)).toContain('country_of_origin: N/A');
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
