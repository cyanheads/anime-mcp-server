# anime-mcp-server — Design

## MCP Surface

### Tools

| Name | Description | Key Inputs | Annotations |
|:-----|:------------|:-----------|:------------|
| `anime_search_media` | Search anime or manga by title, genre, tag, season, year, format, or status. Returns ranked results with IDs, titles, scores, format, and episode/chapter counts. AniList primary; Jikan fallback on empty. | `media_type` (`ANIME`\|`MANGA`), `query`, `genre`, `tag`, `season` (`WINTER`\|`SPRING`\|`SUMMER`\|`FALL`), `season_year`, `format` (AniList MediaFormat enum), `status` (AniList MediaStatus enum), `sort`, `page`, `per_page`, `include_adult` | `readOnlyHint: true`, `openWorldHint: true` |
| `anime_get_media` | Full detail for one anime or manga by AniList ID. Returns synopsis, format, episode/chapter count, status, season, studios, source material, genres + tags (spoiler-flagged), AniList and MAL scores side by side, streaming links, cover/banner, and direct relations. Primary source for a title's complete profile. | `id`, `include_adult` | `readOnlyHint: true`, `idempotentHint: true` |
| `anime_get_relations` | Franchise untangler. Walks the related-works graph from a media ID beyond one hop — sequels, prequels, side stories, movies, OVAs, source/adaptation — and returns them ordered into a suggested watch/read order. The "how do I watch this whole series" tool. | `id`, `max_depth` (int, 1–4) | `readOnlyHint: true`, `idempotentHint: true` |
| `anime_get_schedule` | Airing schedule for a season or upcoming episode window. `season` mode: all anime airing in a given season/year. `upcoming` mode: next episode for each airing title within a date window, with UTC timestamp and countdown. | `mode` (`season`\|`upcoming`), `season` (`WINTER`\|`SPRING`\|`SUMMER`\|`FALL`), `season_year`, `days_ahead`, `page`, `per_page` | `readOnlyHint: true`, `openWorldHint: true` |
| `anime_find_characters` | Characters and voice actors for a title, or look up a character/VA by name. Returns characters with their role (main/supporting/background), voice actors by language, and cross-links to other media. | `id` (media ID, or omit for name search), `character_name`, `voice_actor_name`, `language` (AniList StaffLanguage enum: `JAPANESE`\|`ENGLISH`\|`KOREAN`\|etc.), `page`, `per_page` | `readOnlyHint: true`, `openWorldHint: true` |
| `anime_get_recommendations` | Recommendations for a title, merged from AniList and Jikan, with scores and vote counts. Optionally accepts what the user liked about the source title to contextualize picks. | `id`, `liked_aspects`, `page`, `per_page` | `readOnlyHint: true`, `idempotentHint: true` |
| `anime_get_rankings` | Top, trending, or seasonal rankings. Filterable by genre, tag, and format. `top` returns all-time by score; `trending` returns current week; `seasonal` returns the current or specified season sorted by popularity. | `mode` (`top`\|`trending`\|`seasonal`), `media_type` (`ANIME`\|`MANGA`), `format` (AniList MediaFormat enum), `genre`, `season` (`WINTER`\|`SPRING`\|`SUMMER`\|`FALL`), `season_year`, `page`, `per_page` | `readOnlyHint: true`, `openWorldHint: true` |
| `anime_get_studio` | A studio's full filmography by name or AniList studio ID. Returns all titles the studio produced, sortable by year or score, with format, status, and episode count. | `name`, `id`, `sort` (`POPULARITY_DESC`\|`SCORE_DESC`\|`START_DATE_DESC`\|`START_DATE`), `page`, `per_page` | `readOnlyHint: true`, `idempotentHint: true` (when `id` provided) |

#### Error Contracts

