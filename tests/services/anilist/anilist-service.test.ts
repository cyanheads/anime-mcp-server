/**
 * @fileoverview Tests for the AniList GraphQL service boundary.
 * @module tests/services/anilist/anilist-service.test
 */

import { JsonRpcErrorCode, McpError } from '@cyanheads/mcp-ts-core/errors';
import { mcpTest } from '@cyanheads/mcp-ts-core/testing/vitest';
import { expect } from 'vitest';
import {
  getMediaById,
  getMediaByMalIds,
  getMediaCharacters,
  getRankings,
  getSeasonSchedule,
  getStudioById,
  getUpcomingEpisodes,
  searchCharacter,
  searchMedia,
  searchStaff,
  searchStudio,
} from '@/services/anilist/anilist-service.js';
import { PAGE_DEPTH_REASON, PAGE_DEPTH_RECOVERY } from '@/services/anilist/pagination.js';

const mediaNode = {
  id: 1,
  idMal: 1,
  type: 'ANIME',
  format: 'TV',
  status: 'FINISHED',
  season: 'SPRING',
  seasonYear: 1998,
  episodes: 26,
  chapters: null,
  volumes: null,
  isAdult: false,
  meanScore: 86,
  title: { romaji: 'Cowboy Bebop', english: 'Cowboy Bebop', native: 'カウボーイビバップ' },
  coverImage: { extraLarge: null, large: null, medium: null, color: null },
};

async function requestVariables(request: Request): Promise<Record<string, unknown>> {
  const body = (await request.clone().json()) as { variables: Record<string, unknown> };
  return body.variables;
}

mcpTest('getMediaById returns the AniList media detail', async ({ fetchMock }) => {
  fetchMock.route({
    method: 'POST',
    match: 'https://graphql.anilist.co/',
    respond: Response.json({
      data: {
        Media: {
          ...mediaNode,
          description: 'First paragraph.<br><br>Second paragraph.',
          source: 'ORIGINAL',
          hashtag: null,
          bannerImage: null,
          averageScore: 86,
          popularity: 100,
          favourites: 10,
          isFavourite: false,
          startDate: { year: 1998, month: 4, day: 3 },
          endDate: { year: 1999, month: 4, day: 24 },
          genres: ['Action'],
          tags: [],
          studios: { edges: [] },
          externalLinks: [],
          relations: { edges: [] },
          siteUrl: 'https://anilist.co/anime/1',
          trailer: null,
          nextAiringEpisode: null,
        },
      },
    }),
  });

  const result = await getMediaById(1);

  expect(result).toMatchObject({
    id: 1,
    title: { romaji: 'Cowboy Bebop' },
    description: 'First paragraph.\n\nSecond paragraph.',
  });
});

mcpTest('getMediaCharacters preserves a valid empty cast page', async ({ fetchMock }) => {
  fetchMock.route({
    method: 'POST',
    match: 'https://graphql.anilist.co/',
    respond: Response.json({
      data: {
        Media: {
          characters: { pageInfo: { hasNextPage: false }, edges: [] },
        },
      },
    }),
  });

  await expect(getMediaCharacters({ mediaId: 1, page: 4, perPage: 2 })).resolves.toEqual({
    characters: [],
    hasNextPage: false,
  });
});

mcpTest(
  'getMediaCharacters distinguishes missing media from an empty cast page',
  async ({ fetchMock }) => {
    fetchMock.route({
      method: 'POST',
      match: 'https://graphql.anilist.co/',
      respond: new Response(
        JSON.stringify({
          errors: [{ message: 'Not Found.', status: 404 }],
          data: { Media: null },
        }),
        { status: 404, headers: { 'Content-Type': 'application/json' } },
      ),
    });

    await expect(getMediaCharacters({ mediaId: 999_999_999 })).resolves.toBeNull();
  },
);

mcpTest(
  'searchCharacter returns media appearances and sends its current page defaults',
  async ({ fetchMock }) => {
    fetchMock.route({
      method: 'POST',
      match: 'https://graphql.anilist.co/',
      respond: Response.json({
        data: {
          Character: {
            id: 1,
            name: { full: 'Spike Spiegel', native: null },
            image: null,
            description: null,
            siteUrl: null,
            media: {
              pageInfo: { hasNextPage: true, currentPage: 1 },
              nodes: [mediaNode],
              edges: [{ characterRole: 'MAIN', voiceActors: [] }],
            },
          },
        },
      }),
    });

    const result = await searchCharacter('Spike Spiegel');

    expect(result?.media.nodes[0]?.id).toBe(1);
    await expect(requestVariables(fetchMock.calls[0]!.request)).resolves.toMatchObject({
      search: 'Spike Spiegel',
      page: 1,
      perPage: 10,
    });
  },
);

