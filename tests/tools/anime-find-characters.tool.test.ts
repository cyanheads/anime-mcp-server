/**
 * @fileoverview Tests for anime_find_characters tool.
 * @module tests/tools/anime-find-characters.tool.test
 */

import { JsonRpcErrorCode, serviceUnavailable } from '@cyanheads/mcp-ts-core/errors';
import {
  createFetchMock,
  createMockContext,
  runToolContract,
} from '@cyanheads/mcp-ts-core/testing';
import { escapeMarkdownInline as escapeProviderText } from '@cyanheads/mcp-ts-core/utils';
import { assert, beforeEach, describe, expect, it, vi } from 'vitest';
import { animeFindCharacters } from '@/mcp-server/tools/definitions/anime-find-characters.tool.js';
import type {
  CharacterEdge,
  CharacterWithMedia,
  MediaNode,
  StaffWithRoles,
} from '@/services/anilist/types.js';
import { expectLiteralProse, expectMarkdownDestination } from '../helpers/markdown.js';

vi.mock('@/services/anilist/anilist-service.js');

import * as anilist from '@/services/anilist/anilist-service.js';

const mockCharacterEdges: { characters: CharacterEdge[]; hasNextPage: boolean } = {
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

const mockMediaNode: MediaNode = {
  id: 11757,
  idMal: 9253,
  countryOfOrigin: 'JP',
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

const mockCharacterWithMedia: CharacterWithMedia = {
  id: 40882,
  name: { full: 'Okabe Rintarou', native: '岡部倫太郎' },
  image: { large: 'https://example.com/okabe.jpg', medium: null },
  description: null,
  siteUrl: 'https://anilist.co/character/40882',
  media: {
    pageInfo: { hasNextPage: false, currentPage: 1 },
    edges: [
      {
        node: mockMediaNode,
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

const mockStaffWithRoles: StaffWithRoles = {
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
          countryOfOrigin: 'JP',
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
    vi.mocked(anilist.searchCharacterSuggestions).mockResolvedValue({
      matches: [],
      hasNextPage: false,
    });
    vi.mocked(anilist.searchStaffSuggestions).mockResolvedValue({
      matches: [],
      hasNextPage: false,
    });
  });

  it('an omitted cast language keeps every returned dub and its links', async () => {
    const [edge] = mockCharacterEdges.characters;
    assert(edge);
    vi.mocked(anilist.getMediaCharacters).mockResolvedValue({
      hasNextPage: false,
      characters: [
        {
          ...edge,
          voiceActors: [
            ...edge.voiceActors,
            {
              id: 900,
              name: { full: 'English actor', native: null },
              language: 'ENGLISH',
              image: { large: 'https://example.com/english.jpg', medium: null },
              siteUrl: 'https://anilist.co/staff/900',
            },
          ],
        },
      ],
    });
    const result = await runToolContract(animeFindCharacters, { id: 11757 });
    expect(result.structuredContent).toMatchObject({
      characters: [
        {
          voice_actors: [
            { language: 'JAPANESE' },
            {
              language: 'ENGLISH',
              va_image_url: 'https://example.com/english.jpg',
              va_site_url: 'https://anilist.co/staff/900',
            },
          ],
        },
      ],
    });
    expectMarkdownDestination(result.content, 'image', 'https://example.com/english.jpg');
    expectMarkdownDestination(result.content, 'link', 'https://anilist.co/staff/900');
  });

  it('defaults cast pages to ten and preserves the advertised continuation', async () => {
    vi.mocked(anilist.getMediaCharacters).mockResolvedValue({
      ...mockCharacterEdges,
      hasNextPage: true,
    });
    const result = await runToolContract(animeFindCharacters, { id: 11757, page: 2 });
    expect(anilist.getMediaCharacters).toHaveBeenCalledWith(
      expect.objectContaining({ perPage: 10, page: 2 }),
    );
    expect(result.structuredContent).toMatchObject({ cap: 10, has_next_page: true });
    expect(contentText(result)).toContain('page 3');
  });

  it('looks up a character by exact ID and renders their biography once', async () => {
    const description = 'Biography '.repeat(60);
    vi.mocked(anilist.getCharacterById).mockResolvedValue({
      ...mockCharacterWithMedia,
      description,
    });
    const input = { character_id: 40882, page: 2, per_page: 25 };
    const summary = await runToolContract(animeFindCharacters, input);
    expect(summary.structuredContent).toMatchObject({
      mode: 'by_character',
      character_description: description,
      characters: [{ character_id: 40882, media_id: 11757 }],
    });
    expect(contentText(summary)).toContain('100 biography characters omitted');
    expect(contentText(summary).split('description:')).toHaveLength(2);
    const full = await runToolContract(animeFindCharacters, { ...input, full_text: true });
    expect(JSON.parse(contentText(full).slice(8, -4))).toMatchObject({
      character_description: description,
    });
    expect(anilist.getCharacterById).toHaveBeenCalledWith(40882, 2, 25, expect.any(AbortSignal));
    expect(anilist.searchCharacterSuggestions).not.toHaveBeenCalled();
  });

  it('keeps the selected singleton on later pages and presents independent suggestions', async () => {
    const name = { full: 'Other', native: null };
    vi.mocked(anilist.searchCharacter).mockResolvedValue(mockCharacterWithMedia);
    vi.mocked(anilist.searchCharacterSuggestions).mockResolvedValue({
      hasNextPage: true,
      matches: [
        { id: 40882, name, popularMedia: null },
        {
          id: 145,
          name,
          popularMedia: { id: 20, title: { romaji: 'Naruto', english: null, native: null } },
        },
        { id: 2671, name: { full: null, native: 'さくら' }, popularMedia: null },
      ],
    });
    const result = await runToolContract(animeFindCharacters, {
      character_name: 'Sakura',
      page: 5,
      per_page: 5,
    });
    expect(result.structuredContent).toMatchObject({
      has_next_page: false,
      characters: [{ character_id: 40882 }],
      other_matches_has_next_page: true,
      other_matches_status: 'available',
      other_matches: [
        { id: 145, name: 'Other', name_native: null, media_id: 20, media_title: 'Naruto' },
        { id: 2671, name: null, name_native: 'さくら', media_id: null, media_title: null },
      ],
    });
    expect(contentText(result)).toContain('other_matches_has_next_page: true');
    expect(contentText(result)).toContain('id:2671');
    expect(anilist.searchCharacter).toHaveBeenCalledWith('Sakura', 5, 5, expect.any(AbortSignal));
    expect(anilist.searchCharacterSuggestions).toHaveBeenCalledWith(
      'Sakura',
      5,
      expect.any(AbortSignal),
    );
  });

  it('accepts exact staff IDs at the GraphQL bound with a default page size of ten', async () => {
    vi.mocked(anilist.getStaffById).mockResolvedValue({
      ...mockStaffWithRoles,
      id: 2147483647,
      characterMedia: { pageInfo: { hasNextPage: false, currentPage: 99 }, edges: [] },
    });
    const result = await runToolContract(animeFindCharacters, {
      voice_actor_id: 2147483647,
      page: 99,
      character_name: ' ',
    });
    expect(result.structuredContent).toMatchObject({
      mode: 'by_voice_actor',
      voice_actor: { va_id: 2147483647, roles: [] },
    });
    expect(result.structuredContent).not.toHaveProperty('other_matches_status');
    expect(contentText(result)).toContain('va_id:2147483647');
    expect(anilist.getStaffById).toHaveBeenCalledWith(2147483647, 99, 10, expect.any(AbortSignal));
    expect(anilist.searchStaff).not.toHaveBeenCalled();
  });

  it.each(['character_id', 'voice_actor_id'] as const)(
    'reports an unknown exact %s on both surfaces',
    async (key) => {
      vi.mocked(anilist.getCharacterById).mockResolvedValue(null);
      vi.mocked(anilist.getStaffById).mockResolvedValue(null);
      const result = await runToolContract(animeFindCharacters, { [key]: 999 });
      expect(result.structuredContent).toMatchObject({
        error: {
          code: JsonRpcErrorCode.NotFound,
          data: { reason: 'not_found' },
        },
      });
      expect(contentText(result)).toContain('AniList ID 999');
      expect(contentText(result)).toContain('Recovery: Check the AniList character or staff ID');
    },
  );

  it.each([0, 1.5, 2147483648])('rejects invalid exact person IDs %s before lookup', async (id) => {
    for (const input of [{ character_id: id }, { voice_actor_id: id }]) {
      const result = await runToolContract(animeFindCharacters, input);
      expect(result.structuredContent).toMatchObject({
        error: { code: JsonRpcErrorCode.InvalidParams },
      });
    }
    expect(anilist.getCharacterById).not.toHaveBeenCalled();
    expect(anilist.getStaffById).not.toHaveBeenCalled();
  });

  it('keeps a staff match when suggestions are unavailable, preserving role pagination', async () => {
    vi.mocked(anilist.searchStaff).mockResolvedValue({
      ...mockStaffWithRoles,
      characterMedia: {
        ...mockStaffWithRoles.characterMedia,
        pageInfo: { hasNextPage: true, currentPage: 2 },
      },
    });
    vi.mocked(anilist.searchStaffSuggestions).mockRejectedValue(
      serviceUnavailable('provider unavailable'),
    );
    const result = await runToolContract(animeFindCharacters, {
      voice_actor_name: 'Miyano',
      page: 2,
    });
    expect(result.structuredContent).toMatchObject({
      has_next_page: true,
      voice_actor: { va_id: 95061 },
      other_matches_status: 'unavailable',
    });
    expect(result.structuredContent).not.toHaveProperty('other_matches_has_next_page');
    expect(contentText(result)).toContain('other_matches_status: unavailable');
    expect(anilist.searchStaff).toHaveBeenCalledWith('Miyano', 2, 10, expect.any(AbortSignal));
    expect(anilist.searchStaffSuggestions).toHaveBeenCalledWith(
      'Miyano',
      10,
      expect.any(AbortSignal),
    );
  });

  it('reports an empty staff suggestion page separately from staff roles', async () => {
    vi.mocked(anilist.searchStaff).mockResolvedValue(mockStaffWithRoles);
    vi.mocked(anilist.searchStaffSuggestions).mockResolvedValue({
      matches: [],
      hasNextPage: false,
    });
    const result = await runToolContract(animeFindCharacters, { voice_actor_name: 'Miyano' });
    expect(result.structuredContent).toMatchObject({
      other_matches: [],
      other_matches_status: 'available',
      other_matches_has_next_page: false,
      voice_actor: { roles: [{ media_id: 11757 }] },
    });
    expect(contentText(result)).toContain('No other matches on the suggestion page.');
  });

  it('keeps the selected character when the live service parser receives a malformed suggestion page', async () => {
    const actual = await vi.importActual<typeof anilist>('@/services/anilist/anilist-service.js');
    vi.mocked(anilist.searchCharacterSuggestions).mockImplementation(
      actual.searchCharacterSuggestions,
    );
    vi.mocked(anilist.searchCharacter).mockResolvedValue(mockCharacterWithMedia);
    const fetchMock = createFetchMock();
    fetchMock.route({
      match: 'https://graphql.anilist.co/',
      respond: Response.json({
        data: { Page: { pageInfo: { hasNextPage: true }, matches: [{}] } },
      }),
    });
    vi.stubGlobal('fetch', fetchMock.fetch);
    try {
      const result = await runToolContract(animeFindCharacters, { character_name: 'Okabe' });
      expect(result.isError).toBeFalsy();
      expect(result.structuredContent).toMatchObject({
        characters: [{ character_id: 40882 }],
        other_matches_status: 'unavailable',
      });
      expect(contentText(result)).toContain('other_matches_status: unavailable');
      expect(fetchMock.calls).toHaveLength(1);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('propagates caller cancellation during a suggestion lookup', async () => {
    const controller = new AbortController();
    const reason = new DOMException('caller cancelled', 'AbortError');
    vi.mocked(anilist.searchCharacter).mockResolvedValue(mockCharacterWithMedia);
    vi.mocked(anilist.searchCharacterSuggestions).mockImplementation((_name, _perPage, signal) => {
      expect(signal).toBe(controller.signal);
      controller.abort(reason);
      return Promise.reject(reason);
    });
    const ctx = createMockContext({
      errors: animeFindCharacters.errors,
      signal: controller.signal,
    });
    await expect(
      animeFindCharacters.handler(
        animeFindCharacters.input.parse({ character_name: 'Okabe' }),
        ctx,
      ),
    ).rejects.toBe(reason);
  });

  it.each(['by_media', 'by_character', 'by_voice_actor'] as const)(
    'preserves hostile names and destinations in %s',
    async (mode) => {
      const name = '*[name]*\r\n## injected\n<script>';
      const url = 'https://example.com/a_b.jpg?x=1&y=2#image';
      vi.mocked(anilist.getMediaCharacters).mockResolvedValue({
        ...mockCharacterEdges,
        characters: [
          {
            ...mockCharacterEdges.characters[0]!,
            node: {
              ...mockCharacterEdges.characters[0]!.node,
              name: { full: name, native: null },
              image: { large: url, medium: null },
            },
          },
        ],
      });
      vi.mocked(anilist.searchCharacter).mockResolvedValue({
        ...mockCharacterWithMedia,
        name: { full: name, native: null },
        image: { large: url, medium: null },
      });
      vi.mocked(anilist.searchStaff).mockResolvedValue({
        ...mockStaffWithRoles,
        name: { full: name, native: null },
        image: { large: url, medium: null },
      });
      const input =
        mode === 'by_media'
          ? { id: 11757 }
          : mode === 'by_character'
            ? { character_name: 'name' }
            : { voice_actor_name: 'name' };
      const result = await runToolContract(animeFindCharacters, input);
      expect(result.isError).toBeFalsy();
      expect(JSON.stringify(result.structuredContent)).toContain(JSON.stringify(name).slice(1, -1));
      expectLiteralProse(result.content, name);
      expectMarkdownDestination(result.content, 'image', url);
      expect((result.content[0] as { text: string }).text).toContain(
        `![${mode === 'by_voice_actor' ? 'voice actor' : 'character'}](<${url}>)`,
      );
    },
  );

  it('describes an identity-only character as zero appearances and preserves full-text retrieval', async () => {
    vi.mocked(anilist.searchCharacter).mockResolvedValue({
      ...mockCharacterWithMedia,
      media: { pageInfo: { hasNextPage: false, currentPage: 1 }, edges: [] },
    });
    const result = await runToolContract(animeFindCharacters, {
      character_name: 'Okabe',
      language: '',
    });
    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toMatchObject({
      characters: [{ character_id: 40882, voice_actor_data_available: false }],
    });
    expect(JSON.stringify(result.content)).toContain('Appears in 0 title(s)');
    expect(JSON.stringify(result.content)).toContain('full_text: true');
  });

  it.each([false, true])(
    'full_text %s preserves empty cast and capped-page enrichment',
    async (full_text) => {
      for (const characters of [[], mockCharacterEdges.characters]) {
        vi.mocked(anilist.getMediaCharacters).mockResolvedValue({ characters, hasNextPage: true });
        const result = await runToolContract(animeFindCharacters, {
          id: 11757,
          per_page: 1,
          page: 3,
          full_text,
        });
        expect(result.isError).toBeFalsy();
        expect(result.structuredContent).toMatchObject({
          full_text,
          characters: expect.any(Array),
          has_next_page: true,
          truncated: true,
          shown: characters.length,
          cap: 1,
        });
        expect(JSON.stringify(result.content)).toContain('page 4');
        if (full_text) {
          const domain = JSON.parse((result.content[0] as { text: string }).text.slice(8, -4));
          expect(domain).toMatchObject({ full_text: true, has_next_page: true });
          expect(domain).not.toHaveProperty('truncated');
          expect(domain.characters).toHaveLength(characters.length);
        } else {
          expect(JSON.stringify(result.content)).toContain('full_text: true');
        }
        expect(anilist.getMediaCharacters).toHaveBeenLastCalledWith({
          mediaId: 11757,
          language: undefined,
          page: 3,
          perPage: 1,
          signal: expect.any(AbortSignal),
        });
      }
    },
  );

  it('maps reordered edge-owned appearances and distinguishes null actor data from an empty manga list', async () => {
    const manga = { ...mockMediaNode, id: 2, type: 'MANGA' as const, format: 'MANGA' as const };
    vi.mocked(anilist.searchCharacter).mockResolvedValue({
      ...mockCharacterWithMedia,
      media: {
        pageInfo: { hasNextPage: true, currentPage: 2 },
        edges: [
          { node: manga, characterRole: 'SUPPORTING', voiceActors: [] },
          { node: mockMediaNode, characterRole: 'MAIN', voiceActors: null },
        ],
      },
    });
    const result = await runToolContract(animeFindCharacters, {
      character_name: 'Okabe',
      page: 2,
      per_page: 2,
    });
    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toMatchObject({
      has_next_page: true,
      characters: [
        { media_id: 2, role: 'SUPPORTING', voice_actors: [], voice_actor_data_available: true },
        { media_id: 11757, role: 'MAIN', voice_actors: [], voice_actor_data_available: false },
      ],
    });
    expect(JSON.stringify(result.content)).toContain('unavailable');
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

  it('throws media_not_found when the AniList media ID does not exist', async () => {
    vi.mocked(anilist.getMediaCharacters).mockResolvedValue(null);
    const ctx = createMockContext({ errors: animeFindCharacters.errors });
    const input = animeFindCharacters.input.parse({ id: 999_999_999 });

    await expect(animeFindCharacters.handler(input, ctx)).rejects.toMatchObject({
      code: JsonRpcErrorCode.NotFound,
      message: 'No media found with AniList ID 999999999',
      data: {
        reason: 'media_not_found',
        recovery: {
          hint: 'Use anime_search_media to find a valid AniList media ID and retry.',
        },
      },
    });
  });

  it('returns character info in by_character mode when character_name is provided', async () => {
    vi.mocked(anilist.searchCharacter).mockResolvedValue(mockCharacterWithMedia);
    const ctx = createMockContext({ errors: animeFindCharacters.errors });
    const input = animeFindCharacters.input.parse({ character_name: 'Okabe' });

    const result = await animeFindCharacters.handler(input, ctx);

    expect(result.mode).toBe('by_character');
    expect(result.characters[0]!.character_id).toBe(40882);
    expect(vi.mocked(anilist.searchCharacter)).toHaveBeenCalledWith(
      'Okabe',
      1,
      10,
      expect.any(AbortSignal),
    );
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

  it('by_character mode forwards pagination and returns actionable media context', async () => {
    const secondMedia = {
      ...mockMediaNode,
      id: 14247,
      format: 'MOVIE' as const,
      title: { ...mockMediaNode.title, romaji: 'Steins;Gate: The Movie' },
    };
    vi.mocked(anilist.searchCharacter).mockResolvedValue({
      ...mockCharacterWithMedia,
      media: {
        pageInfo: { hasNextPage: false, currentPage: 2 },
        edges: [{ node: secondMedia, characterRole: 'MAIN', voiceActors: [] }],
      },
    });
    const ctx = createMockContext({ errors: animeFindCharacters.errors });
    const input = animeFindCharacters.input.parse({
      character_name: 'Okabe',
      page: 2,
      per_page: 1,
    });

    const result = await animeFindCharacters.handler(input, ctx);

    expect(anilist.searchCharacter).toHaveBeenCalledWith('Okabe', 2, 1, expect.any(AbortSignal));
    expect(result.characters).toEqual([
      expect.objectContaining({
        media_id: 14247,
        media_title: 'Steins;Gate: The Movie',
        media_format: 'MOVIE',
        role: 'MAIN',
      }),
    ]);
    const text = (animeFindCharacters.format!(result)[0] as { text: string }).text;
    expect(text).toContain('Steins;Gate: The Movie');
    expect(text).toContain('AL:14247');
    expect(text).toContain('MOVIE');
    expect(text).toContain('MAIN');
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

  it('caps the rendered voice-actor description without truncating structured output', async () => {
    const description = `First paragraph.\n\n${'x'.repeat(550)}`;
    vi.mocked(anilist.searchStaff).mockResolvedValue({ ...mockStaffWithRoles, description });
    const ctx = createMockContext({ errors: animeFindCharacters.errors });
    const input = animeFindCharacters.input.parse({ voice_actor_name: 'Miyano' });

    const result = await animeFindCharacters.handler(input, ctx);
    const text = (animeFindCharacters.format!(result)[0] as { text: string }).text;

    expect(result.voice_actor?.description).toBe(description);
    expect(text).toContain(`description:${escapeProviderText(description.slice(0, 500))}…`);
    expect(text).not.toContain(description);
  });

  it('throws ctx.fail("missing_identifier") when no identifier is provided', async () => {
    const ctx = createMockContext({ errors: animeFindCharacters.errors });
    const input = animeFindCharacters.input.parse({ page: 1 });

    await expect(animeFindCharacters.handler(input, ctx)).rejects.toMatchObject({
      code: JsonRpcErrorCode.ValidationError,
      message:
        'Provide one of id, character_id, character_name, voice_actor_id, or voice_actor_name',
      data: { reason: 'missing_identifier' },
    });
  });

  it('throws ctx.fail("not_found") when character name search returns null', async () => {
    vi.mocked(anilist.searchCharacter).mockResolvedValue(null);
    const ctx = createMockContext({ errors: animeFindCharacters.errors });
    const input = animeFindCharacters.input.parse({ character_name: 'NonExistentCharacter12345' });

    await expect(animeFindCharacters.handler(input, ctx)).rejects.toMatchObject({
      code: JsonRpcErrorCode.NotFound,
      message: 'No character found matching "NonExistentCharacter12345"',
      data: { reason: 'not_found' },
    });
  });

  it('throws ctx.fail("not_found") when VA name search returns null', async () => {
    vi.mocked(anilist.searchStaff).mockResolvedValue(null);
    const ctx = createMockContext({ errors: animeFindCharacters.errors });
    const input = animeFindCharacters.input.parse({ voice_actor_name: 'NonExistentVA12345' });

    await expect(animeFindCharacters.handler(input, ctx)).rejects.toMatchObject({
      code: JsonRpcErrorCode.NotFound,
      message: 'No voice actor/staff found matching "NonExistentVA12345"',
      data: { reason: 'not_found' },
    });
  });

  it('rejects id together with both names instead of letting id take priority', async () => {
    const ctx = createMockContext({ errors: animeFindCharacters.errors });
    const input = animeFindCharacters.input.parse({
      id: 11757,
      character_name: 'Okabe',
      voice_actor_name: 'Miyano',
    });

    await expect(animeFindCharacters.handler(input, ctx)).rejects.toMatchObject({
      code: JsonRpcErrorCode.ValidationError,
      message: expect.stringContaining('id, character_name, voice_actor_name'),
      data: { reason: 'conflicting_inputs' },
    });
    expect(vi.mocked(anilist.getMediaCharacters)).not.toHaveBeenCalled();
    expect(vi.mocked(anilist.searchCharacter)).not.toHaveBeenCalled();
    expect(vi.mocked(anilist.searchStaff)).not.toHaveBeenCalled();
  });

  it('formats by_media output with character names and VA info', async () => {
    vi.mocked(anilist.getMediaCharacters).mockResolvedValue(mockCharacterEdges);
    const ctx = createMockContext({ errors: animeFindCharacters.errors });
    const input = animeFindCharacters.input.parse({ id: 11757 });
    const result = await animeFindCharacters.handler(input, ctx);

    const blocks = animeFindCharacters.format!(result);
    const text = (blocks[0] as { text: string }).text;
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
    const text = (blocks[0] as { text: string }).text;
    expect(text).toContain('Mamoru Miyano');
    expect(text).toContain('Steins;Gate');
    expect(text).toContain('AL:11757');
  });
});

describe('animeFindCharacters tool contract', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(anilist.searchCharacterSuggestions).mockResolvedValue({
      matches: [],
      hasNextPage: false,
    });
    vi.mocked(anilist.searchStaffSuggestions).mockResolvedValue({
      matches: [],
      hasNextPage: false,
    });
  });

  it('resolves structuredContent in by_media mode', async () => {
    vi.mocked(anilist.getMediaCharacters).mockResolvedValue(mockCharacterEdges);

    const result = await runToolContract(animeFindCharacters, { id: 11757 });

    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toMatchObject({ mode: 'by_media', media_id: 11757 });
  });

  it('resolves structuredContent in by_character mode', async () => {
    vi.mocked(anilist.searchCharacter).mockResolvedValue(mockCharacterWithMedia);

    const result = await runToolContract(animeFindCharacters, { character_name: 'Okabe' });

    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toMatchObject({ mode: 'by_character', media_id: null });
    expect(result.structuredContent).not.toHaveProperty('truncated');
    expect(result.structuredContent).not.toHaveProperty('shown');
    expect(result.structuredContent).not.toHaveProperty('cap');
    expect(result.structuredContent).not.toHaveProperty('notice');
  });

  it('resolves structuredContent in by_voice_actor mode', async () => {
    vi.mocked(anilist.searchStaff).mockResolvedValue(mockStaffWithRoles);

    const result = await runToolContract(animeFindCharacters, { voice_actor_name: 'Miyano' });

    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toMatchObject({ mode: 'by_voice_actor', media_id: null });
    expect(result.structuredContent).not.toHaveProperty('truncated');
    expect(result.structuredContent).not.toHaveProperty('shown');
    expect(result.structuredContent).not.toHaveProperty('cap');
    expect(result.structuredContent).not.toHaveProperty('notice');
  });

  it('discloses truncation only when the cast list was capped', async () => {
    vi.mocked(anilist.getMediaCharacters).mockResolvedValue(mockCharacterEdges);
    const uncapped = await runToolContract(animeFindCharacters, { id: 11757 });
    expect(uncapped.structuredContent).not.toHaveProperty('truncated');
    expect(uncapped.structuredContent).not.toHaveProperty('shown');
    expect(uncapped.structuredContent).not.toHaveProperty('cap');
    expect(uncapped.structuredContent).not.toHaveProperty('notice');
    expect(uncapped.content).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'text',
          text: expect.stringContaining('More characters are available.'),
        }),
      ]),
    );

    vi.mocked(anilist.getMediaCharacters).mockResolvedValue({
      ...mockCharacterEdges,
      hasNextPage: true,
    });
    const capped = await runToolContract(animeFindCharacters, { id: 11757, per_page: 1 });
    const notice =
      'More characters are available. Call anime_find_characters with page 2 and the same id, per_page, and language (if set) to continue.';
    expect(capped.structuredContent).toMatchObject({
      truncated: true,
      shown: 1,
      cap: 1,
      notice,
    });
    expect(capped.content).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'text', text: expect.stringContaining(notice) }),
      ]),
    );
  });

  it('returns an uncapped empty page past the end', async () => {
    vi.mocked(anilist.getMediaCharacters).mockResolvedValue({
      characters: [],
      hasNextPage: false,
    });

    const result = await runToolContract(animeFindCharacters, { id: 11757, page: 2 });

    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toMatchObject({
      mode: 'by_media',
      has_next_page: false,
      characters: [],
    });
    expect(result.structuredContent).not.toHaveProperty('truncated');
    expect(result.structuredContent).not.toHaveProperty('notice');
    expect(result.content).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'text',
          text: expect.stringContaining('No characters found.'),
        }),
      ]),
    );
  });

  it('returns media_not_found on both public error surfaces', async () => {
    vi.mocked(anilist.getMediaCharacters).mockResolvedValue(null);

    const result = await runToolContract(animeFindCharacters, { id: 999_999_999 });
    const recovery = 'Use anime_search_media to find a valid AniList media ID and retry.';

    expect(result).toMatchObject({
      isError: true,
      structuredContent: {
        error: {
          code: JsonRpcErrorCode.NotFound,
          message: 'No media found with AniList ID 999999999',
          data: { reason: 'media_not_found', recovery: { hint: recovery } },
        },
      },
    });
    expect(result.content).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'text',
          text: expect.stringContaining(`Recovery: ${recovery}`),
        }),
      ]),
    );
  });

  it('rejects per_page above the schema cap', async () => {
    const result = await runToolContract(animeFindCharacters, { id: 11757, per_page: 26 });

    expect(result.isError).toBe(true);
    expect(result.structuredContent).toMatchObject({
      error: { code: JsonRpcErrorCode.InvalidParams },
    });
  });

  it('returns recovery hints for every reachable declared contract failure', async () => {
    const cases = [
      {
        input: {},
        reason: 'missing_identifier',
        message:
          'Provide one of id, character_id, character_name, voice_actor_id, or voice_actor_name',
        recovery:
          'Send one lookup identifier from id, character_id, character_name, voice_actor_id, or voice_actor_name.',
      },
      {
        input: { character_name: 'NonExistentCharacter12345' },
        reason: 'not_found',
        message: 'No character found matching "NonExistentCharacter12345"',
        recovery:
          'Check the AniList character or staff ID from a cast result, or try a distinctive part of the name.',
      },
      {
        input: { voice_actor_name: 'NonExistentVA12345' },
        reason: 'not_found',
        message: 'No voice actor/staff found matching "NonExistentVA12345"',
        recovery:
          'Check the AniList character or staff ID from a cast result, or try a distinctive part of the name.',
      },
    ] as const;

    vi.mocked(anilist.searchCharacter).mockResolvedValue(null);
    vi.mocked(anilist.searchStaff).mockResolvedValue(null);

    for (const testCase of cases) {
      const result = await runToolContract(animeFindCharacters, testCase.input);

      expect(result).toMatchObject({
        isError: true,
        structuredContent: {
          error: {
            message: testCase.message,
            data: {
              reason: testCase.reason,
              recovery: { hint: testCase.recovery },
            },
          },
        },
      });
      expect(result.content).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: 'text',
            text: expect.stringContaining(`Recovery: ${testCase.recovery}`),
          }),
        ]),
      );
    }
  });
});

