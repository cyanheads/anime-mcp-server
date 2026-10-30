/**
 * @fileoverview Source-specific recommendation contracts through real retry, pacing and fetch paths.
 * @module tests/tools/anime-get-recommendations.contract.test
 */
import { JsonRpcErrorCode } from '@cyanheads/mcp-ts-core/errors';
import { createMockContext, runToolContract } from '@cyanheads/mcp-ts-core/testing';
import { mcpTest } from '@cyanheads/mcp-ts-core/testing/vitest';
import { expect, vi } from 'vitest';

const media = (id: number) => ({
  id: 100 + id,
  idMal: id,
  type: 'ANIME',
  title: { romaji: `Title ${id}`, english: null, native: null },
  isAdult: false,
});
const candidate = (id: number, votes = 100 - id) => ({
  entry: {
    mal_id: id,
    title: `MAL ${id}`,
    url: `https://myanimelist.net/anime/${id}`,
    images: null,
  },
  votes,
});

const workflowTest = mcpTest.extend<{
  workflow: {
    tool: typeof import('@/mcp-server/tools/definitions/anime-get-recommendations.tool.js').animeGetRecommendations;
    anilist: typeof import('@/services/anilist/anilist-service.js');
    jikan: typeof import('@/services/jikan/jikan-service.js');
  };
}>({
  workflow: async ({ ctx: _ctx }, use) => {
    vi.resetModules();
    vi.useFakeTimers();
    const anilist = await import('@/services/anilist/anilist-service.js');
    const jikan = await import('@/services/jikan/jikan-service.js');
    const { animeGetRecommendations: tool } = await import(
      '@/mcp-server/tools/definitions/anime-get-recommendations.tool.js'
    );
    try {
      await use({ tool, anilist, jikan });
    } finally {
      anilist.shutdownAniList();
      jikan.shutdownJikan();
      vi.useRealTimers();
    }
  },
});

workflowTest(
  'pages deduplicated Jikan candidates before one non-adult resolution batch and restores vote order',
  async ({ fetchMock, workflow }) => {
    const batches: number[][] = [];
    fetchMock.route({
      match: /graphql\.anilist\.co/,
      respond: async (request) => {
        const body = (await request.json()) as {
          query: string;
          variables: { idMalIn?: number[]; isAdult?: boolean };
        };
        if (body.query.includes('GetMediaByMalIds')) {
          expect(body.variables.isAdult).toBe(false);
          const ids = body.variables.idMalIn!;
          batches.push(ids);
          return Response.json({
            data: {
              Page: {
                media: ids
                  .filter((id) => id !== 5 && id !== 7)
                  .reverse()
                  .map(media),
              },
            },
          });
        }
        expect(body.query).toContain('query GetMedia(');
        return Response.json({
          data: { Media: { id: 1, idMal: 10, type: 'ANIME', description: null } },
        });
      },
    });
    fetchMock.route({
      match: 'https://api.jikan.moe/v4/anime/10/recommendations',
      respond: Response.json({
        data: [...Array.from({ length: 28 }, (_, i) => candidate(i + 1)), candidate(2, 1)],
      }),
    });
    const firstPending = runToolContract(workflow.tool, { id: 1, source: 'jikan', per_page: 25 });
    await vi.advanceTimersByTimeAsync(0);
    const first = await firstPending;
    const firstRows = (
      first.structuredContent as {
        recommendations: Array<{ id_mal: number; anilist_rating: null; sources: string[] }>;
      }
    ).recommendations;
    expect(firstRows.map((row) => row.id_mal)).toEqual(
      Array.from({ length: 25 }, (_, i) => i + 1).filter((id) => id !== 5 && id !== 7),
    );
    expect(
      firstRows.every((row) => row.anilist_rating === null && row.sources.join() === 'jikan'),
    ).toBe(true);
    expect(first.structuredContent).toMatchObject({
      source: 'jikan',
      jikan_status: 'available',
      has_next_page: true,
      truncated: true,
      shown: 23,
      cap: 25,
    });
    expect(JSON.stringify(first.content)).toContain('page 2, source jikan');
    const secondPending = runToolContract(workflow.tool, {
      id: 1,
      source: 'jikan',
      per_page: 25,
      page: 2,
    });
    await vi.advanceTimersByTimeAsync(350);
    const second = await secondPending;
    expect(second.structuredContent).toMatchObject({
      has_next_page: false,
      recommendations: [{ id_mal: 26 }, { id_mal: 27 }, { id_mal: 28 }],
    });
    const pastPending = runToolContract(workflow.tool, {
      id: 1,
      source: 'jikan',
      per_page: 25,
      page: 3,
    });
    await vi.advanceTimersByTimeAsync(350);
    const past = await pastPending;
    expect(past.structuredContent).toMatchObject({
      source: 'jikan',
      jikan_status: 'available',
      has_next_page: false,
      recommendations: [],
    });
    expect(past.structuredContent).not.toHaveProperty('truncated');
    expect(JSON.stringify(past.content)).toContain('No recommendations found.');
    expect(batches).toEqual([Array.from({ length: 25 }, (_, i) => i + 1), [26, 27, 28]]);
  },
);

