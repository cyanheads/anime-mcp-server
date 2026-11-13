/**
 * @fileoverview anime_find_characters tool — characters and voice actors for a title,
 * or bidirectional lookup by character or staff ID or name.
 * @module mcp-server/tools/definitions/anime-find-characters.tool
 */

import { tool, z } from '@cyanheads/mcp-ts-core';
import { JsonRpcErrorCode, McpError } from '@cyanheads/mcp-ts-core/errors';
import {
  markdownImage,
  markdownLink,
  escapeMarkdownInline as text,
} from '@cyanheads/mcp-ts-core/utils';
import * as anilist from '@/services/anilist/anilist-service.js';
import type { PersonSuggestions } from '@/services/anilist/types.js';
import { fullTextJson, headingText } from '../render-text.js';

const STAFF_LANGUAGE_VALUES = [
  'JAPANESE',
  'ENGLISH',
  'KOREAN',
  'ITALIAN',
  'SPANISH',
  'PORTUGUESE',
  'FRENCH',
  'GERMAN',
  'HEBREW',
  'HUNGARIAN',
] as const;

const aniListId = z.number().int().min(1).max(2147483647);

async function personSuggestions(
  lookup: () => Promise<PersonSuggestions>,
  selectedId: number,
  signal: AbortSignal,
) {
  let suggestions: PersonSuggestions;
  try {
    suggestions = await lookup();
  } catch (error) {
    signal.throwIfAborted();
    if (error instanceof Error && error.name === 'AbortError') throw error;
    if (error instanceof McpError && error.code === JsonRpcErrorCode.RequestCancelled) throw error;
    if (error instanceof McpError || error instanceof SyntaxError) {
      return { other_matches_status: 'unavailable' as const };
    }
    throw error;
  }
  signal.throwIfAborted();
  const { matches, hasNextPage } = suggestions;
  return {
    other_matches_status: 'available' as const,
    other_matches_has_next_page: hasNextPage,
    other_matches: matches
      .filter(({ id }) => id !== selectedId)
      .map(({ id, name, popularMedia }) => ({
        id,
        name: name.full,
        name_native: name.native,
        media_id: popularMedia?.id ?? null,
        media_title: popularMedia?.title.romaji ?? null,
      })),
  };
}

