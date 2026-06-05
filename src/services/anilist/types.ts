/**
 * @fileoverview AniList service types — normalized domain types for the AniList GraphQL API.
 * @module services/anilist/types
 */

/** Media type selector. */
export type MediaType = 'ANIME' | 'MANGA';

/** AniList season enum. */
export type MediaSeason = 'WINTER' | 'SPRING' | 'SUMMER' | 'FALL';

/** AniList format enum. */
export type MediaFormat =
  | 'TV'
  | 'TV_SHORT'
  | 'MOVIE'
  | 'SPECIAL'
  | 'OVA'
  | 'ONA'
  | 'MUSIC'
  | 'MANGA'
  | 'NOVEL'
  | 'ONE_SHOT';

/** AniList status enum. */
export type MediaStatus = 'FINISHED' | 'RELEASING' | 'NOT_YET_RELEASED' | 'CANCELLED' | 'HIATUS';

/** AniList staff language enum. */
export type StaffLanguage =
  | 'JAPANESE'
  | 'ENGLISH'
  | 'KOREAN'
  | 'ITALIAN'
  | 'SPANISH'
  | 'PORTUGUESE'
  | 'FRENCH'
  | 'GERMAN'
  | 'HEBREW'
  | 'HUNGARIAN';

/** Relation type between media entries. */
export type MediaRelationType =
  | 'ADAPTATION'
  | 'PREQUEL'
  | 'SEQUEL'
  | 'PARENT'
  | 'SIDE_STORY'
  | 'CHARACTER'
  | 'SUMMARY'
  | 'ALTERNATIVE'
  | 'SPIN_OFF'
  | 'OTHER'
  | 'SOURCE'
  | 'COMPILATION'
  | 'CONTAINS';

/** Character role. */
export type CharacterRole = 'MAIN' | 'SUPPORTING' | 'BACKGROUND';

/** A title's localized name variants. */
export interface MediaTitle {
  english: string | null;
  native: string | null;
  romaji: string | null;
}

/** Cover image URLs. */
export interface CoverImage {
  color: string | null;
  extraLarge: string | null;
  large: string | null;
  medium: string | null;
}

/** A single tag. */
export interface MediaTag {
  category: string | null;
  description: string | null;
  id: number;
  isAdult: boolean;
  isGeneralSpoiler: boolean;
  name: string;
  rank: number | null;
}

/** A single studio edge. */
export interface StudioEdge {
  isMain: boolean;
  node: {
    id: number;
    name: string;
    isAnimationStudio: boolean;
  };
}

/** An external link (streaming or info). */
export interface ExternalLink {
  color: string | null;
  icon: string | null;
  id: number;
  isDisabled: boolean;
  language: string | null;
  site: string;
  siteId: number | null;
  type: string | null;
  url: string | null;
}

/** A relation edge pointing to another media entry. */
export interface MediaRelationEdge {
  node: MediaNode;
  relationType: MediaRelationType;
}

/** A lightweight media node used in relation graphs and recommendations. */
export interface MediaNode {
  chapters: number | null;
  coverImage: CoverImage | null;
  episodes: number | null;
  format: MediaFormat | null;
  id: number;
  idMal: number | null;
  isAdult: boolean;
  meanScore: number | null;
  season: MediaSeason | null;
  seasonYear: number | null;
  status: MediaStatus | null;
  title: MediaTitle;
  type: MediaType;
  volumes: number | null;
}

/** Full media detail from AniList. */
export interface MediaDetail extends MediaNode {
  averageScore: number | null;
  bannerImage: string | null;
  description: string | null;
  endDate: { year: number | null; month: number | null; day: number | null } | null;
  externalLinks: ExternalLink[];
  favourites: number | null;
  genres: string[];
  hashtag: string | null;
  isAdult: boolean;
  isFavourite: boolean;
  nextAiringEpisode: {
    airingAt: number;
    episode: number;
    timeUntilAiring: number;
  } | null;
  popularity: number | null;
  relations: {
    edges: MediaRelationEdge[];
  };
  siteUrl: string | null;
  source: string | null;
  startDate: { year: number | null; month: number | null; day: number | null } | null;
  studios: { edges: StudioEdge[] };
  tags: MediaTag[];
  trailer: { id: string; site: string } | null;
}

/** A page of media search results. */
export interface MediaPage {
  media: MediaNode[];
  pageInfo: {
    total: number | null;
    currentPage: number;
    lastPage: number | null;
    hasNextPage: boolean;
    perPage: number | null;
  };
}

/** A character with optional voice actor edges. */
export interface CharacterEdge {
  node: {
    id: number;
    name: { full: string | null; native: string | null };
    image: { large: string | null; medium: string | null } | null;
    description: string | null;
    siteUrl: string | null;
  };
  role: CharacterRole;
  voiceActors: VoiceActor[];
}

/** Voice actor (Staff) basic info. */
export interface VoiceActor {
  id: number;
  image: { large: string | null; medium: string | null } | null;
  language: StaffLanguage | null;
  name: { full: string | null; native: string | null };
  siteUrl: string | null;
}

/** Full staff/VA with media roles. */
export interface StaffWithRoles {
  characterMedia: {
    pageInfo: { hasNextPage: boolean; currentPage: number };
    edges: Array<{
      characterRole: CharacterRole;
      node: MediaNode;
      characters: Array<{
        id: number;
        name: { full: string | null; native: string | null };
      }>;
    }>;
  };
  description: string | null;
  id: number;
  image: { large: string | null; medium: string | null } | null;
  language: StaffLanguage | null;
  name: { full: string | null; native: string | null };
  siteUrl: string | null;
}

/** A character with their media appearances. */
export interface CharacterWithMedia {
  description: string | null;
  id: number;
  image: { large: string | null; medium: string | null } | null;
  media: {
    pageInfo: { hasNextPage: boolean; currentPage: number };
    nodes: MediaNode[];
    edges: Array<{
      characterRole: CharacterRole;
      voiceActors: VoiceActor[];
    }>;
  };
  name: { full: string | null; native: string | null };
  siteUrl: string | null;
}

/** A recommendation node. */
export interface RecommendationNode {
  mediaRecommendation: MediaNode | null;
  rating: number | null;
}

/** AniList airing schedule entry. */
export interface AiringSchedule {
  airingAt: number;
  episode: number;
  id: number;
  media: MediaNode;
  timeUntilAiring: number;
}

/** Studio full detail. */
export interface StudioDetail {
  id: number;
  isAnimationStudio: boolean;
  media: {
    pageInfo: {
      total: number | null;
      currentPage: number;
      lastPage: number | null;
      hasNextPage: boolean;
    };
    nodes: MediaNode[];
  };
  name: string;
  siteUrl: string | null;
}
