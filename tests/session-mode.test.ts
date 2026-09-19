/**
 * @fileoverview Verify the entry point's HTTP session default and operator override.
 * @module tests/session-mode.test
 */
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { setTimeout } from 'node:timers/promises';
import { expect, it } from 'vitest';

it.each([
  [undefined, 'stateless'],
  ['', 'stateless'],
  ['\u0024{MCP_SESSION_MODE}', 'stateless'],
  ['stateful', 'stateful'],
  ['auto', 'stateful'],
] as const)(
  'resolves session env %s to %s',
  async (mode, expected) => {
    const socket = createServer();
    await new Promise<void>((resolve) => socket.listen(0, '127.0.0.1', resolve));
    const address = socket.address();
    if (!address || typeof address === 'string') throw new Error('Missing test port');
    await new Promise<void>((resolve) => socket.close(() => resolve()));
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      MCP_TRANSPORT_TYPE: 'http',
      MCP_HTTP_HOST: '127.0.0.1',
      MCP_HTTP_PORT: String(address.port),
      MCP_AUTH_MODE: 'none',
      OTEL_ENABLED: 'false',
      MCP_LOG_LEVEL: 'error',
    };
    delete env.MCP_SESSION_MODE;
    if (mode !== undefined) env.MCP_SESSION_MODE = mode;
    const child = spawn('bun', ['--no-env-file', 'src/index.ts'], {
      env,
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    let stderr = '';
    child.stderr.on('data', (chunk) => {
      stderr += String(chunk);
    });
    const closed = once(child, 'exit');
    try {
      const url = `http://127.0.0.1:${address.port}/.well-known/mcp.json`;
      let response: Response | undefined;
      for (let attempt = 0; attempt < 100; attempt++) {
        response = await fetch(url, { signal: AbortSignal.timeout(1000) }).catch(() => undefined);
        if (response?.ok) break;
        await setTimeout(50);
      }
      expect(response?.ok, stderr).toBe(true);
      const card = await response!.json();
      expect(card).toMatchObject({
        _meta: { 'io.github.cyanheads.mcp-ts-core/sessionMode': expected },
      });
    } finally {
      child.kill('SIGTERM');
      await closed;
    }
  },
  15_000,
);