mcpTest(
  'searchCharacter forwards caller pagination to the nested media connection',
  async ({ fetchMock }) => {
    fetchMock.route({
      method: 'POST',
      match: 'https://graphql.anilist.co/',
      respond: Response.json({
        data: {
          Character: {
            id: 1,
            name: { full: 'Spike Spiegel', native: null },
            image: null,
            description: null,
            siteUrl: null,
            media: {
              pageInfo: { hasNextPage: false, currentPage: 2 },
              nodes: [{ ...mediaNode, id: 5 }],
              edges: [{ characterRole: 'MAIN', voiceActors: [] }],
            },
          },
        },
      }),
    });

    const result = await searchCharacter('Spike Spiegel', 2, 1);

    expect(result?.media.nodes[0]?.id).toBe(5);
    await expect(requestVariables(fetchMock.calls[0]!.request)).resolves.toMatchObject({
      search: 'Spike Spiegel',
      page: 2,
      perPage: 1,
    });
  },
);

mcpTest(
  'searchStaff returns the staff description and requested pagination',
  async ({ fetchMock }) => {
    fetchMock.route({
      method: 'POST',
      match: 'https://graphql.anilist.co/',
      respond: Response.json({
        data: {
          Staff: {
            id: 1,
            name: { full: 'Steve Blum', native: null },
            language: 'ENGLISH',
            image: null,
            description: 'First line.<br>Second line.',
            siteUrl: null,
            characterMedia: {
              pageInfo: { hasNextPage: false, currentPage: 2 },
              edges: [],
            },
          },
        },
      }),
    });

    const result = await searchStaff('Steve Blum', 2, 3);

    expect(result?.description).toBe('First line.\nSecond line.');
    await expect(requestVariables(fetchMock.calls[0]!.request)).resolves.toMatchObject({
      search: 'Steve Blum',
      page: 2,
      perPage: 3,
    });
  },
);

mcpTest('getUpcomingEpisodes returns schedules with upstream pageInfo', async ({ fetchMock }) => {
  fetchMock.route({
    method: 'POST',
    match: 'https://graphql.anilist.co/',
    respond: Response.json({
      data: {
        Page: {
          pageInfo: { hasNextPage: true },
          airingSchedules: [
            {
              id: 1,
              airingAt: 2_000_000_000,
              episode: 2,
              timeUntilAiring: 60,
              media: mediaNode,
            },
          ],
        },
      },
    }),
  });

  const result = await getUpcomingEpisodes({ daysAhead: 7, page: 2, perPage: 1 });

  expect(result).toMatchObject({
    airingSchedules: [{ media: { id: 1 } }],
    hasNextPage: true,
  });
  await expect(requestVariables(fetchMock.calls[0]!.request)).resolves.toMatchObject({
    page: 2,
    perPage: 1,
  });
});

mcpTest('resolves MAL IDs to AniList media in one batched query', async ({ fetchMock }) => {
  fetchMock.route({
    method: 'POST',
    match: 'https://graphql.anilist.co/',
    respond: Response.json({
      data: {
        Page: {
          media: [
            { ...mediaNode, id: 101, idMal: 1 },
            { ...mediaNode, id: 202, idMal: 2, title: { ...mediaNode.title, romaji: 'Movie' } },
          ],
        },
      },
    }),
  });

  const result = await getMediaByMalIds([1, 2, 2], 'ANIME', true);

  expect([...result.keys()]).toEqual([1, 2]);
  expect(fetchMock.calls).toHaveLength(1);
  await expect(requestVariables(fetchMock.calls[0]!.request)).resolves.toMatchObject({
    idMalIn: [1, 2],
    type: 'ANIME',
  });
});

mcpTest('the MAL-ID lookup excludes adult media unless asked', async ({ fetchMock }) => {
  fetchMock.route({
    method: 'POST',
    match: 'https://graphql.anilist.co/',
    respond: Response.json({ data: { Page: { media: [] } } }),
  });

  await getMediaByMalIds([1], 'ANIME', false);
  await getMediaByMalIds([1], 'MANGA', true);

  const [excluding, including] = fetchMock.calls;
  await expect(requestVariables(excluding!.request)).resolves.toMatchObject({ isAdult: false });
  await expect(requestVariables(including!.request)).resolves.not.toHaveProperty('isAdult');
  const gql = ((await excluding!.request.clone().json()) as { query: string }).query;
  expect(gql).toMatch(/\$isAdult:\s*Boolean/);
  expect(gql).toMatch(/isAdult:\s*\$isAdult/);
});

