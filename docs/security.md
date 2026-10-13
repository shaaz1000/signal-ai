# Security

| Area | What is in place | Where |
|---|---|---|
| Credentials | Read from the environment on the server only. Nothing is prefixed `NEXT_PUBLIC_` except the site URL. The logger redacts token-shaped strings and secret-named keys. `.env*` is ignored by git. | `lib/utils/log.ts`, `.gitignore` |
| Untrusted content | READMEs, abstracts, feed items and thread titles are treated as data. HTML, comments, control and zero-width characters are stripped before storage. React escapes all output. Only `http(s)` URLs are rendered as links, always with `rel="noopener noreferrer"`. | `lib/utils/text.ts`, `components/ui/primitives.tsx` |
| Prompt injection | Source text is passed to the model inside a JSON field labelled as untrusted, with a system prompt that says never to follow it. The model has no tools. Output is schema-constrained, then every field is checked: numbers and URLs must appear in the evidence, instruction-like text is rejected, and rejected fields fall back to extractive text. Text matching injection patterns is flagged as evidence and costs confidence. | `lib/ai/types.ts`, `lib/ai/guard.ts`, `lib/verification/checks.ts` |
| Outbound requests (SSRF) | URLs must be public `http(s)` on standard ports with no credentials. Private, loopback, link-local and metadata addresses are rejected by literal and by DNS resolution. Redirects are followed manually and every hop is re-validated. Responses are size-capped and time-limited. | `lib/utils/url.ts`, `lib/verification/probe.ts`, `lib/utils/http.ts` |
| Input validation | Every candidate is validated with zod. API and page parameters are parsed against allow-lists; unknown values fall back to defaults. Discovery ids must match `^[a-f0-9]{12}$`. | `lib/ingestion/types.ts`, `lib/feed/query.ts` |
| Rate limiting | 60 requests per minute per client on the JSON API, per server instance. A shared store is needed for strict limits across many instances. | `lib/server/rate-limit.ts` |
| Database | Parameterised queries through Drizzle. Row level security enabled on every table with no policies, so Supabase's public API keys can read nothing. | `lib/db/schema.ts` |
| HTTP headers | Content-Security-Policy (no third-party origins, `frame-ancestors 'none'`), `nosniff`, `Referrer-Policy`, `Permissions-Policy`, HSTS. `X-Powered-By` is off. The policy allows inline scripts because Next.js hydration needs them; a nonce-based policy is the stricter next step. | `next.config.ts` |
| GitHub Actions | Workflows default to `contents: read`. Only the pipeline job gets `contents: write`, used solely to update the `data` branch in embedded mode. Workflow inputs reach the shell through environment variables and are checked against an allow-list. | `.github/workflows/` |
| Dependencies | `npm audit` for production dependencies runs in CI; Dependabot opens weekly update pull requests. | `.github/workflows/ci.yml`, `.github/dependabot.yml` |

## Paid operations: translation and AI drafts

Everything that can call a paid provider runs server-side behind one gate, `runProtected` in `lib/security/gate.ts`. Provider keys never reach the browser, the static site or the Artifact, none of which can call a provider at all.

**Order of checks.** Input size, then the cache (a stored result is returned to anyone, free), then: kill switch, authentication, per-address signal, abuse cooldown, per-kind rate limit, per-user daily budget, global and per-provider daily budgets, provider circuit breaker, duplicate-request check, concurrent-job cap. Only then is the provider called, outside any database transaction and under a hard timeout.

| Control | How |
|---|---|
| Identity | Operator-issued access tokens (only the SHA-256 is stored), exchanged for an httpOnly session cookie signed with `AUTH_SECRET`. No default secret: without one, nobody can sign in and all paid work is refused. |
| Rate limits | Atomic fixed-window counters in Postgres: one `INSERT .. ON CONFLICT DO UPDATE .. WHERE count + n <= limit RETURNING` statement, so a denied request consumes nothing and parallel requests cannot overshoot. No in-memory counters. Defaults: 10 uncached translations an hour, 10 drafts a day, 2 concurrent jobs per user. |
| Budgets | Per-user, global and per-provider daily budgets in units (characters in and out), reserved before the call and settled or refunded after. |
| Duplicates | An idempotency key per user, operation and content version: an identical concurrent request gets 409, and a finished one gets the stored result, so one provider call is made. |
| Kill switch | `GENERATION_DISABLED=true`, or at runtime `npm run admin -- flag:set generation_disabled true`. |
| Circuit breaker | Opens for 60 seconds after five consecutive provider failures. There is no fallback to a different provider or model. |
| Abuse detection | Repeated denials, or many distinct uncached requests in two minutes, trigger a 15 minute per-user cooldown. Addresses are a signal only and are stored hashed; nothing blocks on address alone and nothing is permanent. |
| Fail closed | If identity, quota state or the kill switch cannot be read, or a limit is misconfigured, new paid work is refused with 503. Stored content stays readable. |
| Audit | Completed generations and admin flag changes are written to `audit_logs`; denials to `abuse_events`. Both are pruned after 14 days by the weekly maintenance job. |

**Translation integrity.** Before text is sent to a provider, URLs, code, numbers with units, dates, version strings, repository names and technical terms are replaced with placeholders, and restored afterwards. A response is rejected, and never stored or shown, if a placeholder is missing or duplicated, if it contains markup, if it is implausibly long, or if it echoes instruction-like text. The system prompt tells the model the text is data to translate, not instructions.

**Generated content cannot corrupt source records.** Translations and AI drafts are rows in `generated_content`, keyed by subject, content version (a hash of the source text), language, provider and model. Nothing in that path writes to `discoveries`. A changed source produces a new version, so stale translations are simply not returned. An integration test asserts discovery rows are byte-identical before and after.

**Explanations and diagrams** are data validated against a fixed schema: plain text only, no URLs, no code, a fixed set of diagram types rendered from a registry, and capped complexity. See [learn.md](learn.md).

**Not verified.** No provider key was available, so no provider was called live: adapters were tested against stubs. The atomicity tests ran on a single-connection embedded Postgres; they prove the statements, not multi-connection locking on a hosted database.

## Reporting

Open a private security advisory on the repository.
