/**
 * @fileoverview Shared streaming projection for anime media details and resource counts.
 * @module services/streaming-links
 */

import type { ExternalLink, MediaDetail } from './anilist/types.js';
import type { KitsuStreamingLink } from './kitsu/types.js';

type StreamingLink = {
  site: string;
  url: string;
  language: string | null;
  subs: string[];
  dubs: string[];
  source: 'kitsu' | 'anilist';
};

const SITE_NAMES = new Map([
  ['crunchyroll.com', 'Crunchyroll'],
  ['funimation.com', 'Funimation'],
  ['netflix.com', 'Netflix'],
  ['hidive.com', 'HIDIVE'],
  ['hulu.com', 'Hulu'],
  ['amazon.com', 'Amazon Prime'],
  ['primevideo.com', 'Amazon Prime'],
  ['vrv.co', 'VRV'],
  ['youtube.com', 'YouTube'],
  ['wakanim.tv', 'Wakanim'],
  ['bilibili.com', 'Bilibili'],
  ['animelab.com', 'AnimeLab'],
]);

function streamingHostname(url: string): string | undefined {
  // The original URL must fit inside a Markdown link destination.
  if (url.includes('\r') || url.includes('\n')) return;
  const parsed = URL.parse(url);
  if (parsed?.protocol !== 'https:' && parsed?.protocol !== 'http:') return;
  const hostname = parsed.hostname.toLowerCase();
  return hostname.startsWith('www.') ? hostname.slice(4) : hostname;
}

/** Keep one anime link per hostname or one manga link per hostname and language. */
export function mergeStreamingLinks(
  mediaType: MediaDetail['type'],
  kitsuLinks: readonly KitsuStreamingLink[],
  anilistLinks: readonly Pick<ExternalLink, 'type' | 'isDisabled' | 'site' | 'url' | 'language'>[],
): StreamingLink[] {
  const links = new Map<string, StreamingLink>();
  for (const { url, subs, dubs } of mediaType === 'ANIME' ? kitsuLinks : []) {
    const hostname = streamingHostname(url);
    if (!hostname || links.has(hostname)) continue;
    links.set(hostname, {
      site: SITE_NAMES.get(hostname) ?? hostname,
      url,
      language: null,
      subs,
      dubs,
      source: 'kitsu',
    });
  }
  for (const { type, isDisabled, site, url, language } of anilistLinks) {
    if (type !== 'STREAMING' || isDisabled || !url) continue;
    const hostname = streamingHostname(url);
    if (!hostname) continue;
    const key = mediaType === 'MANGA' ? JSON.stringify([hostname, language]) : hostname;
    if (links.has(key)) continue;
    links.set(key, {
      site,
      url,
      language: language ?? null,
      subs: [],
      dubs: [],
      source: 'anilist',
    });
  }
  return [...links.values()];
}
