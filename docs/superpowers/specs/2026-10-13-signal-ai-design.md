# SIGNAL / AI: design record

**Date:** 13 October 2026. **Status:** implemented.

## Intent

A discovery engine, not a news site, that surfaces what people are building across AI and emerging technology, including projects with no mainstream coverage. Success means a feed that favours momentum and novelty over lifetime popularity, where every number and claim is traceable to a source and anything unconfirmed is labelled.

## Stated requirements (from the brief)

Two deliverables (a Claude Artifact and a deployable Next.js application); five source groups; a six-stage verification pipeline; an explainable ranking with the given starting weights; seven product areas; Apple-HIG-derived design tokens; scheduled GitHub Actions; a normalised Postgres schema; real tests; a private GitHub repository.

## Decisions taken without asking, as instructed

1. **PGlite for local, CI and zero-infrastructure runs; Postgres in production.** No database credentials were available. PGlite is real Postgres, so the schema and SQL are shared.
2. **The Artifact reads a snapshot.** The Artifact sandbox blocks outside network access, which rules out any live integration there. The page states this.
3. **One component set, two hosts**, joined by a small platform interface, so the Artifact and the app cannot drift apart.
4. **Extractive summaries by default.** No AI key was available; the adapter is pluggable and guarded.
5. **A detail page instead of a drawer**, for shareable URLs.
6. **Native form controls instead of a UI primitive library.**
7. **A `data` branch as the embedded store's home in Actions**, so the scheduled pipeline works before any database is connected.
8. **Reddit only through its official API**, therefore off until credentials exist.

## Open questions for the owner

- Which Postgres host and which deployment target.
- Whether to enable an AI provider for summaries and at what per-run budget.
- Whether the repository should stay private (scheduled workflows on private repositories consume Actions minutes).
