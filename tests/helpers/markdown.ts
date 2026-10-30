/**
 * @fileoverview CommonMark assertions for literal provider prose in tool summaries.
 * @module tests/helpers/markdown
 */
import { Parser } from 'commonmark';
import { expect } from 'vitest';

/** Verify provider prose survives parsing without becoming HTML or code. */
export function expectLiteralProse(blocks: unknown, expected: string): void {
  const text = (blocks as Array<{ type: string; text?: string }>)
    .filter((block) => block.type === 'text')
    .map((block) => block.text)
    .join('\n');
  const walker = new Parser().parse(text).walker();
  let literal = '';
  for (let event = walker.next(); event; event = walker.next()) {
    if (!event.entering) continue;
    expect(['html_inline', 'html_block', 'code', 'code_block']).not.toContain(event.node.type);
    if (event.node.type === 'text') literal += event.node.literal;
    if (event.node.type === 'softbreak' || event.node.type === 'linebreak') literal += '\n';
  }
  expect(literal).toContain(expected.replace(/\r\n?/g, '\n'));
}

/** Verify a URL field becomes the intended CommonMark link or image destination. */
export function expectMarkdownDestination(
  blocks: Array<{ type: string; text?: string }>,
  kind: 'link' | 'image',
  destination: string,
): void {
  const walker = new Parser()
    .parse(
      blocks
        .filter((block) => block.type === 'text')
        .map((block) => block.text)
        .join('\n'),
    )
    .walker();
  const destinations: string[] = [];
  for (let event = walker.next(); event; event = walker.next()) {
    if (event.entering && event.node.type === kind) destinations.push(event.node.destination!);
  }
  expect(destinations).toContain(destination);
}
