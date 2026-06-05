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

/** Kitsu anime attributes (abbreviated). */
export interface KitsuAnimeAttributes {
  averageRating: string | null;
  canonicalTitle: string;
  endDate: string | null;
  episodeCount: number | null;
  ratingFrequencies: Record<string, string>;
  slug: string;
  startDate: string | null;
  status: string | null;
  synopsis: string | null;
  titles: Record<string, string>;
  updatedAt: string | null;
}

/** A Kitsu resource item from the JSON:API envelope. */
export interface KitsuResourceItem {
  attributes: Record<string, unknown>;
  id: string;
  relationships?: Record<
    string,
    { data: null | { id: string; type: string } | Array<{ id: string; type: string }> }
  >;
  type: string;
}

/** A Kitsu mapping item (for MAL bridge). */
export interface KitsuMapping {
  attributes: {
    externalSite: string;
    externalId: string;
  };
  id: string;
  type: 'mappings';
}

/** Result from resolving Kitsu ID + streaming links. */
export interface KitsuStreamingResult {
  kitsuId: string;
  streamingLinks: KitsuStreamingLink[];
}
