/**
 * @fileoverview Normalizes residual HTML in AniList description fields exposed by this server.
 * @module services/anilist/normalize-description
 */

/** Convert AniList description HTML remnants into readable plain text while preserving paragraphs. */
export function normalizeAniListDescription(description: string | null): string | null {
  if (description === null) return null;

  return description
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(?:div|h[1-6]|li|p)>/gi, '\n')
    .replace(/<(?:div|h[1-6]|li|p)(?:\s[^>]*)?>/gi, '')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#(?:0*39|x0*27);/gi, "'")
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
