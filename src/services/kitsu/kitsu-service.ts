/**
 * @fileoverview Kitsu service — JSON:API client wrapping https://kitsu.io/api/edge.
 * Provides streaming links (anime only) and MAL ID → Kitsu ID mapping.
 * Streaming links are anime-only; Kitsu calls are skipped entirely for MANGA.
 * @module services/kitsu/kitsu-service
 */

import { fetchWithTimeout, requestContextService, withRetry } from '@cyanheads/mcp-ts-core/utils';
import type { KitsuStreamingLink, KitsuStreamingResult } from './types.js';

// ─── Constants ────────────────────────────────────────────────────────────────

const KITSU_BASE = 'https://kitsu.io/api/edge';
const TIMEOUT_MS = 12_000;
const REQUEST_CONTEXT = requestContextService.createRequestContext({ operation: 'kitsu-service' });

// ─── Core fetch ───────────────────────────────────────────────────────────────

function get<T>(path: string, params?: Record<string, string>): Promise<T | null> {
  const url = new URL(`${KITSU_BASE}${path}`);
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      url.searchParams.set(k, v);
    }
  }

  return withRetry(
    async () => {
      const resp = await fetchWithTimeout(url.toString(), TIMEOUT_MS, REQUEST_CONTEXT, {
        headers: {
          Accept: 'application/vnd.api+json',
          'Content-Type': 'application/vnd.api+json',
        },
      });

      if (resp.status === 404) return null;
      if (!resp.ok) return null; // Degrade gracefully — Kitsu is a supplement

      return (await resp.json()) as T;
    },
    {
      maxRetries: 2,
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
async function findKitsuAnimeId(malId: number): Promise<string | null> {
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
  }>('/mappings', {
    'filter[externalSite]': 'myanimelist/anime',
    'filter[externalId]': String(malId),
    include: 'item',
    'fields[anime]': 'id',
  });

  if (!result?.data?.length) return null;

  const rel = result.data[0]?.relationships?.item?.data;
  if (rel && rel.type === 'anime') return rel.id;

  return null;
}

/**
 * Get streaming links for an anime by Kitsu ID.
 * Returns empty array on failure (supplement service — degrades gracefully).
 */
async function getStreamingLinks(kitsuId: string): Promise<KitsuStreamingLink[]> {
  const result = await get<{
    data: { id: string; type: string };
    included?: Array<{
      id: string;
      type: string;
      attributes: { url: string; subs: string[]; dubs: string[] };
    }>;
  }>(`/anime/${kitsuId}`, { include: 'streamingLinks' });

  if (!result?.included) return [];

  return result.included
    .filter((item) => item.type === 'streamingLinks')
    .map((item) => ({
      id: item.id,
      url: item.attributes.url,
      subs: item.attributes.subs ?? [],
      dubs: item.attributes.dubs ?? [],
    }));
}

/**
 * Get streaming links for an anime by MAL ID.
 * Resolves MAL ID → Kitsu ID, then fetches streaming links.
 * Returns null when Kitsu lookup fails (graceful degradation).
 */
export async function getAnimeStreamingByMalId(
  malId: number,
): Promise<KitsuStreamingResult | null> {
  const kitsuId = await findKitsuAnimeId(malId);
  if (!kitsuId) return null;

  const links = await getStreamingLinks(kitsuId);
  return { kitsuId, streamingLinks: links };
}
