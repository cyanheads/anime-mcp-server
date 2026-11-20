/**
 * @fileoverview MCP transport fixture for media resource tests.
 * @module tests/helpers/request-media-resource
 */

import { createWorkerHandler } from '@cyanheads/mcp-ts-core/worker';
import { vi } from 'vitest';
import { animeMediaResource } from '@/mcp-server/resources/definitions/anime-media.resource.js';

/** Send a resources/read request through the media resource's MCP worker. */
export async function requestMediaResource(uri: string): Promise<unknown> {
  const worker = createWorkerHandler({
    name: 'anime-mcp-server',
    title: 'anime-mcp-server',
    resources: [animeMediaResource],
  });
  const response = await worker.fetch(
    new Request('https://example.test/mcp', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
        'MCP-Protocol-Version': '2026-07-28',
        'Mcp-Method': 'resources/read',
        'Mcp-Name': uri,
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'resources/read',
        params: {
          uri,
          _meta: {
            'io.modelcontextprotocol/protocolVersion': '2026-07-28',
            'io.modelcontextprotocol/clientCapabilities': {},
          },
        },
      }),
    }),
    { MCP_AUTH_MODE: 'none', LOG_LEVEL: 'fatal' },
    { waitUntil: vi.fn(), passThroughOnException: vi.fn(), props: {} },
  );
  const raw = await response.text();
  const frame = raw.split('\n').find((line) => line.startsWith('data: '));
  return JSON.parse(frame ? frame.slice(6) : raw);
}
