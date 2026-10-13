# Ranking and credibility

Everything here is a heuristic. The weights are the starting values from the product brief and have not been statistically validated. They are configurable (`RANKING_WEIGHTS`), versioned in every ranking snapshot, and every score shown in the UI comes with the reasons behind it.

## Trend score

| Signal | Weight | How it is computed (`lib/scoring/signals.ts`) |
|---|---:|---|
| Novelty | 25% | Age of the project (half-life 30 days), rarity of its tag combination across the corpus, how recently it was first seen, a bonus for low visibility. Lists and "awesome" collections are halved. |
| Momentum | 20% | Depends on the kind of item, below. |
| Technical significance | 20% | Topic prior, documentation depth, releases, public code, peer review, independent references, discussion. Blended 50/50 with the model's judgement when an AI provider is configured. |
| Credibility | 20% | The confidence score below. |
| Practical usefulness | 10% | Licence, documentation, releases, install instructions, a homepage or demo. |
| Freshness | 5% | Latest activity, half-life 4 days. |

**Momentum by kind**

- **Repositories:** stars per day measured between our own snapshots (log scale). While only one snapshot exists, the average since creation is used at 65% strength and only for repositories under 60 days old, and the reason text says it is not a measured velocity. Bonuses for a release in the last 14 days, a push in the last 3, and relative growth above 20%. A repository with no push in 90 days is capped at 8, whatever its star count.
- **Papers:** upvotes on Hugging Face Papers, linked code, evidence cues in the abstract (benchmarks, ablations, released data), independent references.
- **Models and demos:** Hugging Face likes and downloads, independent references.
- **Coverage and posts:** number of independent sources, spread across source groups, discussion points.

**Engagement anomalies.** A young repository with hundreds of stars but almost no forks and no issues, or a large star jump with no new forks, is flagged. The flag halves momentum, removes it from Hidden Gems, costs 12 confidence points and is shown on the detail page.

## Credibility (confidence)

An additive score from 0 to 100 (`assessCredibility` in `lib/verification/checks.ts`). Every point belongs to a named factor, and the factor list is stored and displayed.

| Factor | Points |
|---|---:|
| Baseline | +10 |
| Canonical URL confirmed | +8 |
| Primary source read | +8 |
| Public code or files | +8 |
| Technical documentation present | +8 |
| Metrics read from an API | +6 |
| Dates present and consistent | +4 |
| Independent references (9 per editorial or research source, 6 per community source) | up to +27 |
| Source reliability (best source in the trail × 24) | up to +24 |
| Licence, tagged release | +3 each |
| Named author | +2 |
| Peer review reported by authors | +6 |
| Canonical URL does not resolve | −40, and the item is rejected |
| Promotional wording | −10 |
| Secondary description conflicts with the primary source | −12 |
| Unusual engagement | −12 |
| Text aimed at manipulating automated readers | −10 |
| Described as new but created long ago | −4 |
| Date contradiction | −10 |

**Star counts add nothing.** Two sources with the same owner (for example two Hugging Face feeds) count as one reference.

| Level | Score | Treatment |
|---|---|---|
| High | 75+ | Eligible everywhere |
| Medium | 55 to 74 | Status `verified`; eligible for featured sections |
| Low | 40 to 54 | Shown in feeds with a "Low confidence" label; never featured |
| Not verified | below 40 | Only in the Unverified section |

Credibility is both 20% of the trend score and an independent gate: nothing below 40 appears in ranked surfaces however well it scores elsewhere.

## Source reliability priors

Fixed editorial values, not measurements: MIT Technology Review and IEEE Spectrum 0.90; Ars Technica 0.85; GitHub Blog and Google Research 0.80; TechCrunch, The Verge, OpenAI, DeepMind and Hugging Face blogs 0.75; arXiv and Simon Willison 0.70; VentureBeat and Hugging Face Papers 0.65; Hacker News and Lobsters 0.55; GitHub and Hugging Face hosting 0.50 (hosting something is not vouching for it); Reddit 0.45; Product Hunt 0.40.

## Sorts and sections

| Sort | Definition |
|---|---|
| Trending | Trend score, then a diversity pass |
| Latest | Most recently picked up |
| Fastest growing | Momentum |
| Most innovative | 0.6 × novelty + 0.4 × significance |
| Most useful | Usefulness, with credibility as a tie-breaker |
| Hidden gems | Under 1,500 stars (or under 150 discussion points), confidence 50+, no anomaly, not a list; scored 0.45 novelty + 0.30 significance + 0.25 usefulness |
| Open source | Has public code, by trend score |
| Verified breakthroughs | Confidence 75+ **and** at least two independent sources. This means the work exists as described and is independently referenced. It does not mean results were reproduced. |

**Diversity.** A greedy re-rank discounts each repeat of an owner (×0.7), source (×0.94) and category (×0.97) among neighbours, so one organisation, outlet or topic cannot fill a page.

**Time windows** apply to the publication date (creation date for repositories), falling back to the first-seen time when the source gives no date.
