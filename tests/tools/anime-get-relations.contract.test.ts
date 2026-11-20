/**
 * @fileoverview Relation ordering contract through AniList's HTTP boundary.
 */

import { z } from '@cyanheads/mcp-ts-core';
import { createFetchMock, runToolContract } from '@cyanheads/mcp-ts-core/testing';
import { expect, it } from 'vitest';
import { animeGetRelations } from '@/mcp-server/tools/definitions/anime-get-relations.tool.js';
import type { MediaDetail, MediaRelationType } from '@/services/anilist/types.js';

const graphRequest = z.object({ query: z.string(), variables: z.object({ id: z.number() }) });

function relation(
  id: number,
  relationType: MediaRelationType,
  startDate: MediaDetail['startDate'],
  seasonYear: number | null = null,
) {
  return {
    relationType,
    node: {
      id,
      isAdult: false,
      startDate,
      seasonYear,
      title: { romaji: `Entry ${id}`, english: null },
    },
  };
}

it('orders dates inside each group and retains discovery order for tied dates', async () => {
  const http = createFetchMock();
  const root = relation(1, 'OTHER', { year: 2016, month: 4, day: 3 }, 2016).node;
  const manga = relation(2, 'ADAPTATION', { year: 2014, month: 7, day: 7 });
  const sequel = relation(3, 'SEQUEL', { year: 2017, month: 6, day: null });
  const late = relation(4, 'ADAPTATION', { year: 2017, month: null, day: null }, 2015);
  const early = relation(5, 'SEQUEL', { year: 2017, month: 6, day: 2 });
  const tie = relation(6, 'ADAPTATION', { year: 2017, month: 6, day: 2 });
  const fallback = relation(7, 'SEQUEL', null, 2015);
  const undated = relation(8, 'PREQUEL', null);
  const sideStory = relation(9, 'SIDE_STORY', { year: 2012, month: 1, day: 2 });
  const summary = relation(10, 'SUMMARY', { year: 2018, month: 1, day: 2 });
  const sameYear = relation(11, 'SEQUEL', { year: 2016, month: 9, day: 1 });
  const graph = new Map([
    [1, [manga, sequel, early, fallback, undated, summary, sideStory, sameYear]],
    [2, [late, tie]],
  ]);
  http.route({
    method: 'POST',
    match: 'https://graphql.anilist.co/',
    respond: async (request) => {
      const { query, variables } = graphRequest.parse(await request.json());
      const media = query.includes('query GetRelations')
        ? { id: variables.id, relations: { edges: graph.get(variables.id) ?? [] } }
        : { ...root, description: null };
      return Response.json({ data: { Media: media } });
    },
  });
  http.install();
  try {
    const result = await runToolContract(animeGetRelations, { id: 1, max_depth: 2 });
    const expectedIds = [2, 7, 1, 11, 5, 6, 3, 4, 8, 9, 10];
    const { entries } = animeGetRelations.output.parse(result.structuredContent);
    expect(entries.map((entry) => entry.id)).toEqual(expectedIds);
    expect(entries.find((entry) => entry.id === 6)).toMatchObject({
      depth: 2,
      parent_id: 2,
      relation_to_parent: 'ADAPTATION',
      relation_to_root: null,
      path: [1, 2, 6],
    });
    expect(result.structuredContent).toMatchObject({ depth_reached: 2, total_entries: 11 });
    const text = JSON.stringify(result.content);
    expect(Array.from(text.matchAll(/\[AL:(\d+)\]/g), (match) => Number(match[1]))).toEqual(
      expectedIds,
    );
    expect(text).toContain('Release-date order within each group.');
    expect(text).toContain('1 → 2 → 6');

    const requests = await Promise.all(
      http.calls.map(async (call) => graphRequest.parse(await call.request.clone().json())),
    );
    const edges = requests.filter(({ query }) => query.includes('query GetRelations'));
    expect(edges.map(({ variables }) => variables.id)).toEqual([1, 2, 3, 5, 7, 8, 10, 9, 11]);
    for (const { query } of edges) {
      expect(query).toMatch(/node \{.*startDate\s*\{\s*year month day\s*\}/s);
    }
  } finally {
    http.restore();
  }
});
