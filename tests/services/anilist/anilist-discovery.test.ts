/**
 * @fileoverview AniList discovery filters, exact people, and advisory reads at the fetch boundary.
 */
import { JsonRpcErrorCode } from '@cyanheads/mcp-ts-core/errors';
import { mcpTest } from '@cyanheads/mcp-ts-core/testing/vitest';
import { expect, vi } from 'vitest';
import * as anilist from '@/services/anilist/anilist-service.js';

const url = 'https://graphql.anilist.co/';

mcpTest(
  'search uses strict fuzzy-date bounds and AniList country filtering',
  async ({ fetchMock }) => {
    let body: { query: string; variables: Record<string, unknown> } | undefined;
    fetchMock.route({
      match: 'https://graphql.anilist.co/',
      respond: async (request) => {
        body = (await request.json()) as { query: string; variables: Record<string, unknown> };
        return Response.json({
          data: {
            Page: { media: [], pageInfo: { currentPage: 1, hasNextPage: false, perPage: 20 } },
          },
        });
      },
    });
    const params = { mediaType: 'MANGA' as const, startYear: 2020, countryOfOrigin: 'KR' };
    await expect(anilist.searchMedia(params)).resolves.toMatchObject({ media: [] });
    expect(body?.variables).toMatchObject({
      startDateGreater: 20199999,
      startDateLesser: 20210000,
      countryOfOrigin: 'KR',
    });
    expect(body?.query).toContain('startDate_greater: $startDateGreater');
    expect(body?.query).toContain('startDate_lesser: $startDateLesser');
    expect(body?.query).toContain('countryOfOrigin: $countryOfOrigin');
    expect(body?.query).toContain('$countryOfOrigin: CountryCode');
  },
);

async function readRequest(
  request: Request,
): Promise<{ query: string; variables: Record<string, unknown> }> {
  return (await request.clone().json()) as { query: string; variables: Record<string, unknown> };
}

mcpTest('studio main credit filter applies before paging in both modes', async ({ fetchMock }) => {
  fetchMock.route({ match: url, respond: Response.json({ data: { Studio: null } }) });
  const opts = { mainOnly: true, page: 2, perPage: 5, sort: 'START_DATE_DESC' };
  await anilist.searchStudio({ name: 'MAPPA', ...opts });
  await anilist.getStudioById({ id: 569, ...opts });
  await anilist.searchStudio({ name: 'MAPPA', mainOnly: false });
  await anilist.getStudioById({ id: 569 });
  const [name, id, mixedName, mixedId] = await Promise.all(
    fetchMock.calls.map(({ request }) => readRequest(request)),
  );
  for (const call of [name, id]) {
    expect(call?.variables).toMatchObject({
      isMain: true,
      page: 2,
      perPage: 5,
      mediaSort: ['START_DATE_DESC'],
    });
    expect(call?.query).toContain('isMain: $isMain');
  }
  expect(mixedName?.variables).not.toHaveProperty('isMain');
  expect(mixedId?.variables).not.toHaveProperty('isMain');
});

mcpTest(
  'exact character and staff IDs keep nested role paging independent',
  async ({ fetchMock }) => {
    fetchMock.route({
      match: url,
      respond: async (request) => {
        const { variables } = await readRequest(request);
        if (variables.id === 999) return new Response('Not found', { status: 404 });
        const roles = { pageInfo: { currentPage: 2, hasNextPage: true }, edges: [] };
        return Response.json({
          data: {
            Character: { id: 145, description: 'One.<br>Two.', media: roles },
            Staff: { id: 145879, description: null, characterMedia: roles },
          },
        });
      },
    });
    await expect(anilist.getCharacterById(145, 2, 5)).resolves.toMatchObject({
      id: 145,
      description: 'One.\nTwo.',
      media: { pageInfo: { hasNextPage: true } },
    });
    await expect(anilist.getStaffById(145879, 2, 25)).resolves.toMatchObject({
      id: 145879,
      characterMedia: { pageInfo: { hasNextPage: true } },
    });
    await expect(anilist.getCharacterById(999)).resolves.toBeNull();
    await expect(anilist.getStaffById(999)).resolves.toBeNull();
    const [character, staff] = await Promise.all(
      fetchMock.calls.map(({ request }) => readRequest(request)),
    );
    expect(character?.variables).toEqual({ id: 145, page: 2, perPage: 5 });
    expect(character?.query).toContain('Character(id: $id)');
    expect(staff?.variables).toEqual({ id: 145879, page: 2, perPage: 25 });
    expect(staff?.query).toContain('Staff(id: $id)');
  },
);

mcpTest(
  'suggestions preserve nullable names and optional popular media with first-page metadata',
  async ({ fetchMock }) => {
    const name = { full: null, native: '小林' };
    const title = { romaji: 'Example', english: null, native: null };
    fetchMock.route({
      match: url,
      respond: async (request) => {
        const { query } = await readRequest(request);
        return Response.json({
          data: {
            Page: {
              pageInfo: { hasNextPage: true },
              matches: query.includes('matches: characters')
                ? [{ id: 145, name, popularMedia: { edges: [{ node: { id: 20, title } }] } }]
                : [
                    { id: 145879, name, popularMedia: null },
                    null,
                    { id: 900, name: null, popularMedia: { edges: [{ node: null }] } },
                    { id: 901, popularMedia: { edges: [{ node: { id: 21 } }] } },
                  ],
            },
          },
        });
      },
    });
    await expect(anilist.searchCharacterSuggestions('Sakura', 5)).resolves.toEqual({
      matches: [{ id: 145, name, popularMedia: { id: 20, title } }],
      hasNextPage: true,
    });
    await expect(anilist.searchStaffSuggestions('Yuu Kobayashi', 5)).resolves.toEqual({
      matches: [
        { id: 145879, name, popularMedia: null },
        { id: 900, name: { full: null, native: null }, popularMedia: null },
        {
          id: 901,
          name: { full: null, native: null },
          popularMedia: { id: 21, title: { romaji: null, english: null, native: null } },
        },
      ],
      hasNextPage: true,
    });
    for (const { request } of fetchMock.calls) {
      const call = await readRequest(request);
      expect(call.query).toContain('Page(page: 1, perPage: $perPage)');
      expect(call.variables).toMatchObject({ perPage: 5 });
    }
  },
);

