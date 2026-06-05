/**
 * @fileoverview Jikan v4 service — REST client wrapping https://api.jikan.moe/v4 (MyAnimeList proxy).
 * Media-type-aware: routes to /anime/... or /manga/... based on media_type.
 * Rate limit: ~3 req/sec; enforces 350ms minimum between calls.
 * @module services/jikan/jikan-service
 */

import { serviceUnavailable } from '@cyanheads/mcp-ts-core/errors';
import { fetchWithTimeout, requestContextService, withRetry } from '@cyanheads/mcp-ts-core/utils';
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

// ─── Rate-limit guard ─────────────────────────────────────────────────────────

let _lastCallAt = 0;

async function throttle(): Promise<void> {
  const now = Date.now();
  const elapsed = now - _lastCallAt;
  if (elapsed < MIN_INTERVAL_MS) {
    await new Promise((r) => setTimeout(r, MIN_INTERVAL_MS - elapsed));
  }
  _lastCallAt = Date.now();
}

// ─── Core fetch ───────────────────────────────────────────────────────────────

/**
 * Execute a GET request against Jikan. Returns parsed JSON body or null if not found.
 * Jikan returns HTTP 5xx for nonexistent MAL IDs (upstream proxy issue) — treat 5xx on
 * ID lookups as "not found or MAL unavailable" rather than a server error.
 */
async function get<T>(
  path: string,
  params?: Record<string, string | number | undefined>,
): Promise<T | null> {
  await throttle();

  const url = new URL(`${JIKAN_BASE}${path}`);
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined) url.searchParams.set(k, String(v));
    }
  }

  return withRetry(
    async () => {
      const resp = await fetchWithTimeout(url.toString(), TIMEOUT_MS, REQUEST_CONTEXT);

      if (resp.status === 404) return null;

      // Jikan returns 500 for nonexistent MAL IDs (UpstreamException) — treat as not found
      if (resp.status >= 500) return null;

      if (!resp.ok) {
        throw serviceUnavailable(`Jikan returned HTTP ${resp.status}`, { status: resp.status });
      }

      return (await resp.json()) as T;
    },
    {
      maxRetries: 2,
      baseDelayMs: 1000,
      maxDelayMs: 5000,
      operation: 'jikan-get',
      context: REQUEST_CONTEXT,
      // Don't retry 5xx — they're "not found" for Jikan
      isTransient: (e) => {
        const msg = e instanceof Error ? e.message.toLowerCase() : '';
        return msg.includes('timeout') || msg.includes('serviceunavailable');
      },
    },
  );
}

// ─── Service methods ──────────────────────────────────────────────────────────

/** Get full detail for one anime or manga by MAL ID. Returns null if not found. */
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