| Tool | reason | code | when |
|:-----|:-------|:-----|:-----|
| `anime_get_media` | `not_found` | `NotFound` | AniList returns null for the given ID (invalid or nonexistent) |
| `anime_get_relations` | `not_found` | `NotFound` | Root media ID not found on AniList |
| `anime_find_characters` | `not_found` | `NotFound` | Name search (`character_name` / `voice_actor_name`) returns no match from AniList |
| `anime_find_characters` | `missing_identifier` | `InvalidParams` | Neither `id` nor `character_name` nor `voice_actor_name` provided |
| `anime_get_studio` | `not_found` | `NotFound` | Neither name search nor ID lookup returns a result on AniList |
| `anime_get_schedule` | `invalid_season` | `InvalidParams` | `mode: season` called without both `season` and `season_year` |

Baseline infra codes (`ServiceUnavailable`, `Timeout`, `ValidationError`, `InternalError`) bubble from any tool without needing declaration.

### Resources

| URI Template | Description | Pagination |
|:-------------|:------------|:-----------|
| `anime://media/{id}` | Full media record by AniList ID — same data as `anime_get_media`. Stable URI for injectable context. | None (single item) |

### Prompts

None. This is a data-retrieval server; no interaction templates add value.

---

## Overview

Multi-source anime and manga server for fans who care about the details. The workflow isn't "query one API" — it's "what order do I watch this franchise in," "who voices this character and what else are they in," "what's airing this season," and "I liked X, what's next." No single source answers all of that well. This server normalizes AniList, MyAnimeList (via Jikan), and Kitsu into one tool surface, reconciling their incompatible ID spaces via AniList's `idMal` bridge.

**Audience:** Anime/manga fans — seasonal watchers, franchise completionists, seiyuu followers, studio stans, manga readers tracking adaptations.

**Local-only by design.** The free APIs are tightly rate-limited per IP (AniList 30 req/30s, Jikan ~3 req/sec) and Jikan is an unofficial MAL proxy. Hosting pools users onto one IP — throttled or banned quickly, and proxying an unofficial API at scale is bad citizenship. Each local user brings their own IP and modest usage. Not in the hosted fleet, plugin marketplaces, or README `/mcp` set.

---

## Requirements

- Search anime and manga by multiple dimensions (title, genre, tag, season, year, format, status)
- Full detail view including dual scores (AniList + MAL side by side — never blended)
- Franchise watch-order via multi-hop relation graph traversal
- Seasonal airing schedule and upcoming episode countdown
- Characters + voice actors, bidirectionally (title → cast, VA → roles)
- Recommendations merged from AniList and Jikan
- Top/trending/seasonal rankings filterable by genre and format
- Studio filmography by name or ID
- Adult content gated behind explicit `include_adult` opt-in (default: off)
- Spoiler-safe by default — AniList spoiler-flagged tags returned with spoiler flag, relation descriptions sanitized unless opted in
- All timestamps UTC; season labels echoed to avoid the winter/spring/summer/fall boundary footgun
- No synthesized composite scores — surface real AniList and MAL scores separately

---

## Services

| Service | Wraps | Used By |
|:--------|:------|:--------|
| `AniListService` | AniList GraphQL API — `https://graphql.anilist.co` (POST, keyless) | `anime_search_media`, `anime_get_media`, `anime_get_relations`, `anime_get_schedule`, `anime_find_characters`, `anime_get_recommendations`, `anime_get_rankings`, `anime_get_studio`, `anime://media/{id}` |
| `JikanService` | Jikan v4 REST API — `https://api.jikan.moe/v4` (GET, keyless, ~3 req/sec). **Endpoint routing is media-type-aware:** anime uses `/anime/{id}/full`, `/anime/{id}/recommendations`, `GET /anime?q=...`; manga uses `/manga/{id}/full`, `/manga/{id}/recommendations`, `GET /manga?q=...`. Service must branch on `media_type` for all ID and search calls. | `anime_search_media` (fallback), `anime_get_media` (MAL score supplement), `anime_get_recommendations` (merged) |
| `KitsuService` | Kitsu JSON:API — `https://kitsu.io/api/edge` (GET, keyless). **Endpoint routing is media-type-aware:** anime uses `/anime/{id}` and `/anime?filter[text]=...`; manga uses `/manga/{id}` and `/manga?filter[text]=...`. Streaming links are relevant only for anime — skip Kitsu call when `media_type: MANGA`. | `anime_get_media` (streaming links supplement, anime only) |

