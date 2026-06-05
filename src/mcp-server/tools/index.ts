/**
 * @fileoverview Barrel export for all anime-mcp-server tool definitions.
 * @module mcp-server/tools/index
 */

import { animeFindCharacters } from './definitions/anime-find-characters.tool.js';
import { animeGetMedia } from './definitions/anime-get-media.tool.js';
import { animeGetRankings } from './definitions/anime-get-rankings.tool.js';
import { animeGetRecommendations } from './definitions/anime-get-recommendations.tool.js';
import { animeGetRelations } from './definitions/anime-get-relations.tool.js';
import { animeGetSchedule } from './definitions/anime-get-schedule.tool.js';
import { animeGetStudio } from './definitions/anime-get-studio.tool.js';
import { animeSearchMedia } from './definitions/anime-search-media.tool.js';

export const allToolDefinitions = [
  animeSearchMedia,
  animeGetMedia,
  animeGetRelations,
  animeGetSchedule,
  animeFindCharacters,
  animeGetRecommendations,
  animeGetRankings,
  animeGetStudio,
];
