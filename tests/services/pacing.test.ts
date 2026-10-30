/**
 * @fileoverview Exercise upstream request pacing at the real fetch boundary.
 * @module tests/services/pacing.test
 */
import { mcpTest } from '@cyanheads/mcp-ts-core/testing/vitest';
import { expect, vi } from 'vitest';

mcpTest('AniList queues the 31st start until the sliding window expires', async ({ fetchMock }) => {
  vi.resetModules();
  const { getMediaById, shutdownAniList } = await import('@/services/anilist/anilist-service.js');
  vi.useFakeTimers();
  fetchMock.route({
    match: /graphql\.anilist\.co/,
    respond: Response.json({ data: { Media: null } }),
  });
  try {
    const pending = Promise.all(Array.from({ length: 31 }, (_, id) => getMediaById(id + 1)));
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchMock.calls).toHaveLength(30);
    await vi.advanceTimersByTimeAsync(29_999);
    expect(fetchMock.calls).toHaveLength(30);
    await vi.advanceTimersByTimeAsync(1);
    await pending;
    expect(fetchMock.calls).toHaveLength(31);
  } finally {
    shutdownAniList();
    vi.useRealTimers();
  }
});

mcpTest('Jikan spaces concurrent calls and retry starts', async ({ fetchMock }) => {
  vi.resetModules();
  const { getMediaFull, shutdownJikan } = await import('@/services/jikan/jikan-service.js');
  vi.useFakeTimers();
  const starts: number[] = [];
  fetchMock.route({
    match: /api\.jikan\.moe/,
    respond: () => {
      starts.push(Date.now());
      return starts.length === 1
        ? new Response('rate limited', { status: 429, headers: { 'Retry-After': '0' } })
        : Response.json({ data: null });
    },
  });
  try {
    const pending = Promise.all([getMediaFull(1, 'ANIME'), getMediaFull(2, 'ANIME')]);
    await vi.advanceTimersByTimeAsync(0);
    expect(starts).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(349);
    expect(starts).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(351);
    await pending;
    expect(starts).toHaveLength(3);
    expect(starts[1]! - starts[0]!).toBe(350);
    expect(starts[2]! - starts[1]!).toBe(350);
  } finally {
    shutdownJikan();
    vi.useRealTimers();
  }
});

mcpTest(
  'cancels an AniList request queued behind the sliding window without starting fetch',
  async ({ fetchMock }) => {
    vi.resetModules();
    const { getMediaById, shutdownAniList } = await import('@/services/anilist/anilist-service.js');
    vi.useFakeTimers();
    fetchMock.route({
      match: /graphql\.anilist\.co/,
      respond: Response.json({ data: { Media: null } }),
    });
    try {
      const initial = Promise.all(Array.from({ length: 30 }, (_, id) => getMediaById(id + 1)));
      await vi.advanceTimersByTimeAsync(0);
      await initial;
      const controller = new AbortController();
      const pending = getMediaById(31, false, controller.signal);
      const reason = new DOMException('queued AniList cancellation', 'AbortError');
      const assertion = expect(pending).rejects.toBe(reason);
      await vi.advanceTimersByTimeAsync(0);
      controller.abort(reason);
      await vi.advanceTimersByTimeAsync(0);
      await assertion;
      await vi.advanceTimersByTimeAsync(30000);
      expect(fetchMock.calls).toHaveLength(30);
    } finally {
      shutdownAniList();
      vi.useRealTimers();
    }
  },
);

mcpTest(
  'cancels a Jikan recommendation queued behind the start gap without starting fetch',
  async ({ fetchMock }) => {
    vi.resetModules();
    const { getRecommendations, shutdownJikan } = await import('@/services/jikan/jikan-service.js');
    vi.useFakeTimers();
    fetchMock.route({ match: /api\.jikan\.moe/, respond: Response.json({ data: [] }) });
    try {
      const initial = getRecommendations(1, 'ANIME');
      await vi.advanceTimersByTimeAsync(0);
      await initial;
      const controller = new AbortController();
      const reason = new DOMException('queued Jikan cancellation', 'AbortError');
      const pending = getRecommendations(2, 'ANIME', { signal: controller.signal });
      const assertion = expect(pending).rejects.toBe(reason);
      await vi.advanceTimersByTimeAsync(0);
      controller.abort(reason);
      await vi.advanceTimersByTimeAsync(1000);
      await assertion;
      expect(fetchMock.calls).toHaveLength(1);
    } finally {
      shutdownJikan();
      vi.useRealTimers();
    }
  },
);