**Source strategy:** AniList is primary for structure, relations, characters, schedule, and studio data — its GraphQL collapses what would be many REST calls into one. Jikan contributes MAL scores and recommendation depth. Kitsu contributes streaming links where AniList's `externalLinks` (type: STREAMING) is incomplete. ID reconciliation via AniList's `idMal` field bridges AniList IDs ↔ MAL IDs.

---

## Config

| Env Var | Required | Description |
|:--------|:---------|:------------|
| *(none)* | — | All three sources are keyless; no API credentials required. |

No `server-config.ts` needed — zero required env vars. Rate limit handling is service-layer behavior, not config.

---

## Implementation Order

1. **Services** — `AniListService` (GraphQL client with retry + rate-limit backoff), `JikanService` (REST client, ~300ms between calls), `KitsuService` (JSON:API client)
2. **`anime_search_media`** — AniList Page query + Jikan fallback; establish the base search + output shape
3. **`anime_get_media`** — flagship: AniList full-detail query + Jikan score supplement + Kitsu streaming links fan-out
4. **`anime_get_relations`** — multi-hop BFS/DFS over AniList relation graph; watch-order sort
5. **`anime_get_schedule`** — AniList `AiringSchedule` query (single-item) + `Page(media(...))` for season mode
6. **`anime_find_characters`** — AniList `Media.characters` + `Staff` lookup
7. **`anime_get_recommendations`** — AniList `Media.recommendations.nodes` + Jikan `/{media_type}/{idMal}/recommendations` merge
8. **`anime_get_rankings`** — AniList `Page(media(sort:...))` with mode dispatch
9. **`anime_get_studio`** — AniList `Studio(...)` query with `media` node list
10. **`anime://media/{id}` resource** — delegates to `anime_get_media` handler
11. Tests for each tool + service
12. Devcheck pass

---

## Domain Mapping

### AniList GraphQL — confirmed live response shapes

**Nouns:** Media, AiringSchedule, Studio, Character, Staff, Recommendation

| Noun | Operations | GraphQL entry |
|:-----|:-----------|:--------------|
| Media | search, get-full, list-by-season, list-by-sort (trending, score), get-relations, get-characters, get-recommendations | `Page.media(...)`, `Media(id/search)` |
| AiringSchedule | single-item get, list-by-time-window | `AiringSchedule(airingAt_greater, airingAt_lesser)` |
| Studio | get-by-id, search-by-name (via Page), get-filmography | `Studio(id)`, `Page.studios(search)` |
| Character | get characters for media with VA | `Media.characters(page, perPage)` → edges → `voiceActors(language)` |
| Staff | get VA roles across media | `Staff(id)` → `characterMedia(page, perPage)` |
| Recommendation | get recs for media | `Media.recommendations(page, perPage)` → `nodes { rating, mediaRecommendation }` |

**Key AniList quirks found during probing:**
- `recommendations` uses `.nodes { rating, mediaRecommendation }` — NOT `edges.rating` (returns 400 if queried as edge field)
- Rate limit: 30 req / 30s window (`x-ratelimit-limit: 30`, `x-ratelimit-remaining` in response headers)
- Auth-required endpoints (MediaList, user data) return `{"errors":[{"message":"Private User","status":404}]}` — treat as out of scope
- Error envelope: `{"errors":[{"message":"...","status":404,"locations":[...]}],"data":{"Media":null}}` — HTTP 200 with error in body (GraphQL standard)
- Tags include `isGeneralSpoiler` boolean — honor for spoiler-safe default
- `externalLinks` carries type `STREAMING` for streaming URLs — supplement with Kitsu when absent

