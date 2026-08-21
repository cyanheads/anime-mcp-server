/**
 * @fileoverview anime_find_characters tool — characters and voice actors for a title,
 * or bidirectional lookup by character/VA name.
 * @module mcp-server/tools/definitions/anime-find-characters.tool
 */

import { tool, z } from '@cyanheads/mcp-ts-core';
import { JsonRpcErrorCode } from '@cyanheads/mcp-ts-core/errors';
import * as anilist from '@/services/anilist/anilist-service.js';

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

export const animeFindCharacters = tool('anime_find_characters', {
  description:
    'Characters and voice actors for a title, or look up a character/VA by name. ' +
    'Provide "id" for title → cast lookup, or "character_name" / "voice_actor_name" for name-based lookup. ' +
    'Returns characters with their role, voice actors by language, and cross-links to other media.',
  annotations: { readOnlyHint: true, openWorldHint: true },

  input: z.object({
    id: z
      .number()
      .int()
      .min(1)
      .optional()
      .describe(
        'AniList media ID for title → cast lookup. Use anime_search_media to find this ID.',
      ),
    character_name: z
      .string()
      .max(200)
      .optional()
      .describe("Character name to search for. Returns the character's appearances across media."),
    voice_actor_name: z
      .string()
      .max(200)
      .optional()
      .describe('Voice actor/staff name to search for. Returns their roles across anime.'),
    language: z
      .enum(STAFF_LANGUAGE_VALUES)
      .optional()
      .describe(
        'Filter voice actors by language. Common: JAPANESE, ENGLISH, KOREAN. ' +
          'Only applies when fetching by media ID.',
      ),
    page: z
      .number()
      .int()
      .min(1)
      .default(1)
      .describe('1-based page number for character/role results.'),
    per_page: z.number().int().min(1).max(25).default(25).describe('Results per page. Maximum 25.'),
  }),

  enrichment: {
    truncated: z
      .boolean()
      .describe('True when the cast list was capped at per_page (by_media mode only).'),
    shown: z.number().int().describe('Number of characters returned.'),
    cap: z.number().int().describe('The per-page limit applied.'),
  },

  output: z.object({
    mode: z
      .enum(['by_media', 'by_character', 'by_voice_actor'])
      .describe('Which lookup mode was used.'),
    media_id: z
      .number()
      .int()
      .nullable()
      .describe('AniList media ID used for the lookup, or null for name-based lookup.'),
    has_next_page: z.boolean().describe('Whether more results are available on the next page.'),
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
        description: z.string().nullable().describe('Bio/description (HTML stripped), or null.'),
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
      when: 'Name search returns no match from AniList',
      recovery:
        'Try a broader name search or check spelling. For character searches, use the full name or a distinctive part of it.',
    },
    {
      reason: 'missing_identifier',
      code: JsonRpcErrorCode.ValidationError,
      when: 'Neither id nor character_name nor voice_actor_name provided',
      recovery:
        'Provide at least one of: id (media AniList ID), character_name, or voice_actor_name.',
    },
  ],

  async handler(input, ctx) {
    // Validate: must have at least one identifier
    if (!input.id && !input.character_name && !input.voice_actor_name) {
      throw ctx.fail(
        'missing_identifier',
        'Provide at least one of: id, character_name, or voice_actor_name',
      );
    }

    // Mode A: by media ID
    if (input.id) {
      ctx.log.info('Fetching characters by media ID', { id: input.id });

      const result = await anilist.getMediaCharacters({
        mediaId: input.id,
        language: input.language,
        page: input.page,
        perPage: input.per_page,
      });

      ctx.enrich.truncated({ shown: result.characters.length, cap: input.per_page });

      return {
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

    // Mode B: by character name
    if (input.character_name) {
      ctx.log.info('Searching character by name', { name: input.character_name });

      const character = await anilist.searchCharacter(input.character_name);

      if (!character) {
        throw ctx.fail('not_found', `No character found matching "${input.character_name}"`);
      }

      // Map each media appearance as a character entry so the agent can see
      // which titles the character appears in and their VAs per appearance.
      const appearances = character.media.nodes.map((_media, i) => {
        const edge = character.media.edges[i];
        return {
          character_id: character.id,
          character_name: character.name.full,
          character_name_native: character.name.native,
          role: edge?.characterRole ?? 'SUPPORTING',
          character_image_url: character.image?.large ?? null,
          character_site_url: character.siteUrl ?? null,
          // Attach media context via voice_actors reuse: each "va" entry here is
          // a VA for this character in this specific media.
          voice_actors: (edge?.voiceActors ?? []).map((va) => ({
            va_id: va.id,
            va_name: va.name.full,
            va_name_native: va.name.native,
            language: va.language ?? null,
            va_image_url: va.image?.large ?? null,
            va_site_url: va.siteUrl ?? null,
          })),
        };
      });

      // If no appearances mapped (edge/node mismatch), fall back to single entry
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
                voice_actors: [],
              },
            ];

      return {
        mode: 'by_character' as const,
        media_id: null,
        has_next_page: character.media.pageInfo.hasNextPage,
        characters,
        voice_actor: null,
      };
    }

    // Mode C: by voice actor name
    const vaName = input.voice_actor_name;
    if (!vaName) {
      throw ctx.fail('missing_identifier', 'voice_actor_name is required for name-based lookup');
    }

    ctx.log.info('Searching VA by name', { name: vaName });

    const staff = await anilist.searchStaff(vaName, input.page, input.per_page);

    if (!staff) {
      throw ctx.fail(
        'not_found',
        `No voice actor/staff found matching "${input.voice_actor_name}"`,
      );
    }

    return {
      mode: 'by_voice_actor' as const,
      media_id: null,
      has_next_page: staff.characterMedia.pageInfo.hasNextPage,
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
    const lines: string[] = [`mode: ${result.mode}`];

    if (result.mode === 'by_media') {
      lines.push(`## Characters [media AL:${result.media_id}]`, '');
      if (result.characters.length === 0) {
        lines.push('No characters found.');
        return [{ type: 'text', text: lines.join('\n') }];
      }
      for (const c of result.characters) {
        lines.push(
          `**${c.character_name ?? 'Unknown'}** (${c.character_name_native ?? '?'}) [char_id:${c.character_id}] [${c.role}]`,
          `  image: ${c.character_image_url ?? 'none'} | site: ${c.character_site_url ?? 'none'}`,
        );
        for (const v of c.voice_actors) {
          lines.push(
            `  VA: ${v.va_name ?? '?'} (${v.va_name_native ?? '?'}) (${v.language ?? '?'}) [va_id:${v.va_id}] image:${v.va_image_url ?? 'none'} site:${v.va_site_url ?? 'none'}`,
          );
        }
      }
    } else if (result.mode === 'by_character') {
      const first = result.characters[0];
      if (!first) {
        lines.push('No character found.');
        return [{ type: 'text', text: lines.join('\n') }];
      }
      lines.push(
        `## ${first.character_name ?? 'Unknown'} (${first.character_name_native ?? '?'}) [char_id:${first.character_id}]`,
        `image: ${first.character_image_url ?? 'none'} | site: ${first.character_site_url ?? 'none'}`,
        '',
        `**Appears in ${result.characters.length} title(s):**`,
      );
      for (const c of result.characters) {
        lines.push(`  [${c.role}] char_id:${c.character_id}`);
        for (const v of c.voice_actors) {
          lines.push(
            `    VA: ${v.va_name ?? '?'} (${v.va_name_native ?? '?'}) (${v.language ?? '?'}) [va_id:${v.va_id}] image:${v.va_image_url ?? 'none'} site:${v.va_site_url ?? 'none'}`,
          );
        }
      }
    } else if (result.mode === 'by_voice_actor') {
      const va = result.voice_actor;
      if (va) {
        lines.push(
          `## ${va.va_name ?? 'Unknown'} (${va.va_name_native ?? '?'}) (VA)`,
          `va_id:${va.va_id} | va_name:${va.va_name ?? '?'} | va_name_native:${va.va_name_native ?? '?'} | language:${va.language ?? 'unknown'}`,
          `va_image_url:${va.va_image_url ?? 'none'} | va_site_url:${va.va_site_url ?? 'none'}`,
          `description:${va.description ?? 'none'}`,
          '',
          '**Roles:**',
        );
        for (const role of va.roles.slice(0, 20)) {
          lines.push(
            `- character_name:${role.character_name ?? '?'} media_title:${role.media_title ?? 'Unknown'} character_role:${role.character_role} media_format:${role.media_format ?? '?'} [AL:${role.media_id}] media_id:${role.media_id}`,
          );
        }
        if (va.roles.length > 20) lines.push(`_…and ${va.roles.length - 20} more_`);
      }
    }

    // Render voice_actor fields when present (also catches synthetic linter samples)
    if (result.mode !== 'by_voice_actor' && result.voice_actor) {
      const va = result.voice_actor;
      lines.push(
        `va_id:${va.va_id} va_name:${va.va_name ?? '?'} va_name_native:${va.va_name_native ?? '?'} language:${va.language ?? '?'} va_image_url:${va.va_image_url ?? 'none'} va_site_url:${va.va_site_url ?? 'none'} description:${va.description ?? 'none'}`,
      );
      for (const role of va.roles) {
        lines.push(
          `role: media_id:${role.media_id} media_title:${role.media_title ?? '?'} media_format:${role.media_format ?? '?'} character_role:${role.character_role} character_name:${role.character_name ?? '?'}`,
        );
      }
    }

    if (result.has_next_page) lines.push('', '_More results on next page._');

    return [{ type: 'text', text: lines.filter((l) => l !== '').join('\n') }];
  },
});