workflowTest(
  'keeps candidate continuation when the whole selected page is unresolved',
  async ({ fetchMock, workflow }) => {
    fetchMock.route({
      match: /graphql\.anilist\.co/,
      respond: async (request) => {
        const { query } = (await request.json()) as { query: string };
        return Response.json({
          data: query.includes('GetMediaByMalIds')
            ? { Page: { media: [] } }
            : { Media: { id: 1, idMal: 10, type: 'MANGA', description: null } },
        });
      },
    });
    fetchMock.route({
      match: 'https://api.jikan.moe/v4/manga/10/recommendations',
      respond: Response.json({ data: [candidate(1), candidate(2)] }),
    });
    const pending = runToolContract(workflow.tool, { id: 1, source: 'jikan', per_page: 1 });
    await vi.advanceTimersByTimeAsync(0);
    const result = await pending;
    expect(result.structuredContent).toMatchObject({
      recommendations: [],
      has_next_page: true,
      shown: 0,
      cap: 1,
      source_type: 'MANGA',
    });
    expect(JSON.stringify(result.content)).toContain('page 2, source jikan');
  },
);

workflowTest(
  'valid empty candidates need no resolution request',
  async ({ fetchMock, workflow }) => {
    fetchMock.route({
      match: /graphql\.anilist\.co/,
      respond: Response.json({
        data: { Media: { id: 1, idMal: 10, type: 'ANIME', description: null } },
      }),
    });
    fetchMock.route({ match: /api\.jikan\.moe/, respond: Response.json({ data: [] }) });
    const pending = runToolContract(workflow.tool, { id: 1, source: 'jikan' });
    await vi.advanceTimersByTimeAsync(0);
    const result = await pending;
    expect(result.structuredContent).toMatchObject({
      source: 'jikan',
      jikan_status: 'available',
      recommendations: [],
      has_next_page: false,
    });
    expect(JSON.stringify(result.content)).toContain('jikan_status: available');
    expect(fetchMock.calls).toHaveLength(2);
  },
);

workflowTest(
  'optional annotations stop after one failed request and retain primary results',
  async ({ fetchMock, workflow }) => {
    fetchMock.route({
      match: /graphql\.anilist\.co/,
      respond: async (request) => {
        const { query } = (await request.json()) as { query: string };
        return Response.json({
          data: {
            Media: query.includes('query GetMedia(')
              ? { id: 1, idMal: 10, type: 'ANIME', description: null }
              : {
                  recommendations: {
                    pageInfo: { hasNextPage: false },
                    nodes: [{ rating: 10, mediaRecommendation: media(2) }],
                  },
                },
          },
        });
      },
    });
    fetchMock.route({
      match: /api\.jikan\.moe/,
      respond: new Response('temporarily unavailable', {
        status: 429,
        headers: { 'Retry-After': '1' },
      }),
    });
    const pending = runToolContract(workflow.tool, { id: 1 });
    await vi.advanceTimersByTimeAsync(0);
    const result = await pending;
    expect(result.structuredContent).toMatchObject({
      source: 'anilist',
      jikan_status: 'unavailable',
      recommendations: [{ id_mal: 2, sources: ['anilist'] }],
    });
    expect(JSON.stringify(result.content)).toContain('jikan_status: unavailable');
    await vi.advanceTimersByTimeAsync(60000);
    expect(fetchMock.calls).toHaveLength(3);
  },
);