### Jikan v4 REST — confirmed live response shapes

| Noun | Operations | Endpoint |
|:-----|:-----------|:---------|
| Anime | search, full-detail, recommendations | `GET /anime?q=...`, `GET /anime/{id}/full`, `GET /anime/{id}/recommendations` |
| Manga | search, full-detail, recommendations | `GET /manga?q=...`, `GET /manga/{id}/full`, `GET /manga/{id}/recommendations` |

**Media-type routing (critical):** Every Jikan call must use the correct noun path. When `media_type: ANIME`, use `/anime/...`; when `media_type: MANGA`, use `/manga/...`. Manga `/full` returns `score`, `scored_by`, `rank`, `chapters`, `volumes`. Manga recommendations use the same `data[].entry.mal_id` / `data[].votes` shape as anime.

**Key Jikan quirks found during probing:**
- Nonexistent IDs return HTTP 500 with `{"status":500,"type":"UpstreamException","message":"Request to MyAnimeList.net failed..."}` — NOT a 404. Service must treat 5xx on ID lookups as "not found or MAL unavailable" not "server error."
- Recommendation response: `data[].entry.mal_id`, `data[].entry.title`, `data[].votes`
- Full detail (`/full`): `score`, `scored_by`, `rank`, `popularity`, `favorites`, `streaming[{name,url}]`, `external[{name,url}]` (anime); `score`, `scored_by`, `rank`, `chapters`, `volumes` (manga)
- Rate limit: not in response headers; docs state ~3 req/sec (1000ms cache window per endpoint). Service should use minimum 350ms between calls.
- Pagination via `?page=N&limit=N`; `pagination.has_next_page` boolean

### Kitsu JSON:API — confirmed live response shapes

| Noun | Operations | Endpoint |
|:-----|:-----------|:---------|
| Anime | search, get-by-ID, get-mappings, get-streaming-links | `GET /anime?filter[text]=...`, `GET /anime/{id}`, `GET /anime/{id}/mappings`, streaming via `include=streamingLinks` |
| Manga | search, get-by-ID, get-mappings | `GET /manga?filter[text]=...`, `GET /manga/{id}`, `GET /manga/{id}/mappings` |

**Media-type routing:** Kitsu `/anime` and `/manga` are separate resource types. When `media_type: MANGA`, use `/manga/...` paths and `/manga/{id}/mappings`. Streaming links are an anime-only concept — do not call streamingLinks for manga.

**Mappings for manga:** `externalSite: "myanimelist/manga"`, `externalId: "{mal_id}"` — same pattern as anime.

**Key Kitsu quirks found during probing:**
- Streaming links require `?include=streamingLinks` — arrives in `included[]` array with `type: "streamingLinks"`, `attributes: { url, subs: [], dubs: [] }`
- Mappings endpoint confirms MAL bridge: `externalSite: "myanimelist/anime"`, `externalId: "16498"` — can resolve AniList `idMal` → Kitsu ID without separate search
- Error envelope: `{"errors":[{"title":"Record not found","detail":"...","code":"404","status":"404"}]}` — clean 404
- `averageRating` is a string (e.g. `"84.5"`) — coerce to float in service layer
- `ratingFrequencies` is a string→string map of scale 2–20 — not used, skip
- Primary streaming data use: Kitsu's `streamingLinks` relationship is reliable; fall back to AniList's `externalLinks[type=STREAMING]` when Kitsu lookup fails

---

## Workflow Analysis

### `anime_get_media` — flagship fan-out (3 upstream services)

