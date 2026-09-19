/**
 * @fileoverview Jikan v4 service — REST client wrapping https://api.jikan.moe/v4 (MyAnimeList proxy).
 * Media-type-aware: routes to /anime/... or /manga/... based on media_type.
 * Rate limit: ~3 req/sec; enforces 350ms minimum between calls.
 * @module services/jikan/jikan-service
 */

import { McpError } from '@cyanheads/mcp-ts-core/errors';
import {
  createPacer,
  defaultIsTransient,
  fetchWithTimeout,
  requestContextService,
  withRetry,
} from '@cyanheads/mcp-ts-core/utils';
import type {
  JikanMedia,
  JikanPagination,
  JikanRecommendation,
  JikanSearchResult,
} from './types.js';

// ─── Constants ────────────────────────────────────────────────────────────────

const JIKAN_BASE = 'https://api.jikan.moe/v4';
const TIMEOUT_MS = 15_000;
const REQUEST_CONTEXT = requestContextService.createRequestContext({ operation: 'jikan-service' });
const MIN_INTERVAL_MS = 350;

const pacer = createPacer({ name: 'jikan', minStartGapMs: MIN_INTERVAL_MS });

/** Release queued Jikan work during server shutdown. */
export function shutdownJikan(): void {
  pacer.dispose();
}

// ─── Core fetch ───────────────────────────────────────────────────────────────

/**
 * Execute a GET against Jikan; HTTP failures retain the framework classification.
 * Tool callers decide whether a failed supplement can be omitted.
 */
function get<T>(
  path: string,
  params?: Record<string, string | number | undefined>,
): Promise<T | null> {
  const url = new URL(`${JIKAN_BASE}${path}`);
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined) url.searchParams.set(k, String(v));
    }
  }

  return withRetry(
    ({ signal }) =>
      pacer.run(
        async () => {
          const resp = await fetchWithTimeout(url.toString(), TIMEOUT_MS, REQUEST_CONTEXT, {
            signal,
          });
          return (await resp.json()) as T;
        },
        { signal },
      ),
    {
      maxRetries: 2,
      baseDelayMs: 1000,
      maxDelayMs: 5000,
      operation: 'jikan-get',
      context: REQUEST_CONTEXT,
      // Jikan can report missing MAL IDs as 5xx; those fail without repeated lookups.
      isTransient: (error) =>
        !(
          error instanceof McpError &&
          typeof error.data?.status === 'number' &&
          error.data.status >= 500
        ) && defaultIsTransient(error),
    },
  );
}

// ─── Service methods ──────────────────────────────────────────────────────────

/** Get full detail by MAL ID. Returns null for empty data; HTTP failures throw. */
export async function getMediaFull(
  malId: number,
  mediaType: 'ANIME' | 'MANGA',
): Promise<JikanMedia | null> {
  const noun = mediaType === 'ANIME' ? 'anime' : 'manga';
  const result = await get<{ data: JikanMedia }>(`/${noun}/${malId}/full`);
  return result?.data ?? null;
}

/** Search anime or manga by query. */
export async function searchMedia(params: {
  query: string;
  mediaType: 'ANIME' | 'MANGA';
  page?: number;
  limit?: number;
}): Promise<{ results: JikanSearchResult[]; pagination: JikanPagination | null }> {
  const noun = params.mediaType === 'ANIME' ? 'anime' : 'manga';
  const result = await get<{ data: JikanSearchResult[]; pagination: JikanPagination }>(`/${noun}`, {
    q: params.query,
    page: params.page ?? 1,
    limit: Math.min(params.limit ?? 20, 25),
  });

  return {
    results: result?.data ?? [],
    pagination: result?.pagination ?? null,
  };
}

/** Get recommendations for an anime or manga by MAL ID. */
export async function getRecommendations(
  malId: number,
  mediaType: 'ANIME' | 'MANGA',
): Promise<JikanRecommendation[]> {
  const noun = mediaType === 'ANIME' ? 'anime' : 'manga';
  const result = await get<{ data: JikanRecommendation[] }>(`/${noun}/${malId}/recommendations`);
  return result?.data ?? [];
}