export const animeFindCharacters = tool('anime_find_characters', {
  description:
    'Characters and voice actors for a title, or look up a character or voice actor by ID or name. ' +
    'Send exactly one of id (media ID), character_id, character_name, voice_actor_id, or voice_actor_name. ' +
    'Returns characters with their role, voice actors by language, and cross-links to other media.',
  annotations: { readOnlyHint: true, openWorldHint: true },

  input: z.object({
    full_text: z
      .boolean()
      .default(false)
      .describe(
        'Render complete domain JSON in text, including full biography and every role on this page. Default false uses bounded summaries; upstream pagination is unchanged.',
      ),
    id: aniListId
      .optional()
      .describe(
        'AniList media ID for title → cast lookup. Use anime_search_media to find this ID.',
      ),
    character_id: aniListId
      .optional()
      .describe(
        'Exact AniList character ID from characters[].character_id. Returns media appearances.',
      ),
    character_name: z
      .string()
      .max(200)
      .optional()
      .describe(
        "Character name to search for. Returns the character's appearances across media. Trimmed; blank counts as absent.",
      ),
    voice_actor_id: aniListId
      .optional()
      .describe(
        'Exact AniList staff ID from voice_actors[].va_id. Returns voice roles across anime.',
      ),
    voice_actor_name: z
      .string()
      .max(200)
      .optional()
      .describe(
        'Voice actor/staff name to search for. Returns their roles across anime. Trimmed; blank counts as absent.',
      ),
    language: z
      .enum(STAFF_LANGUAGE_VALUES)
      .describe('AniList voice acting language.')
      .or(z.literal(''))
      .optional()
      .describe(
        'Filter voice actors by language. Use JAPANESE for a single-language cast. Omit to keep all returned languages. Only with id (title → cast lookup).',
      ),
    page: z
      .number()
      .int()
      .min(1)
      .default(1)
      .describe('1-based page number for character/role results.'),
    per_page: z
      .number()
      .int()
      .min(1)
      .max(25)
      .default(10)
      .describe('Results per page. Defaults to 10; maximum 25.'),
  }),

  enrichment: {
    truncated: z
      .boolean()
      .optional()
      .describe(
        'True when the cast list was capped at per_page. Present in by_media mode only, and only when the cap was hit.',
      ),
    shown: z
      .number()
      .int()
      .optional()
      .describe('Number of characters returned. Present alongside truncated.'),
    cap: z
      .number()
      .int()
      .optional()
      .describe('The per-page limit applied. Present alongside truncated.'),
    notice: z
      .string()
      .optional()
      .describe('Next-page guidance. Present in by_media mode only when the cast list was capped.'),
  },

  output: z.object({
    full_text: z.boolean().describe('Whether text renders the complete domain result as JSON.'),
    mode: z
      .enum(['by_media', 'by_character', 'by_voice_actor'])
      .describe('Which lookup mode was used.'),
    media_id: z
      .number()
      .int()
      .nullable()
      .describe('AniList media ID used for the cast lookup, or null for a person lookup.'),
    has_next_page: z.boolean().describe('Whether more results are available on the next page.'),
    character_description: z
      .string()
      .nullable()
      .optional()
      .describe('Normalized full biography, or null. Present only in by_character mode.'),
    other_matches: z
      .array(
        z
          .object({
            id: z.number().int().describe('AniList ID of the other character or staff member.'),
            name: z.string().nullable().describe('Full name, or null.'),
            name_native: z.string().nullable().describe('Native-script name, or null.'),
            media_id: z
              .number()
              .int()
              .nullable()
              .describe('AniList ID of a popular associated title, or null.'),
            media_title: z.string().nullable().describe('Romanized title of that media, or null.'),
          })
          .describe('An alternate AniList character or staff match.'),
      )
      .optional()
      .describe(
        'Other people on the first suggestion page, excluding the selected person. Present when suggestions are available in a name lookup.',
      ),
    other_matches_has_next_page: z
      .boolean()
      .optional()
      .describe(
        'Whether AniList has more name suggestions beyond its first page, independent of role paging.',
      ),
    other_matches_status: z
      .enum(['available', 'unavailable'])
      .optional()
      .describe(
        'Whether the optional name suggestion lookup succeeded. Present for name lookups only.',
      ),
    characters: z
      .array(
        z
          .object({
            character_id: z.number().int().describe('AniList character ID.'),
            character_name: z.string().nullable().describe('Character full name.'),
            character_name_native: z
              .string()
              .nullable()
              .describe('Native script character name, or null.'),
            role: z.string().describe('Role in the media: MAIN, SUPPORTING, or BACKGROUND.'),
            character_image_url: z.string().nullable().describe('Character image URL, or null.'),
            character_site_url: z
              .string()
              .nullable()
              .describe('AniList character page URL, or null.'),
            media_id: z
              .number()
              .int()
              .optional()
              .describe('AniList media ID for this appearance. Present in by_character mode.'),
            media_title: z
              .string()
              .nullable()
              .optional()
              .describe('Romanized media title for this appearance. Present in by_character mode.'),
            media_format: z
              .string()
              .nullable()
              .optional()
              .describe('Media format for this appearance. Present in by_character mode.'),
            voice_actors: z
              .array(
                z
                  .object({
                    va_id: z.number().int().describe('AniList staff/VA ID.'),
                    va_name: z.string().nullable().describe('Voice actor full name.'),
                    va_name_native: z
                      .string()
                      .nullable()
                      .describe('Native script VA name, or null.'),
                    language: z.string().nullable().describe('Voice acting language.'),
                    va_image_url: z.string().nullable().describe('VA image URL, or null.'),
                    va_site_url: z.string().nullable().describe('AniList VA page URL, or null.'),
                  })
                  .describe('A voice actor for this character.'),
              )
              .describe('Voice actors for this character, filtered by language if requested.'),
            voice_actor_data_available: z
              .boolean()
              .describe(
                'False when the provider did not supply actor data; true for populated or genuinely empty lists.',
              ),
          })
          .describe('A character entry with voice actor list.'),
      )
      .describe(
        'Characters found. In by_media mode, characters for the title. In by_character mode, one character with their media appearances as context. Empty in by_voice_actor mode.',
      ),
    voice_actor: z
      .object({
        va_id: z.number().int().describe('AniList staff ID.'),
        va_name: z.string().nullable().describe('Voice actor full name.'),
        va_name_native: z.string().nullable().describe('Native script VA name, or null.'),
        language: z.string().nullable().describe('Primary voice acting language.'),
        description: z
          .string()
          .nullable()
          .describe('Normalized full bio/description text, or null.'),
        va_image_url: z.string().nullable().describe('VA image URL, or null.'),
        va_site_url: z.string().nullable().describe('AniList VA page URL, or null.'),
        roles: z
          .array(
            z
              .object({
                media_id: z.number().int().describe('AniList media ID.'),
                media_title: z.string().nullable().describe('Romanized media title.'),
                media_format: z.string().nullable().describe('Media format.'),
                character_role: z.string().describe('Role: MAIN, SUPPORTING, or BACKGROUND.'),
                character_name: z.string().nullable().describe('Character name in this role.'),
              })
              .describe('A media role entry for this voice actor.'),
          )
          .describe('Media roles for this voice actor.'),
      })
      .nullable()
      .describe('Voice actor detail (populated in by_voice_actor mode only, null otherwise).'),
  }),

  errors: [
    {
      reason: 'not_found',
      code: JsonRpcErrorCode.NotFound,
      when: 'AniList returns no person for the supplied name or exact ID',
      recovery:
        'Check the AniList character or staff ID from a cast result, or try a distinctive part of the name.',
    },
    {
      reason: 'media_not_found',
      code: JsonRpcErrorCode.NotFound,
      when: 'AniList has no media record for the requested ID',
      recovery: 'Use anime_search_media to find a valid AniList media ID and retry.',
    },
    {
      reason: 'missing_identifier',
      code: JsonRpcErrorCode.ValidationError,
      when: 'No media ID, person ID, or non-blank person name was supplied',
      recovery:
        'Send one lookup identifier from id, character_id, character_name, voice_actor_id, or voice_actor_name.',
    },
    {
      reason: 'conflicting_inputs',
      code: JsonRpcErrorCode.ValidationError,
      when: 'Multiple lookup identifiers are supplied, or language is supplied without id',
      recovery:
        'Send exactly one of id, character_id, character_name, voice_actor_id, or voice_actor_name, and use language only with id.',
    },
  ],

  async handler(input, ctx) {
    const characterName = input.character_name?.trim() || undefined;
    const voiceActorName = input.voice_actor_name?.trim() || undefined;
    const characterSelector = characterName ?? input.character_id;
    const staffSelector = voiceActorName ?? input.voice_actor_id;
    const identifiers = [
      ...(input.id !== undefined ? ['id'] : []),
      ...(input.character_id !== undefined ? ['character_id'] : []),
      ...(characterName ? ['character_name'] : []),
      ...(input.voice_actor_id !== undefined ? ['voice_actor_id'] : []),
      ...(voiceActorName ? ['voice_actor_name'] : []),
    ];

    if (identifiers.length > 1) {
      throw ctx.fail(
        'conflicting_inputs',
        `Send one lookup identifier per call; got ${identifiers.join(', ')}`,
      );
    }
    if (input.language && input.id === undefined && identifiers.length > 0) {
      throw ctx.fail(
        'conflicting_inputs',
        'language filters the cast of a title and requires a media id',
      );
    }

    ctx.signal.throwIfAborted();
    if (input.id !== undefined) {
      ctx.log.info('Fetching characters by media ID', { id: input.id });

      const result = await anilist.getMediaCharacters({
        mediaId: input.id,
        language: input.language || undefined,
        page: input.page,
        perPage: input.per_page,
        signal: ctx.signal,
      });
      ctx.signal.throwIfAborted();

      if (!result) {
        throw ctx.fail('media_not_found', `No media found with AniList ID ${input.id}`, {
          ...ctx.recoveryFor('media_not_found'),
        });
      }

      if (result.hasNextPage) {
        ctx.enrich.truncated({
          shown: result.characters.length,
          cap: input.per_page,
          guidance: `More characters are available. Call anime_find_characters with page ${input.page + 1} and the same id, per_page, and language (if set) to continue.`,
        });
      }

      return {
        full_text: input.full_text,
        mode: 'by_media' as const,
        media_id: input.id,
        has_next_page: result.hasNextPage,
        characters: result.characters.map((edge) => ({
          character_id: edge.node.id,
          character_name: edge.node.name.full,
          character_name_native: edge.node.name.native,
          role: edge.role,
          character_image_url: edge.node.image?.large ?? null,
          character_site_url: edge.node.siteUrl ?? null,
          voice_actor_data_available: true,
          voice_actors: edge.voiceActors.map((va) => ({
            va_id: va.id,
            va_name: va.name.full,
            va_name_native: va.name.native,
            language: va.language ?? null,
            va_image_url: va.image?.large ?? null,
            va_site_url: va.siteUrl ?? null,
          })),
        })),
        voice_actor: null,
      };
    }

    if (characterSelector !== undefined) {
      const character =
        typeof characterSelector === 'string'
          ? await anilist.searchCharacter(characterSelector, input.page, input.per_page, ctx.signal)
          : await anilist.getCharacterById(
              characterSelector,
              input.page,
              input.per_page,
              ctx.signal,
            );
      ctx.signal.throwIfAborted();

      if (!character) {
        throw ctx.fail(
          'not_found',
          characterName
            ? `No character found matching "${characterName}"`
            : `No character found with AniList ID ${input.character_id}`,
        );
      }
      const suggestions = characterName
        ? await personSuggestions(
            () => anilist.searchCharacterSuggestions(characterName, input.per_page, ctx.signal),
            character.id,
            ctx.signal,
          )
        : {};

      // Map each media appearance as a character entry so the agent can see
      // which titles the character appears in and their VAs per appearance.
      const appearances = character.media.edges.map((edge) => {
        const media = edge.node;
        return {
          character_id: character.id,
          character_name: character.name.full,
          character_name_native: character.name.native,
          role: edge.characterRole,
          character_image_url: character.image?.large ?? null,
          character_site_url: character.siteUrl ?? null,
          media_id: media.id,
          media_title: media.title.romaji,
          media_format: media.format ?? null,
          voice_actor_data_available: edge.voiceActors !== null,
          voice_actors: (edge.voiceActors ?? []).map((va) => ({
            va_id: va.id,
            va_name: va.name.full,
            va_name_native: va.name.native,
            language: va.language ?? null,
            va_image_url: va.image?.large ?? null,
            va_site_url: va.siteUrl ?? null,
          })),
        };
      });

      // A character without appearances still returns their identity.
      const characters =
        appearances.length > 0
          ? appearances
          : [
              {
                character_id: character.id,
                character_name: character.name.full,
                character_name_native: character.name.native,
                role: 'SUPPORTING',
                character_image_url: character.image?.large ?? null,
                character_site_url: character.siteUrl ?? null,
                media_id: undefined,
                media_title: null,
                media_format: null,
                voice_actors: [],
                voice_actor_data_available: false,
              },
            ];

      return {
        full_text: input.full_text,
        mode: 'by_character' as const,
        media_id: null,
        has_next_page: character.media.pageInfo.hasNextPage,
        character_description: character.description,
        ...suggestions,
        characters,
        voice_actor: null,
      };
    }

    if (staffSelector === undefined) {
      throw ctx.fail(
        'missing_identifier',
        'Provide one of id, character_id, character_name, voice_actor_id, or voice_actor_name',
      );
    }
    const vaName = voiceActorName;
    const staff =
      typeof staffSelector === 'string'
        ? await anilist.searchStaff(staffSelector, input.page, input.per_page, ctx.signal)
        : await anilist.getStaffById(staffSelector, input.page, input.per_page, ctx.signal);
    ctx.signal.throwIfAborted();

    if (!staff) {
      throw ctx.fail(
        'not_found',
        vaName
          ? `No voice actor/staff found matching "${vaName}"`
          : `No voice actor/staff found with AniList ID ${input.voice_actor_id}`,
      );
    }
    const suggestions = vaName
      ? await personSuggestions(
          () => anilist.searchStaffSuggestions(vaName, input.per_page, ctx.signal),
          staff.id,
          ctx.signal,
        )
      : {};

    return {
      full_text: input.full_text,
      mode: 'by_voice_actor' as const,
      media_id: null,
      has_next_page: staff.characterMedia.pageInfo.hasNextPage,
      ...suggestions,
      characters: [],
      voice_actor: {
        va_id: staff.id,
        va_name: staff.name.full,
        va_name_native: staff.name.native,
        language: staff.language ?? null,
        description: staff.description ?? null,
        va_image_url: staff.image?.large ?? null,
        va_site_url: staff.siteUrl ?? null,
        roles: staff.characterMedia.edges.map((edge) => ({
          media_id: edge.node.id,
          media_title: edge.node.title.romaji,
          media_format: edge.node.format ?? null,
          character_role: edge.characterRole,
          character_name: edge.characters?.[0]?.name.full ?? null,
        })),
      },
    };
  },

  format: (result) => {
    if (result.full_text) return [{ type: 'text', text: fullTextJson(result) }];
    const mode = result.mode;
    const omittedStaffBio = Math.max(0, (result.voice_actor?.description?.length ?? 0) - 500);
    const omittedCharacterBio = Math.max(0, (result.character_description?.length ?? 0) - 500);
    const omittedRoles =
      mode === 'by_voice_actor' ? Math.max(0, (result.voice_actor?.roles.length ?? 0) - 20) : 0;
    const lines: string[] = [`mode: ${result.mode}`];

    if (mode === 'by_media') {
      lines.push(`## Characters [media AL:${result.media_id}]`, '');
      if (result.characters.length === 0) {
        lines.push('No characters found.');
      }
      for (const c of result.characters) {
        lines.push(
          `voice_actor_data_available: ${c.voice_actor_data_available}${c.voice_actor_data_available ? '' : ' (unavailable)'}`,
        );
        const mediaContext =
          c.media_id !== undefined || c.media_title !== undefined || c.media_format !== undefined
            ? ` | media_id:${c.media_id ?? 'none'} media_title:${text(c.media_title ?? 'none')} media_format:${text(c.media_format ?? 'none')}`
            : '';
        lines.push(
          `**${text(c.character_name ?? 'Unknown')}** (${text(c.character_name_native ?? '?')}) [char_id:${c.character_id}] [${text(c.role)}]${mediaContext}`,
          `  image: ${c.character_image_url ? markdownImage('character', c.character_image_url) : 'none'} | site: ${c.character_site_url ? markdownLink('character', c.character_site_url) : 'none'}`,
        );
        for (const v of c.voice_actors) {
          lines.push(
            `  VA: ${text(v.va_name ?? '?')} (${text(v.va_name_native ?? '?')}) (${text(v.language ?? '?')}) [va_id:${v.va_id}] image:${v.va_image_url ? markdownImage('voice actor', v.va_image_url) : 'none'} site:${v.va_site_url ? markdownLink('voice actor', v.va_site_url) : 'none'}`,
          );
        }
      }
    } else if (mode === 'by_character') {
      const first = result.characters[0];
      if (!first) {
        lines.push('No character found.');
      } else {
        lines.push(
          `## ${headingText(first.character_name ?? 'Unknown')} (${headingText(first.character_name_native ?? '?')}) [char_id:${first.character_id}]`,
          `image: ${first.character_image_url ? markdownImage('character', first.character_image_url) : 'none'} | site: ${first.character_site_url ? markdownLink('character', first.character_site_url) : 'none'}`,
          `description:${text(result.character_description?.slice(0, 500) ?? 'none')}${omittedCharacterBio > 0 ? '…' : ''}`,
          '',
          `**Appears in ${result.characters.filter((entry) => entry.media_id !== undefined).length} title(s):**`,
        );
      }
      for (const c of result.characters) {
        lines.push(
          `voice_actor_data_available: ${c.voice_actor_data_available}${c.voice_actor_data_available ? '' : ' (unavailable)'}`,
        );
        lines.push(
          `  media_title:${text(c.media_title ?? 'Unknown title')} [AL:${c.media_id ?? '?'}] media_id:${c.media_id ?? 'none'} media_format:${text(c.media_format ?? 'none')} role:${text(c.role)} char_id:${c.character_id}`,
        );
        for (const v of c.voice_actors) {
          lines.push(
            `    VA: ${text(v.va_name ?? '?')} (${text(v.va_name_native ?? '?')}) (${text(v.language ?? '?')}) [va_id:${v.va_id}] image:${v.va_image_url ? markdownImage('voice actor', v.va_image_url) : 'none'} site:${v.va_site_url ? markdownLink('voice actor', v.va_site_url) : 'none'}`,
          );
        }
      }
    } else if (mode === 'by_voice_actor') {
      const va = result.voice_actor;
      if (va) {
        lines.push(
          `## ${headingText(va.va_name ?? 'Unknown')} (${headingText(va.va_name_native ?? '?')}) (VA)`,
          `va_id:${va.va_id} | va_name:${text(va.va_name ?? '?')} | va_name_native:${text(va.va_name_native ?? '?')} | language:${text(va.language ?? 'unknown')}`,
          `va_image_url:${va.va_image_url ? markdownImage('voice actor', va.va_image_url) : 'none'} | va_site_url:${va.va_site_url ? markdownLink('voice actor', va.va_site_url) : 'none'}`,
          `description:${text(va.description?.slice(0, 500) ?? 'none')}${omittedStaffBio > 0 ? '…' : ''}`,
          '',
          '**Roles:**',
        );
        for (const role of va.roles.slice(0, 20)) {
          lines.push(
            `- character_name:${text(role.character_name ?? '?')} media_title:${text(role.media_title ?? 'Unknown')} character_role:${text(role.character_role)} media_format:${text(role.media_format ?? '?')} [AL:${role.media_id}] media_id:${role.media_id}`,
          );
        }
        if (omittedRoles > 0) lines.push(`${omittedRoles} roles omitted.`);
      }
    }

    // Render voice_actor fields when present (also catches synthetic linter samples)
    if (mode !== 'by_voice_actor' && result.voice_actor) {
      const va = result.voice_actor;
      lines.push(
        `va_id:${va.va_id} va_name:${text(va.va_name ?? '?')} va_name_native:${text(va.va_name_native ?? '?')} language:${text(va.language ?? '?')} va_image_url:${va.va_image_url ? markdownImage('voice actor', va.va_image_url) : 'none'} va_site_url:${va.va_site_url ? markdownLink('voice actor', va.va_site_url) : 'none'} description:${text(va.description?.slice(0, 500) ?? 'none')}${omittedStaffBio > 0 ? '…' : ''}`,
      );
      for (const role of va.roles) {
        lines.push(
          `role: media_id:${role.media_id} media_title:${text(role.media_title ?? '?')} media_format:${text(role.media_format ?? '?')} character_role:${text(role.character_role)} character_name:${text(role.character_name ?? '?')}`,
        );
      }
    }

    if (result.other_matches_status)
      lines.push(`other_matches_status: ${result.other_matches_status}`);
    if (result.other_matches_has_next_page !== undefined) {
      lines.push(`other_matches_has_next_page: ${result.other_matches_has_next_page}`);
    }
    if (result.other_matches) {
      lines.push(
        result.other_matches.length
          ? '**Other matches**'
          : 'No other matches on the suggestion page.',
      );
      for (const match of result.other_matches) {
        lines.push(
          `- id:${match.id} name:${text(match.name ?? '?')} name_native:${text(match.name_native ?? '?')} media_id:${match.media_id ?? 'none'} media_title:${text(match.media_title ?? 'none')}`,
        );
      }
    }
    if (result.has_next_page) lines.push('', '_More results on next page._');
    lines.push(
      `full_text: false · ${omittedCharacterBio + omittedStaffBio} biography characters omitted · ${omittedRoles} roles omitted. Repeat the same input with full_text: true for the complete domain result on this page; use page to retrieve other pages.`,
    );

    return [{ type: 'text', text: lines.filter((l) => l !== '').join('\n') }];
  },
});
