<div align="center">
  <h1>@cyanheads/anime-mcp-server</h1>
  <p><b>Search anime/manga, get full detail, franchise watch order, seasonal schedule, characters, rankings, and studio filmography via MCP. STDIO or Streamable HTTP.</b>
  <div>8 Tools • 1 Resource</div>
  </p>
</div>

<div align="center">

[![Version](https://img.shields.io/badge/Version-0.1.8-blue.svg?style=flat-square)](./CHANGELOG.md) [![License](https://img.shields.io/badge/License-Apache%202.0-orange.svg?style=flat-square)](./LICENSE) [![Docker](https://img.shields.io/badge/Docker-ghcr.io-2496ED?style=flat-square&logo=docker&logoColor=white)](https://github.com/users/cyanheads/packages/container/package/anime-mcp-server) [![MCP SDK](https://img.shields.io/badge/MCP%20SDK-^2.0.0-green.svg?style=flat-square)](https://modelcontextprotocol.io/) [![npm](https://img.shields.io/npm/v/@cyanheads/anime-mcp-server?style=flat-square&logo=npm&logoColor=white)](https://www.npmjs.com/package/@cyanheads/anime-mcp-server) [![TypeScript](https://img.shields.io/badge/TypeScript-^7.0.2-3178C6.svg?style=flat-square)](https://www.typescriptlang.org/) [![Bun](https://img.shields.io/badge/Bun-v1.4.0-blueviolet.svg?style=flat-square)](https://bun.sh/)

</div>

<div align="center">

[![Install in Claude Desktop](https://img.shields.io/badge/Install_in-Claude_Desktop-D97757?style=for-the-badge&logo=anthropic&logoColor=white)](https://github.com/cyanheads/anime-mcp-server/releases/latest/download/anime-mcp-server.mcpb) [![Install in Cursor](https://cursor.com/deeplink/mcp-install-dark.svg)](https://cursor.com/en/install-mcp?name=anime-mcp-server&config=eyJjb21tYW5kIjoibnB4IiwiYXJncyI6WyIteSIsIkBjeWFuaGVhZHMvYW5pbWUtbWNwLXNlcnZlciJdfQ==) [![Install in VS Code](https://img.shields.io/badge/VS_Code-Install_Server-0098FF?style=for-the-badge&logo=visualstudiocode&logoColor=white)](https://vscode.dev/redirect?url=vscode:mcp/install?%7B%22name%22%3A%22anime-mcp-server%22%2C%22command%22%3A%22npx%22%2C%22args%22%3A%5B%22-y%22%2C%22%40cyanheads%2Fanime-mcp-server%22%5D%7D)

[![Framework](https://img.shields.io/badge/Built%20on-@cyanheads/mcp--ts--core-67E8F9?style=flat-square)](https://www.npmjs.com/package/@cyanheads/mcp-ts-core)

</div>

---

## Overview

Anime and manga data from AniList, Jikan (MyAnimeList), and Kitsu. Search titles, pull full detail with side-by-side AniList and MAL scores, walk a franchise's watch order, check the airing schedule, and look up characters, voice actors, and studio filmographies from any MCP client. Runs as a stdio process or a local Streamable HTTP server.

### Tools

| Tool | Description |
|:---|:---|
| `anime_search_media` | Search anime or manga by title, genre, tag, season, year, format, or status. Returns ranked results with IDs, titles, scores, format, and episode/chapter counts. AniList primary; Jikan fallback on empty results. |
| `anime_get_media` | Full detail for one anime or manga by AniList ID — synopsis, format, episode/chapter count, status, season, studios, source material, genres and tags (spoiler-flagged), AniList and MAL scores side by side, streaming links, cover/banner, and direct relations. |
| `anime_get_relations` | Franchise untangler. Walks the related-works graph from a media ID beyond one hop — sequels, prequels, side stories, movies, OVAs, source and adaptation — and returns them in suggested watch/read order. |
| `anime_get_schedule` | Airing schedule for a season or upcoming episode window. Season mode lists all anime airing in a given season/year. Upcoming mode returns the next episode for each airing title within a date window, with UTC timestamp and countdown. |
| `anime_find_characters` | Characters and voice actors for a title, or look up a character/VA by name. Returns characters with role (main/supporting/background), voice actors by language, and cross-links to other media. |
| `anime_get_recommendations` | AniList recommendations with matching Jikan (MAL) vote counts. Optionally echoes what the user liked about the source title to contextualize picks. |
| `anime_get_rankings` | Top, trending, or seasonal rankings. Filterable by genre and format. Top returns all-time by score; trending uses AniList's trending order; seasonal returns the current or specified season sorted by popularity. |
| `anime_get_studio` | A studio's full filmography by name or AniList studio ID — all titles the studio produced, sortable by year or score, with format, status, and episode count. |

### Resources

| Resource | Description |
|:---|:---|
| `anime://media/{id}` | Compact media record by AniList ID — title, synopsis, scores, genres, streaming count, and cover image. Stable URI for injectable context. |

All resource data is also reachable via tools. Use `anime_search_media` to discover AniList IDs before fetching the resource URI.

---

## Capability reference

### `anime_search_media` <sub>tool</sub>

- Free-text title search with AniList primary; falls back to Jikan when AniList returns empty and a `query` was given
- Filter by genre, tag, season/year, format (`TV`, `MOVIE`, `OVA`, `MANGA`, `NOVEL`, etc.), and status (`RELEASING`, `FINISHED`, etc.); up to 5 sort values
- Adult content gated behind explicit `include_adult: true` (default off)
- Pagination via `page` and `per_page` (max 50)

---

### `anime_get_media` <sub>tool</sub>

- AniList full-detail query supplemented in parallel by Jikan (MAL score) and Kitsu (streaming links with sub/dub language flags) via `Promise.allSettled`; `data_sources` flags which succeeded
- AniList and MAL scores surfaced side by side — never blended — plus AniList weighted average/popularity and MAL rank/popularity
- Tags carry an `is_spoiler` flag from AniList's `isGeneralSpoiler`; the formatted text view hides spoiler and adult tags while the full array stays in structured output
- Streaming links: Kitsu primary (with per-platform sub/dub language lists), AniList `externalLinks` fallback when Kitsu has none
- `not_found` when the AniList ID doesn't resolve — use `anime_search_media` first

---

### `anime_get_relations` <sub>tool</sub>

- Multi-hop BFS over AniList's relation graph, up to `max_depth` hops (default 2, max 4)
- Entries split into `main` (source, adaptation, prequel, sequel — canonical story) and `supplementary` (side story, spin-off, compilation, and similar) via `watch_order_category`
- Each entry includes `season_year` and episode/chapter count for context
- `not_found` when the root AniList ID doesn't resolve

---

### `anime_get_schedule` <sub>tool</sub>

- Two modes: `season` (all anime airing in a season/year — both `season` and `season_year` required) and `upcoming` (next episode per airing title within `days_ahead`, default 7, max 30)
- `invalid_season` when mode is `season` but `season`/`season_year` is missing
- Adult titles excluded by default (`include_adult`); pagination via `page`/`per_page` (max 50)
- Airing timestamps are UTC ISO 8601, with `time_until_airing_seconds` for countdowns

---

### `anime_find_characters` <sub>tool</sub>

- Three lookup modes: `id` (media → cast), `character_name`, or `voice_actor_name` — at least one identifier required, or `missing_identifier`; when several are supplied, `id` takes precedence, then `character_name`
- By-media mode supports a `language` filter over AniList's `StaffLanguage` enum (JAPANESE, ENGLISH, KOREAN, etc.)
- Cast list capped at `per_page` (max 25); a capped page returns `truncated: true` with next-page guidance
- `media_not_found` / `not_found` distinguish an invalid media ID from a name search with no match

---

### `anime_get_recommendations` <sub>tool</sub>

- Returns AniList recommendations, adding Jikan/MAL vote counts when the same recommendation appears in both sources; `sources` identifies each contribution
- Scores stay separate — `anilist_rating` and `jikan_votes` are never blended into one figure
- Optional `liked_aspects` free-text field is echoed back unmodified, for the caller to contextualize picks
- AniList page capped at `per_page` (max 25); a capped page returns `truncated: true` with next-page guidance
- `not_found` when the source AniList ID doesn't resolve

---

### `anime_get_rankings` <sub>tool</sub>

- Three modes: `top` (all-time by score), `trending` (current week), `seasonal` (current or specified season/year, sorted by popularity)
- Filterable by `genre` and `format`; adult content excluded by default (`include_adult`)
- Pagination via `page`/`per_page` (max 50); each entry carries a 1-based `rank`

---

### `anime_get_studio` <sub>tool</sub>

- Look up by `name` (search) or `id` (direct AniList studio ID) — at least one required, or `missing_identifier`; `id` takes precedence when both are supplied
- Filmography sortable by `POPULARITY_DESC` (default), `SCORE_DESC`, `START_DATE_DESC`, or `START_DATE`
- `not_found` when neither the name search nor the ID lookup resolves
- Pagination via `page`/`per_page` (max 50)

---

### `anime://media/{id}` <sub>resource</sub>

- Compact media record as `application/json` — title variants, synopsis, scores, genres, streaming count, cover image
- `id` comes from `anime_search_media` or `anime_get_media`
- A flatter subset of `anime_get_media` — no tags, studios, streaming links, or relations

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
- Spoiler safety — tags carry an `is_spoiler` flag from AniList's `isGeneralSpoiler`; the formatted text view hides spoiler and adult tags while the full array stays in structured output
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
| `MCP_SESSION_MODE` | Overrides the source-declared default: `auto`, `stateful`, or `stateless`. The framework schema default `auto` resolves to `stateful`. | `stateless` |
| `MCP_AUTH_MODE` | Auth mode: `none`, `jwt`, or `oauth`. | `none` |
| `MCP_LOG_LEVEL` | Log level (RFC 5424): `debug`, `info`, `notice`, `warning`, `error`. | `info` |
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
