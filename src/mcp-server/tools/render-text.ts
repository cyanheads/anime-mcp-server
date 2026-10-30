/**
 * @fileoverview Display-only provider text escaping and lossless JSON rendering.
 * @module mcp-server/tools/render-text
 */

import { escapeMarkdownInline } from '@cyanheads/mcp-ts-core/utils';

/** Keep a provider name inside its authored heading even when it contains line breaks. */
export function headingText(value: string): string {
  return escapeMarkdownInline(value).replaceAll('\\\n', '&#10;');
}

/** Render complete domain JSON; escaped backticks cannot close the fixed Markdown fence. */
export function fullTextJson(value: unknown): string {
  const json = JSON.stringify(value, null, 2).replaceAll('`', '\\u0060');
  return `\`\`\`json\n${json}\n\`\`\``;
}
