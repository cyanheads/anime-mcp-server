/**
 * @fileoverview anime_get_media tool — full detail for one anime or manga by AniList ID.
 * Fans out to Jikan (MAL score) and Kitsu (streaming links) in parallel.
 * @module mcp-server/tools/definitions/anime-get-media.tool
 */

import { tool, z } from '@cyanheads/mcp-ts-core';
import { JsonRpcErrorCode } from '@cyanheads/mcp-ts-core/errors';
import * as anilist from '@/services/anilist/anilist-service.js';
import * as jikan from '@/services/jikan/jikan-service.js';
import * as kitsu from '@/services/kitsu/kitsu-service.js';

export const animeGetMedia = tool('anime_get_media', {
  description:
    'Full detail for one anime or manga by AniList ID. Returns synopsis, format, episode/chapter count, ' +
    'status, season, studios, source material, genres and tags (spoiler-flagged), ' +
    'AniList and MAL scores side by side, streaming links, cover/banner, and direct relations. ' +
    'Use anime_search_media first to find the AniList ID.',
  annotations: { readOnlyHint: true, idempotentHint: true },

  input: z.object({
    id: z
      .number()
      .int()
      .min(1)
      .describe('AniList media ID. Obtain from anime_search_media results.'),
    include_adult: z
      .boolean()
      .default(false)
      .describe('Include adult/NSFW content. Default false.'),
  }),

  output: z.object({
    id: z.number().int().describe('AniList media ID.'),
    id_mal: z
      .number()
      .int()
      .nullable()
      .describe('MyAnimeList ID used to cross-reference MAL data, or null.'),
    type: z.enum(['ANIME', 'MANGA']).describe('Media type.'),
    title: z
      .object({
        romaji: z.string().nullable().describe('Romanized title.'),
        english: z.string().nullable().describe('English title, or null.'),
        native: z.string().nullable().describe('Native script title, or null.'),
      })
      .describe('Title variants.'),
    format: z.string().nullable().describe('Format: TV, MOVIE, OVA, ONA, MANGA, NOVEL, etc.'),
    status: z.string().nullable().describe('Production status.'),
    season: z.string().nullable().describe('Broadcast season label, e.g. "FALL 2023", or null.'),
    description: z.string().nullable().describe('Normalized full plot synopsis text, or null.'),
    source: z
      .string()
      .nullable()
      .describe('Source material type, e.g. "MANGA", "LIGHT_NOVEL", "ORIGINAL".'),
    episodes: z.number().int().nullable().describe('Total episode count (anime), or null.'),
    chapters: z.number().int().nullable().describe('Total chapter count (manga), or null.'),
    volumes: z.number().int().nullable().describe('Total volume count (manga), or null.'),
    genres: z.array(z.string().describe('A genre label.')).describe('Genre list.'),
    tags: z
      .array(
        z
          .object({
            name: z.string().describe('Tag name.'),
            category: z.string().nullable().describe('Tag category, or null.'),
            rank: z.number().int().nullable().describe('Relevance rank 0–100, or null.'),
            is_spoiler: z
              .boolean()
              .describe('True when AniList marks this tag as a general spoiler.'),
            is_adult: z.boolean().describe('True when this is an adult tag.'),
          })
          .describe('A content tag entry.'),
      )
      .describe('Content tags. Spoiler-flagged tags include is_spoiler: true.'),
    studios: z
      .array(
        z
          .object({
            id: z.number().int().describe('AniList studio ID.'),
            name: z.string().describe('Studio name.'),
            is_main: z.boolean().describe('True when this is the primary production studio.'),
            is_animation_studio: z.boolean().describe('True when this is an animation studio.'),
          })
          .describe('A studio entry.'),
      )
      .describe('Production studios.'),
    scores: z
      .object({
        anilist_mean: z
          .number()
          .nullable()
          .describe('AniList mean score 0–100, from AniList community votes.'),
        anilist_average: z.number().nullable().describe('AniList weighted average score 0–100.'),
        anilist_popularity: z
          .number()
          .nullable()
          .describe('Number of AniList users with this in their list.'),
        mal_score: z
          .number()
          .nullable()
          .describe(
            'MAL score 0–10.0, from MyAnimeList community. Null when MAL data unavailable.',
          ),
        mal_scored_by: z.number().nullable().describe('Number of MAL users who scored this entry.'),
        mal_rank: z.number().nullable().describe('MAL rank by score, or null.'),
        mal_popularity: z
          .number()
          .nullable()
          .describe('MAL popularity rank (by list count), or null.'),
      })
      .describe(
        'Community scores. AniList uses a 0–100 scale; MAL uses 0–10.0. Both are returned separately.',
      ),
    streaming_links: z
      .array(
        z
          .object({
            site: z.string().describe('Platform name, e.g. "Crunchyroll", "Netflix".'),
            url: z.string().describe('Link to the streaming page.'),
            subs: z
              .array(z.string().describe('A language code or name.'))
              .describe('Subtitle languages available on this platform.'),
            dubs: z
              .array(z.string().describe('A language code or name.'))
              .describe('Dub languages available on this platform.'),
            source: z.enum(['kitsu', 'anilist']).describe('Which service provided this link.'),
          })
          .describe('A streaming platform link entry.'),
      )
      .describe(
        'Streaming platform links (anime only). Empty for manga or when no streaming data is available.',
      ),
    relations: z
      .array(
        z
          .object({
            relation_type: z
              .string()
              .describe(
                'Relation type: SEQUEL, PREQUEL, SIDE_STORY, SPIN_OFF, ALTERNATIVE, SOURCE, ADAPTATION, etc.',
              ),
            id: z.number().int().describe('AniList ID of the related entry.'),
            title: z.string().nullable().describe('Romanized title of the related entry.'),
            type: z.string().nullable().describe('Media type of the related entry.'),
            format: z.string().nullable().describe('Format of the related entry.'),
            status: z.string().nullable().describe('Status of the related entry.'),
          })
          .describe('A relation entry.'),
      )
      .describe(
        'Direct relations. Use anime_get_relations for full franchise walk-order across multiple hops.',
      ),
    cover_image_url: z.string().nullable().describe('Cover image URL (extra large), or null.'),
    banner_image_url: z.string().nullable().describe('Banner image URL, or null.'),
    site_url: z.string().nullable().describe('AniList page URL.'),
    next_airing: z
      .object({
        episode: z.number().int().describe('Next episode number.'),
        airing_at_utc: z.string().describe('UTC ISO 8601 timestamp of the next airing.'),
        time_until_airing_seconds: z.number().int().describe('Seconds until next airing from now.'),
      })
      .nullable()
      .describe('Next airing episode info for currently airing anime, or null.'),
    is_adult: z.boolean().describe('Whether this entry is marked adult/NSFW.'),
    data_sources: z
      .object({
        anilist: z.boolean().describe('True when AniList data was successfully retrieved.'),
        mal: z.boolean().describe('True when MAL/Jikan data was successfully retrieved.'),
        kitsu: z.boolean().describe('True when Kitsu streaming data was successfully retrieved.'),
      })
      .describe('Provenance: which sources contributed data to this response.'),
  }),

  errors: [
    {
      reason: 'not_found',
      code: JsonRpcErrorCode.NotFound,
      when: 'AniList returns null for the given ID (invalid or nonexistent)',
      recovery: 'Use anime_search_media to find a valid AniList ID and retry.',
    },
  ],

  async handler(input, ctx) {
    ctx.log.info('Fetching media detail', { id: input.id });

    const detail = await anilist.getMediaById(input.id, input.include_adult);

    if (!detail) {
      throw ctx.fail('not_found', `No media found with AniList ID ${input.id}`, {
        ...ctx.recoveryFor('not_found'),
      });
    }

    const mediaType = detail.type;

    // Fan out to Jikan + Kitsu in parallel (supplements only)
    const [jikanResult, kitsuResult] = await Promise.allSettled([
      detail.idMal ? jikan.getMediaFull(detail.idMal, mediaType) : Promise.resolve(null),
      mediaType === 'ANIME' && detail.idMal
        ? kitsu.getAnimeStreamingByMalId(detail.idMal)
        : Promise.resolve(null),
    ]);

    const jikanData = jikanResult.status === 'fulfilled' ? jikanResult.value : null;
    const kitsuData = kitsuResult.status === 'fulfilled' ? kitsuResult.value : null;

    if (jikanResult.status === 'rejected') {
      ctx.log.warning('Jikan supplement failed', {
        id: input.id,
        error: String(jikanResult.reason),
      });
    }
    if (kitsuResult.status === 'rejected') {
      ctx.log.warning('Kitsu supplement failed', {
        id: input.id,
        error: String(kitsuResult.reason),
      });
    }

    // Build streaming links: Kitsu primary, AniList externalLinks fallback
    const streamingLinks: Array<{
      site: string;
      url: string;
      subs: string[];
      dubs: string[];
      source: 'kitsu' | 'anilist';
    }> = [];

    if (kitsuData?.streamingLinks?.length) {
      for (const link of kitsuData.streamingLinks) {
        // Extract site name from URL
        const site = extractSiteName(link.url);
        streamingLinks.push({
          site,
          url: link.url,
          subs: link.subs,
          dubs: link.dubs,
          source: 'kitsu',
        });
      }
    } else if (mediaType === 'ANIME') {
      // Fall back to AniList externalLinks
      for (const link of detail.externalLinks ?? []) {
        if (link.type === 'STREAMING' && link.url) {
          streamingLinks.push({
            site: link.site,
            url: link.url,
            subs: [],
            dubs: [],
            source: 'anilist',
          });
        }
      }
    }

    const season =
      detail.season && detail.seasonYear
        ? `${detail.season} ${detail.seasonYear}`
        : (detail.season ?? null);

    return {
      id: detail.id,
      id_mal: detail.idMal ?? null,
      type: detail.type,
      title: {
        romaji: detail.title.romaji,
        english: detail.title.english,
        native: detail.title.native,
      },
      format: detail.format ?? null,
      status: detail.status ?? null,
      season,
      description: detail.description ?? null,
      source: detail.source ?? null,
      episodes: detail.episodes ?? null,
      chapters: detail.chapters ?? null,
      volumes: detail.volumes ?? null,
      genres: detail.genres ?? [],
      tags: (detail.tags ?? []).map((t) => ({
        name: t.name,
        category: t.category ?? null,
        rank: t.rank ?? null,
        is_spoiler: t.isGeneralSpoiler,
        is_adult: t.isAdult,
      })),
      studios: (detail.studios?.edges ?? []).map((e) => ({
        id: e.node.id,
        name: e.node.name,
        is_main: e.isMain,
        is_animation_studio: e.node.isAnimationStudio,
      })),
      scores: {
        anilist_mean: detail.meanScore ?? null,
        anilist_average: detail.averageScore ?? null,
        anilist_popularity: detail.popularity ?? null,
        mal_score: jikanData?.score ?? null,
        mal_scored_by: jikanData?.scored_by ?? null,
        mal_rank: jikanData?.rank ?? null,
        mal_popularity: jikanData?.popularity ?? null,
      },
      streaming_links: streamingLinks,
      relations: (detail.relations?.edges ?? []).map((e) => ({
        relation_type: e.relationType,
        id: e.node.id,
        title: e.node.title.romaji,
        type: e.node.type ?? null,
        format: e.node.format ?? null,
        status: e.node.status ?? null,
      })),
      cover_image_url: detail.coverImage?.extraLarge ?? null,
      banner_image_url: detail.bannerImage ?? null,
      site_url: detail.siteUrl ?? null,
      next_airing: detail.nextAiringEpisode
        ? {
            episode: detail.nextAiringEpisode.episode,
            airing_at_utc: new Date(detail.nextAiringEpisode.airingAt * 1000).toISOString(),
            time_until_airing_seconds: detail.nextAiringEpisode.timeUntilAiring,
          }
        : null,
      is_adult: detail.isAdult,
      data_sources: {
        anilist: true,
        mal: jikanData !== null,
        kitsu: kitsuData !== null,
      },
    };
  },

  format: (result) => {
    const title = result.title.english ?? result.title.romaji ?? result.title.native ?? 'Unknown';
    const lines: string[] = [];

    lines.push(`## ${title}`);
    if (result.title.romaji && result.title.romaji !== title)
      lines.push(`*${result.title.romaji}*`);
    lines.push('');

    const meta: string[] = [];
    if (result.format) meta.push(result.format);
    if (result.status) meta.push(result.status);
    if (result.season) meta.push(result.season);
    if (result.type === 'ANIME' && result.episodes) meta.push(`${result.episodes} episodes`);
    if (result.type === 'MANGA' && result.chapters) meta.push(`${result.chapters} chapters`);
    if (result.source) meta.push(`Source: ${result.source}`);
    if (meta.length) lines.push(meta.join(' · '), '');

    if (result.description) {
      lines.push(
        result.description.slice(0, 500) + (result.description.length > 500 ? '…' : ''),
        '',
      );
    }

    // Scores
    const scores: string[] = [];
    if (result.scores.anilist_mean !== null) {
      scores.push(
        `AniList: ${result.scores.anilist_mean}/100${result.scores.anilist_popularity !== null ? ` (${result.scores.anilist_popularity.toLocaleString()} users)` : ''}`,
      );
    }
    if (result.scores.mal_score !== null) {
      scores.push(
        `MAL: ${result.scores.mal_score}/10${result.scores.mal_scored_by !== null ? ` (${result.scores.mal_scored_by.toLocaleString()} users)` : ''}`,
      );
    }
    if (scores.length) lines.push(`**Scores:** ${scores.join(' · ')}`, '');

    // Genres + tags (non-spoiler)
    if (result.genres.length) lines.push(`**Genres:** ${result.genres.join(', ')}`);
    const visibleTags = result.tags.filter((t) => !t.is_spoiler && !t.is_adult).slice(0, 10);
    if (visibleTags.length) lines.push(`**Tags:** ${visibleTags.map((t) => t.name).join(', ')}`);
    const spoilerCount = result.tags.filter((t) => t.is_spoiler).length;
    if (spoilerCount) lines.push(`*${spoilerCount} spoiler tag(s) hidden. See tags array.*`);
    if (result.genres.length || visibleTags.length) lines.push('');

    // Studios
    if (result.studios.length) {
      const mainStudios = result.studios.filter((s) => s.is_main).map((s) => s.name);
      if (mainStudios.length) lines.push(`**Studio(s):** ${mainStudios.join(', ')}`);
    }

    // Streaming links
    if (result.streaming_links.length) {
      lines.push('', `**Streaming:** ${result.streaming_links.map((s) => s.site).join(', ')}`);
    }

    // Relations
    if (result.relations.length) {
      lines.push('', '**Relations:**');
      for (const rel of result.relations.slice(0, 10)) {
        lines.push(`- ${rel.relation_type}: ${rel.title ?? 'Untitled'} [AL:${rel.id}]`);
      }
    }

    // Next airing
    if (result.next_airing) {
      const seconds = result.next_airing.time_until_airing_seconds;
      const hours = Math.floor(seconds / 3600);
      const days = Math.floor(hours / 24);
      const countdown = days > 0 ? `${days}d ${hours % 24}h` : `${hours}h`;
      lines.push(
        '',
        `**Next airing:** Episode ${result.next_airing.episode} in ${countdown} (${result.next_airing.airing_at_utc})`,
      );
    }

    // IDs and supplementary data
    const idParts = [`AL:${result.id}`];
    if (result.id_mal) idParts.push(`MAL:${result.id_mal}`);
    lines.push(
      '',
      `**IDs:** ${idParts.join(' · ')} | is_adult: ${result.is_adult}`,
      `**Volumes:** ${result.volumes ?? 'N/A'} | Chapters: ${result.chapters ?? 'N/A'}`,
      `**Cover:** ${result.cover_image_url ?? 'none'} | Banner: ${result.banner_image_url ?? 'none'}`,
      `**Title native:** ${result.title.native ?? 'none'} | Site: ${result.site_url ?? 'none'}`,
    );

    // Scores detail (all fields must appear)
    lines.push(
      '',
      `**Scores detail:** anilist_mean=${result.scores.anilist_mean} anilist_average=${result.scores.anilist_average} anilist_popularity=${result.scores.anilist_popularity} ` +
        `mal_score=${result.scores.mal_score} mal_scored_by=${result.scores.mal_scored_by} mal_rank=${result.scores.mal_rank} mal_popularity=${result.scores.mal_popularity}`,
      `**Data sources:** anilist=${result.data_sources.anilist} mal=${result.data_sources.mal} kitsu=${result.data_sources.kitsu}`,
    );

    // Tags full (for parity — include category, rank, is_adult)
    if (result.tags.length) {
      const tagDetail = result.tags
        .slice(0, 5)
        .map(
          (t) =>
            `${t.name}(cat:${t.category ?? '?'} rank:${t.rank ?? '?'} spoiler:${t.is_spoiler} is_adult:${t.is_adult})`,
        )
        .join(', ');
      lines.push(`**Tag detail:** ${tagDetail}`);
    }

    // Studios detail (id, is_animation_studio)
    if (result.studios.length) {
      const studioDetail = result.studios
        .map((s) => `${s.name}[id:${s.id} main:${s.is_main} anim:${s.is_animation_studio}]`)
        .join(', ');
      lines.push(`**Studio detail:** ${studioDetail}`);
    }

    // Streaming detail (url, subs, dubs, source)
    if (result.streaming_links.length) {
      const streamDetail = result.streaming_links
        .map(
          (s) =>
            `${s.site}(url:${s.url} subs:${s.subs.join(',')} dubs:${s.dubs.join(',')} src:${s.source})`,
        )
        .join(' | ');
      lines.push(`**Stream detail:** ${streamDetail}`);
    }

    // Relations detail (type, format, status)
    if (result.relations.length) {
      const relDetail = result.relations
        .slice(0, 5)
        .map(
          (r) =>
            `${r.relation_type}:${r.title ?? '?'}[type:${r.type} fmt:${r.format} status:${r.status}]`,
        )
        .join(', ');
      lines.push(`**Relation detail:** ${relDetail}`);
    }

    // Next airing all fields
    if (result.next_airing) {
      lines.push(
        `**Next airing full:** episode=${result.next_airing.episode} airing_at_utc=${result.next_airing.airing_at_utc} time_until_airing_seconds=${result.next_airing.time_until_airing_seconds}`,
      );
    }

    return [{ type: 'text', text: lines.join('\n') }];
  },
});

/** Extract a human-readable site name from a URL. */
function extractSiteName(url: string): string {
  try {
    const hostname = new URL(url).hostname.replace(/^www\./, '');
    const known: Record<string, string> = {
      'crunchyroll.com': 'Crunchyroll',
      'funimation.com': 'Funimation',
      'netflix.com': 'Netflix',
      'hidive.com': 'HIDIVE',
      'hulu.com': 'Hulu',
      'amazon.com': 'Amazon Prime',
      'primevideo.com': 'Amazon Prime',
      'vrv.co': 'VRV',
      'youtube.com': 'YouTube',
      'wakanim.tv': 'Wakanim',
      'bilibili.com': 'Bilibili',
      'animelab.com': 'AnimeLab',
    };
    return known[hostname] ?? hostname;
  } catch {
    return url;
  }
}