mcpTest(
  'catalog rejects malformed data, caches the next valid response, and expires it',
  async ({ fetchMock }) => {
    vi.resetModules();
    const service = await import('@/services/anilist/anilist-service.js');
    vi.useFakeTimers();
    try {
      let count = 0;
      fetchMock.route({
        match: url,
        respond: () =>
          Response.json({
            data: {
              GenreCollection: ['Action'],
              MediaTagCollection: count++ === 0 ? [{}] : [{ name: 'Seinen' }],
            },
          }),
      });
      await expect(service.getMediaFilterCatalog()).rejects.toMatchObject({
        code: JsonRpcErrorCode.ServiceUnavailable,
      });
      const expected = { genres: ['Action'], tags: ['Seinen'] };
      await expect(service.getMediaFilterCatalog()).resolves.toEqual(expected);
      const { signal } = new AbortController();
      await expect(service.getGenreAdvice('ACTION', signal)).resolves.toBeUndefined();
      await expect(service.getGenreAdvice('sEinEn', signal)).resolves.toContain(
        'in tag instead of genre',
      );
      await expect(service.getGenreAdvice('unlisted', signal)).resolves.toContain(
        'does not recognize',
      );
      await expect(service.getMediaFilterCatalog()).resolves.toEqual(expected);
      expect(fetchMock.calls).toHaveLength(2);
      await vi.advanceTimersByTimeAsync(24 * 60 * 60 * 1000);
      await expect(service.getMediaFilterCatalog()).resolves.toEqual(expected);
      expect(fetchMock.calls).toHaveLength(3);
    } finally {
      service.shutdownAniList();
      vi.useRealTimers();
    }
  },
);

mcpTest(
  'a cancelled catalog read cannot poison another request or the cache',
  async ({ fetchMock }) => {
    vi.resetModules();
    const service = await import('@/services/anilist/anilist-service.js');
    const controller = new AbortController();
    const started = Promise.withResolvers<void>();
    let count = 0;
    const expected = { genres: ['Action'], tags: ['Seinen'] };
    try {
      fetchMock.route({
        match: url,
        respond: (request) => {
          if (++count !== 1) {
            return Response.json({
              data: { GenreCollection: ['Action'], MediaTagCollection: [{ name: 'Seinen' }] },
            });
          }
          return new Response(
            new ReadableStream({
              start(stream) {
                request.signal.addEventListener(
                  'abort',
                  () => stream.error(request.signal.reason),
                  { once: true },
                );
                started.resolve();
              },
            }),
          );
        },
      });
      const first = service.getMediaFilterCatalog(controller.signal);
      const cancelled = expect(first).rejects.toMatchObject({
        code: JsonRpcErrorCode.RequestCancelled,
      });
      await started.promise;
      const second = service.getMediaFilterCatalog();
      controller.abort();
      await cancelled;
      await expect(second).resolves.toEqual(expected);
      await expect(service.getMediaFilterCatalog()).resolves.toEqual(expected);
      expect(fetchMock.calls).toHaveLength(2);
    } finally {
      service.shutdownAniList();
    }
  },
);

mcpTest(
  'optional MAL resolution uses one attempt and includes the body in the shared deadline',
  async ({ fetchMock }) => {
    vi.useFakeTimers();
    try {
      let bodyStarted = false;
      fetchMock.route({
        match: url,
        respond: (request) => {
          if (!bodyStarted) {
            bodyStarted = true;
            return new Response('busy', { status: 503 });
          }
          return new Response(
            new ReadableStream({
              start(stream) {
                request.signal.addEventListener(
                  'abort',
                  () => stream.error(request.signal.reason),
                  { once: true },
                );
              },
            }),
          );
        },
      });
      const controller = new AbortController();
      const failed = expect(
        anilist.getMediaByMalIds([1], 'ANIME', false, controller.signal, { maxRetries: 0 }),
      ).rejects.toMatchObject({ code: JsonRpcErrorCode.ServiceUnavailable });
      await vi.advanceTimersByTimeAsync(0);
      await failed;
      expect(fetchMock.calls).toHaveLength(1);
      const expired = expect(
        anilist.getMediaByMalIds([1], 'ANIME', false, controller.signal, { maxRetries: 0 }),
      ).rejects.toMatchObject({ code: JsonRpcErrorCode.Timeout });
      const timer = setTimeout(
        () => controller.abort(new DOMException('Fallback deadline', 'TimeoutError')),
        5_000,
      );
      try {
        await vi.advanceTimersByTimeAsync(4_999);
        expect(fetchMock.calls).toHaveLength(2);
        expect(controller.signal.aborted).toBe(false);
        await vi.advanceTimersByTimeAsync(1);
        await expired;
        expect(fetchMock.calls).toHaveLength(2);
      } finally {
        clearTimeout(timer);
      }
    } finally {
      vi.useRealTimers();
    }
  },
);
