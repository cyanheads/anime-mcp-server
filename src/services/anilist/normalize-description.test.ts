/**
 * @fileoverview Characterize description normalization and single-pass entity decoding.
 * @module services/anilist/normalize-description.test
 */
import { expect, it } from 'vitest';
import { normalizeAniListDescription } from './normalize-description.js';

it.each([
  [null, null],
  ['', ''],
  ['<p>First<br>line.</p><p>Second.</p>', 'First\nline.\nSecond.'],
  ['&nbsp;A &amp; B &lt;x&gt; &quot;q&quot; &#39;a&#x27;&nbsp;', 'A & B <x> "q" \'a\''],
  ['&unknown; &#65;', '&unknown; &#65;'],
])('preserves existing normalization for %s', (input, expected) => {
  expect(normalizeAniListDescription(input)).toBe(expected);
});

it.each([
  ['&amp;lt;b&amp;gt;', '&lt;b&gt;'],
  ['&amp;quot;x&amp;quot; &amp;#39;y&amp;#x27;', '&quot;x&quot; &#39;y&#x27;'],
  ['&amp;amp; &AMP;LT;', '&amp; &LT;'],
])('decodes each original entity only once: %s', (input, expected) => {
  expect(normalizeAniListDescription(input)).toBe(expected);
});
