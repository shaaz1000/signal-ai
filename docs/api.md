# HTTP API

All responses are JSON. Errors are `{ "error": string, "code": string }`. Unknown parameter values fall back to defaults instead of failing.

## Public read endpoints

Rate limited to 60 requests a minute per client (`API_RATE_LIMIT`). Cached for 30 to 60 seconds.

| Endpoint | Returns |
|---|---|
| `GET /api/discoveries?scope=&q=&category=&industry=&sort=&window=&language=&age=&activity=&page=` | One page of discoveries. `scope`: `discover`, `radar`, `research`, `gems`, `models`, `industries`, `learn`, `content`, `unverified`. |
| `GET /api/discoveries/{id}` | One discovery with evidence, sources, scores, industries, stated maturity and model facts. |
| `GET /api/status` | Last ingestion, verification and ranking runs, per-source results, counts, staleness. |
| `GET /api/content/{id}?language=` | Stored generated records (translations, AI drafts) for a discovery, for its current content version. No account needed. |

## Account

| Endpoint | Notes |
|---|---|
| `POST /api/session` `{ token }` | Exchanges an operator-issued access token for an httpOnly session cookie. 5 attempts a minute per address. One generic 401 for any failure. |
| `DELETE /api/session` | Signs out. |
| `GET /api/me` | `{ signedIn, translationAvailable, generationAvailable, languages }`, plus plan, limits and usage when signed in. |

There is no self-service sign-up. Create accounts with `npm run admin -- user:create --name NAME [--plan free|pro] [--role user|admin]`; the token is printed once and only its hash is stored. API clients can send it as `Authorization: Bearer <token>`.

## Protected generation

These are the only endpoints that can spend money. Each goes through one gate (`lib/security/gate.ts`). A stored result for the same content is returned first, without sign-in and without touching any quota.

| Endpoint | Body | Result |
|---|---|---|
| `POST /api/translate` | `{ discoveryId, language }` | `{ fields, language, dir, provider, model, cached, contentVersion }` |
| `POST /api/generate` | `{ discoveryId, kind: "draft", variant: "<format>:<tone>", language? }` | `{ payload, provider, model, cached, contentVersion }` |
| `POST /api/admin/flags` | `{ key: "generation_disabled", value: boolean }` | Admin role only. Writes an audit log entry. |

`kind` also accepts `explanation` and `story`, which answer 501: explanations and Story Mode are assembled without a model.

| Status | Codes | Meaning |
|---|---|---|
| 400 | `invalid_json`, `invalid_request`, `invalid_input`, `unsupported_language` | Rejected before any other work |
| 401 | `unauthenticated` | Sign in first |
| 403 | `forbidden` | Not an admin, or a cross-site request |
| 409 | `in_progress` | The identical request is already running |
| 413 | `payload_too_large`, `input_too_large` | |
| 429 | `rate_limited`, `cooldown`, `too_many_concurrent`, `budget_exhausted` | Carries `Retry-After` |
| 501 | `not_configured` | No provider configured for this operation |
| 502, 504 | `provider_failed`, `timeout` | Nothing is stored and the user is not charged |
| 503 | `disabled`, `auth_unavailable`, `misconfigured`, `quota_unavailable`, `provider_unavailable`, `budget_exhausted` | Kill switch, missing `AUTH_SECRET`, bad limit configuration, quota store unreachable, open circuit breaker, or the global budget |
