# Architecture

## Decisions and why

| Decision | Choice | Reason |
|---|---|---|
| Framework | Next.js App Router, React, strict TypeScript | As specified. Pages are server components; only filters, bookmarks, theme and refresh ship client JavaScript. |
| Styling | Tailwind CSS v4 with CSS-variable design tokens | One token file drives light, dark and density, and compiles for both the app and the Artifact. |
| UI primitives | Native elements (`button`, `select`, `input type=search`, `role=switch` checkboxes, radio groups) | Accessible by default, no dependency, almost no JavaScript. A component library would add weight without adding capability here. |
| Database | PostgreSQL through Drizzle ORM | As specified. Supabase-compatible (`prepare: false`, RLS enabled on every table). |
| Local and CI database | PGlite (Postgres compiled to WebAssembly) | The same schema, migrations and SQL run in tests and locally with nothing to install. Not SQLite pretending to be Postgres. |
| Ingestion | Plain TypeScript workers run by `tsx` | Independent of the web app. Each stage is a function taking a database handle, so tests call them directly. |
| Scheduling | GitHub Actions | As specified. Works with no open session. |
| Rendering | Dynamic, with a 30 second per-instance cache | Data changes at most hourly; pages read preferences from a cookie so the first paint has the right theme and feed. |
| Filtering | SQL loads active records; one shared pure function filters, sorts and diversifies | The Artifact has no server, so the logic has to run in the browser too. One implementation means the app and the Artifact cannot disagree. At a few thousand active records this is cheap; pushing filters into SQL is the scaling step. |
| Artifact data | A snapshot file published beside the page | The Artifact content policy blocks `fetch` to every outside host. |

## Layout

```
app/                    Next.js routes, API handlers, global styles (design tokens)
components/ui           Primitives: confidence bars, notices, states, controls
components/discovery    Cards, repository rows, filter bar, detail view, bookmark button
components/navigation   Sidebar, mobile header and tab bar
components/views        Page-level compositions shared by the app and the Artifact
lib/ingestion           Source adapters, normalisation, deduplication, discovery runner
lib/verification        Checks, credibility assessment, URL probing, verification runner
lib/ai                  Provider adapters (Anthropic, OpenAI-compatible, extractive) and the output guard
lib/scoring             Growth from snapshots, signals, weights, ranking runner
lib/curation            Featured pick, weekly edition, retention
lib/explain             Explanation schema, concept library, builder, diagram layout
lib/creator             Creator Studio templates, Content Radar score, guarded AI rewrite
lib/trends              Daily topic snapshots and trend classification
lib/i18n                Interface strings, bundled Hindi and Hinglish, content localisation
lib/translation         Provider adapters, term protection, validation
lib/security            Accounts, atomic quotas, budgets, breaker, abuse detection, the gate
lib/industries.ts       Industry registry and stated-maturity detection
lib/feed                Search, filter, sort, diversity, Today layout (shared, pure)
lib/db                  Schema, client, persistence, view builders
lib/client              Host platform for components (Next.js implementation), bookmarks store
artifact/               Artifact entry point and its platform implementation
scripts/                CLI, Artifact build, datastore pack/unpack, test preparation
tests/                  unit, integration, e2e, fixtures
drizzle/                SQL migrations
```

### How one component set serves two hosts

Components import three things from their host: `next/link`, and hooks from `lib/client/platform` (`useQueryNav`, `usePrefs`, `useRefresh`, `useBookmarks`, `useRoutePath`, `useNavigate`). In the app these are Next.js router calls and a cookie. The Artifact build (`scripts/build-artifact.ts`) aliases both to `artifact/` implementations backed by an in-page store: routes become bare `#fragment` tokens (the only deep link the Artifact frame passes through), data comes from `snapshot.json`, preferences live in `localStorage`, and bookmarks use the Artifact's per-viewer database when the viewer is signed in.

## Pipeline