function contentText(result: { content: unknown[] }): string {
  return result.content.map((block) => (block as { text?: string }).text ?? '').join('\n');
}

describe('animeFindCharacters input combinations', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(anilist.searchCharacterSuggestions).mockResolvedValue({
      matches: [],
      hasNextPage: false,
    });
    vi.mocked(anilist.searchStaffSuggestions).mockResolvedValue({
      matches: [],
      hasNextPage: false,
    });
  });

  // ─── characterization: behavior that holds before and after ─────────────────

  it.each(['', '   '])(
    'an id beside the blank character_name %o still runs by_media',
    async (name) => {
      vi.mocked(anilist.getMediaCharacters).mockResolvedValue(mockCharacterEdges);

      const result = await runToolContract(animeFindCharacters, {
        id: 11757,
        character_name: name,
      });

      expect(result.isError).toBeFalsy();
      expect(result.structuredContent).toMatchObject({ mode: 'by_media', media_id: 11757 });
      expect(anilist.searchCharacter).not.toHaveBeenCalled();
    },
  );

  it('forwards language with id', async () => {
    vi.mocked(anilist.getMediaCharacters).mockResolvedValue(mockCharacterEdges);

    await runToolContract(animeFindCharacters, { id: 11757, language: 'ENGLISH' });

    expect(anilist.getMediaCharacters).toHaveBeenCalledWith(
      expect.objectContaining({ mediaId: 11757, language: 'ENGLISH' }),
    );
  });

  // ─── #25: one lookup mode per call ──────────────────────────────────────────

  it.each([
    [{ id: 5114, character_name: 'Edward Elric' }, 'id, character_name'],
    [{ id: 5114, voice_actor_name: 'Romi Park' }, 'id, voice_actor_name'],
    [
      { character_name: 'Edward Elric', voice_actor_name: 'Romi Park' },
      'character_name, voice_actor_name',
    ],
    [{ character_name: 'Edward Elric', language: 'JAPANESE' }, 'language'],
    [{ voice_actor_name: 'Romi Park', language: 'ENGLISH' }, 'language'],
    [{ id: 5114, character_id: 12 }, 'id, character_id'],
    [{ character_id: 12, voice_actor_id: 34 }, 'character_id, voice_actor_id'],
    [{ voice_actor_id: 34, language: 'JAPANESE' }, 'language'],
  ] as const)('rejects %o with conflicting_inputs before any AniList call', async (raw, named) => {
    const declared = animeFindCharacters.errors?.find((e) => e.reason === 'conflicting_inputs');

    const result = await runToolContract(animeFindCharacters, raw);

    expect(declared).toMatchObject({ code: JsonRpcErrorCode.ValidationError });
    expect(result.isError).toBe(true);
    expect(result.structuredContent).toMatchObject({
      error: {
        code: JsonRpcErrorCode.ValidationError,
        message: expect.stringContaining(named),
        data: { reason: 'conflicting_inputs', recovery: { hint: declared?.recovery } },
      },
    });
    expect(contentText(result)).toContain(`Recovery: ${declared?.recovery}`);
    expect(anilist.getMediaCharacters).not.toHaveBeenCalled();
    expect(anilist.searchCharacter).not.toHaveBeenCalled();
    expect(anilist.searchStaff).not.toHaveBeenCalled();
  });

  it.each([
    { character_name: '   ' },
    { voice_actor_name: ' \t ' },
    { character_name: '', voice_actor_name: '  ' },
  ])('a blank-only identifier %o fails missing_identifier with no AniList call', async (raw) => {
    const result = await runToolContract(animeFindCharacters, raw);

    expect(result.structuredContent).toMatchObject({
      error: { data: { reason: 'missing_identifier' } },
    });
    expect(anilist.searchCharacter).not.toHaveBeenCalled();
    expect(anilist.searchStaff).not.toHaveBeenCalled();
  });

  it('a blank name beside a real one is ignored', async () => {
    vi.mocked(anilist.searchStaff).mockResolvedValue(mockStaffWithRoles);

    const result = await runToolContract(animeFindCharacters, {
      character_name: '  ',
      voice_actor_name: 'Miyano',
    });

    expect(result.structuredContent).toMatchObject({ mode: 'by_voice_actor' });
    expect(anilist.searchCharacter).not.toHaveBeenCalled();
  });

  it('trims a padded character_name before searching', async () => {
    vi.mocked(anilist.searchCharacter).mockResolvedValue(mockCharacterWithMedia);

    const result = await runToolContract(animeFindCharacters, { character_name: '  Okabe ' });

    expect(result.isError).toBeFalsy();
    expect(vi.mocked(anilist.searchCharacter).mock.calls[0]![0]).toBe('Okabe');
  });

  it('trims a padded voice_actor_name before searching', async () => {
    vi.mocked(anilist.searchStaff).mockResolvedValue(mockStaffWithRoles);

    const result = await runToolContract(animeFindCharacters, { voice_actor_name: '\tMiyano  ' });

    expect(result.isError).toBeFalsy();
    expect(vi.mocked(anilist.searchStaff).mock.calls[0]![0]).toBe('Miyano');
  });
});