| # | Call | Service | Purpose | Failure mode |
|:--|:-----|:--------|:--------|:-------------|
| 1 | AniList `Media(id)` query | AniList | Full media detail: title, synopsis, format, episodes/chapters, status, season, studios, genres+tags, score, relations, `idMal`, `externalLinks` | Throws `not_found` if entity absent |
| 2 | Jikan `/{media_type}/{idMal}/full` | Jikan | MAL score (`score`, `scored_by`, `rank`, `popularity`); route: `/anime/{id}/full` for ANIME, `/manga/{id}/full` for MANGA | `Promise.allSettled` — MAL scores set to `null` on failure |
| 3 | Kitsu mapping + streaming (ANIME only) | Kitsu | Streaming links with sub/dub language flags via `/anime/{kitsuId}?include=streamingLinks`; **skip entirely when `media_type: MANGA`** | `Promise.allSettled` — streaming from Kitsu omitted on failure, falls back to AniList externalLinks |

Calls 2 and 3 run in parallel via `Promise.allSettled`. Result always includes provenance per source so agents know which data is present.

### `anime_get_relations` — multi-hop graph traversal

| # | Call | Purpose |
|:--|:-----|:--------|
| 1 | AniList `Media(id)` with `relations.edges` | Fetch direct relations (SEQUEL, PREQUEL, SIDE_STORY, SPIN_OFF, ALTERNATIVE, SOURCE, ADAPTATION, etc.) |
| 2–N | AniList `Media(id)` for each related node | Walk transitive hops up to `max_depth` (default 2; cap at 4 to avoid runaway queries) |
| Final | Topological sort | Order by relation type priority: SOURCE → PREQUEL → MAIN STORY → SEQUEL → SIDE_STORY → SPIN_OFF → OVA/SPECIAL → MOVIE |

**Watch-order sort logic:** SOURCE/ADAPTATION relationships determine adaptation chain. PREQUEL → entry target → SEQUEL chains map the canonical order. SIDE_STORY, SPIN_OFF, OVA entries annotated as optional/supplementary. Result includes each entry's `seasonYear` and `episodes` for context.

### `anime_find_characters` — bidirectional character/VA lookup

**Mode A: by media ID**
| # | Call | Purpose |
|:--|:-----|:--------|
| 1 | AniList `Media.characters` | Characters for the title with VA by language |

**Mode B: by character or VA name**
| # | Call | Purpose |
|:--|:-----|:--------|
| 1 | AniList `Character(search)` or `Staff(search)` | Find character/VA node by name |
| 2 | AniList `Character.media` or `Staff.characterMedia` | Roles across titles |

### `anime_get_recommendations` — merged from two sources

| # | Call | Service | Purpose |
|:--|:-----|:--------|:--------|
| 1 | AniList `Media.recommendations.nodes` | AniList | Community-voted recommendations with rating scores |
| 2 | Jikan `/{media_type}/{idMal}/recommendations` | Jikan | MAL user recommendations with vote counts; route: `/anime/{id}/recommendations` for ANIME, `/manga/{id}/recommendations` for MANGA |
| — | Merge + dedup on `idMal` / AniList ID | local | Unified list, source provenance per item |

Both calls parallel via `Promise.allSettled`. Items deduped by ID; AniList rating + Jikan votes surfaced separately (not summed).

---

## Design Decisions

**No synthesized composite score.** `idea.md` is explicit: surface AniList `meanScore` and Jikan `score` side by side. Blending them into a fabricated number misleads — different scales, different communities, different methodologies. Output carries both with their population size (`scored_by`, `popularity`) so the agent can reason about weight.

**AniList primary, not parity.** AniList's GraphQL collapses media + relations + characters + schedule + studio into a single query tree. Jikan and Kitsu are supplements for data AniList doesn't carry well: MAL scores (the scores fans cite in conversation), Kitsu streaming links with sub/dub language detail. Tools fan out to supplements in parallel; AniList failure is fatal, supplement failure degrades gracefully.

