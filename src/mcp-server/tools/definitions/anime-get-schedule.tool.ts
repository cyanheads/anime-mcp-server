/**
 * @fileoverview anime_get_schedule tool — airing schedule for a season or upcoming episode window.
 * @module mcp-server/tools/definitions/anime-get-schedule.tool
 */

import { tool, z } from '@cyanheads/mcp-ts-core';
import { JsonRpcErrorCode } from '@cyanheads/mcp-ts-core/errors';
import * as anilist from '@/services/anilist/anilist-service.js';
import {
  exactResultCount,
  nextPageOutOfReach,
  nextPageReachable,
  PAGE_DEPTH_EDGE_NOTICE,
  pastEndNotice,
} from '@/services/anilist/pagination.js';

const SeasonEnum = z
  .enum(['WINTER', 'SPRING', 'SUMMER', 'FALL'])
  .describe(
    'Anime broadcast season. WINTER=Jan–Mar, SPRING=Apr–Jun, SUMMER=Jul–Sep, FALL=Oct–Dec.',
  );

/** Days ahead the upcoming window covers when the caller does not set days_ahead. */
const DEFAULT_DAYS_AHEAD = 7;

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
    season: SeasonEnum.optional().describe(
      'Season to list. Required with mode "season"; rejected with mode "upcoming".',
    ),
    season_year: z
      .number()
      .int()
      .min(1940)
      .max(2100)
      .optional()
      .describe('4-digit year. Required with mode "season"; rejected with mode "upcoming".'),
    days_ahead: z
      .number()
      .int()
      .min(1)
      .max(30)
      .optional()
      .describe(
        'Days ahead to look for upcoming episodes, 1–30. Mode "upcoming" only (rejected with mode "season"); 7 when omitted.',
      ),
    page: z
      .number()
      .int()
      .min(1)
      .default(1)
      .describe(
        '1-based page number. AniList serves only the first 5,000 entries of a list, so page × per_page must stay at or below 5,000.',
      ),
    per_page: z
      .number()
      .int()
      .min(1)
      .max(50)
      .default(25)
      .describe('Results per page. Maximum 50; page × per_page must stay at or below 5,000.'),
    include_adult: z.boolean().default(false).describe('Include adult/NSFW titles. Default false.'),
  }),

  enrichment: {
    notice: z
      .string()
      .optional()
      .describe(
        'Set when entries is empty — echoes the applied mode/season and how to broaden it, says the page is past the end of the list, or (upcoming mode) says every episode on the page was an adult title hidden by include_adult. Also set on the last season page AniList serves (its 5,000-entry reach) while has_next_page is still true.',
      ),
    totalCount: z
      .number()
      .int()
      .optional()
      .describe(
        'Exact number of titles in the season, set only on its final page (0 for an empty first page); season mode only. Use has_next_page to paginate.',
      ),
  },

  output: z.object({
    mode: z.enum(['season', 'upcoming']).describe('Mode used for this response.'),
    season_label: z
      .string()
      .nullable()
      .describe('Human-readable season label, e.g. "FALL 2024", or null for upcoming mode.'),
    page: z.number().int().describe('Current page number.'),
    has_next_page: z
      .boolean()
      .describe('Whether more pages are available. Drives pagination; stop when false.'),
    total_results: z
      .number()
      .int()
      .nullable()
      .describe(
        'Exact number of titles in the season, present only on its final page (has_next_page false) and 0 for an empty first page. Null on every other page and always null in upcoming mode.',
      ),
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
    {
      reason: 'conflicting_inputs',
      code: JsonRpcErrorCode.ValidationError,
      when: 'mode "upcoming" is sent with season or season_year, or mode "season" with days_ahead',
      recovery:
        'Drop the fields the chosen mode does not use: season and season_year apply only to mode "season", and days_ahead applies only to mode "upcoming".',
    },
    {
      reason: 'page_depth_exceeded',
      code: JsonRpcErrorCode.ValidationError,
      when: 'page × per_page reaches past the first 5,000 entries, which AniList refuses to serve',
      recovery:
        'AniList serves only the first 5,000 entries of a result list, so page × per_page must stay at or below 5,000. Narrow the criteria so fewer entries match, or request a lower page.',
      thrownBy: 'service',
    },
  ],

  async handler(input, ctx) {
    const irrelevant =
      input.mode === 'upcoming'
        ? [
            ...(input.season ? ['season'] : []),
            ...(input.season_year !== undefined ? ['season_year'] : []),
          ]
        : input.days_ahead !== undefined
          ? ['days_ahead']
          : [];
    if (irrelevant.length > 0) {
      throw ctx.fail(
        'conflicting_inputs',
        `mode "${input.mode}" does not use ${irrelevant.join(', ')}; drop ${irrelevant.length > 1 ? 'them' : 'it'} or switch mode`,
      );
    }

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

      const seasonLabel = `${input.season} ${input.season_year}`;
      const { currentPage, hasNextPage, perPage } = page.pageInfo;
      const total = exactResultCount({
        page: currentPage,
        perPage,
        hasNextPage,
        entriesOnPage: page.media.length,
      });
      if (total !== null) ctx.enrich.total(total);

      const notices: string[] = [];
      if (page.media.length === 0) {
        notices.push(
          currentPage > 1
            ? pastEndNotice(currentPage, `the ${seasonLabel} schedule`)
            : `No entries for ${seasonLabel}. Verify the season/year is correct, or try an adjacent season.`,
        );
      }
      if (nextPageOutOfReach({ page: currentPage, perPage, hasNextPage })) {
        notices.push(PAGE_DEPTH_EDGE_NOTICE);
      }
      if (notices.length > 0) ctx.enrich.notice(notices.join(' '));

      type SeasonMediaNode = (typeof page.media)[0] & {
        nextAiringEpisode?: { airingAt: number; episode: number; timeUntilAiring: number } | null;
      };

      return {
        mode: 'season' as const,
        season_label: seasonLabel,
        page: currentPage,
        has_next_page: hasNextPage,
        total_results: total,
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
    const daysAhead = input.days_ahead ?? DEFAULT_DAYS_AHEAD;
    ctx.log.info('Fetching upcoming episodes', { daysAhead });

    const upcoming = await anilist.getUpcomingEpisodes({
      daysAhead,
      page: input.page,
      perPage: input.per_page,
    });

    const schedules = upcoming.airingSchedules
      .filter((schedule) => input.include_adult || !schedule.media.isAdult)
      .sort((a, b) => a.airingAt - b.airingAt);

    if (schedules.length === 0) {
      const hidden = upcoming.airingSchedules.length;
      ctx.enrich.notice(
        hidden > 0
          ? `All ${hidden} episode(s) on page ${input.page} are adult titles, hidden because include_adult is false.${upcoming.hasNextPage ? ` Continue with page ${input.page + 1}.` : ''}`
          : input.page > 1
            ? pastEndNotice(input.page, `the ${daysAhead}-day upcoming window`)
            : `No upcoming episodes found within ${daysAhead} day(s). Try increasing days_ahead (max 30).`,
      );
    }

    return {
      mode: 'upcoming' as const,
      season_label: null,
      page: input.page,
      has_next_page: upcoming.hasNextPage,
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

    // Upcoming pages are filtered for adult titles after the fetch, so their row count
    // says nothing about the page size.
    const nextReachable =
      result.mode === 'season'
        ? nextPageReachable({
            page: result.page,
            hasNextPage: result.has_next_page,
            rowsOnPage: result.entries.length,
          })
        : result.has_next_page;
    if (nextReachable) {
      lines.push('', `_More results available (page ${result.page + 1})._`);
    }

    return [{ type: 'text', text: lines.join('\n') }];
  },
});
