---
name: anime-mcp-server
description: "Anime and manga intelligence — search, full detail with franchise watch-order, airing schedule, characters and voice actors, and recommendations across AniList, MyAnimeList, and Kitsu."
version: 0.0.0
status: idea
category: external-data
hosted: false
subdomain: ""
port: 0
tools: 0
resources: 0
prompts: 0
rating: unrated
stars: 0
open_issues: 0
auth: none
framework: mcp-ts-core
core_version: ""
npm: "@cyanheads/anime-mcp-server"
created: 2026-05-30
error_handling: unaudited
response_enrichment: unaudited
needs_migration: false
pattern: multi-source aggregation (AniList primary + Jikan/Kitsu)
complexity: medium
api-deps: AniList GraphQL + Jikan (MyAnimeList) + Kitsu + AnimeThemes
api-cost: free (all keyless)
hostable: false
composes-with: wikidata-mcp-server, wikipedia-mcp-server
---

# anime-mcp-server

Anime and manga, built for the people who actually care. The workflow isn't "query one anime API" — it's "what's airing this season," "what order do I watch this franchise in," "who voices this character and what else are they in," and "I liked X, what's next." No single source answers all of that well, and the three big free ones use incompatible ID spaces. The server normalizes them into one surface: AniList for the rich structured model, MyAnimeList (via Jikan) for the scores fans cite, Kitsu for streaming links — reconciled on AniList's `idMal` bridge so the agent never juggles three ID systems.

**Audience:** Anime/manga fans — seasonal watchers, franchise completionists, seiyuu (voice-actor) followers, studio stans, manga readers tracking adaptations. A large, devoted niche with no fleet coverage.

**Local-only by design** — see Design Notes. Not for the hosted fleet.

## User Goals

- Find anime or manga by title, genre, tag (isekai, time-travel, found-family), season, year, or format
- Get full detail: synopsis, studio, source material, episode/chapter count, status, scores (AniList + MAL side by side), streaming links
- Untangle a franchise — sequels, prequels, side stories, movies, OVAs — into a watch order
- See what's airing this season and when the next episode of a show drops
- Look up a title's characters and their voice actors — and what else a seiyuu has voiced
- Get recommendations from a title you liked

## Sources (service layer)

Each source is its own service; tools compose across them — the agent sees "anime," not "AniList + Jikan + Kitsu." Reconciled on AniList's `idMal` field (the bridge between AniList IDs and MyAnimeList IDs).

| Source | Type | Strength | Auth |
|:-------|:-----|:---------|:-----|
| AniList | GraphQL | Primary — one query pulls media + relations + characters + staff + airing schedule; rich tag system; carries `idMal` | keyless |
| Jikan (MyAnimeList) | REST | MAL's huge catalog and the scores fans cite; recommendations; coverage fallback | keyless |
| Kitsu | JSON:API | Streaming links, alternate catalog/categories | keyless |
| AnimeThemes | REST | OP/ED theme songs (optional garnish) | keyless |

## Tool Surface (sketch)

Tool prefix `anime_`.

```
anime_search_media    — search anime or manga (media_type mode). Filters: title query,
                        genre/tag, season + year, format (TV|movie|OVA|ONA|special),
                        status (airing|finished|upcoming), sort (popularity|score|
                        trending). AniList primary, Jikan fallback. Returns ranked
                        media: id (+ idMal), titles (romaji/english/native), format,
                        episode/chapter count, season, scores, cover image.

anime_get_media       — the flagship. Full detail by id (anime or manga): synopsis,
                        format, episodes/chapters, status, season/year, studios,
                        source material (manga|light-novel|original|game), genres +
                        tags, AniList AND MAL scores side by side, streaming/external
                        links, cover + banner, and direct relations. One AniList
                        GraphQL query carries most of it; reconciles AniList id ↔ idMal.

anime_get_relations   — franchise untangler. A media id → the full related-works graph
                        (sequels, prequels, side stories, movies, OVAs, source/
                        adaptation) walked beyond one hop and ordered into a suggested
                        watch order. The "how do I watch this whole series" tool.

anime_get_schedule    — airing schedule. mode: 'season' (everything airing a given
                        season) or 'upcoming' (next episodes in a date window, with
                        airingAt timestamps, episode numbers, and a countdown). The
                        seasonal-watcher heartbeat.

anime_find_characters — characters for a title with their voice actors (seiyuu) by
                        language — or search a character/VA by name to find their
                        roles. Returns character + VA with cross-links. "Who voices
                        this, and what else have they been in?"

anime_get_recommendations — given a title (and optionally why you liked it), related
                        recommendations merged from AniList + Jikan, with scores and a
                        one-line "because you liked X" rationale per pick.

anime_get_rankings    — top / trending / seasonal rankings. mode: 'top' (all-time by
                        score) | 'trending' (now) | 'seasonal' (this season's best),
                        filterable by genre/tag/format. The discovery tool.

anime_get_studio      — a studio id or name (MAPPA, Ufotable, Kyoto Animation) → full
                        filmography: all titles the studio produced, sorted by year or
                        score, with format and status. The "everything this studio made"
                        query earns its own tool over a search filter because the workflow
                        is dedicated (studio completionists, seasonal "who made this?"),
                        the result shape is a curated filmography not a search page, and
                        it pairs cleanly with anime_get_media for drilling in. AniList
                        staff/studio nodes via GraphQL.
```

## Design Notes

- **Local-only is deliberate, not a technical limit.** The free APIs are tightly rate-limited per IP (Jikan ~60/min, AniList ~90/min — verify at build) and Jikan is an *unofficial* MyAnimeList proxy. A shared hosted endpoint pools every user onto one VPS IP — throttled or banned fast — and proxying an unofficial API at scale is bad citizenship. Run locally, each user brings their own IP and modest usage. Hence `hostable: false`; keep it out of the hosted fleet, the plugin marketplaces, and the README `[/mcp]` set.
- **The moat is ID reconciliation + merge + GraphQL consolidation**, not parsing one ugly source. MAL IDs ≠ AniList IDs ≠ Kitsu IDs; AniList's `idMal` bridges them. Normalize on one shape, reconcile, and merge — AniList for structure/relations/schedule/characters (its GraphQL collapses what would be many REST calls), Jikan for the MAL scores fans expect and recommendation depth, Kitsu for streaming. Same workflow-first stance as `sports`; the agent names a title, never a source.
- **No synthesized hype score.** Surface the real AniList and MAL scores side by side and let the user compare — don't blend them into one fabricated number.
- **Default-exclude adult content.** AniList/Jikan flag `isAdult` / mature ratings; gate NSFW behind an explicit opt-in param, default off.
- **Spoiler-aware.** AniList marks spoiler tags and spoiler relation descriptions — honor those flags and return a spoiler-safe view by default, with an opt-in to reveal.
- **Schedule is UTC.** `airingAt` is a Unix timestamp — normalize to UTC and return a local-time hint + countdown; season boundaries (winter/spring/summer/fall) are a recurring footgun, so echo the resolved season.
- Composes with `wikidata` / `wikipedia` for real-world context (creator bios, cultural impact, awards) the structured catalogs don't carry.
- **Moonshot:** precise anime↔manga adaptation mapping ("the anime ends at manga chapter 45, start reading there"). That crosswalk is fan-maintained data, not in these APIs — would need a separate community source. Flag as out of scope until one's found.
- README one-liner: "Anime and manga for the people who care — search, franchise watch-order, airing schedule, characters and voice actors, and recommendations across AniList, MyAnimeList, and Kitsu."
