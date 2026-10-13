/**
 * @fileoverview Render-boundary correctness and thread-CPU scaling checks.
 * @module tests/tools/render-text.test
 */
import { describe, expect, it } from 'vitest';
import { escapeProviderText, fullTextJson, summaryView } from '@/mcp-server/tools/render-text.js';

describe('provider summary boundary', () => {
  it.each(['\\`*_{}[]()#+.!|~-', '<tag>&amp;', '\r\n\u2028\u2029', '```\n## heading\n[link](url)'])(
    'escapes every delimiter and line boundary in %j',
    (value) => {
      const escaped = escapeProviderText(value);
      expect(escaped.replace(/&#\d+;/g, '')).not.toMatch(
        /[<>\\`*_{}[\]()#+.!|~\-\r\n\u2028\u2029]/,
      );
      expect(
        escaped.replace(/&#(\d+);/g, (_, code: string) => String.fromCharCode(Number(code))),
      ).toBe(value);
    },
  );
  it('escapes nested lists before adjacent joins and leaves the domain intact', () => {
    const source = {
      title: '[x]',
      list: ['*', '*', '\\'],
      nested: [{ url: 'https://example.com/a_(b)?q=1&x=2' }],
      empty: null,
      id: 1,
    };
    const rendered = summaryView(source);
    expect(rendered.list.join('')).toBe('&#42;&#42;&#92;');
    expect(rendered.nested[0]?.url).toBe('https://example&#46;com/a&#95;&#40;b&#41;?q=1&#38;x=2');
    expect(source.list).toEqual(['*', '*', '\\']);
    expect(rendered.empty).toBeNull();
    expect(rendered.id).toBe(1);
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
      for (let warm = 0; warm < 5; warm++) {
        escapeProviderText(value);
        fullTextJson({ value });
      }
      const start = process.threadCpuUsage();
      for (let repeat = 0; repeat < 10; repeat++) {
        escapeProviderText(value);
        fullTextJson({ value });
      }
      const usage = process.threadCpuUsage(start);
      return { length, microseconds: (usage.user + usage.system) / 10 };
    });
    expect(measures[3]!.microseconds / measures[0]!.microseconds).toBeLessThan(256);
    expect(measures[3]!.microseconds).toBeLessThan(500000);
    console.info('render-text thread CPU microseconds/call', measures);
  });
});
