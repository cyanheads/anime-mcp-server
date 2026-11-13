/**
 * @fileoverview Verify the shared streaming-link projection.
 * @module tests/services/streaming-links.test
 */
import { expect, it } from 'vitest';
import { mergeStreamingLinks } from '@/services/streaming-links.js';

it('keeps the first usable row per normalized hostname, with Kitsu first', () => {
  const netflix = { id: '1', url: 'https://WWW.Netflix.com/a', subs: ['en'], dubs: ['ja'] };
  const youtube = {
    type: 'STREAMING',
    site: 'YouTube',
    url: 'https://youtube.com/b',
    isDisabled: false,
  };
  expect(
    mergeStreamingLinks(
      [
        netflix,
        { ...netflix, id: '2', url: 'https://netflix.com/b', dubs: ['en'] },
        { ...netflix, id: '3', url: 'https://constructor/show' },
      ],
      [
        { ...youtube, site: 'Netflix AniList', url: 'http://netflix.com/c' },
        { ...youtube, url: 'https://youtube.com/disabled', isDisabled: true },
        youtube,
        { ...youtube, url: 'https://www.youtube.com/c' },
        { ...youtube, site: 'YouTube Music', url: 'https://music.youtube.com/d' },
      ],
    ),
  ).toEqual([
    { site: 'Netflix', url: netflix.url, subs: ['en'], dubs: ['ja'], source: 'kitsu' },
    {
      site: 'constructor',
      url: 'https://constructor/show',
      subs: ['en'],
      dubs: ['ja'],
      source: 'kitsu',
    },
    { site: 'YouTube', url: youtube.url, subs: [], dubs: [], source: 'anilist' },
    {
      site: 'YouTube Music',
      url: 'https://music.youtube.com/d',
      subs: [],
      dubs: [],
      source: 'anilist',
    },
  ]);
});

it('skips unusable URLs and non-streaming records when Kitsu is absent', () => {
  const link = { type: 'STREAMING', site: 'Hulu', url: 'https://hulu.com/a', isDisabled: false };
  expect(
    mergeStreamingLinks(
      [],
      [
        { ...link, url: null },
        { ...link, url: '/relative' },
        { ...link, url: 'javascript:alert(1)' },
        { ...link, url: 'https://hulu.com/a\n' },
        { ...link, type: 'INFO' },
        link,
      ],
    ),
  ).toEqual([{ site: 'Hulu', url: link.url, subs: [], dubs: [], source: 'anilist' }]);
  expect(
    mergeStreamingLinks([{ id: '1', url: 'ftp://example.com/a', subs: [], dubs: [] }], []),
  ).toEqual([]);
});
