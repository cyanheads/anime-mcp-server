# Changelog

All notable changes to this project. Each entry links to its full per-version file in [changelog/](changelog/).

## [0.1.4](changelog/0.1.x/0.1.4.md) — 2026-08-21

Adopts @cyanheads/mcp-ts-core ^0.12.3 (MCP SDK v2; protocol 2026-07-28 served alongside 2025; strict tool inputs; error envelope in the advertised outputSchema) and discloses pagination totals across the tool surface.

## [0.1.3](changelog/0.1.x/0.1.3.md) — 2026-06-11

Upgrade to @cyanheads/mcp-ts-core ^0.10.6: explicit name/title identity, post-pack bundle cleaner, anchored .mcpbignore patterns; three param-combination errors recoded to ValidationError.

## [0.1.2](changelog/0.1.x/0.1.2.md) — 2026-06-06

DX fixes: empty-result notices in structuredContent, description leaks removed, studio missing-identifier uses ctx.fail

## [0.1.1](changelog/0.1.x/0.1.1.md) — 2026-06-05 · 🛡️ Security

Initial public release — 8 anime/manga tools + 1 resource over AniList, Jikan, and Kitsu with input-bounds hardening
