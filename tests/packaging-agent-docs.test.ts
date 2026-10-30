/**
 * @fileoverview Protect dependency runtime modules from bundle agent-doc cleanup.
 * @module tests/packaging-agent-docs
 */
import { describe, expect, it } from 'vitest';
import { AGENT_DOC_ENTRY as cleaner } from '../scripts/clean-mcpb.js';

const { AGENT_DOC_ENTRY: linter } = await import(
  new URL('../scripts/lint-packaging.ts', import.meta.url).href
);

describe('dependency agent-doc selectors', () => {
  for (const [name, selector] of [
    ['cleaner', cleaner],
    ['linter', linter],
  ] as const) {
    it(`${name} preserves nested runtime skill modules`, () => {
      expect(
        selector.test('node_modules/@modelcontextprotocol/server/dist/ext/skills/index.js'),
      ).toBe(false);
      expect(
        selector.test(
          'node_modules/parent/node_modules/@modelcontextprotocol/server/dist/ext/skills/load.js',
        ),
      ).toBe(false);
    });

    it(`${name} selects agent docs at scoped, unscoped, and nested package roots`, () => {
      for (const path of [
        'node_modules/pkg/skills/example/SKILL.md',
        'node_modules/@scope/pkg/framework-skills/add-tool/SKILL.md',
        'node_modules/parent/node_modules/@scope/pkg/.claude/settings.json',
        'node_modules/parent/node_modules/pkg/.agents/skills/example/SKILL.md',
        'node_modules/pkg/SKILL.md',
      ])
        expect(selector.test(path)).toBe(true);
    });
  }
});
