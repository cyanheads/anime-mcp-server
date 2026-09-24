/**
 * @fileoverview Verify Jikan's network and error contracts.
 * @module tests/services/jikan-service.test
 */
import { JsonRpcErrorCode } from '@cyanheads/mcp-ts-core/errors';
import { mcpTest } from '@cyanheads/mcp-ts-core/testing/vitest';
import { expect } from 'vitest';
import { getMediaFull, searchMedia } from '@/services/jikan/jikan-service.js';

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
