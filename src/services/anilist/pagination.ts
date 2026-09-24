/**
 * @fileoverview AniList pagination semantics shared by the service and the tools:
 * exact result counts derived from `hasNextPage` (AniList's `pageInfo.total` and
 * `lastPage` are placeholders), the notice for an empty page past the end,
 * recognition of AniList's page-depth refusal, and the rule for the last page AniList
 * serves before that refusal. A dependency-free leaf,
 * so tool tests that mock the AniList service still run it.
 * @module services/anilist/pagination
 */

import { McpError, validationError } from '@cyanheads/mcp-ts-core/errors';

/**
 * Exact number of results in an AniList list, or `null` when the page cannot tell.
 *
 * AniList documents only `hasNextPage` as accurate, so a count exists only where
 * the page itself proves it: an empty first page holds nothing, and a non-empty
 * final page closes the list at `(page − 1) × perPage + entriesOnPage`. `perPage`
 * must be the page size AniList echoed, which caps what the caller requested. A
 * final page that is exactly full still reports `hasNextPage`, so it counts as `null`
 * and the empty page after it ends the list.
 */
export function exactResultCount(params: {
  page: number;
  perPage: number;
  hasNextPage: boolean;
  entriesOnPage: number;
}): number | null {
  const { page, perPage, hasNextPage, entriesOnPage } = params;
  if (entriesOnPage === 0) return page === 1 ? 0 : null;
  if (hasNextPage) return null;
  return (page - 1) * perPage + entriesOnPage;
}

/**
 * Notice for an empty page past the first. Because an exactly full final page still
 * reports `hasNextPage`, a caller paging forward correctly can land here, so the
 * notice says the list is complete rather than blaming the request.
 */
export function pastEndNotice(page: number, list: string): string {
  return `Page ${page} is past the end of ${list}: the list ends on an earlier page. If page ${page - 1} reported has_next_page true, it was the last page; AniList reports has_next_page true on a final page that is exactly full.`;
}

/** AniList serves only this many leading entries of any `Page` list. */
const PAGE_DEPTH_LIMIT = 5000;

/**
 * True on the last page AniList serves while it still reports `hasNextPage`: the
 * next page would end past entry 5,000, so AniList refuses it. `perPage` must be
 * the page size AniList echoed.
 */
export function nextPageOutOfReach(params: {
  page: number;
  perPage: number;
  hasNextPage: boolean;
}): boolean {
  return params.hasNextPage && (params.page + 1) * params.perPage > PAGE_DEPTH_LIMIT;
}

/**
 * Whether a rendered AniList page should offer the next page. `format()` sees only
 * the tool output, which carries no page size, so it reads it from the row count:
 * AniList serves full pages until the last, so a page with `hasNextPage` holds
 * exactly one page of rows. False on the last page within the 5,000-entry reach.
 */
export function nextPageReachable(params: {
  page: number;
  hasNextPage: boolean;
  rowsOnPage: number;
}): boolean {
  const { page, hasNextPage, rowsOnPage } = params;
  return hasNextPage && !nextPageOutOfReach({ page, perPage: rowsOnPage, hasNextPage });
}

/** Notice for a page where {@link nextPageOutOfReach} holds. */
export const PAGE_DEPTH_EDGE_NOTICE =
  'Further pages are out of reach: AniList serves only the first 5,000 entries of a result list, so it refuses the next page even though has_next_page is true. Narrow the criteria to reach the remaining matches.';

/** Error-contract reason for AniList's refusal to page past its first 5,000 entries. */
export const PAGE_DEPTH_REASON = 'page_depth_exceeded';

/** Recovery hint carried by the page-depth refusal; tools declare the same text. */
export const PAGE_DEPTH_RECOVERY =
  'AniList serves only the first 5,000 entries of a result list, so page × per_page must stay at or below 5,000. Narrow the criteria so fewer entries match, or request a lower page.';

const PAGE_DEPTH_MARKER = 'Page depth exceeds maximum allowed';

/**
 * Map AniList's HTTP 400 page-depth refusal (as thrown by `fetchWithTimeout`, with
 * the response body on `data.body`) to a typed `ValidationError`. Returns
 * `undefined` for every other failure so it keeps its existing classification.
 */
export function toPageDepthError(error: unknown): McpError | undefined {
  if (
    !(error instanceof McpError) ||
    error.data?.status !== 400 ||
    typeof error.data.body !== 'string' ||
    !error.data.body.includes(PAGE_DEPTH_MARKER)
  ) {
    return;
  }
  return validationError(
    'AniList refused the page: it reaches past the first 5,000 entries of the result list.',
    { reason: PAGE_DEPTH_REASON, recovery: { hint: PAGE_DEPTH_RECOVERY } },
    { cause: error },
  );
}
