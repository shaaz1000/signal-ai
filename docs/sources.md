# Sources

Every source is read through an official API or a feed the publisher provides for syndication. Nothing is scraped from rendered pages, and nothing bypasses authentication or blocks. All requests send an identifying User-Agent, time out, retry with exponential backoff and jitter, and honour `Retry-After` and GitHub's rate-limit headers.

| Group | Source | Access | Auth | Notes |
|---|---|---|---|---|
| A GitHub | Repository search | REST `GET /search/repositories` | Optional token | Queries always carry a `created:` or `pushed:` date bound; never "most stars ever". Topic queries rotate across runs to stay within 30 searches/min (10 without a token). |
| A GitHub | Repository detail, README, latest release, contributor count | REST `/repos/{owner}/{repo}` and sub-resources | Optional token | Used by verification. Budgeted per run. |
| B Communities | Hacker News | Official Algolia search API | None | Show HN above 30 points; stories above 120 points, filtered for topic. |
| B Communities | Lobsters | `hottest.json` | None | Filtered for topic. |
| B Communities | Reddit | Official OAuth API | **Required** | Skipped unless `REDDIT_CLIENT_ID` and `REDDIT_CLIENT_SECRET` are set. Unauthenticated JSON is blocked for automated clients and is not used. |
| B Communities | Product Hunt | Public Atom feed | None | The GraphQL API needs a token; the feed carries less detail. |
| C Research | arXiv | Listing API (`cs.AI`, `cs.CL`, `cs.LG`, `cs.RO`) | None | Preprint unless the authors give a journal reference. |
| C Research | Hugging Face Papers, Models, Spaces | Hub API | None | Trending lists. Papers map onto arXiv ids, so the two merge. |
| C Research | Papers with Code | Not used | | The site now redirects to Hugging Face; Hugging Face Papers is the maintained equivalent. |
| D News | Ars Technica, TechCrunch, The Verge, MIT Technology Review, VentureBeat, IEEE Spectrum | RSS/Atom | None | General feeds are filtered for topic. News is ranked by the same formula as everything else and does not get a boost, so it does not dominate. |
| D/C Blogs | GitHub Blog, Hugging Face Blog, OpenAI News, Google DeepMind, Google Research, Simon Willison | RSS/Atom | None | A publisher's own post is a primary source for its own announcement and is labelled "company announcement". |
| E Experimental web | No single source | | | Found through GitHub topics (`webassembly`, `emulator`, `webgpu`, `reverse-engineering`, `game-engine`, `creative-coding`, `browser-automation`), Show HN, Lobsters and Hugging Face Spaces, then classified by keyword rules. |

## What was observed at build time (13 October 2026)

- 19 of 20 attempted sources responded. VentureBeat returned HTTP 429 and was recorded as failed for that run.
- Reddit was skipped: no credentials configured.

## Adding a source

Implement `SourceAdapter` (`lib/ingestion/types.ts`): a `meta` block and a `fetch(ctx)` that returns candidates. Register it in `lib/ingestion/registry.ts`. For an RSS or Atom feed, add one line to `FEEDS` in `lib/ingestion/sources/rss.ts`.
