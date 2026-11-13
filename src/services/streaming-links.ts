/**
 * @fileoverview Shared streaming projection for anime media details and resource counts.
 * @module services/streaming-links
 */

import type { ExternalLink } from './anilist/types.js';
import type { KitsuStreamingLink } from './kitsu/types.js';

type StreamingLink = {
  site: string;
  url: string;
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

/** Keep the first usable link for each hostname, preferring Kitsu's language metadata. */
export function mergeStreamingLinks(
  kitsuLinks: readonly KitsuStreamingLink[],
  anilistLinks: readonly Pick<ExternalLink, 'type' | 'isDisabled' | 'site' | 'url'>[],
): StreamingLink[] {
  const links = new Map<string, StreamingLink>();
  for (const { url, subs, dubs } of kitsuLinks) {
    const hostname = streamingHostname(url);
    if (!hostname || links.has(hostname)) continue;
    links.set(hostname, {
      site: SITE_NAMES.get(hostname) ?? hostname,
      url,
      subs,
      dubs,
      source: 'kitsu',
    });
  }
  for (const { type, isDisabled, site, url } of anilistLinks) {
    if (type !== 'STREAMING' || isDisabled || !url) continue;
    const hostname = streamingHostname(url);
    if (!hostname || links.has(hostname)) continue;
    links.set(hostname, { site, url, subs: [], dubs: [], source: 'anilist' });
  }
  return [...links.values()];
}
