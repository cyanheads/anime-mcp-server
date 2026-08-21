/**
 * @fileoverview anime_get_schedule tool — airing schedule for a season or upcoming episode window.
 * @module mcp-server/tools/definitions/anime-get-schedule.tool
 */

import { tool, z } from '@cyanheads/mcp-ts-core';
import { JsonRpcErrorCode } from '@cyanheads/mcp-ts-core/errors';
import * as anilist from '@/services/anilist/anilist-service.js';

const SeasonEnum = z
  .enum(['WINTER', 'SPRING', 'SUMMER', 'FALL'])
  .describe(
    'Anime broadcast season. WINTER=Jan–Mar, SPRING=Apr–Jun, SUMMER=Jul–Sep, FALL=Oct–Dec.',
  );

export const animeGetSchedule = tool('anime_get_schedule', {
  description:
    'Airing schedule for a season or upcoming episode window. ' +
    '"season" mode returns all anime airing in a given season/year. ' +
    '"upcoming" mode returns next episode for airing titles within a date window, with UTC timestamps.',
  annotations: { readOnlyHint: true, openWorldHint: true },

  input: z.object({
    mode: z
      .enum(['season', 'upcoming'])
      .describe(
        '"season": all anime from a specific season/year. Requires season and season_year. ' +
          '"upcoming": next airing episode for each currently-airing title within days_ahead window.',
      ),
    season: SeasonEnum.optional(),
    season_year: z
      .number()
      .int()
      .min(1940)
      .max(2100)
      .optional()
      .describe('4-digit year. Required with mode "season".'),
    days_ahead: z
      .number()
      .int()
      .min(1)
      .max(30)
      .default(7)
      .describe(
        'Days ahead to look for upcoming episodes. Used only in "upcoming" mode. Default 7.',
      ),
    page: z.number().int().min(1).default(1).describe('1-based page number.'),
    per_page: z.number().int().min(1).max(50).default(25).describe('Results per page. Maximum 50.'),
    include_adult: z.boolean().default(false).describe('Include adult/NSFW titles. Default false.'),
  }),

  enrichment: {
    notice: z
      .string()
      .optional()
      .describe(
        'Recovery guidance when entries is empty — echoes the applied mode/season and suggests how to broaden.',
      ),
    totalCount: z
      .number()
      .int()
      .optional()
      .describe('Total entries in the season, when AniList reports it (season mode only).'),
  },

  output: z.object({
    mode: z.enum(['season', 'upcoming']).describe('Mode used for this response.'),
    season_label: z
      .string()
      .nullable()
      .describe('Human-readable season label, e.g. "FALL 2024", or null for upcoming mode.'),
    page: z.number().int().describe('Current page number.'),
    has_next_page: z.boolean().describe('Whether more pages are available.'),
    total_results: z
      .number()
      .int()
      .nullable()
      .describe('Total entries in this season, or null for upcoming mode.'),
    entries: z
      .array(
        z
          .object({
            id: z.number().int().describe('AniList media ID.'),
            title: z.string().nullable().describe('Romanized title.'),
            title_english: z.string().nullable().describe('English title, or null.'),
            format: z.string().nullable().describe('Format: TV, ONA, OVA, etc.'),
            status: z.string().nullable().describe('Production status.'),
            episodes: z.number().int().nullable().describe('Total episode count, or null.'),
            mean_score: z.number().nullable().describe('AniList mean score 0–100, or null.'),
            cover_image_url: z.string().nullable().describe('Cover image URL, or null.'),
            next_episode: z
              .number()
              .int()
              .nullable()
              .describe('Next episode number, or null if not currently airing.'),
            next_airing_at_utc: z
              .string()
              .nullable()
              .describe('UTC ISO 8601 timestamp of next airing, or null.'),
            time_until_airing_seconds: z
              .number()
              .int()
              .nullable()
              .describe('Seconds until next airing, or null.'),
          })
          .describe('An anime schedule entry.'),
      )
      .describe('Anime entries in the schedule.'),
  }),

  errors: [
    {
      reason: 'invalid_season',
      code: JsonRpcErrorCode.ValidationError,
      when: 'mode is "season" but season or season_year is missing',
      recovery:
        'Provide both season (WINTER/SPRING/SUMMER/FALL) and season_year (e.g. 2024) when using mode "season".',
    },
  ],

  async handler(input, ctx) {
    if (input.mode === 'season') {
      if (!input.season || !input.season_year) {
        throw ctx.fail(
          'invalid_season',
          'mode "season" requires both season and season_year parameters',
        );
      }

      ctx.log.info('Fetching season schedule', { season: input.season, year: input.season_year });

      const page = await anilist.getSeasonSchedule({
        season: input.season,
        seasonYear: input.season_year,
        page: input.page,
        perPage: input.per_page,
        includeAdult: input.include_adult,
      });

      if (page.media.length === 0) {
        ctx.enrich.notice(
          `No entries for ${input.season} ${input.season_year}. Verify the season/year is correct, or try an adjacent season.`,
        );
      }
      if (page.pageInfo.total != null) ctx.enrich.total(page.pageInfo.total);

      type SeasonMediaNode = (typeof page.media)[0] & {
        nextAiringEpisode?: { airingAt: number; episode: number; timeUntilAiring: number } | null;
      };

      return {
        mode: 'season' as const,
        season_label: `${input.season} ${input.season_year}`,
        page: page.pageInfo.currentPage,
        has_next_page: page.pageInfo.hasNextPage,
        total_results: page.pageInfo.total ?? null,
        entries: page.media.map((m: SeasonMediaNode) => ({
          id: m.id,
          title: m.title.romaji,
          title_english: m.title.english,
          format: m.format ?? null,
          status: m.status ?? null,
          episodes: m.episodes ?? null,
          mean_score: m.meanScore ?? null,
          cover_image_url: m.coverImage?.large ?? null,
          next_episode: m.nextAiringEpisode?.episode ?? null,
          next_airing_at_utc: m.nextAiringEpisode
            ? new Date(m.nextAiringEpisode.airingAt * 1000).toISOString()
            : null,
          time_until_airing_seconds: m.nextAiringEpisode?.timeUntilAiring ?? null,
        })),
      };
    }

    // upcoming mode
    ctx.log.info('Fetching upcoming episodes', { daysAhead: input.days_ahead });

    const schedules = await anilist.getUpcomingEpisodes({
      daysAhead: input.days_ahead,
      page: input.page,
      perPage: input.per_page,
    });

    // Sort by airing time
    schedules.sort((a, b) => a.airingAt - b.airingAt);

    if (schedules.length === 0) {
      ctx.enrich.notice(
        `No upcoming episodes found within ${input.days_ahead} day(s). Try increasing days_ahead (max 30).`,
      );
    }

    return {
      mode: 'upcoming' as const,
      season_label: null,
      page: input.page,
      has_next_page: schedules.length >= input.per_page,
      total_results: null,
      entries: schedules.map((s) => ({
        id: s.media.id,
        title: s.media.title.romaji,
        title_english: s.media.title.english,
        format: s.media.format ?? null,
        status: s.media.status ?? null,
        episodes: s.media.episodes ?? null,
        mean_score: s.media.meanScore ?? null,
        cover_image_url: s.media.coverImage?.large ?? null,
        next_episode: s.episode,
        next_airing_at_utc: new Date(s.airingAt * 1000).toISOString(),
        time_until_airing_seconds: s.timeUntilAiring,
      })),
    };
  },

  format: (result) => {
    const lines: string[] = [];

    if (result.mode === 'season') {
      lines.push(
        `## ${result.season_label} Anime Schedule`,
        `mode: ${result.mode} | ${result.total_results !== null ? `${result.total_results} titles` : 'Results'} · page ${result.page}`,
        '',
      );
    } else {
      lines.push('## Upcoming Airing Episodes', `mode: ${result.mode} | Page ${result.page}`, '');
    }

    if (result.entries.length === 0) {
      lines.push('No entries found.');
      return [{ type: 'text', text: lines.join('\n') }];
    }

    for (const entry of result.entries) {
      const displayTitle = entry.title_english ?? entry.title ?? 'Unknown';
      const score = entry.mean_score !== null ? ` · ${entry.mean_score}/100` : '';
      const fmt = entry.format ? ` · ${entry.format}` : '';
      const status = entry.status ? ` status:${entry.status}` : '';
      const cover = entry.cover_image_url ? ` cover:${entry.cover_image_url}` : '';
      const titleRomaji = entry.title ? ` title:${entry.title}` : '';

      if (result.mode === 'upcoming' && entry.next_airing_at_utc) {
        const seconds = entry.time_until_airing_seconds ?? 0;
        const hours = Math.floor(seconds / 3600);
        const days = Math.floor(hours / 24);
        const countdown = days > 0 ? `${days}d ${hours % 24}h` : `${hours}h`;
        lines.push(
          `**${displayTitle}** [AL:${entry.id}]${fmt}${score}${status}${titleRomaji}`,
          `  Ep ${entry.next_episode} in **${countdown}** — ${entry.next_airing_at_utc} (time_until_airing_seconds:${entry.time_until_airing_seconds ?? 0})${cover}`,
        );
      } else {
        const ep = entry.episodes !== null ? ` · ${entry.episodes} eps` : '';
        const airing = entry.next_airing_at_utc
          ? ` · Next ep ${entry.next_episode}: ${entry.next_airing_at_utc} (time_until_airing_seconds:${entry.time_until_airing_seconds ?? 0})`
          : '';
        lines.push(
          `**${displayTitle}** [AL:${entry.id}]${fmt}${ep}${score}${status}${airing}${titleRomaji}${cover}`,
        );
      }
    }

    if (result.has_next_page) {
      lines.push('', `_More results available (page ${result.page + 1})._`);
    }

    return [{ type: 'text', text: lines.join('\n') }];
  },
});
