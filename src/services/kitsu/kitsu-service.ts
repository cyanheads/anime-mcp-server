/**
 * @fileoverview Kitsu service — JSON:API client wrapping https://kitsu.io/api/edge.
 * Provides streaming links (anime only) and MAL ID → Kitsu ID mapping.
 * Streaming links are anime-only; Kitsu calls are skipped entirely for MANGA.
 * @module services/kitsu/kitsu-service
 */

import { z } from '@cyanheads/mcp-ts-core';
import { serviceUnavailable } from '@cyanheads/mcp-ts-core/errors';
import {
  fetchWithTimeout,
  type RetryOptions,
  requestContextService,
  withRetry,
} from '@cyanheads/mcp-ts-core/utils';
import type { KitsuStreamingLink, KitsuStreamingResult } from './types.js';

// ─── Constants ────────────────────────────────────────────────────────────────

const KITSU_BASE = 'https://kitsu.io/api/edge';
const TIMEOUT_MS = 12_000;
const REQUEST_CONTEXT = requestContextService.createRequestContext({ operation: 'kitsu-service' });
type KitsuRequestOptions = Required<Pick<RetryOptions, 'signal' | 'maxRetries'>>;
const streamingLinkSchema = z.object({
  id: z.string(),
  attributes: z.object({
    url: z.string(),
    subs: z.array(z.string()).nullish(),
    dubs: z.array(z.string()).nullish(),
  }),
});
const includedSchema = z.object({
  included: z.array(z.looseObject({ type: z.string() })).nullish(),
});

// ─── Core fetch ───────────────────────────────────────────────────────────────

function get<T>(
  path: string,
  params: Record<string, string>,
  options: KitsuRequestOptions,
): Promise<T> {
  const url = new URL(`${KITSU_BASE}${path}`);
  for (const [k, v] of Object.entries(params)) {
    url.searchParams.set(k, v);
  }

  return withRetry(
    async ({ signal }) => {
      const resp = await fetchWithTimeout(url.toString(), TIMEOUT_MS, REQUEST_CONTEXT, {
        signal,
        headers: {
          Accept: 'application/vnd.api+json',
          'Content-Type': 'application/vnd.api+json',
        },
      });

      return (await resp.json()) as T;
    },
    {
      ...options,
      baseDelayMs: 1000,
      maxDelayMs: 5000,
      operation: 'kitsu-get',
      context: REQUEST_CONTEXT,
    },
  );
}

// ─── Service methods ──────────────────────────────────────────────────────────

/**
 * Find Kitsu anime ID by MAL ID using the mappings filter.
 * Returns null if not found.
 */
async function findKitsuAnimeId(
  malId: number,
  options: KitsuRequestOptions,
): Promise<string | null> {
  // Kitsu's mappings endpoint with externalSite filter returns mapping records;
  // the relationships.item data contains the kitsu ID
  const result = await get<{
    data: Array<{
      id: string;
      type: string;
      relationships?: {
        item?: { data: { id: string; type: string } | null };
      };
    }>;
  }>(
    '/mappings',
    {
      'filter[externalSite]': 'myanimelist/anime',
      'filter[externalId]': String(malId),
      include: 'item',
      'fields[anime]': 'id',
    },
    options,
  );

  if (!result?.data?.length) return null;

  const rel = result.data[0]?.relationships?.item?.data;
  if (rel && rel.type === 'anime') return rel.id;

  return null;
}

/**
 * Get streaming links for an anime by Kitsu ID.
 * Returns an empty array when no streaming links are available.
 */
async function getStreamingLinks(
  kitsuId: string,
  options: KitsuRequestOptions,
): Promise<KitsuStreamingLink[]> {
  // Guard: Kitsu IDs are numeric strings (e.g. "7442"). Reject anything that would
  // escape the path segment (traversal, scheme injection) via a malformed API response.
  if (!/^\d+$/.test(kitsuId)) return [];

  const result = includedSchema.safeParse(
    await get<unknown>(`/anime/${kitsuId}`, { include: 'streamingLinks' }, options),
  );
  if (!result.success) {
    throw serviceUnavailable('Kitsu returned invalid streaming data.', { retryable: false });
  }
  const rows = streamingLinkSchema
    .array()
    .safeParse((result.data.included ?? []).filter((item) => item.type === 'streamingLinks'));
  if (!rows.success) {
    throw serviceUnavailable('Kitsu returned invalid streaming links.', { retryable: false });
  }
  return rows.data.map(({ id, attributes: { url, subs, dubs } }) => ({
    id,
    url,
    subs: subs ?? [],
    dubs: dubs ?? [],
  }));
}

/**
 * Get streaming links for an anime by MAL ID.
 * Returns null for an absent mapping. HTTP failures throw.
 * An operation deadline covers both requests and their response bodies.
 */
export async function getAnimeStreamingByMalId(
  malId: number,
  options?: Pick<RetryOptions, 'signal' | 'deadlineMs' | 'maxRetries'>,
): Promise<KitsuStreamingResult | null> {
  const result = await withRetry(
    async ({ signal }) => {
      const requestOptions = { signal, maxRetries: options?.maxRetries ?? 2 };
      const kitsuId = await findKitsuAnimeId(malId, requestOptions);
      if (!kitsuId) return null;
      const streamingLinks = await getStreamingLinks(kitsuId, requestOptions);
      return { kitsuId, streamingLinks };
    },
    {
      operation: 'kitsu-streaming',
      context: REQUEST_CONTEXT,
      ...options,
      // Each request handles its own retries under the shared deadline.
      maxRetries: 0,
    },
  ).catch((error: unknown) => {
    options?.signal?.throwIfAborted();
    throw error;
  });
  options?.signal?.throwIfAborted();
  return result;
}
