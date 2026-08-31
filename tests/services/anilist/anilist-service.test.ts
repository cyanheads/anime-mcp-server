/**
 * @fileoverview Tests for the AniList GraphQL service boundary.
 * @module tests/services/anilist/anilist-service.test
 */

import { mcpTest } from '@cyanheads/mcp-ts-core/testing/vitest';
import { expect } from 'vitest';
import {
  getMediaById,
  getMediaByMalIds,
  getMediaCharacters,
  getUpcomingEpisodes,
  searchCharacter,
  searchStaff,
} from '@/services/anilist/anilist-service.js';

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

  const result = await getMediaByMalIds([1, 2, 2], 'ANIME');

  expect([...result.keys()]).toEqual([1, 2]);
  expect(fetchMock.calls).toHaveLength(1);
  await expect(requestVariables(fetchMock.calls[0]!.request)).resolves.toMatchObject({
    idMalIn: [1, 2],
    type: 'ANIME',
  });
});
