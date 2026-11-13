/** @fileoverview Optional upstream failures preserve completed primary results. */
import { runToolContract } from '@cyanheads/mcp-ts-core/testing';
import { mcpTest } from '@cyanheads/mcp-ts-core/testing/vitest';
import { expect } from 'vitest';
import { animeFindCharacters } from '@/mcp-server/tools/definitions/anime-find-characters.tool.js';
import { animeGetMedia } from '@/mcp-server/tools/definitions/anime-get-media.tool.js';
import { animeGetRecommendations } from '@/mcp-server/tools/definitions/anime-get-recommendations.tool.js';
import { animeSearchMedia } from '@/mcp-server/tools/definitions/anime-search-media.tool.js';

const anilist = 'https://graphql.anilist.co/';
const jikan = /api\.jikan\.moe/;
const media = {
  id: 1,
  idMal: 1,
  type: 'ANIME',
  isAdult: false,
  description: null,
  title: { romaji: 'Fixture title', english: null, native: null },
};
const pageInfo = { currentPage: 1, perPage: 20, hasNextPage: false };

for (const failure of [422, 404, 403, 429, 503, 'malformed'] as const)
  mcpTest(
    `retains AniList recommendations when the optional Jikan response is ${failure}`,
    async ({ fetchMock }) => {
      fetchMock.route(
        {
          match: anilist,
          respond: async (request) => {
            const { query } = (await request.json()) as { query: string };
            const recommendations = {
              pageInfo,
              nodes: [{ rating: 12, mediaRecommendation: media }],
            };
            return Response.json({
              data: { Media: query.includes('GetRecommendations') ? { recommendations } : media },
            });
          },
        },
        {
          match: jikan,
          respond: () =>
            failure === 'malformed'
              ? Response.json({ data: [{}] })
              : new Response('Jikan upstream error', { status: failure }),
        },
      );
      const result = await runToolContract(animeGetRecommendations, { id: 1 });
      expect(result.structuredContent).toMatchObject({
        jikan_status: 'unavailable',
        recommendations: [{ id: 1, anilist_rating: 12 }],
      });
      expect(JSON.stringify(result.content)).toContain('jikan_status: unavailable');
    },
  );

for (const body of ['null', '{'])
  mcpTest(
    `preserves primary person and empty search results when an advisory body is ${body}`,
    async ({ fetchMock }) => {
      fetchMock.route({
        match: anilist,
        respond: async (request) => {
          const { query } = (await request.json()) as { query: string };
          if (query.includes('PersonSuggestions') || query.includes('MediaFilterCatalog')) {
            return new Response(body);
          }
          if (query.includes('Character(')) {
            return Response.json({
              data: {
                Character: {
                  id: 145,
                  name: { full: 'Sakura', native: null },
                  description: null,
                  media: { pageInfo, edges: [] },
                },
              },
            });
          }
          return Response.json({ data: { Page: { pageInfo, media: [] } } });
        },
      });
      const person = await runToolContract(animeFindCharacters, { character_name: 'Sakura' });
      const search = await runToolContract(animeSearchMedia, {
        media_type: 'ANIME',
        genre: 'Seinen',
      });
      expect(person.structuredContent).toMatchObject({
        other_matches_status: 'unavailable',
        characters: [{ character_id: 145 }],
      });
      expect(JSON.stringify(person.content)).toContain('other_matches_status: unavailable');
      expect(search.structuredContent).toMatchObject({ total_results: 0, results: [] });
      expect(JSON.stringify(search.content)).toContain('No results found');
    },
  );

mcpTest(
  'retains the AniList empty page when a resolved Jikan row lacks a title',
  async ({ fetchMock }) => {
    fetchMock.route(
      {
        match: anilist,
        respond: async (request) => {
          const { query } = (await request.json()) as { query: string };
          return Response.json({
            data: { Page: { pageInfo, media: query.includes('GetMediaByMalIds') ? [media] : [] } },
          });
        },
      },
      { match: jikan, respond: Response.json({ data: [{ mal_id: 1 }] }) },
    );
    const result = await runToolContract(animeSearchMedia, {
      media_type: 'ANIME',
      query: 'Fixture',
    });
    expect(result.structuredContent).toMatchObject({ source: 'anilist', results: [] });
    expect(JSON.stringify(result.content)).toContain('fallback search was unavailable');
  },
);

mcpTest(
  'retains AniList media when the Kitsu streaming URL is malformed',
  async ({ fetchMock }) => {
    fetchMock.route(
      { match: anilist, respond: Response.json({ data: { Media: media } }) },
      { match: jikan, respond: Response.json({ data: null }) },
      {
        match: /kitsu\.io.*\/mappings/,
        respond: Response.json({
          data: [{ relationships: { item: { data: { id: '42', type: 'anime' } } } }],
        }),
      },
      {
        match: /kitsu\.io.*\/anime\/42/,
        respond: Response.json({
          included: [{ type: 'streamingLinks', attributes: { url: null } }],
        }),
      },
    );
    const result = await runToolContract(animeGetMedia, { id: 1 });
    expect(result.structuredContent).toMatchObject({ id: 1, streaming_links: [] });
    expect(JSON.stringify(result.content)).toContain('Kitsu streaming data is unavailable');
  },
);