// ─── Page queries: pagination selection, defaults, and refusals ─────────────────

async function requestQuery(request: Request): Promise<string> {
  const body = (await request.clone().json()) as { query: string };
  return body.query;
}

/** The `pageInfo { … }` selection of a GraphQL document, whitespace-collapsed. */
function pageInfoSelection(gql: string): string {
  return /pageInfo\s*\{([^}]*)\}/.exec(gql)?.[1]?.trim().split(/\s+/).sort().join(' ') ?? '';
}

const emptyPage = {
  data: { Page: { pageInfo: { currentPage: 1, hasNextPage: false, perPage: 20 }, media: [] } },
};

mcpTest('searchMedia sends the query with the SEARCH_MATCH default sort', async ({ fetchMock }) => {
  fetchMock.route({
    method: 'POST',
    match: 'https://graphql.anilist.co/',
    respond: Response.json(emptyPage),
  });

  await searchMedia({ mediaType: 'ANIME', query: 'Steins;Gate', page: 2, perPage: 5 });

  const variables = await requestVariables(fetchMock.calls[0]!.request);
  expect(variables).toMatchObject({
    type: 'ANIME',
    search: 'Steins;Gate',
    sort: ['SEARCH_MATCH'],
    page: 2,
    perPage: 5,
    isAdult: false,
  });
});

mcpTest('searchMedia defaults a queryless search to POPULARITY_DESC', async ({ fetchMock }) => {
  fetchMock.route({
    method: 'POST',
    match: 'https://graphql.anilist.co/',
    respond: Response.json(emptyPage),
  });

  await searchMedia({ mediaType: 'ANIME', genre: 'Action' });

  const variables = await requestVariables(fetchMock.calls[0]!.request);
  expect(variables).toMatchObject({ genre: 'Action', sort: ['POPULARITY_DESC'] });
  expect(variables).not.toHaveProperty('search');
});

mcpTest('searchMedia sends an explicit sort unchanged', async ({ fetchMock }) => {
  fetchMock.route({
    method: 'POST',
    match: 'https://graphql.anilist.co/',
    respond: Response.json(emptyPage),
  });

  await searchMedia({ mediaType: 'MANGA', genre: 'Action', sort: ['SEARCH_MATCH'] });

  await expect(requestVariables(fetchMock.calls[0]!.request)).resolves.toMatchObject({
    sort: ['SEARCH_MATCH'],
  });
});

mcpTest(
  'Page queries select only accurate pageInfo fields (no total or lastPage)',
  async ({ fetchMock }) => {
    fetchMock.route({
      method: 'POST',
      match: 'https://graphql.anilist.co/',
      respond: Response.json(emptyPage),
    });

    await searchMedia({ mediaType: 'ANIME', query: 'x' });
    await getRankings({ mediaType: 'ANIME', mode: 'top' });
    await getSeasonSchedule({ season: 'FALL', seasonYear: 2024 });

    expect(fetchMock.calls).toHaveLength(3);
    for (const call of fetchMock.calls) {
      await expect(requestQuery(call.request).then(pageInfoSelection)).resolves.toBe(
        'currentPage hasNextPage perPage',
      );
    }
  },
);

