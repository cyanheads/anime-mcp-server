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

await createApp({
  tools: allToolDefinitions,
  resources: allResourceDefinitions,
  prompts: allPromptDefinitions,
  instructions:
    'Anime and manga data from AniList, MAL (via Jikan), and Kitsu.\n' +
    '- Use anime_search_media to discover AniList IDs, then anime_get_media for full detail.\n' +
    '- Use anime_get_relations to build watch/read order for a franchise.\n' +
    '- Use anime_get_schedule for seasonal airing schedules or upcoming episodes.\n' +
    '- Use anime_find_characters for cast lookup or voice actor role search.\n' +
    '- Scores: AniList and MAL scores are surfaced separately — never blended.\n' +
    '- Adult content: off by default; opt in via include_adult: true.\n' +
    '- Rate limits: AniList 30 req/30s, Jikan ~3 req/sec. Service layer handles backoff automatically.',
});
