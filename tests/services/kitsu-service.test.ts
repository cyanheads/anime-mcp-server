/**
 * @fileoverview Kitsu mapping, streaming, and operation deadline contracts.
 * @module tests/services/kitsu-service.test
 */
import { mcpTest } from '@cyanheads/mcp-ts-core/testing/vitest';
import { expect, vi } from 'vitest';
import { getAnimeStreamingByMalId } from '@/services/kitsu/kitsu-service.js';

const mappingUrl = 'https://kitsu.io/api/edge/mappings';
const animeUrl = 'https://kitsu.io/api/edge/anime/42';
const mapping = { data: [{ relationships: { item: { data: { id: '42', type: 'anime' } } } }] };

mcpTest('an empty mapping is absent and uses one request', async ({ fetchMock }) => {
  fetchMock.route({
    match: (request) => request.url.startsWith(mappingUrl),
    respond: Response.json({ data: [] }),
  });
  await expect(getAnimeStreamingByMalId(1)).resolves.toBeNull();
  expect(fetchMock.calls).toHaveLength(1);
});

mcpTest('a mapped anime can legitimately have no streaming links', async ({ fetchMock }) => {
  fetchMock.route(
    { match: (request) => request.url.startsWith(mappingUrl), respond: Response.json(mapping) },
    {
      match: (request) => request.url.startsWith(animeUrl),
      respond: Response.json({ data: { id: '42', type: 'anime' } }),
    },
  );
  await expect(getAnimeStreamingByMalId(1)).resolves.toEqual({ kitsuId: '42', streamingLinks: [] });
  expect(fetchMock.calls).toHaveLength(2);
});

mcpTest('mapping HTTP failures keep their status', async ({ fetchMock }) => {
  fetchMock.route({
    match: (request) => request.url.startsWith(mappingUrl),
    respond: new Response('missing', { status: 404 }),
  });
  await expect(getAnimeStreamingByMalId(1)).rejects.toMatchObject({ data: { status: 404 } });
  expect(fetchMock.calls).toHaveLength(1);
});

mcpTest('the streaming request is not retried when optional', async ({ fetchMock }) => {
  vi.useFakeTimers();
  fetchMock.route(
    { match: (request) => request.url.startsWith(mappingUrl), respond: Response.json(mapping) },
    {
      match: (request) => request.url.startsWith(animeUrl),
      respond: () => new Response('rate limited', { status: 429, headers: { 'Retry-After': '0' } }),
    },
  );
  try {
    const pending = getAnimeStreamingByMalId(1, { deadlineMs: 5000, maxRetries: 0 });
    const assertion = expect(pending).rejects.toMatchObject({ data: { status: 429 } });
    await vi.advanceTimersByTimeAsync(5000);
    await assertion;
    expect(fetchMock.calls).toHaveLength(2);
  } finally {
    vi.useRealTimers();
  }
});

mcpTest(
  'one deadline covers mapping headers and streaming response body',
  async ({ fetchMock }) => {
    vi.useFakeTimers();
    fetchMock.route(
      {
        match: (request) => request.url.startsWith(mappingUrl),
        respond: () =>
          new Promise((resolve) => setTimeout(() => resolve(Response.json(mapping)), 3000)),
      },
      {
        match: (request) => request.url.startsWith(animeUrl),
        respond: ({ signal }) =>
          new Response(
            new ReadableStream({
              start(controller) {
                const timer = setTimeout(() => {
                  controller.enqueue(
                    new TextEncoder().encode('{"data":{"id":"42","type":"anime"}}'),
                  );
                  controller.close();
                }, 3000);
                signal.addEventListener(
                  'abort',
                  () => {
                    clearTimeout(timer);
                    controller.error(signal.reason);
                  },
                  { once: true },
                );
              },
            }),
          ),
      },
    );
    try {
      const pending = getAnimeStreamingByMalId(1, { deadlineMs: 5000, maxRetries: 0 }).catch(
        (error: unknown) => error,
      );
      const settled = vi.fn();
      const observation = pending.then(settled);
      await vi.advanceTimersByTimeAsync(4999);
      expect(fetchMock.calls).toHaveLength(2);
      expect(settled).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1);
      expect(settled).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({
          data: expect.objectContaining({ reason: 'retry_deadline_exceeded', elapsedMs: 5000 }),
        }),
      );
      await observation;
    } finally {
      vi.useRealTimers();
    }
  },
);

mcpTest('caller abort cancels a pending Kitsu mapping request', async ({ fetchMock }) => {
  vi.useFakeTimers();
  const caller = new AbortController();
  const reason = new DOMException('cancel Kitsu mapping', 'AbortError');
  fetchMock.route({
    match: (request) => request.url.startsWith(mappingUrl),
    respond: ({ signal }) =>
      new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(signal.reason), { once: true });
      }),
  });
  try {
    const pending = getAnimeStreamingByMalId(1, {
      signal: caller.signal,
      deadlineMs: 5000,
      maxRetries: 0,
    }).catch((error: unknown) => error);
    const settled = vi.fn();
    const observation = pending.then(settled);
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchMock.calls).toHaveLength(1);
    caller.abort(reason);
    await vi.advanceTimersByTimeAsync(0);
    expect(settled).toHaveBeenCalledExactlyOnceWith(reason);
    await observation;
  } finally {
    vi.useRealTimers();
  }
});
