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

## Reporting

Open a private security advisory on the repository.