**`anime_get_studio` as a dedicated tool.** Could be a filter on `anime_search_media`. Kept separate because the workflow is different (completionist filmography, not a discovery page), the result shape is a curated sorted filmography (not a search result), and the output carries studio metadata (studio name, ID) not present in search results.

**`anime_get_relations` max_depth cap at 4.** Uncapped BFS on a franchise like Gundam (50+ entries) would generate dozens of AniList requests. Default depth 2 covers 90% of use cases; max 4 covers long multi-sequel chains without runaway. Each hop is a separate GraphQL query — depth 4 on a branching franchise could mean ~15 queries. Rate limit awareness required.

**No `anime_get_character` / `anime_get_va` as separate tools.** `anime_find_characters` handles both "title → cast" and "name → roles" via parameter branching. A dedicated character-detail tool would mostly duplicate what character search returns; deferred unless field-testing reveals demand.

**Kitsu ID resolution via mappings endpoint, not search.** When AniList's `idMal` is available, use Kitsu's `/mappings?filter[externalSite]=myanimelist/anime&filter[externalId]={idMal}` to resolve the Kitsu ID directly, avoiding a text search that might match the wrong title. Confirmed live: Kitsu 7442 maps to MAL 16498 via `externalSite: "myanimelist/anime"`.

**AniList recommendations field is `nodes`, not `edges`.** Live probe confirmed: `Media.recommendations(page, perPage) { nodes { rating, mediaRecommendation {...} } }` — querying `edges.rating` returns HTTP 200 with a 400 error body. Service must use `nodes`.

**Jikan 500 on invalid ID is an upstream proxy issue, not a server error.** When MAL returns an unexpected status for a nonexistent ID, Jikan raises a 500 UpstreamException. Service must treat HTTP 5xx on both `/anime/{id}` and `/manga/{id}` lookups as "not found or MAL unavailable" and fail gracefully (null MAL data), not surface as `ServiceUnavailable`.

**Spoiler-safe default.** AniList tags carry `isGeneralSpoiler`. Relations include description fields that often contain spoilers. Default behavior: return spoiler tags with a `spoiler: true` flag (agent can decide whether to show), relation descriptions omitted unless `reveal_spoilers: true`. This respects the watching experience without hiding the data.

---

## Known Limitations

- **No cross-media chapter mapping.** The "anime ends at manga chapter 45" crosswalk is fan-maintained data not in these APIs. Out of scope; flagged in `idea.md`.
- **Jikan rate limit is informal.** The ~3 req/sec limit is empirical, not contractually documented. Service adds a 350ms floor between calls. AniList primary means Jikan is called for supplements only, not the hot path.
- **Kitsu streaming data may be stale.** Kitsu's streaming links are user-contributed and not actively maintained by a streaming platform. `updatedAt: null` on some entries is common. Treat as supplementary; `externalLinks[type=STREAMING]` from AniList is more reliable for current availability.
- **AniList 30 req/30s shared across all tools.** Deep franchise relation traversal (`anime_get_relations` with max_depth 4 on a large franchise) plus concurrent tool calls could hit the limit. Service must track the window and back off on 429. Backoff: 30s (the window size).
- **No MAL user list, watchlist, or ratings.** Jikan supports user list endpoints, but these require MAL authentication. Out of scope for a keyless server.
- **No AnimeThemes integration.** `idea.md` lists it as "optional garnish." Deferred — not enough workflow coverage to justify an eighth service dependency at v0.1.
- **Kitsu streaming links are anime-only.** Kitsu has a `/manga` resource type (confirmed live) but no streaming links relationship — that concept doesn't apply to manga. Kitsu calls are skipped entirely when `media_type: MANGA`.
- **Jikan manga recommendations exist but cover fewer titles.** Jikan `/manga/{id}/recommendations` is live and returns the same shape as anime, but community rec volume is lower than anime. Merged list may be shorter for manga.
