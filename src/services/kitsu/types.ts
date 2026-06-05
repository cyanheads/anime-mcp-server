/**
 * @fileoverview Kitsu service types — normalized domain types for the Kitsu JSON:API.
 * @module services/kitsu/types
 */

/** A streaming link from Kitsu's included[] array. */
export interface KitsuStreamingLink {
  dubs: string[];
  id: string;
  subs: string[];
  url: string;
}

/** Result from resolving Kitsu ID + streaming links. */
export interface KitsuStreamingResult {
  kitsuId: string;
  streamingLinks: KitsuStreamingLink[];
}
