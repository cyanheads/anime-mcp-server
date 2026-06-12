<div align="center">
  <h1>@cyanheads/anime-mcp-server</h1>
  <p><b>Search anime/manga, get full detail, franchise watch order, seasonal schedule, characters, rankings, and studio filmography via MCP. STDIO or Streamable HTTP.</b>
  <div>8 Tools • 1 Resource</div>
  </p>
</div>

<div align="center">

[![Version](https://img.shields.io/badge/Version-0.1.3-blue.svg?style=flat-square)](./CHANGELOG.md) [![License](https://img.shields.io/badge/License-Apache%202.0-orange.svg?style=flat-square)](./LICENSE) [![Docker](https://img.shields.io/badge/Docker-ghcr.io-2496ED?style=flat-square&logo=docker&logoColor=white)](https://github.com/users/cyanheads/packages/container/package/anime-mcp-server) [![MCP SDK](https://img.shields.io/badge/MCP%20SDK-^1.29.0-green.svg?style=flat-square)](https://modelcontextprotocol.io/) [![npm](https://img.shields.io/npm/v/@cyanheads/anime-mcp-server?style=flat-square&logo=npm&logoColor=white)](https://www.npmjs.com/package/@cyanheads/anime-mcp-server) [![TypeScript](https://img.shields.io/badge/TypeScript-^6.0.3-3178C6.svg?style=flat-square)](https://www.typescriptlang.org/) [![Bun](https://img.shields.io/badge/Bun-v1.3.11-blueviolet.svg?style=flat-square)](https://bun.sh/)

</div>

<div align="center">

[![Install in Claude Desktop](https://img.shields.io/badge/Install_in-Claude_Desktop-D97757?style=for-the-badge&logo=anthropic&logoColor=white)](https://github.com/cyanheads/anime-mcp-server/releases/latest/download/anime-mcp-server.mcpb) [![Install in Cursor](https://cursor.com/deeplink/mcp-install-dark.svg)](https://cursor.com/en/install-mcp?name=anime-mcp-server&config=eyJjb21tYW5kIjoibnB4IiwiYXJncyI6WyIteSIsIkBjeWFuaGVhZHMvYW5pbWUtbWNwLXNlcnZlciJdfQ==) [![Install in VS Code](https://img.shields.io/badge/VS_Code-Install_Server-0098FF?style=for-the-badge&logo=visualstudiocode&logoColor=white)](https://vscode.dev/redirect?url=vscode:mcp/install?%7B%22name%22%3A%22anime-mcp-server%22%2C%22command%22%3A%22npx%22%2C%22args%22%3A%5B%22-y%22%2C%22%40cyanheads%2Fanime-mcp-server%22%5D%7D)

[![Framework](https://img.shields.io/badge/Built%20on-@cyanheads/mcp--ts--core-67E8F9?style=flat-square)](https://www.npmjs.com/package/@cyanheads/mcp-ts-core)

</div>

---

## Tools

Eight tools covering anime and manga discovery, detail, and navigation:

| Tool | Description |
|:---|:---|
| `anime_search_media` | Search anime or manga by title, genre, tag, season, year, format, or status. Returns ranked results with IDs, titles, scores, format, and episode/chapter counts. AniList primary; Jikan fallback on empty results. |
| `anime_get_media` | Full detail for one anime or manga by AniList ID — synopsis, format, episode/chapter count, status, season, studios, source material, genres and tags (spoiler-flagged), AniList and MAL scores side by side, streaming links, cover/banner, and direct relations. |
| `anime_get_relations` | Franchise untangler. Walks the related-works graph from a media ID beyond one hop — sequels, prequels, side stories, movies, OVAs, source and adaptation — and returns them in suggested watch/read order. |
| `anime_get_schedule` | Airing schedule for a season or upcoming episode window. Season mode lists all anime airing in a given season/year. Upcoming mode returns the next episode for each airing title within a date window, with UTC timestamp and countdown. |
| `anime_find_characters` | Characters and voice actors for a title, or look up a character/VA by name. Returns characters with role (main/supporting/background), voice actors by language, and cross-links to other media. |
| `anime_get_recommendations` | Recommendations for a title, merged from AniList and Jikan (MAL), with scores and vote counts. Optionally accepts what the user liked about the source title to contextualize picks. |
| `anime_get_rankings` | Top, trending, or seasonal rankings. Filterable by genre, tag, and format. Top returns all-time by score; trending returns current week; seasonal returns the current or specified season sorted by popularity. |
| `anime_get_studio` | A studio's full filmography by name or AniList studio ID — all titles the studio produced, sortable by year or score, with format, status, and episode count. |

### `anime_search_media`

Search for anime or manga across multiple dimensions.

- Free-text title search with AniList primary; falls back to Jikan when AniList returns empty
- Filter by genre, tag, season, year, format (`TV`, `MOVIE`, `OVA`, `MANGA`, `NOVEL`, etc.), and status (`RELEASING`, `FINISHED`, etc.)
- Adult content gated behind explicit `include_adult: true` (default off)
- Pagination via `page` and `per_page`

---

### `anime_get_media`

Full detail for a single anime or manga — the flagship tool for a title's complete profile.

- AniList full-detail query supplemented in parallel by Jikan (MAL score) and Kitsu (streaming links with sub/dub language flags)
- AniList and MAL scores surfaced side by side — never blended
- Spoiler-safe by default: tags carry a `spoiler` flag; relation descriptions omitted unless `reveal_spoilers: true`
- All timestamps UTC; season labels included to avoid boundary ambiguity

---

### `anime_get_relations`

Build the watch/read order for an entire franchise.

- Multi-hop BFS over AniList's relation graph, up to `max_depth` hops (default 2, max 4)
- Relation types: SOURCE, PREQUEL, SEQUEL, SIDE_STORY, SPIN_OFF, ADAPTATION, OVA, SPECIAL, MOVIE
- Topological sort: SOURCE → PREQUEL → main story chain → SEQUEL → SIDE_STORY → SPIN_OFF → supplementary entries
- Each entry includes `seasonYear` and episode/chapter count for context

---

### `anime_find_characters`

Bidirectional character and voice actor lookup.

- By media ID: characters for a title with voice actors by language
- By character name: find the character and all media they appear in
- By voice actor name: find the VA and all roles across media
- Language filter via AniList `StaffLanguage` enum (JAPANESE, ENGLISH, KOREAN, etc.)

---

## Resources and prompts

| Type | Name | Description |
|:---|:---|:---|
| Resource | `anime://media/{id}` | Full media record for an anime or manga by AniList ID — same data as `anime_get_media`. Stable URI for injectable context. |

All resource data is also reachable via tools. Use `anime_search_media` to discover AniList IDs before fetching the resource URI.

---

## Features

Built on [`@cyanheads/mcp-ts-core`](https://www.npmjs.com/package/@cyanheads/mcp-ts-core):

- Declarative tool and resource definitions — single file per primitive, framework handles registration and validation
- Unified error handling — handlers throw, framework catches, classifies, and formats
- Pluggable auth: `none`, `jwt`, `oauth`
- Swappable storage backends: `in-memory`, `filesystem`, `Supabase`, `Cloudflare KV/R2/D1`
- Structured logging with optional OpenTelemetry tracing
- STDIO and Streamable HTTP transports

Anime/manga-specific:

- Three-source architecture: AniList GraphQL (primary), Jikan v4 REST (MAL scores + recommendations), Kitsu JSON:API (streaming links with sub/dub language detail)
- ID reconciliation via AniList's `idMal` bridge — no cross-source ID guessing
- Franchise relation graph traversal with topological watch-order sort
- Rate-limit-aware service layer: AniList 30 req/30s with automatic backoff; Jikan 350ms floor between calls
- Keyless by design — all three sources are public and require no API credentials
- **Local-only by design:** free APIs are tightly rate-limited per IP; hosting would pool users onto one IP and risk throttling or bans. Each local user brings their own IP and modest usage.

Agent-friendly output:

- Dual scores surfaced separately — AniList `meanScore` (0–100) and MAL `score` (0–10) with population size (`scored_by`) so agents can reason about weight; never blended into a composite
- Spoiler safety by default — AniList tags carry `isGeneralSpoiler`; relation descriptions omitted unless opted in
- Supplement provenance — each response indicates which sources contributed (AniList, Jikan, Kitsu) and which failed gracefully, so agents know what data is present
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

- [Bun v1.3.0](https://bun.sh/) or higher (or Node.js v24+). No API keys needed.

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

Issues and pull requests are welcome. Run checks and tests before submitting:

```sh
bun run devcheck
bun run test
```

---

## License

Apache-2.0 — see [LICENSE](LICENSE) for details.
