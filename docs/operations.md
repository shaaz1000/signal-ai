# Operations

## Schedules

| Workflow | Cron (UTC) | Runs |
|---|---|---|
| `discover.yml` | `17 */3 * * *` | discover, verify, rank, curate |
| `daily-curation.yml` | `47 5 * * *` | rank, curate |
| `maintenance.yml` | `23 4 * * 1` | maintain, rank |
| `ci.yml` | on push and pull request | lint, typecheck, unit and integration tests, build, audit, browser tests |

All three scheduled workflows call `pipeline.yml`, which serialises runs with a concurrency group. Each can also be started by hand from the Actions tab or with `gh workflow run discover.yml`.

GitHub starts scheduled workflows on a best-effort basis: runs can be delayed at busy times, and schedules are disabled automatically after 60 days without repository activity. The app therefore reports the **last successful** ingestion and flags data as stale after two missed runs (7 hours) instead of assuming the schedule held.

## Storage modes

**Postgres (recommended for a deployed app).** Set the `DATABASE_URL` repository secret. The workflow applies migrations, then runs the pipeline against it. The deployed app reads the same database.

**Embedded (zero infrastructure).** With no `DATABASE_URL` secret, the workflow restores an embedded Postgres store from the `data` branch, runs the pipeline, and force-pushes the updated store and a fresh `snapshot.json` back as a single commit. Star velocity still comes from real snapshots because the store persists between runs. This mode keeps the pipeline running with no accounts to set up, but a deployed Next.js app cannot read it; use it to keep data accumulating and to produce snapshots for the Artifact until a database is connected.

## The self-updating static site (GitHub Pages)

The pipeline workflow can republish the interface as a static page after every run. It is the Artifact page built as a complete document, with the latest `snapshot.json` beside it, so it needs no server and no database host.

1. Repository **Settings → Pages → Source: GitHub Actions** (or `gh api -X POST repos/OWNER/REPO/pages -f build_type=workflow`).
2. Set the repository variable `PUBLISH_SITE=true` (`gh variable set PUBLISH_SITE --body true`).
3. Run `gh workflow run discover.yml`, or wait for the next scheduled run.

The site then updates every three hours on GitHub's schedule. It shows the last ingestion time, the next scheduled run, and a stale warning if two runs are missed. Bookmarks and settings there are stored in the visitor's browser.

GitHub Pages on a private repository needs a paid plan; on a public repository it is free.

## Deploying the app

1. Create a Postgres database (a Supabase project works; use the pooler connection string).
2. `DATABASE_URL=... npm run db:migrate`.
3. Add `DATABASE_URL` as a GitHub Actions secret so the scheduled pipeline writes to it. Optionally add `ANTHROPIC_API_KEY` or `OPENAI_API_KEY` and set the `AI_PROVIDER` repository variable.
4. Deploy to Vercel (or any Node host): set `DATABASE_URL` and `NEXT_PUBLIC_SITE_URL`. No build-time database access is needed; pages render on request.
5. Run `gh workflow run discover.yml` once to populate it.

## Updating the Artifact

```sh
npm run export:snapshot      # from the database you want to publish
npm run build:artifact       # dist/artifact/signal-ai.html + snapshot.json
```

Publish `signal-ai.html` with `snapshot.json` as a supporting file. The latest pipeline snapshot is always available on the `data` branch (`snapshot.json`). The Artifact shows the ingestion time of its snapshot on every page and marks it as old after 24 hours. It cannot refresh itself: the Artifact sandbox blocks requests to every host except the page's own files. For a page that stays current unattended, use the static site above.

## When something goes wrong

| Symptom | Cause | Action |
|---|---|---|
| "Coverage was reduced" notice | One or more sources failed in the last run | Check `/status` for which. It retries next run. |
| "This data is stale" warning | No successful discovery run for 7 hours | Check the Actions tab; scheduled workflows may be disabled or failing. |
| Verification run is `degraded` with a rate-limit message | GitHub API allowance used up | Nothing; remaining repositories are verified on the next run. Lower `GITHUB_CALL_BUDGET` if it recurs. |
| Many items "Not measured" for growth | Only one snapshot so far | Wait for the next run; velocity needs two observations. |
| App shows "The discovery data could not be loaded" | Database unreachable | Check `DATABASE_URL` and the database status. |

## Known limitations

- **Summaries are extractive unless an AI provider is configured.** They quote and restate the sources, which keeps them grounded but plain. The Anthropic and OpenAI adapters are implemented and unit-tested against stubs; they have not been run against the live APIs because no key was available at build time.
- **Reddit is not ingested** until OAuth credentials are supplied.
- **Classification is keyword-based.** Categories and topical relevance are wrong at the margins.
- **Credibility is evidence of existence and traceability, not of correctness.** The system cannot run code or reproduce results.
- **Peer review is reported, not confirmed.** A journal reference on arXiv is the authors' statement.
- **Bookmarks are per browser** in the app (accounts are not implemented). In the Artifact they are per signed-in viewer.
- **Notifications are not implemented.**
- **Rate limiting is per server instance.**
- **Unknown discovery pages return HTTP 200 with a not-found page**, because the response has started streaming before the lookup finishes.
- **Core Web Vitals and Lighthouse have not been measured.**
- **No screen-reader testing** beyond automated axe scans and keyboard tests.
