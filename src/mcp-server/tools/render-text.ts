/**
 * @fileoverview Display-only provider text escaping and lossless JSON rendering.
 * @module mcp-server/tools/render-text
 */

/** Escape Markdown delimiters, HTML and line boundaries without changing displayed text. */
export function escapeProviderText(value: string): string {
  return value.replace(
    /[&<>\\`*_{}[\]()#+.!|~\-\r\n\u2028\u2029]/g,
    (character) => `&#${character.charCodeAt(0)};`,
  );
}

/** Make a display-only clone; domain decisions and preview slicing precede this boundary. */
export function summaryView<T>(value: T): T {
  if (typeof value === 'string') return escapeProviderText(value) as T;
  if (Array.isArray(value)) return value.map((entry) => summaryView(entry)) as T;
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, summaryView(entry)]),
    ) as T;
  }
  return value;
}

/** Render complete domain JSON; escaped backticks cannot close the fixed Markdown fence. */
export function fullTextJson(value: unknown): string {
  const json = JSON.stringify(value, null, 2).replaceAll('`', '\\u0060');
  return `\`\`\`json\n${json}\n\`\`\``;
}
