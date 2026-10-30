---
name: anime-guide
description: Use anime_* tools to trace a franchise, follow cast into other roles, build a studio filmography, or assess anime and manga recommendations. Resolve the right work and identifier namespace, check coverage, and distinguish catalog evidence from watch-order or availability claims.
license: Apache-2.0
metadata:
  author: "cyanheads"
  version: "1.0"
---

## Scope

Use this server for catalog-backed anime and manga research: choosing a specific adaptation, tracing related works or cast, comparing candidates, and exploring studio credits. Manga chapter continuation after an anime requires another source; this server has no episode-to-chapter crosswalk.

## Identifiers

Keep AniList media IDs, MAL IDs, AniList studio IDs, character IDs, and staff IDs distinct even when their numbers match. Use media IDs returned with titles for title follow-ups. Obtain studio IDs from `anime_get_media` or `anime_get_studio`, then retain the chosen studio ID while paging its filmography.

For cast-to-career research, take the actor name from `anime_find_characters` and use its name lookup for roles. Character and staff IDs identify returned people; they are not media lookup IDs.

## Gates

- Confirm the title, media type, and format before following an adaptation, sequel, or recommendation. Similar names can refer to different works.
- Before declaring a title absent, inspect the search notice and coverage. A filtered search does not run the MAL fallback; a title-only fallback can be skipped or unavailable. Try alternate title forms and broader criteria before concluding the catalog has no match.
- Before calling a franchise list complete or presenting a definitive watch order, check traversal depth and the discovered paths. Boundary works have not had their own relations explored; the displayed order is not narrative chronology.
- Before saying a character has no actor in a language, check actor-data availability and remaining cast pages. Missing provider data is not a confirmed empty cast.
- Before counting a studio's titles, finish the filmography pages and deduplicate by media ID across pages. Credits can repeat a title across page boundaries; retain the distinction between main studio and co-credit.
- Before claiming that a title is currently watchable in a country, verify the platform directly. Catalog streaming links are supplementary leads and can be stale.
- Before stopping on an empty upcoming-schedule or Jikan recommendation page, check continuation. Filtering or unresolved candidates can leave an empty page while later candidates remain.
- Before concluding that MAL has no recommendations, check Jikan status. Unavailable data and a missing MAL mapping do not establish an empty recommendation list.

## Workflows

**Explain a recommendation.** Confirm the source work, retrieve recommendations, then inspect promising candidates with `anime_get_media`. Explain fit from the candidate's synopsis, genres, and spoiler flags. The supplied liked aspects are context for your reasoning: the tool echoes that text rather than using it to personalize retrieval. Use the Jikan branch to explore candidates beyond AniList's page; keep pages within their selected source, and deduplicate media IDs when comparing branches. Neither branch establishes a combined global rank.

**Propose a franchise route.** Inspect the chosen work's relation graph and separate anime, manga, and other formats before proposing a watch or reading route. Use discovery paths to explain connections. Label the route as a recommendation supported by the returned graph, with its depth boundary.

**Follow a voice actor.** Start from the known title's cast to identify the actor for the desired language. Look up that actor by name, confirm the returned identity, and follow role media IDs into title detail. Page roles before making career-wide claims.

**Explore a studio.** Resolve the studio from a title credit or studio-name lookup. Continue with its returned studio ID, collect pages, and deduplicate titles before comparing output. A co-credit alone does not establish primary production responsibility.

**Choose what to watch this season.** Use rankings for discovery and schedules for broadcast timing, then inspect shortlisted titles. Convert returned UTC timestamps to the user's timezone and label broadcast timing separately from streaming availability.