for (const stage of ['detail', 'jikan', 'resolution'] as const) {
  workflowTest(
    `cancels the real ${stage} fetch without partial success or further requests`,
    async ({ fetchMock, workflow }) => {
      const controller = new AbortController();
      let activeSignal: AbortSignal | undefined;
      const respond = async (request: Request) => {
        const isJikan = new URL(request.url).hostname === 'api.jikan.moe';
        const body = isJikan ? null : ((await request.json()) as { query: string });
        const current = isJikan
          ? 'jikan'
          : body!.query.includes('GetMediaByMalIds')
            ? 'resolution'
            : 'detail';
        if (current === stage) {
          activeSignal = request.signal;
          return new Promise<Response>((_resolve, reject) =>
            request.signal.addEventListener('abort', () => reject(request.signal.reason), {
              once: true,
            }),
          );
        }
        return Response.json(
          isJikan
            ? { data: [candidate(2)] }
            : { data: { Media: { id: 1, idMal: 10, type: 'ANIME', description: null } } },
        );
      };
      fetchMock.route({ match: /graphql\.anilist\.co/, respond });
      fetchMock.route({ match: /api\.jikan\.moe/, respond });
      const pending = runToolContract(
        workflow.tool,
        { id: 1, source: 'jikan' },
        { context: { signal: controller.signal } },
      );
      await vi.advanceTimersByTimeAsync(0);
      expect(activeSignal?.aborted).toBe(false);
      const reason = new DOMException(`caller cancelled ${stage}`, 'AbortError');
      controller.abort(reason);
      await vi.advanceTimersByTimeAsync(0);
      const result = await pending;
      expect(activeSignal?.aborted).toBe(true);
      expect(activeSignal?.reason).toBe(reason);
      const message =
        stage === 'detail' ? 'fetch POST https://graphql.anilist.co was aborted.' : reason.message;
      expect(result.structuredContent).toMatchObject({
        error: { code: JsonRpcErrorCode.RequestCancelled, message },
      });
      expect(JSON.stringify(result.content)).toContain(message);
      expect(result.structuredContent).not.toHaveProperty('recommendations');
      const calls = fetchMock.calls.length;
      await vi.advanceTimersByTimeAsync(60000);
      expect(fetchMock.calls).toHaveLength(calls);
      expect(calls).toBe(stage === 'detail' ? 1 : stage === 'jikan' ? 2 : 3);
    },
  );
}

workflowTest(
  'optional supplement cancellation rethrows caller reason at the handler boundary',
  async ({ fetchMock, workflow }) => {
    const controller = new AbortController();
    fetchMock.route({
      match: /graphql\.anilist\.co/,
      respond: async (request) => {
        const { query } = (await request.json()) as { query: string };
        return Response.json({
          data: {
            Media: query.includes('query GetMedia(')
              ? { id: 1, idMal: 10, type: 'ANIME', description: null }
              : { recommendations: { pageInfo: { hasNextPage: false }, nodes: [] } },
          },
        });
      },
    });
    fetchMock.route({
      match: /api\.jikan\.moe/,
      respond: (request) =>
        new Promise<Response>((_resolve, reject) =>
          request.signal.addEventListener('abort', () => reject(request.signal.reason), {
            once: true,
          }),
        ),
    });
    const ctx = createMockContext({ signal: controller.signal, errors: workflow.tool.errors });
    const pending = workflow.tool.handler(workflow.tool.input.parse({ id: 1 }), ctx);
    const reason = new DOMException('optional cancelled', 'AbortError');
    const assertion = expect(pending).rejects.toBe(reason);
    await vi.advanceTimersByTimeAsync(0);
    controller.abort(reason);
    await vi.advanceTimersByTimeAsync(0);
    await assertion;
    expect(fetchMock.calls).toHaveLength(3);
  },
);