mcpTest(
  'studio filmography queries select the echoed perPage instead of total/lastPage',
  async ({ fetchMock }) => {
    fetchMock.route({
      method: 'POST',
      match: 'https://graphql.anilist.co/',
      respond: Response.json({
        data: {
          Studio: {
            id: 2,
            name: 'Kyoto Animation',
            isAnimationStudio: true,
            siteUrl: null,
            media: {
              pageInfo: { currentPage: 1, hasNextPage: true, perPage: 25 },
              edges: [{ isMainStudio: true, node: mediaNode }],
            },
          },
        },
      }),
    });

    const byName = await searchStudio({ name: 'Kyoto Animation' });
    await getStudioById({ id: 2 });

    expect(byName?.media.pageInfo.perPage).toBe(25);
    expect(byName?.media.edges[0]).toMatchObject({ isMainStudio: true, node: { id: 1 } });
    for (const call of fetchMock.calls) {
      await expect(requestQuery(call.request).then(pageInfoSelection)).resolves.toBe(
        'currentPage hasNextPage perPage',
      );
      await expect(requestQuery(call.request)).resolves.toMatch(
        /edges\s*\{\s*isMainStudio\s+node\s*\{/,
      );
    }
  },
);

mcpTest(
  'studio filmography queries cap perPage at the 25 credits AniList serves',
  async ({ fetchMock }) => {
    fetchMock.route({
      method: 'POST',
      match: 'https://graphql.anilist.co/',
      respond: Response.json({ data: { Studio: null } }),
    });

    await searchStudio({ name: 'Kyoto Animation', perPage: 50 });
    await getStudioById({ id: 2 });

    const [byName, byId] = await Promise.all(
      fetchMock.calls.map((call) => requestVariables(call.request)),
    );
    expect(byName).toMatchObject({ perPage: 25 });
    expect(byId).toMatchObject({ perPage: 25 });
  },
);

mcpTest('getRankings forwards a tag filter to AniList', async ({ fetchMock }) => {
  fetchMock.route({
    method: 'POST',
    match: 'https://graphql.anilist.co/',
    respond: Response.json(emptyPage),
  });

  await getRankings({ mediaType: 'ANIME', mode: 'trending', tag: 'Isekai' });

  const call = fetchMock.calls[0]!.request;
  await expect(requestVariables(call)).resolves.toMatchObject({
    tag: 'Isekai',
    sort: ['TRENDING_DESC'],
  });
  const gql = await requestQuery(call);
  expect(gql).toMatch(/\$tag:\s*String/);
  expect(gql).toMatch(/tag:\s*\$tag/);
});

mcpTest('getRankings sends no tag for an absent or empty tag', async ({ fetchMock }) => {
  fetchMock.route({
    method: 'POST',
    match: 'https://graphql.anilist.co/',
    respond: Response.json(emptyPage),
  });

  await getRankings({ mediaType: 'ANIME', mode: 'top' });
  await getRankings({ mediaType: 'MANGA', mode: 'top', tag: '' });

  for (const call of fetchMock.calls) {
    await expect(requestVariables(call.request)).resolves.not.toHaveProperty('tag');
  }
});

const pageDepthRefusal = () =>
  new Response(
    JSON.stringify({
      errors: [
        {
          message: 'Page depth exceeds maximum allowed for API requests (5000 entries)',
          status: 400,
          locations: [{ line: 2, column: 3 }],
        },
      ],
      data: { Page: null },
    }),
    { status: 400, headers: { 'Content-Type': 'application/json' } },
  );

mcpTest(
  'a page-depth refusal throws a typed ValidationError without retrying',
  async ({ fetchMock }) => {
    fetchMock.route({
      method: 'POST',
      match: 'https://graphql.anilist.co/',
      respond: pageDepthRefusal,
    });

    await expect(
      searchMedia({ mediaType: 'ANIME', genre: 'Action', page: 150, perPage: 50 }),
    ).rejects.toMatchObject({
      code: JsonRpcErrorCode.ValidationError,
      data: { reason: PAGE_DEPTH_REASON, recovery: { hint: PAGE_DEPTH_RECOVERY } },
    });
    await expect(getRankings({ mediaType: 'ANIME', mode: 'top', page: 101 })).rejects.toMatchObject(
      { data: { reason: PAGE_DEPTH_REASON } },
    );
    await expect(
      getSeasonSchedule({ season: 'FALL', seasonYear: 2024, page: 250 }),
    ).rejects.toMatchObject({ data: { reason: PAGE_DEPTH_REASON } });
    expect(fetchMock.calls).toHaveLength(3);
  },
);

mcpTest('other AniList 400s keep their InvalidParams classification', async ({ fetchMock }) => {
  fetchMock.route({
    method: 'POST',
    match: 'https://graphql.anilist.co/',
    respond: () =>
      new Response(
        JSON.stringify({
          errors: [{ message: 'Variable "$page" got invalid value "x".', status: 400 }],
          data: null,
        }),
        { status: 400, headers: { 'Content-Type': 'application/json' } },
      ),
  });

  const error = await searchMedia({ mediaType: 'ANIME', query: 'x' }).catch((e: unknown) => e);

  expect(error).toBeInstanceOf(McpError);
  expect(error).toMatchObject({
    code: JsonRpcErrorCode.InvalidParams,
    message: expect.stringContaining('Status: 400'),
  });
  expect((error as McpError).data?.reason).toBeUndefined();
});
