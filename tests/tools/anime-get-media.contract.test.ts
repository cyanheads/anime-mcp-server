/**
 * @fileoverview Wire contracts for the media tool and compact resource.
 */
import { runToolContract } from '@cyanheads/mcp-ts-core/testing';
import { mcpTest } from '@cyanheads/mcp-ts-core/testing/vitest';
import { expect } from 'vitest';
import { animeGetMedia } from '@/mcp-server/tools/definitions/anime-get-media.tool.js';
import { requestMediaResource } from '../helpers/request-media-resource.js';

const anilist = 'https://graphql.anilist.co/';
const jikan = /api\.jikan\.moe/;
const kitsu = /kitsu\.io/;
const media = {
  id: 154587,
  idMal: 52991,
  type: 'ANIME',
  isAdult: false,
  description: null,
  title: { romaji: 'Fixture', english: null, native: null },
  externalLinks: [
    {
      url: 'https://example.com/watch',
      site: 'Fixture platform',
      type: 'STREAMING',
      isDisabled: false,
      language: 'English',
    },
  ],
};

async function readMediaResource(id: number) {
  const uri = `anime://media/${id}`;
  const payload = await requestMediaResource(uri);
  expect(payload).toMatchObject({
    result: { contents: [{ uri, mimeType: 'application/json', text: expect.any(String) }] },
  });
  const { result } = payload as { result: { contents: [{ text: string }] } };
  return JSON.parse(result.contents[0].text);
}

mcpTest(
  'preserves AniList data and reports failed supplements in the media tool',
  async ({ fetchMock }) => {
    fetchMock.route(
      { match: anilist, respond: Response.json({ data: { Media: media } }) },
      { match: jikan, respond: () => new Response(null, { status: 503 }) },
      { match: kitsu, respond: () => new Response(null, { status: 503 }) },
    );
    const result = await runToolContract(animeGetMedia, { id: media.id });
    expect(result.structuredContent).toMatchObject({
      data_sources: { anilist: true, mal: false, kitsu: false },
      scores: { mal_score: null },
      streaming_links: [{ url: 'https://example.com/watch', source: 'anilist' }],
    });
    expect(JSON.stringify(result.content)).toContain(
      'Jikan MAL data is unavailable. Kitsu streaming data is unavailable.',
    );
    expect(await readMediaResource(media.id)).toMatchObject({
      mal_score: null,
      streaming_count: 1,
      data_sources: { anilist: true, mal: false, kitsu: false },
      notice: 'Jikan MAL data is unavailable. Kitsu streaming data is unavailable.',
    });
  },
);

mcpTest('reports only the rejected supplement in compact JSON', async ({ fetchMock }) => {
  fetchMock.route(
    { match: anilist, respond: Response.json({ data: { Media: media } }) },
    { match: jikan, respond: Response.json({ data: null }) },
    { match: /kitsu\.io.*\/mappings/, respond: () => new Response(null, { status: 503 }) },
  );
  expect(await readMediaResource(media.id)).toMatchObject({
    mal_score: null,
    streaming_count: 1,
    data_sources: { anilist: true, mal: false, kitsu: false },
    notice: 'Kitsu streaming data is unavailable.',
  });
});

mcpTest('handles null MAL score and mapped Kitsu record with no links', async ({ fetchMock }) => {
  fetchMock.route(
    { match: anilist, respond: Response.json({ data: { Media: media } }) },
    {
      match: jikan,
      respond: Response.json({ data: { mal_id: 52991, title: 'Fixture', score: null } }),
    },
    {
      match: /kitsu\.io.*\/mappings/,
      respond: Response.json({
        data: [{ relationships: { item: { data: { id: '42', type: 'anime' } } } }],
      }),
    },
    { match: /kitsu\.io.*\/anime\/42/, respond: Response.json({ included: [] }) },
  );
  const result = await readMediaResource(media.id);
  expect(result).toMatchObject({
    mal_score: null,
    streaming_count: 1,
    data_sources: { anilist: true, mal: true, kitsu: true },
  });
  expect(result).not.toHaveProperty('notice');
});

mcpTest(
  'returns distinct manga reading destinations and languages through both MCP surfaces',
  async ({ fetchMock }) => {
    const link = {
      ...media.externalLinks[0]!,
      site: 'MANGA Plus',
      url: 'https://example.com/english',
    };
    fetchMock.route({
      match: anilist,
      respond: Response.json({
        data: {
          Media: {
            ...media,
            id: 105778,
            idMal: null,
            type: 'MANGA',
            externalLinks: [
              { ...link, isDisabled: true },
              { ...link, type: 'INFO' },
              { ...link, url: null },
              { ...link, url: 'ftp://example.com/english' },
              link,
              { ...link, url: 'https://www.example.com/duplicate' },
              { ...link, url: 'https://example.com/spanish', language: 'Spanish' },
              { ...link, url: 'https://example.com/unknown', language: null },
            ],
          },
        },
      }),
    });
    const links = [
      {
        site: 'MANGA Plus',
        url: 'https://example.com/english',
        language: 'English',
        subs: [],
        dubs: [],
        source: 'anilist',
      },
      {
        site: 'MANGA Plus',
        url: 'https://example.com/spanish',
        language: 'Spanish',
        subs: [],
        dubs: [],
        source: 'anilist',
      },
      {
        site: 'MANGA Plus',
        url: 'https://example.com/unknown',
        language: null,
        subs: [],
        dubs: [],
        source: 'anilist',
      },
    ];
    const summary = await runToolContract(animeGetMedia, { id: 105778 });
    expect(summary.structuredContent).toMatchObject({ streaming_links: links });
    const text = JSON.stringify(summary.content);
    expect(text).toContain('**Reading:**');
    for (const link of links) {
      expect(text).toContain(link.url);
      expect(text).toContain(`language:${link.language}`);
    }

    const full = await runToolContract(animeGetMedia, { id: 105778, full_text: true });
    expect(full.structuredContent).toMatchObject({ streaming_links: links });
    const fullText = full.content[0];
    expect(fullText?.type).toBe('text');
    if (fullText?.type !== 'text') throw new Error('Expected full media JSON text');
    expect(JSON.parse(fullText.text.slice(8, -4))).toEqual(full.structuredContent);

    const resource = await readMediaResource(105778);
    expect(resource).toMatchObject({
      streaming_count: 3,
      data_sources: { anilist: true, mal: false, kitsu: false },
    });
    expect(resource).not.toHaveProperty('notice');
  },
);