| Stage | Module | Output |
|---|---|---|
| 1 Discovery | `lib/ingestion/sources/*` | Raw candidates per source. Failures are isolated per source. |
| 2 Normalisation | `lib/ingestion/normalize.ts` | Validated (zod), sanitised candidates with a canonical key such as `github:owner/repo` or `arxiv:2610.01234`. Unsafe URLs, malformed items and off-topic items are counted and dropped. |
| 3 Deduplication | `groupCandidates`, `persistGroups` | One discovery per real-world item with every source kept as a reference. Exact identity first, then near-identical headlines for coverage. Later coverage attaches to the stored story. |
| 4 Verification | `lib/verification/run.ts`, `checks.ts` | Evidence rows: existence, primary source, description agreement, promotional wording, metrics provenance, dates, code, documentation, corroboration, execution mode, engagement pattern, hostile content. |
| 5 Credibility | `assessCredibility` | A 0 to 100 score as a list of named factors, stored and shown. |
| 6 Editorial | `lib/ai/*` | Headline, summary and the detail sections, extractive by default, model-drafted and guarded when a provider is configured. |
| Ranking | `lib/scoring/*` | Six signals, weighted total, hidden-gem score, human-readable reasons. |
| Curation | `lib/curation/run.ts` | Featured story, weekly edition. |

Every write is an upsert on a unique key, so any stage can be rerun safely. Each run is recorded in `ingestion_runs` with per-source results; a run left "running" for over an hour is closed as abandoned by the next run.

## Data model

| Table | Purpose | Uniqueness |
|---|---|---|
| `sources` | Registry of sources with group, reliability prior and independence owner | `id` |
| `categories` | The ten product categories | `id` |
| `projects` | The thing itself: a repository, paper, model, article | `canonical_key` |
| `discoveries` | The editorial record: headline, claim type, status, confidence, latest scores, provenance (`origin`) | `id` = hash of the canonical key; one per project |
| `source_references` | Every place the item was seen, with points and comments | `(source_id, external_id)` |
| `repo_metric_snapshots` | Stars, forks, issues, release per observation | `(project_id, hour bucket)` |
| `tags`, `discovery_tags` | Normalised tags | `slug`; composite key |
| `verification_evidence` | One row per check per discovery | `(discovery_id, check)` |
| `credibility_assessments` | History of confidence scores with factor lists | appended when the score changes |
| `ranking_snapshots` | Score history with explanations | `(discovery_id, day)` |
| `ingestion_runs` | Job status, per-source results, statistics | `id` |
| `editions` | Daily featured pick and weekly edition | `(kind, period_start)` |
| `model_releases` | Publisher, weights availability, licence, modalities, whether independently tested | `discovery_id` |
| `trend_snapshots` | Per-topic daily counts, momentum and confidence | `(topic_kind, topic, day)` |
| `generated_content` | Translations and AI drafts, apart from source records | `(kind, subject, content_version, language, variant, provider, model)` |
| `usage_counters` | Atomic rate-limit and budget windows | `(key, window_start)` |
| `generation_jobs` | One row per paid operation, with an idempotency key | `idempotency_key` |
| `abuse_events`, `audit_logs`, `app_flags` | Denials, completed paid work and admin actions, runtime switches | see schema |
| `users`, `collections`, `bookmarks` | Accounts for paid operations (token hash, plan, role); collections and bookmarks reserved for server-side saving | see schema |

Timestamps are `timestamptz`. `published_at` (what the source says) and `first_discovered_at` (when the pipeline first saw it) are separate columns. Every foreign key is indexed; feed, score and verification-queue indexes match the queries that use them. Row level security is enabled on every table with no policies, so a Supabase anon key can read nothing; the server connects with the database role.

Retention (`RETENTION` in `lib/curation/run.ts`): hourly star snapshots for 14 days, then one per day up to 180 days; ranking history 90 days; run history 60 days; unseen and inactive records archived after 45 days; rejected records purged after 14.

## Assumptions made

- Accounts are out of scope for launch, so bookmarks are per browser in the app. The tables for server-side bookmarks exist.
- "Verified" means the item exists as described and its claims are traceable, not that results were reproduced. The UI says this wherever the word appears.
- Category classification and topical relevance use keyword rules, not a model. They are transparent and testable, and wrong at the margins.
- The reliability value per source is a fixed editorial prior, documented in `docs/scoring.md`, not a measurement.
