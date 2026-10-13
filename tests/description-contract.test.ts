/**
 * @fileoverview Entity normalization through real services and both MCP result surfaces.
 * @module tests/description-contract.test
 */
import { runToolContract } from '@cyanheads/mcp-ts-core/testing';
import { mcpTest } from '@cyanheads/mcp-ts-core/testing/vitest';
import { expect } from 'vitest';
import { animeFindCharacters } from '@/mcp-server/tools/definitions/anime-find-characters.tool.js';
import { animeGetMedia } from '@/mcp-server/tools/definitions/anime-get-media.tool.js';

mcpTest(
  'media full_text retrieves every same-page value while the default discloses cuts',
  async ({ fetchMock }) => {
    const description = `${'*_[x](https://example.com)'.repeat(30)}\r\n\`\`\`json\n<instruction>`;
    fetchMock.route({
      match: /graphql\.anilist\.co/,
      respond: Response.json({
        data: {
          Media: {
            id: 1,
            idMal: null,
            type: 'ANIME',
            title: { romaji: '*_[hostile]', english: null, native: null },
            isAdult: false,
            description,
            tags: Array.from({ length: 12 }, (_, id) => ({
              id,
              name: `tag ${id}`,
              category: null,
              rank: id,
              isGeneralSpoiler: false,
              isAdult: false,
            })),
            relations: {
              edges: Array.from({ length: 12 }, (_, id) => ({
                relationType: 'SEQUEL',
                node: { id: id + 2, title: { romaji: `relation ${id}` }, type: 'ANIME' },
              })),
            },
          },
        },
      }),
    });
    const summary = await runToolContract(animeGetMedia, { id: 1 });
    const full = await runToolContract(animeGetMedia, { id: 1, full_text: true });
    expect(summary.isError).toBeFalsy();
    expect(full.isError).toBeFalsy();
    expect(full.structuredContent).toMatchObject({ full_text: true, tags: expect.any(Array) });
    const text = (full.content[0] as { text: string }).text;
    expect(text.startsWith('```json\n')).toBe(true);
    expect(JSON.parse(text.slice(8, -4))).toEqual(full.structuredContent);
    expect(text.match(/```/g)).toHaveLength(2);
    const bounded = (summary.content[0] as { text: string }).text;
    expect(bounded).toContain('7 tag details omitted');
    expect(bounded).toContain('7 relation details omitted');
    expect(bounded).toContain('full_text: true');
    expect(bounded).not.toContain('## *_[hostile]');
  },
);

mcpTest(
  'staff full_text retrieves all 25 roles and the normalized biography',
  async ({ fetchMock }) => {
    fetchMock.route({
      match: /graphql\.anilist\.co/,
      respond: Response.json({
        data: {
          Staff: {
            id: 1,
            name: { full: '*Staff*', native: null },
            description: 'long bio '.repeat(100),
            characterMedia: {
              pageInfo: { hasNextPage: true },
              edges: Array.from({ length: 25 }, (_, id) => ({
                node: { id: id + 1, title: { romaji: `Title ${id}` }, format: null },
                characterRole: 'MAIN',
                characters: [{ name: { full: `Character ${id}` } }],
              })),
            },
          },
        },
      }),
    });
    const summary = await runToolContract(animeFindCharacters, { voice_actor_name: 'Staff' });
    const full = await runToolContract(animeFindCharacters, {
      voice_actor_name: 'Staff',
      full_text: true,
    });
    expect(summary.isError).toBeFalsy();
    expect(full.isError).toBeFalsy();
    expect(JSON.stringify(summary.content)).toContain('5 roles omitted');
    const text = (full.content[0] as { text: string }).text;
    expect(JSON.parse(text.slice(8, -4))).toEqual(full.structuredContent);
    expect(full.structuredContent).toMatchObject({
      full_text: true,
      voice_actor: {
        roles: expect.arrayContaining([
          {
            media_id: 25,
            media_title: 'Title 24',
            media_format: null,
            character_role: 'MAIN',
            character_name: 'Character 24',
          },
        ]),
      },
    });
  },
);

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
      expect.objectContaining({ type: 'text', text: expect.stringContaining('&#38;lt;b&#38;gt;') }),
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
      expect.objectContaining({
        type: 'text',
        text: expect.stringContaining('&#38;quot;bio&#38;quot;'),
      }),
    ]),
  );
});
