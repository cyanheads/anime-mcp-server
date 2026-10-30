/**
 * @fileoverview Render-boundary correctness and thread-CPU scaling checks.
 * @module tests/tools/render-text.test
 */

import { escapeMarkdownInline, markdownImage, markdownLink } from '@cyanheads/mcp-ts-core/utils';
import { Parser } from 'commonmark';
import { describe, expect, it } from 'vitest';
import { fullTextJson, headingText } from '@/mcp-server/tools/render-text.js';
import { expectLiteralProse } from '../helpers/markdown.js';

describe('provider summary boundary', () => {
  it.each([
    '\\`*_{}[]()#+.!|~-',
    '<tag>&amp;',
    '\r\n\u2028\u2029',
    '```\n## heading\n[link](url)',
    'AT&T Re:Zero - (2016) TV_SHORT',
    ' # heading #\r\n\n- item\n<script> &copy;',
  ])('preserves literal provider prose in %j', (value) => {
    expectLiteralProse([{ type: 'text', text: escapeMarkdownInline(value) }], value);
  });
  it('contains multiline names in one heading without interpreting their syntax', () => {
    const value = '*Name*\r\n## second\n<script> &copy;';
    const markdown = `## ${headingText(value)} suffix`;
    const tree = new Parser().parse(markdown);
    expect(tree.firstChild?.type).toBe('heading');
    expect(tree.firstChild?.next).toBeNull();
    expectLiteralProse([{ type: 'text', text: markdown }], value);
  });
  it.each([
    ['https://example.com/a_(b).jpg?x=1&y=2#part', 'https://example.com/a_(b).jpg?x=1&y=2#part'],
    [
      'https://example.com/q?entity=&copy;&x=<tag>',
      'https://example.com/q?entity=&copy;&x=%3Ctag%3E',
    ],
  ])('preserves link and image destinations %s', (url, parsedDestination) => {
    const tree = new Parser().parse(
      `${markdownLink('*site*', url)} ${markdownImage('[cover]', url)}`,
    );
    const walker = tree.walker();
    const destinations: string[] = [];
    for (let event = walker.next(); event; event = walker.next()) {
      if (event.entering && (event.node.type === 'link' || event.node.type === 'image'))
        destinations.push(event.node.destination!);
    }
    expect(destinations).toEqual([parsedDestination, parsedDestination]);
  });
  it.each([
    'javascript:alert(1)',
    'data:text/html,<script>x</script>',
    '/relative',
    'https://example.com/\n[bad](javascript:x)',
  ])('keeps unsafe destination literal: %s', (url) => {
    const markdown = `${markdownLink('site', url)} ${markdownImage('cover', url)}`;
    const walker = new Parser().parse(markdown).walker();
    for (let event = walker.next(); event; event = walker.next()) {
      if (event.entering)
        expect(['link', 'image', 'html_inline', 'html_block']).not.toContain(event.node.type);
    }
    expectLiteralProse([{ type: 'text', text: markdown }], url);
  });
  it('round-trips full JSON including hostile fences, nulls and recursive arrays', () => {
    const source = {
      title: '``````\r\n```',
      nested: [{ empty: null, text: '<tag>_[x](y)', next: ['`', '\\u0060'] }],
    };
    const fenced = fullTextJson(source);
    expect(fenced.match(/```/g)).toHaveLength(2);
    expect(JSON.parse(fenced.slice(8, -4))).toEqual(source);
  });
  it('bounds thread CPU across 5k/20k/80k and a 64x full span', () => {
    const measures = [5000, 20000, 80000, 320000].map((length) => {
      const value = '`_*[]<>\\\r\n'.repeat(Math.ceil(length / 10)).slice(0, length);
      const start = process.threadCpuUsage();
      escapeMarkdownInline(value);
      fullTextJson({ value });
      const usage = process.threadCpuUsage(start);
      const microseconds = usage.user + usage.system;
      expect(microseconds).toBeLessThan(500000);
      return { length, microseconds };
    });
    expect(measures[3]!.microseconds / measures[0]!.microseconds).toBeLessThan(256);
    expect(measures[3]!.microseconds).toBeLessThan(500000);
    console.info(
      'render-text runtime',
      process.versions.bun ? 'Bun' : 'Node',
      'thread CPU microseconds/call',
      measures,
    );
  });
});
