/**
 * @fileoverview Entity normalization through real services and both MCP result surfaces.
 * @module tests/description-contract.test
 */
import { runToolContract } from '@cyanheads/mcp-ts-core/testing';
import { mcpTest } from '@cyanheads/mcp-ts-core/testing/vitest';
import { expect } from 'vitest';
import { animeFindCharacters } from '@/mcp-server/tools/definitions/anime-find-characters.tool.js';
import { animeGetMedia } from '@/mcp-server/tools/definitions/anime-get-media.tool.js';

mcpTest('media synopsis decodes once on both result surfaces', async ({ fetchMock }) => {
  fetchMock.route({
    match: /graphql\.anilist\.co/,
    respond: Response.json({
      data: {
        Media: {
          id: 1,
          idMal: null,
          type: 'ANIME',
          title: { romaji: 'Example', english: null, native: null },
          isAdult: false,
          description: '&amp;lt;b&amp;gt;',
        },
      },
    }),
  });
  const result = await runToolContract(animeGetMedia, { id: 1 });
  expect(result.isError).not.toBe(true);
  expect(result.structuredContent).toMatchObject({ description: '&lt;b&gt;' });
  expect(result.content).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ type: 'text', text: expect.stringContaining('&lt;b&gt;') }),
    ]),
  );
});

mcpTest('staff biography decodes once on both result surfaces', async ({ fetchMock }) => {
  fetchMock.route({
    match: /graphql\.anilist\.co/,
    respond: Response.json({
      data: {
        Staff: {
          id: 1,
          name: { full: 'Example', native: null },
          description: '&amp;quot;bio&amp;quot;',
          characterMedia: { pageInfo: { hasNextPage: false }, edges: [] },
        },
      },
    }),
  });
  const result = await runToolContract(animeFindCharacters, { voice_actor_name: 'Example' });
  expect(result.isError).not.toBe(true);
  expect(result.structuredContent).toMatchObject({
    voice_actor: { description: '&quot;bio&quot;' },
  });
  expect(result.content).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ type: 'text', text: expect.stringContaining('&quot;bio&quot;') }),
    ]),
  );
});
