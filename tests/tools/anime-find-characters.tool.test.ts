/**
 * @fileoverview Tests for anime_find_characters tool.
 * @module tests/tools/anime-find-characters.tool.test
 */

import { createMockContext } from '@cyanheads/mcp-ts-core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { animeFindCharacters } from '@/mcp-server/tools/definitions/anime-find-characters.tool.js';

vi.mock('@/services/anilist/anilist-service.js');

import * as anilist from '@/services/anilist/anilist-service.js';

const mockCharacterEdges = {
  characters: [
    {
      node: {
        id: 40882,
        name: { full: 'Okabe Rintarou', native: '岡部倫太郎' },
        image: { large: 'https://example.com/okabe.jpg', medium: null },
        description: null,
        siteUrl: 'https://anilist.co/character/40882',
      },
      role: 'MAIN' as const,
      voiceActors: [
        {
          id: 95061,
          name: { full: 'Mamoru Miyano', native: '宮野真守' },
          language: 'JAPANESE' as const,
          image: { large: 'https://example.com/miyano.jpg', medium: null },
          siteUrl: 'https://anilist.co/staff/95061',
        },
      ],
    },
  ],
  hasNextPage: false,
};

const mockMediaNode = {
  id: 11757,
  idMal: 9253,
  type: 'ANIME' as const,
  format: 'TV',
  status: 'FINISHED',
  season: null,
  seasonYear: null,
  episodes: 25,
  chapters: null,
  volumes: null,
  meanScore: 90,
  isAdult: false,
  title: { romaji: 'Steins;Gate', english: 'Steins;Gate', native: null },
  coverImage: null,
};

const mockCharacterWithMedia = {
  id: 40882,
  name: { full: 'Okabe Rintarou', native: '岡部倫太郎' },
  image: { large: 'https://example.com/okabe.jpg', medium: null },
  description: null,
  siteUrl: 'https://anilist.co/character/40882',
  media: {
    pageInfo: { hasNextPage: false, currentPage: 1 },
    nodes: [mockMediaNode],
    edges: [
      {
        characterRole: 'MAIN' as const,
        voiceActors: [
          {
            id: 95061,
            name: { full: 'Mamoru Miyano', native: '宮野真守' },
            language: 'JAPANESE' as const,
            image: { large: 'https://example.com/miyano.jpg', medium: null },
            siteUrl: 'https://anilist.co/staff/95061',
          },
        ],
      },
    ],
  },
};

const mockStaffWithRoles = {
  id: 95061,
  name: { full: 'Mamoru Miyano', native: '宮野真守' },
  language: 'JAPANESE' as const,
  image: { large: 'https://example.com/miyano.jpg', medium: null },
  description: null,
  siteUrl: 'https://anilist.co/staff/95061',
  characterMedia: {
    pageInfo: { hasNextPage: false, currentPage: 1 },
    edges: [
      {
        characterRole: 'MAIN' as const,
        node: {
          id: 11757,
          idMal: 9253,
          type: 'ANIME' as const,
          format: 'TV',
          status: 'FINISHED',
          season: null,
          seasonYear: null,
          episodes: 25,
          chapters: null,
          volumes: null,
          meanScore: 90,
          isAdult: false,
          title: { romaji: 'Steins;Gate', english: 'Steins;Gate', native: null },
          coverImage: null,
        },
        characters: [{ id: 40882, name: { full: 'Okabe Rintarou', native: null } }],
      },
    ],
  },
};

