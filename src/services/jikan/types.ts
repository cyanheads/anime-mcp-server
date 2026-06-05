/**
 * @fileoverview Jikan v4 service types — normalized domain types for the Jikan REST API (MAL proxy).
 * @module services/jikan/types
 */

/** Jikan anime/manga full detail. */
export interface JikanMedia {
  chapters: number | null;
  episodes: number | null;
  /** External links */
  external: Array<{ name: string; url: string }> | null;
  favorites: number | null;
  images: {
    jpg?: {
      image_url: string | null;
      small_image_url: string | null;
      large_image_url: string | null;
    };
    webp?: {
      image_url: string | null;
      small_image_url: string | null;
      large_image_url: string | null;
    };
  } | null;
  mal_id: number;
  popularity: number | null;
  rank: number | null;
  score: number | null;
  scored_by: number | null;
  status: string | null;
  /** Streaming sources (anime only) */
  streaming: Array<{ name: string; url: string }> | null;
  synopsis: string | null;
  title: string;
  title_english: string | null;
  title_japanese: string | null;
  type: string | null;
  url: string | null;
  volumes: number | null;
}

/** A single recommendation entry from Jikan. */
export interface JikanRecommendation {
  entry: {
    mal_id: number;
    url: string | null;
    images: { jpg?: { image_url: string | null } } | null;
    title: string;
  };
  votes: number;
}

/** Jikan search result item (lighter than full). */
export interface JikanSearchResult {
  chapters: number | null;
  episodes: number | null;
  mal_id: number;
  rank: number | null;
  score: number | null;
  scored_by: number | null;
  status: string | null;
  title: string;
  title_english: string | null;
  type: string | null;
  url: string | null;
}

/** Jikan pagination info. */
export interface JikanPagination {
  current_page: number;
  has_next_page: boolean;
  items: {
    count: number;
    total: number;
    per_page: number;
  };
  last_visible_page: number;
}