workflowTest(
  'bounds the optional hanging supplement to five seconds without retries',
  async ({ fetchMock, workflow }) => {
    fetchMock.route({
      match: /graphql\.anilist\.co/,
      respond: async (request) => {
        const { query } = (await request.json()) as { query: string };
        return Response.json({
          data: {
            Media: query.includes('query GetMedia(')
              ? { id: 1, idMal: 10, type: 'ANIME', description: null }
              : { recommendations: { pageInfo: { hasNextPage: false }, nodes: [] } },
          },
        });
      },
    });
    fetchMock.route({
      match: /api\.jikan\.moe/,
      respond: (request) =>
        new Promise<Response>((_resolve, reject) =>
          request.signal.addEventListener('abort', () => reject(request.signal.reason), {
            once: true,
          }),
        ),
    });
    const pending = runToolContract(workflow.tool, { id: 1 });
    await vi.advanceTimersByTimeAsync(5000);
    const result = await pending;
    expect(result.structuredContent).toMatchObject({
      source: 'anilist',
      jikan_status: 'unavailable',
      recommendations: [],
    });
    expect(fetchMock.calls).toHaveLength(3);
  },
);

workflowTest(
  'one total deadline stops detail retries before the default client deadline',
  async ({ fetchMock, workflow }) => {
    const signals: AbortSignal[] = [];
    fetchMock.route({
      match: /graphql\.anilist\.co/,
      respond: (request) => {
        signals.push(request.signal);
        return new Promise<Response>((_resolve, reject) =>
          request.signal.addEventListener('abort', () => reject(request.signal.reason), {
            once: true,
          }),
        );
      },
    });
    const pending = runToolContract(workflow.tool, { id: 1, source: 'jikan' });
    await vi.advanceTimersByTimeAsync(50000);
    const result = await pending;
    expect(result.structuredContent).toMatchObject({
      error: {
        code: JsonRpcErrorCode.Timeout,
        data: { reason: 'retry_deadline_exceeded', deadlineMs: 50000 },
      },
    });
    expect(JSON.stringify(result.content)).toContain('50000');
    expect(result.structuredContent).toMatchObject({
      error: {
        data: {
          recovery: { hint: 'Retry the same page or use source anilist if Jikan is unavailable.' },
        },
      },
    });
    expect(JSON.stringify(result.content)).toContain('Retry the same page or use source anilist');
    expect(signals.every((signal) => signal.aborted)).toBe(true);
    const calls = fetchMock.calls.length;
    await vi.advanceTimersByTimeAsync(10000);
    expect(fetchMock.calls).toHaveLength(calls);
    expect(calls).toBeGreaterThan(1);
  },
);

workflowTest(
  'the same operation deadline spans source lookup, Jikan and resolution retries',
  async ({ fetchMock, workflow }) => {
    const stages: string[] = [];
    const respond = async (request: Request) => {
      const isJikan = new URL(request.url).hostname === 'api.jikan.moe';
      const body = isJikan ? null : ((await request.json()) as { query: string });
      const stage = isJikan
        ? 'jikan'
        : body!.query.includes('GetMediaByMalIds')
          ? 'resolution'
          : 'detail';
      stages.push(stage);
      return new Promise<Response>((resolve, reject) => {
        const timer =
          stage === 'resolution'
            ? undefined
            : setTimeout(
                () =>
                  resolve(
                    Response.json(
                      isJikan
                        ? { data: [candidate(2)] }
                        : {
                            data: { Media: { id: 1, idMal: 10, type: 'ANIME', description: null } },
                          },
                    ),
                  ),
                14000,
              );
        request.signal.addEventListener(
          'abort',
          () => {
            clearTimeout(timer);
            reject(request.signal.reason);
          },
          { once: true },
        );
      });
    };
    fetchMock.route({ match: /graphql\.anilist\.co/, respond });
    fetchMock.route({ match: /api\.jikan\.moe/, respond });
    const pending = runToolContract(workflow.tool, { id: 1, source: 'jikan' });
    await vi.advanceTimersByTimeAsync(50000);
    const result = await pending;
    expect(stages).toEqual(['detail', 'jikan', 'resolution', 'resolution']);
    expect(result.structuredContent).toMatchObject({
      error: {
        code: JsonRpcErrorCode.Timeout,
        data: { reason: 'retry_deadline_exceeded', deadlineMs: 50000 },
      },
    });
    expect(JSON.stringify(result.content)).toContain('Retry the same page or use source anilist');
    await vi.advanceTimersByTimeAsync(10000);
    expect(fetchMock.calls).toHaveLength(4);
  },
);