describe('animeFindCharacters', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('returns characters in by_media mode when id is provided', async () => {
    vi.mocked(anilist.getMediaCharacters).mockResolvedValue(mockCharacterEdges);
    const ctx = createMockContext({ errors: animeFindCharacters.errors });
    const input = animeFindCharacters.input.parse({ id: 11757 });

    const result = await animeFindCharacters.handler(input, ctx);

    expect(result.mode).toBe('by_media');
    expect(result.media_id).toBe(11757);
    expect(result.characters).toHaveLength(1);
    expect(result.characters[0]!.character_name).toBe('Okabe Rintarou');
    expect(result.characters[0]!.voice_actors).toHaveLength(1);
    expect(result.voice_actor).toBeNull();
  });

  it('returns character info in by_character mode when character_name is provided', async () => {
    vi.mocked(anilist.searchCharacter).mockResolvedValue(mockCharacterWithMedia);
    const ctx = createMockContext({ errors: animeFindCharacters.errors });
    const input = animeFindCharacters.input.parse({ character_name: 'Okabe' });

    const result = await animeFindCharacters.handler(input, ctx);

    expect(result.mode).toBe('by_character');
    expect(result.characters[0]!.character_id).toBe(40882);
    expect(vi.mocked(anilist.searchCharacter)).toHaveBeenCalledWith('Okabe');
  });

  it('by_character mode maps media appearances with VAs from edges', async () => {
    vi.mocked(anilist.searchCharacter).mockResolvedValue(mockCharacterWithMedia);
    const ctx = createMockContext({ errors: animeFindCharacters.errors });
    const input = animeFindCharacters.input.parse({ character_name: 'Okabe' });

    const result = await animeFindCharacters.handler(input, ctx);

    // One appearance per media node
    expect(result.characters).toHaveLength(1);
    expect(result.characters[0]!.role).toBe('MAIN');
    // VAs from corresponding edge
    expect(result.characters[0]!.voice_actors).toHaveLength(1);
    expect(result.characters[0]!.voice_actors[0]!.va_name).toBe('Mamoru Miyano');
  });

  it('returns VA detail in by_voice_actor mode when voice_actor_name is provided', async () => {
    vi.mocked(anilist.searchStaff).mockResolvedValue(mockStaffWithRoles);
    const ctx = createMockContext({ errors: animeFindCharacters.errors });
    const input = animeFindCharacters.input.parse({ voice_actor_name: 'Miyano' });

    const result = await animeFindCharacters.handler(input, ctx);

    expect(result.mode).toBe('by_voice_actor');
    expect(result.voice_actor).not.toBeNull();
    expect(result.voice_actor!.va_id).toBe(95061);
    expect(result.voice_actor!.roles).toHaveLength(1);
    expect(result.characters).toHaveLength(0);
  });

  it('throws ctx.fail("missing_identifier") when no identifier is provided', async () => {
    const ctx = createMockContext({ errors: animeFindCharacters.errors });
    const input = animeFindCharacters.input.parse({ page: 1 });

    await expect(animeFindCharacters.handler(input, ctx)).rejects.toMatchObject({
      data: { reason: 'missing_identifier' },
    });
  });

  it('throws ctx.fail("not_found") when character name search returns null', async () => {
    vi.mocked(anilist.searchCharacter).mockResolvedValue(null);
    const ctx = createMockContext({ errors: animeFindCharacters.errors });
    const input = animeFindCharacters.input.parse({ character_name: 'NonExistentCharacter12345' });

    await expect(animeFindCharacters.handler(input, ctx)).rejects.toMatchObject({
      data: { reason: 'not_found' },
    });
  });

  it('throws ctx.fail("not_found") when VA name search returns null', async () => {
    vi.mocked(anilist.searchStaff).mockResolvedValue(null);
    const ctx = createMockContext({ errors: animeFindCharacters.errors });
    const input = animeFindCharacters.input.parse({ voice_actor_name: 'NonExistentVA12345' });

    await expect(animeFindCharacters.handler(input, ctx)).rejects.toMatchObject({
      data: { reason: 'not_found' },
    });
  });

  it('id takes priority over character_name and voice_actor_name', async () => {
    vi.mocked(anilist.getMediaCharacters).mockResolvedValue(mockCharacterEdges);
    const ctx = createMockContext({ errors: animeFindCharacters.errors });
    const input = animeFindCharacters.input.parse({
      id: 11757,
      character_name: 'Okabe',
      voice_actor_name: 'Miyano',
    });

    const result = await animeFindCharacters.handler(input, ctx);

    expect(result.mode).toBe('by_media');
    expect(vi.mocked(anilist.searchCharacter)).not.toHaveBeenCalled();
    expect(vi.mocked(anilist.searchStaff)).not.toHaveBeenCalled();
  });

  it('formats by_media output with character names and VA info', async () => {
    vi.mocked(anilist.getMediaCharacters).mockResolvedValue(mockCharacterEdges);
    const ctx = createMockContext({ errors: animeFindCharacters.errors });
    const input = animeFindCharacters.input.parse({ id: 11757 });
    const result = await animeFindCharacters.handler(input, ctx);

    const blocks = animeFindCharacters.format!(result);
    const text = blocks[0]!.text as string;
    expect(text).toContain('Okabe Rintarou');
    expect(text).toContain('MAIN');
    expect(text).toContain('Mamoru Miyano');
  });

  it('formats by_voice_actor output with VA name and roles', async () => {
    vi.mocked(anilist.searchStaff).mockResolvedValue(mockStaffWithRoles);
    const ctx = createMockContext({ errors: animeFindCharacters.errors });
    const input = animeFindCharacters.input.parse({ voice_actor_name: 'Miyano' });
    const result = await animeFindCharacters.handler(input, ctx);

    const blocks = animeFindCharacters.format!(result);
    const text = blocks[0]!.text as string;
    expect(text).toContain('Mamoru Miyano');
    expect(text).toContain('Steins;Gate');
    expect(text).toContain('AL:11757');
  });
});
