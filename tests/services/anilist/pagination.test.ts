/**
 * @fileoverview Tests for the AniList pagination helpers: exact-count derivation,
 * the past-the-end notice, page-depth refusal recognition, and the out-of-reach
 * next-page rule.
 * @module tests/services/anilist/pagination.test
 */

import { JsonRpcErrorCode, McpError } from '@cyanheads/mcp-ts-core/errors';
import { describe, expect, it } from 'vitest';
import {
  exactResultCount,
  nextPageOutOfReach,
  nextPageReachable,
  PAGE_DEPTH_EDGE_NOTICE,
  PAGE_DEPTH_REASON,
  PAGE_DEPTH_RECOVERY,
  pastEndNotice,
  toPageDepthError,
} from '@/services/anilist/pagination.js';

describe('nextPageOutOfReach', () => {
  it.each([
    [100, 50],
    [102, 49],
    [1000, 5],
  ])('flags page %i at %i per page when AniList reports another page', (page, perPage) => {
    expect(nextPageOutOfReach({ page, perPage, hasNextPage: true })).toBe(true);
  });

  it.each([
    [99, 50],
    [101, 49],
    [999, 5],
    [1, 20],
  ])('leaves page %i at %i per page alone: the next page is still served', (page, perPage) => {
    expect(nextPageOutOfReach({ page, perPage, hasNextPage: true })).toBe(false);
  });

  it('never flags a final page', () => {
    expect(nextPageOutOfReach({ page: 100, perPage: 50, hasNextPage: false })).toBe(false);
  });

  it('explains the edge in a notice naming the 5,000-entry reach', () => {
    expect(PAGE_DEPTH_EDGE_NOTICE).toContain('5,000');
    expect(PAGE_DEPTH_EDGE_NOTICE).toContain('out of reach');
    expect(PAGE_DEPTH_EDGE_NOTICE).toContain('has_next_page');
  });
});

describe('nextPageReachable', () => {
  it.each([
    [99, true, 50, true],
    [100, true, 50, false],
    [102, true, 49, false],
    [3, false, 20, false],
  ])(
    'page %i (has_next_page %s, %i rows) offers the next page: %s',
    (page, hasNextPage, rowsOnPage, expected) => {
      expect(nextPageReachable({ page, hasNextPage, rowsOnPage })).toBe(expected);
    },
  );
});

describe('pastEndNotice', () => {
  it('names the page and list and allows for an exactly full final page', () => {
    const notice = pastEndNotice(4, 'the results for genre="Action"');
    expect(notice).toContain('Page 4 is past the end of the results for genre="Action"');
    expect(notice).toContain('If page 3 reported has_next_page true, it was the last page');
    expect(notice).toContain('exactly full');
  });
});

describe('exactResultCount', () => {
  it('reports 0 for an empty first page', () => {
    expect(exactResultCount({ page: 1, perPage: 20, hasNextPage: false, entriesOnPage: 0 })).toBe(
      0,
    );
  });

  it('counts a non-empty final page from the echoed page size', () => {
    expect(exactResultCount({ page: 3, perPage: 50, hasNextPage: false, entriesOnPage: 17 })).toBe(
      117,
    );
  });

  it('counts a single-page result set', () => {
    expect(exactResultCount({ page: 1, perPage: 5, hasNextPage: false, entriesOnPage: 5 })).toBe(5);
  });

  it('reports null while more pages remain, whatever the page holds', () => {
    expect(
      exactResultCount({ page: 1, perPage: 5, hasNextPage: true, entriesOnPage: 5 }),
    ).toBeNull();
    expect(
      exactResultCount({ page: 4, perPage: 25, hasNextPage: true, entriesOnPage: 25 }),
    ).toBeNull();
  });

  it('reports null for an empty page past the first', () => {
    expect(
      exactResultCount({ page: 3, perPage: 5, hasNextPage: false, entriesOnPage: 0 }),
    ).toBeNull();
  });
});

describe('toPageDepthError', () => {
  const refusalBody = JSON.stringify({
    errors: [
      {
        message: 'Page depth exceeds maximum allowed for API requests (5000 entries)',
        status: 400,
        locations: [{ line: 2, column: 3 }],
      },
    ],
    data: { Page: null },
  });

  function fetchFailure(status: number, body: string): McpError {
    return new McpError(
      status === 400 ? JsonRpcErrorCode.InvalidParams : JsonRpcErrorCode.ServiceUnavailable,
      `Fetch failed for https://graphql.anilist.co. Status: ${status}`,
      { status, body },
    );
  }

  it('maps the AniList page-depth refusal to a typed ValidationError', () => {
    const cause = fetchFailure(400, refusalBody);
    const mapped = toPageDepthError(cause);

    expect(mapped).toBeInstanceOf(McpError);
    expect(mapped).toMatchObject({
      code: JsonRpcErrorCode.ValidationError,
      data: { reason: PAGE_DEPTH_REASON, recovery: { hint: PAGE_DEPTH_RECOVERY } },
    });
    expect(mapped?.cause).toBe(cause);
    expect(PAGE_DEPTH_REASON).toBe('page_depth_exceeded');
    expect(PAGE_DEPTH_RECOVERY).toContain('5,000');
  });

  it('leaves other 400s and other statuses unmapped', () => {
    expect(
      toPageDepthError(fetchFailure(400, '{"errors":[{"message":"Validation error"}]}')),
    ).toBeUndefined();
    expect(toPageDepthError(fetchFailure(500, refusalBody))).toBeUndefined();
    expect(toPageDepthError(new Error('Page depth exceeds maximum allowed'))).toBeUndefined();
  });
});
