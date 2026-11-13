/**
 * @fileoverview Jikan v4 service — REST client wrapping https://api.jikan.moe/v4 (MyAnimeList proxy).
 * Media-type-aware: routes to /anime/... or /manga/... based on media_type.
 * Rate limit: ~3 req/sec; enforces 350ms minimum between calls.
 * @module services/jikan/jikan-service
 */

import { z } from '@cyanheads/mcp-ts-core';
import { McpError, serviceUnavailable } from '@cyanheads/mcp-ts-core/errors';
import {
  createPacer,
  defaultIsTransient,
  fetchWithTimeout,
  type RetryOptions,
  requestContextService,
  withRetry,
} from '@cyanheads/mcp-ts-core/utils';
import type { JikanMedia } from './types.js';

// ─── Constants ────────────────────────────────────────────────────────────────

const JIKAN_BASE = 'https://api.jikan.moe/v4';
const TIMEOUT_MS = 15_000;
const REQUEST_CONTEXT = requestContextService.createRequestContext({ operation: 'jikan-service' });
const MIN_INTERVAL_MS = 350;

const pacer = createPacer({ name: 'jikan', minStartGapMs: MIN_INTERVAL_MS });
type JikanRequestOptions = Pick<RetryOptions, 'signal' | 'deadlineMs' | 'maxRetries'>;

const searchPageSchema = z.object({
  data: z
    .array(
      z.object({
        mal_id: z.number().int().positive(),
        title: z.string(),
        title_english: z
          .string()
          .nullish()
          .transform((value) => value ?? null),
        type: z.string().nullish(),
        status: z.string().nullish(),
        chapters: z.number().int().nullish(),
        episodes: z.number().int().nullish(),
        score: z.number().nullish(),
      }),
    )
    .nullish(),
  pagination: z
    .object({
      current_page: z.number().int().optional(),
      has_next_page: z.boolean().optional(),
    })
    .nullish(),
});

const recommendationPageSchema = z.object({
  data: z
    .array(
      z.object({
        entry: z.object({ mal_id: z.number().int().positive() }),
        votes: z.number().int(),
      }),
    )
    .nullish(),
});

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
  options?: JikanRequestOptions,
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
      ...options,
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
  options?: JikanRequestOptions,
): Promise<JikanMedia | null> {
  const noun = mediaType === 'ANIME' ? 'anime' : 'manga';
  const result = await get<{ data: JikanMedia }>(`/${noun}/${malId}/full`, undefined, options);
  return result?.data ?? null;
}

/** Most rows Jikan returns per search page; larger `limit` values are capped. */
export const JIKAN_SEARCH_PAGE_MAX = 25;

/** Search anime or manga by query. `sfw` asks Jikan to drop adult entries. */
export async function searchMedia(
  params: {
    query: string;
    mediaType: 'ANIME' | 'MANGA';
    page?: number;
    limit?: number;
    sfw?: boolean;
  },
  options?: JikanRequestOptions,
) {
  const noun = params.mediaType === 'ANIME' ? 'anime' : 'manga';
  const raw = await get<unknown>(
    `/${noun}`,
    {
      q: params.query,
      page: params.page ?? 1,
      limit: Math.min(params.limit ?? 20, JIKAN_SEARCH_PAGE_MAX),
      sfw: params.sfw ? 'true' : undefined,
    },
    options,
  );
  const result = searchPageSchema.safeParse(raw);
  if (!result.success) {
    throw serviceUnavailable('Jikan returned invalid search data.', { retryable: false });
  }

  return {
    results: result.data.data ?? [],
    pagination: result.data.pagination ?? null,
  };
}

/** Get recommendations for an anime or manga by MAL ID. */
export async function getRecommendations(
  malId: number,
  mediaType: 'ANIME' | 'MANGA',
  options?: JikanRequestOptions,
): Promise<Array<{ entry: { mal_id: number }; votes: number }>> {
  const noun = mediaType === 'ANIME' ? 'anime' : 'manga';
  const raw = await get<unknown>(`/${noun}/${malId}/recommendations`, undefined, options);
  const result = recommendationPageSchema.safeParse(raw);
  if (!result.success) {
    throw serviceUnavailable('Jikan returned invalid recommendation data.', { retryable: false });
  }
  return result.data.data ?? [];
}
