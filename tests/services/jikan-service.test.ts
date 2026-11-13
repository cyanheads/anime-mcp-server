/**
 * @fileoverview Verify Jikan's network and error contracts.
 * @module tests/services/jikan-service.test
 */
import { JsonRpcErrorCode } from '@cyanheads/mcp-ts-core/errors';
import { mcpTest } from '@cyanheads/mcp-ts-core/testing/vitest';
import { expect, vi } from 'vitest';
import { getMediaFull, searchMedia } from '@/services/jikan/jikan-service.js';

mcpTest('detail returns null when Jikan has no data', async ({ fetchMock }) => {
  fetchMock.route({ match: /api\.jikan\.moe/, respond: Response.json({ data: null }) });
  await expect(getMediaFull(999, 'MANGA')).resolves.toBeNull();
  expect(fetchMock.calls[0]!.request.url).toBe('https://api.jikan.moe/v4/manga/999/full');
});

mcpTest('optional detail fails after one rate-limited request', async ({ fetchMock }) => {
  vi.resetModules();
  const { getMediaFull, shutdownJikan } = await import('@/services/jikan/jikan-service.js');
  vi.useFakeTimers();
  fetchMock.route({
    match: /api\.jikan\.moe/,
    respond: () => new Response('rate limited', { status: 429, headers: { 'Retry-After': '0' } }),
  });
  try {
    const pending = getMediaFull(1, 'ANIME', { deadlineMs: 5000, maxRetries: 0 });
    const assertion = expect(pending).rejects.toMatchObject({ data: { status: 429 } });
    await vi.advanceTimersByTimeAsync(5000);
    await assertion;
    expect(fetchMock.calls).toHaveLength(1);
  } finally {
    shutdownJikan();
    vi.useRealTimers();
  }
});

mcpTest(
  'optional search deadline includes time spent in the Jikan queue',
  async ({ fetchMock }) => {
    vi.resetModules();
    const { getMediaFull, searchMedia, shutdownJikan } = await import(
      '@/services/jikan/jikan-service.js'
    );
    vi.useFakeTimers();
    fetchMock.route({ match: /api\.jikan\.moe/, respond: () => Response.json({ data: null }) });
    try {
      const initial = getMediaFull(1, 'ANIME');
      await vi.advanceTimersByTimeAsync(0);
      await initial;
      const pending = searchMedia(
        { query: 'Bebop', mediaType: 'ANIME' },
        { deadlineMs: 300, maxRetries: 0 },
      ).catch((error: unknown) => error);
      await vi.advanceTimersByTimeAsync(350);
      expect(await pending).toMatchObject({ data: { reason: 'retry_deadline_exceeded' } });
      expect(fetchMock.calls).toHaveLength(1);
    } finally {
      shutdownJikan();
      vi.useRealTimers();
    }
  },
);

mcpTest('forwards search pagination and returns upstream results', async ({ fetchMock }) => {
  fetchMock.route({
    match: /api\.jikan\.moe/,
    respond: Response.json({ data: [], pagination: { has_next_page: false } }),
  });
  await expect(
    searchMedia({ query: 'Bebop', mediaType: 'ANIME', page: 2, limit: 50 }),
  ).resolves.toEqual({ results: [], pagination: { has_next_page: false } });
  const url = new URL(fetchMock.calls[0]!.request.url);
  expect(url.searchParams.get('limit')).toBe('25');
  expect(url.searchParams.get('page')).toBe('2');
});

mcpTest('asks Jikan for safe-for-work results only when sfw is set', async ({ fetchMock }) => {
  fetchMock.route({
    match: /api\.jikan\.moe/,
    respond: Response.json({ data: [], pagination: { has_next_page: false } }),
  });

  await searchMedia({ query: 'Bebop', mediaType: 'ANIME', sfw: true });
  await searchMedia({ query: 'Bebop', mediaType: 'MANGA', sfw: false });

  const [safe, unfiltered] = fetchMock.calls.map((call) => new URL(call.request.url));
  expect(safe!.searchParams.get('sfw')).toBe('true');
  expect(unfiltered!.searchParams.has('sfw')).toBe(false);
});

mcpTest('propagates classified not-found from the fetch boundary', async ({ fetchMock }) => {
  fetchMock.route({ match: /api\.jikan\.moe/, respond: new Response('missing', { status: 404 }) });
  await expect(getMediaFull(999, 'ANIME')).rejects.toMatchObject({
    code: JsonRpcErrorCode.NotFound,
  });
  expect(fetchMock.calls).toHaveLength(1);
});

mcpTest(
  'propagates an upstream 500 without retry under the existing policy',
  async ({ fetchMock }) => {
    fetchMock.route({
      match: /api\.jikan\.moe/,
      respond: new Response('unavailable', { status: 500 }),
    });
    await expect(getMediaFull(999, 'ANIME')).rejects.toMatchObject({
      code: JsonRpcErrorCode.ServiceUnavailable,
    });
    expect(fetchMock.calls).toHaveLength(1);
  },
);

mcpTest(
  'recommendation retry backoff exits with the caller reason and no second fetch',
  async ({ fetchMock }) => {
    vi.resetModules();
    const { getRecommendations, shutdownJikan } = await import('@/services/jikan/jikan-service.js');
    vi.useFakeTimers();
    const controller = new AbortController();
    fetchMock.route({
      match: /api\.jikan\.moe/,
      respond: new Response('rate limited', { status: 429, headers: { 'Retry-After': '1' } }),
    });
    try {
      const pending = getRecommendations(1, 'MANGA', { signal: controller.signal });
      const reason = new DOMException('cancel Jikan retry', 'AbortError');
      const assertion = expect(pending).rejects.toBe(reason);
      await vi.advanceTimersByTimeAsync(0);
      expect(fetchMock.calls).toHaveLength(1);
      expect(fetchMock.calls[0]!.request.url).toBe(
        'https://api.jikan.moe/v4/manga/1/recommendations',
      );
      controller.abort(reason);
      await vi.advanceTimersByTimeAsync(10000);
      await assertion;
      expect(fetchMock.calls).toHaveLength(1);
    } finally {
      shutdownJikan();
      vi.useRealTimers();
    }
  },
);
