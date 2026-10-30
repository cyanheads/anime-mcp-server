<div align="center">
  <h1>@cyanheads/anime-mcp-server</h1>
  <p><b>Search anime/manga, get full detail, franchise relations, seasonal schedule, characters, rankings, and studio filmography via MCP. STDIO or Streamable HTTP.</b>
  <div>8 Tools • 2 Resources</div>
  </p>
</div>

<div align="center">

[![Version](https://img.shields.io/badge/Version-0.3.0-blue.svg?style=flat-square)](./CHANGELOG.md) [![License](https://img.shields.io/badge/License-Apache%202.0-orange.svg?style=flat-square)](./LICENSE) [![Docker](https://img.shields.io/badge/Docker-ghcr.io-2496ED?style=flat-square&logo=docker&logoColor=white)](https://github.com/users/cyanheads/packages/container/package/anime-mcp-server) [![MCP SDK](https://img.shields.io/badge/MCP%20SDK-^2.4.0-green.svg?style=flat-square)](https://modelcontextprotocol.io/) [![npm](https://img.shields.io/npm/v/@cyanheads/anime-mcp-server?style=flat-square&logo=npm&logoColor=white)](https://www.npmjs.com/package/@cyanheads/anime-mcp-server) [![TypeScript](https://img.shields.io/badge/TypeScript-^7.0.2-3178C6.svg?style=flat-square)](https://www.typescriptlang.org/) [![Bun](https://img.shields.io/badge/Bun-v1.4.4-blueviolet.svg?style=flat-square)](https://bun.sh/)

</div>

<div align="center">

[![Install in Claude Desktop](https://img.shields.io/badge/Install_in-Claude_Desktop-D97757?style=for-the-badge&logo=anthropic&logoColor=white)](https://github.com/cyanheads/anime-mcp-server/releases/latest/download/anime-mcp-server.mcpb) [![Install in Cursor](https://cursor.com/deeplink/mcp-install-dark.svg)](https://cursor.com/en/install-mcp?name=anime-mcp-server&config=eyJjb21tYW5kIjoibnB4IiwiYXJncyI6WyIteSIsIkBjeWFuaGVhZHMvYW5pbWUtbWNwLXNlcnZlciJdfQ==) [![Install in VS Code](https://img.shields.io/badge/VS_Code-Install_Server-0098FF?style=for-the-badge&logo=visualstudiocode&logoColor=white)](https://vscode.dev/redirect?url=vscode:mcp/install?%7B%22name%22%3A%22anime-mcp-server%22%2C%22command%22%3A%22npx%22%2C%22args%22%3A%5B%22-y%22%2C%22%40cyanheads%2Fanime-mcp-server%22%5D%7D)

[![Framework](https://img.shields.io/badge/Built%20on-@cyanheads/mcp--ts--core-67E8F9?style=flat-square)](https://www.npmjs.com/package/@cyanheads/mcp-ts-core)

</div>

---

## Overview

Anime and manga data from AniList, Jikan (MyAnimeList), and Kitsu. Search titles, pull full detail with side-by-side AniList and MAL scores, walk a franchise's relation graph, check the airing schedule, and look up characters, voice actors, and studio filmographies.

### Tools

| Tool | Description |
|:---|:---|
| `anime_search_media` | Search anime or manga by title, genre, tag, season, year, format, or status. Returns ranked results with IDs, titles, scores, format, and episode/chapter counts. AniList primary; Jikan (MAL) fallback when AniList has no match for a title-only query. |
| `anime_get_media` | Full detail for one anime or manga by AniList ID — synopsis, format, episode/chapter count, status, season, studios, source material, genres and tags (spoiler-flagged), AniList and MAL scores side by side, streaming links, cover/banner, and direct relations. |
| `anime_get_relations` | Walks the related-works graph within a hop limit. Groups main and supplementary entries by relation priority, then year; not a strict chronology. |
| `anime_get_schedule` | Airing schedule for a season or upcoming episode window. Season mode lists all anime airing in a given season/year. Upcoming mode returns the next episode for each airing title within a date window, with UTC timestamp and countdown. |
| `anime_find_characters` | Characters and voice actors for a title, or look up a character/VA by name. Returns characters with role (main/supporting/background), voice actors by language, and cross-links to other media. |
| `anime_get_recommendations` | Page AniList recommendations with matching MAL votes, or Jikan candidates resolved through AniList. Reports the selected source and Jikan availability; optionally echoes what you liked. |
| `anime_get_rankings` | Top, trending, or seasonal rankings. Filterable by genre, tag, and format. Top returns all-time by score; trending uses AniList's trending order; seasonal returns the current or specified season sorted by popularity. |
| `anime_get_studio` | A studio's full filmography by name or AniList studio ID — all titles the studio produced, sortable by year or score, with format, status, and episode count. |

### Resources

| Resource | Description |
|:---|:---|
| `anime://media/{id}` | Compact media record by AniList ID — title, synopsis, scores, genres, streaming count, and cover image. Stable URI for injectable context. |
| `skill://anime-guide/SKILL.md` | [Caller guide](./skills/anime-guide/SKILL.md) for franchise research, cast-to-career lookups, studio filmographies, and recommendation coverage. Also included in plugin, npm, Docker, and MCPB installs. |

Media resource data is also reachable via tools. Use `anime_search_media` to discover AniList IDs before fetching its resource URI.

---

## Capability reference

### `anime_search_media` <sub>tool</sub>

- Search anime or manga by title, genre, tag, season/year, format, status, or up to 5 sort values; at least one criterion is required. `page`/`per_page` pages results (max 50), and `include_adult: true` opts into adult titles
- Results carry AniList IDs, titles, scores, and episode/chapter counts. AniList is primary; title-only searches with no match can fall back to Jikan at `per_page` 25 or less. Follow `has_next_page`; `total_results` is exact only on the final page
- AniList serves only the first 5,000 search, season, and ranking entries; deeper pages fail with `page_depth_exceeded`, so narrow the criteria instead

---

### `anime_get_media` <sub>tool</sub>

- Fetch full detail by AniList `id`, with adult content requiring `include_adult: true`; discover IDs through `anime_search_media`
- Returns synopsis, genres, spoiler-flagged tags, studios, direct relations, images, streaming links, and separate AniList/MAL scores. `data_sources` identifies successful supplements; `not_found` means the ID did not resolve
- `full_text: true` returns the complete result as fenced JSON; by default the synopsis is a 500-character preview and tags and relations are shortened, with counts of what was omitted

---

### `anime_get_relations` <sub>tool</sub>

- Walk a franchise from an AniList `id` up to `max_depth` hops (default 2, max 4)
- Returns `main` and `supplementary` entries with season year and episode/chapter counts, ordered by relation priority then year. `not_found` means the root ID did not resolve
- `depth`, `parent_id`, `relation_to_parent`, and `path` show the shortest route to each entry. `relation_to_root` is set only for entries linked directly to the root, and is null otherwise. Entries at the hop limit are returned without their own relations; `depth_reached` is the deepest hop returned

---

### `anime_get_schedule` <sub>tool</sub>

- `season` mode requires `season` and `season_year`; `upcoming` uses `days_ahead` (default 7, max 30). Page with `page`/`per_page` (max 50); adult titles require `include_adult: true`
- Returns UTC ISO 8601 airing times and `time_until_airing_seconds`. Follow `has_next_page`; `total_results` is exact only on the final season page. `invalid_season` and `conflicting_inputs` identify invalid mode inputs

---

### `anime_find_characters` <sub>tool</sub>

- Supply exactly one of media `id`, `character_name`, or `voice_actor_name`. `language` filters only media cast lookups; `per_page` is capped at 25
- Returns cast, voice actors, or media appearances according to `mode`. `truncated: true` carries next-page guidance for capped cast lists; `media_not_found`/`not_found` distinguish an unknown media ID from an unmatched name
- `voice_actor_data_available: false` means the provider had no voice actor data, as opposed to an empty list. `full_text: true` returns every role on the page and the full biography as fenced JSON; by default biographies are 500-character previews and staff roles stop at 20, with counts of what was omitted

---

### `anime_get_recommendations` <sub>tool</sub>

- Fetch recommendations for an AniList `id` with `source: "anilist"` (default) or `source: "jikan"`; optional `liked_aspects` is echoed unchanged. AniList pages its recommendations and adds matching MAL votes. Jikan deduplicates its supplied list by maximum votes, orders votes descending/MAL ID ascending, and locally pages candidates with `page`/`per_page` (max 25) before resolving that slice through AniList. Adult and unresolved candidates are omitted; `has_next_page` still follows candidate pages. Jikan does not guarantee a global ranking or a stable snapshot across calls
- Both surfaces report `source` and `jikan_status` (`available`, `unavailable`, or `not_applicable` when the source lacks a MAL ID), plus separate `anilist_rating`, `jikan_votes`, and item `sources`. Jikan mode uses null `anilist_rating` and `sources: ["jikan"]`. Optional annotation failures retain AniList results; selected Jikan/resolution failures return retry-or-switch guidance. `truncated: true` supplies continuation with the same source; `not_found` means the source ID did not resolve, while valid empty pages succeed

---

### `anime_get_rankings` <sub>tool</sub>

- Rank `ANIME` or `MANGA` in `top`/`trending`; `seasonal` and season/year filters apply only to `ANIME` (`anime_only_season` otherwise). Genre/tag/format filters and `page`/`per_page` (max 50) remain available. Adult titles require `include_adult: true`
- Entries carry 1-based `rank` and `season_label`. Follow `has_next_page`; `total_results` is exact only on the final page. Seasonal mode takes `season`/`season_year` together or neither for the current season (`invalid_season` otherwise)

---

### `anime_get_studio` <sub>tool</sub>

- Identify a studio with exactly one of `name` or `id`; sort by popularity, score, or release date and page with `page`/`per_page` (max 25)
- Returns one row per distinct title within the page, with `is_main_studio` identifying main credits. Follow `has_next_page`; `total_titles` is exact only when the whole filmography fits on page 1. `not_found` means the studio did not resolve

---

### `anime://media/{id}` <sub>resource</sub>

- Read a compact `application/json` media record using an AniList `id` from `anime_search_media` or `anime_get_media`
- The ID must be a whole number from 1 to 2147483647; anything else fails with `invalid_id` before any upstream call
- Returns title variants, synopsis, scores, genres, streaming count, and cover image; use `anime_get_media` for tags, studios, streaming links, and relations

---

## Features

Built on [`@cyanheads/mcp-ts-core`](https://github.com/cyanheads/mcp-ts-core): stdio and Streamable HTTP transports, pluggable auth (`none` / `jwt` / `oauth`), swappable storage (`in-memory`, `filesystem`, `Supabase`, `Cloudflare KV/R2/D1`), structured logging with optional OpenTelemetry tracing.

Anime/manga-specific:

- Three-source architecture: AniList GraphQL (primary), Jikan v4 REST (MAL scores + recommendations), Kitsu JSON:API (streaming links with sub/dub language detail)
- ID reconciliation via AniList's `idMal` bridge — no cross-source ID guessing
- Franchise relation graph traversal with heuristic ordering by relation-type priority, then season year
- Rate-limit-aware service layer: AniList 30 req/30s with automatic backoff; Jikan 350ms floor between calls
- Keyless by design — all three sources are public and require no API credentials

Agent-friendly output:

- Dual scores surfaced separately — AniList `meanScore` (0–100) and MAL `score` (0–10) with population size (`scored_by`) so agents can reason about weight; never blended into a composite
- Spoiler flags — the tag summary hides spoiler/adult tags; structured output and `full_text: true` carry all tags with their flags
- Supplement provenance — `anime_get_media.data_sources` reports whether AniList, MAL/Jikan, and Kitsu data was retrieved; an unavailable supplement leaves its flag false
- UTC timestamps throughout; season labels echoed (`WINTER 2024`) to avoid the winter/spring/summer/fall boundary footgun

---

## Getting started

No API keys required — all three upstream sources (AniList, Jikan, Kitsu) are keyless public APIs.

Add the following to your MCP client configuration file:

```json
{
  "mcpServers": {
    "anime-mcp-server": {
      "type": "stdio",
      "command": "bunx",
      "args": ["@cyanheads/anime-mcp-server@latest"],
      "env": {
        "MCP_TRANSPORT_TYPE": "stdio",
        "MCP_LOG_LEVEL": "info"
      }
    }
  }
}
```

Or with npx (no Bun required):

```json
{
  "mcpServers": {
    "anime-mcp-server": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "@cyanheads/anime-mcp-server@latest"],
      "env": {
        "MCP_TRANSPORT_TYPE": "stdio",
        "MCP_LOG_LEVEL": "info"
      }
    }
  }
}
```

Or with Docker:

```json
{
  "mcpServers": {
    "anime-mcp-server": {
      "type": "stdio",
      "command": "docker",
      "args": [
        "run", "-i", "--rm",
        "-e", "MCP_TRANSPORT_TYPE=stdio",
        "ghcr.io/cyanheads/anime-mcp-server:latest"
      ]
    }
  }
}
```

For Streamable HTTP, set the transport and start the server:

```sh
MCP_TRANSPORT_TYPE=http MCP_HTTP_PORT=3010 bun run start:http
# Server listens at http://localhost:3010/mcp
```

### Prerequisites

- [Bun v1.4.0](https://bun.sh/) or higher (or Node.js v24+). No API keys needed.

### Installation

1. **Clone the repository:**

```sh
git clone https://github.com/cyanheads/anime-mcp-server.git
```

2. **Navigate into the directory:**

```sh
cd anime-mcp-server
```

3. **Install dependencies:**

```sh
bun install
```

4. **Configure environment (optional):**

```sh
cp .env.example .env
# edit .env if you want to change transport or log level
```

---

## Configuration

No server-specific env vars are required. All framework variables are optional with sensible defaults.

| Variable | Description | Default |
|:---------|:------------|:--------|
| `MCP_TRANSPORT_TYPE` | Transport: `stdio` or `http`. | `stdio` |
| `MCP_HTTP_PORT` | Port for HTTP server. | `3010` |
| `MCP_HTTP_HOST` | Hostname for HTTP server. | `127.0.0.1` |
| `MCP_HTTP_ENDPOINT_PATH` | Endpoint path for the MCP server. | `/mcp` |
| `MCP_SESSION_MODE` | Session mode: `auto`, `stateful`, or `stateless`. | `stateless` |
| `MCP_AUTH_MODE` | Auth mode: `none`, `jwt`, or `oauth`. | `none` |
| `MCP_LOG_LEVEL` | Log level (RFC 5424): `debug`, `info`, `notice`, `warning`, `error`. | `info` |
| `LOG_TOOL_FAILURE_PAYLOADS` | Log failed calls' arguments and results, redacted by key name and capped at `LOG_TOOL_FAILURE_PAYLOAD_MAX_BYTES` (default `16384`). Secrets inside free-form values are not redacted. | `false` |
| `OTEL_ENABLED` | Enable [OpenTelemetry instrumentation](https://github.com/cyanheads/mcp-ts-core/tree/main/docs/telemetry). | `false` |

See [`.env.example`](./.env.example) for the full list of optional overrides.

---

## Running the server

### Local development

- **Build and run:**

  ```sh
  # One-time build
  bun run rebuild

  # Run the built server
  bun run start:stdio
  # or
  bun run start:http
  ```

- **Run checks and tests:**

  ```sh
  bun run devcheck   # Lint, format, typecheck, security
  bun run test       # Vitest test suite
  bun run lint:mcp   # Validate MCP definitions against spec
  ```

### Docker

```sh
docker build -t anime-mcp-server .
docker run --rm -p 3010:3010 anime-mcp-server
```

The Dockerfile defaults to HTTP transport, stateless session mode, and logs to `/var/log/anime-mcp-server`. OpenTelemetry peer dependencies are installed by default — build with `--build-arg OTEL_ENABLED=false` to omit them.

---

## Project structure

| Directory | Purpose |
|:----------|:--------|
| `src/index.ts` | `createApp()` entry point — registers tools, resources, and inits services. |
| `src/mcp-server/tools` | Tool definitions (`*.tool.ts`). |
| `src/mcp-server/resources` | Resource definitions (`*.resource.ts`). |
| `src/services/anilist` | AniList GraphQL client — primary source for all queries. |
| `src/services/jikan` | Jikan v4 REST client — MAL scores and recommendations. |
| `src/services/kitsu` | Kitsu JSON:API client — streaming links with sub/dub language detail. |
| `tests/` | Unit and integration tests mirroring `src/`. |
| `skills/` | Published caller guide, available through plugins and MCP skill discovery. |
| `changelog/` | Per-version changelog files (`changelog/<minor>.x/<version>.md`). |

---

## Development guide

See [`CLAUDE.md`/`AGENTS.md`](./CLAUDE.md) for development guidelines and architectural rules. The short version:

- Handlers throw, framework catches — no `try/catch` in tool logic
- Use `ctx.log` for request-scoped logging, `ctx.state` for tenant-scoped storage
- Register new tools and resources via the barrels in `src/mcp-server/*/definitions/index.ts`
- Wrap external API calls: validate raw → normalize to domain type → return output schema; never fabricate missing fields
- AniList is primary — supplement failures (Jikan, Kitsu) degrade gracefully via `Promise.allSettled`

---

## Contributing

Issues are welcome. Run checks and tests before submitting:

```sh
bun run devcheck
bun run test
```

---

## License

Apache-2.0 — see [LICENSE](LICENSE) for details.
