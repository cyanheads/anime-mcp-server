#!/usr/bin/env node
/**
 * @fileoverview anime-mcp-server MCP server entry point.
 * Multi-source anime and manga server over AniList GraphQL, Jikan v4, and Kitsu JSON:API.
 * @module index
 */

import { createApp } from '@cyanheads/mcp-ts-core';
import { allPromptDefinitions } from './mcp-server/prompts/index.js';
import { allResourceDefinitions } from './mcp-server/resources/index.js';
import { allToolDefinitions } from './mcp-server/tools/index.js';
import { shutdownAniList } from './services/anilist/anilist-service.js';
import { shutdownJikan } from './services/jikan/jikan-service.js';

await createApp({
  name: 'anime-mcp-server',
  title: 'anime-mcp-server',
  sessionMode: 'stateless',
  teardown() {
    shutdownAniList();
    shutdownJikan();
  },
  tools: allToolDefinitions,
  resources: allResourceDefinitions,
  prompts: allPromptDefinitions,
  instructions:
    'Search anime and manga through anime_search_media to discover AniList IDs, then use anime_get_media for detail, anime_get_relations for franchise order, anime_get_schedule for airing dates, and anime_find_characters for cast or voice actors. AniList and MAL scores remain separate, and adult content requires include_adult: true. AniList, Jikan, and Kitsu supply the data; requests are paced for AniList at 30 starts per 30 seconds and Jikan at least 350 milliseconds apart.',
});
