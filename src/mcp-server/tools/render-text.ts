/**
 * @fileoverview Display formatting for provider text, lossless JSON, and airing countdowns.
 * @module mcp-server/tools/render-text
 */

import { escapeMarkdownInline } from '@cyanheads/mcp-ts-core/utils';

/** Format whole minutes, hours, or days without displaying elapsed times as negative. */
export function formatAiringCountdown(seconds: number): string {
  const remaining = Math.max(0, seconds);
  if (remaining < 3600) return `${Math.floor(remaining / 60)}m`;
  const hours = Math.floor(remaining / 3600);
  const days = Math.floor(hours / 24);
  return days > 0 ? `${days}d ${hours % 24}h` : `${hours}h`;
}

/** Keep a provider name inside its authored heading even when it contains line breaks. */
export function headingText(value: string): string {
  return escapeMarkdownInline(value).replaceAll('\\\n', '&#10;');
}

/** Render complete domain JSON; escaped backticks cannot close the fixed Markdown fence. */
export function fullTextJson(value: unknown): string {
  const json = JSON.stringify(value, null, 2).replaceAll('`', '\\u0060');
  return `\`\`\`json\n${json}\n\`\`\``;
}
