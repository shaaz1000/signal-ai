import type { CheckOutcome, ClaimType, ConfidenceLevel, CredibilityFactor, ExecutionMode, Kind, SourceGroup } from '@/lib/types';
import { coverage, INJECTION_PATTERN, PROMO_PATTERN, tokens } from '@/lib/utils/text';
import { DAY } from '@/lib/utils/time';
import { detectExecutionMode } from '@/lib/ingestion/classify';
import { QUALITY_GATE } from '@/lib/scoring/weights';

export interface VerificationRef {
  sourceId: string;
  sourceName: string;
  group: SourceGroup;
  owner: string;
  reliability: number;
  isPrimary: boolean;
  url: string;
  title: string;
  description: string;
  publishedAt: Date | null;
}

export type Probe =
  | { state: 'ok'; via: string }
  | { state: 'not_found'; via: string }
  | { state: 'blocked' | 'error'; via: string }
  | { state: 'skipped'; via: string };

export interface VerificationInput {
  now: Date;
  kind: Kind;
  category: string;
  claimType: ClaimType;
  canonicalUrl: string;
  title: string;
  description: string;
  author: string | null;
  publishedAt: Date | null;
  refs: VerificationRef[];
  probe: Probe;
  repo: {
    stars: number;
    description: string | null;
    createdAt: Date | null;
    pushedAt: Date | null;
    license: string | null;
    releaseAt: Date | null;
    archived: boolean;
    isFork: boolean;
  } | null;
  /** README or model card text. Untrusted. */
  docs: string;
  hasCode: boolean;
  codeUrl: string | null;
  anomaly: { anomaly: boolean; reason: string | null };
}

export interface Evidence {
  check: string;
  outcome: CheckOutcome;
  detail: string;
  url: string | null;
}

const ev = (check: string, outcome: CheckOutcome, detail: string, url: string | null = null): Evidence => ({ check, outcome, detail, url });

/** Distinct owners other than the primary source: the unit of corroboration. */
export function corroborators(refs: VerificationRef[]): VerificationRef[] {
  const primaryOwners = new Set(refs.filter((r) => r.isPrimary).map((r) => r.owner));
  const seen = new Set<string>();
  return refs.filter((r) => {
    if (r.isPrimary || primaryOwners.has(r.owner) || seen.has(r.owner)) return false;
    seen.add(r.owner);
    return true;
  });
}

/** Stage 4. Pure: every network result arrives through `input`. */
export function runChecks(i: VerificationInput): { evidence: Evidence[]; executionMode: ExecutionMode | null } {
  const out: Evidence[] = [];
  const allText = `${i.title} ${i.description} ${i.docs}`;

  // 1. Does the thing exist?
  switch (i.probe.state) {
    case 'ok':
      out.push(ev('url_exists', 'pass', `Confirmed reachable (${i.probe.via})`, i.canonicalUrl));
      break;
    case 'not_found':
      out.push(ev('url_exists', 'fail', `The canonical URL does not resolve (${i.probe.via})`, i.canonicalUrl));
      break;
    case 'skipped':
      out.push(ev('url_exists', 'pass', i.probe.via, i.canonicalUrl));
      break;
    default:
      out.push(ev('url_exists', 'unknown', `Could not confirm: ${i.probe.via}. Blocking automated requests is not evidence either way.`, i.canonicalUrl));
  }

  // 2. Is there a primary source, or only other people's descriptions?
  const primary = i.refs.find((r) => r.isPrimary);
  const projectHost = i.kind === 'repository' || i.kind === 'paper' || i.kind === 'model';
  if (primary || (projectHost && i.probe.state === 'ok')) {
    out.push(ev('primary_source', 'pass', `Primary source available: ${primary?.sourceName ?? new URL(i.canonicalUrl).hostname}`, i.canonicalUrl));
  } else if (i.claimType === 'third_party') {
    out.push(ev('primary_source', 'warn', 'Third-party report. The underlying primary source has not been located.'));
  } else {
    out.push(ev('primary_source', 'unknown', 'Only seen through community links; the original author has not been confirmed.'));
  }

  // 3. Do secondary descriptions agree with the primary one?
  if (i.repo) {
    const ownWords = tokens(`${i.repo.description ?? ''} ${i.docs.slice(0, 4000)}`);
    // The repository name counts as its own wording, but only once there is something to compare against.
    const primaryTokens = ownWords.length ? [...ownWords, ...tokens(i.canonicalUrl)] : [];
    const disagreeing = i.refs.filter((r) => {
      if (r.isPrimary) return false;
      const claim = tokens(r.title);
      return claim.length >= 4 && coverage(claim, primaryTokens) < 0.25;
    });
    if (!primaryTokens.length) out.push(ev('description_match', 'unknown', 'The repository has no description or README to compare against.'));
    else if (disagreeing.length) out.push(ev('description_match', 'warn', `"${disagreeing[0].title}" (${disagreeing[0].sourceName}) shares little wording with the repository's own description.`, disagreeing[0].url));
    else out.push(ev('description_match', 'pass', 'Secondary descriptions are consistent with the repository description and README.'));
    if (i.repo.archived) out.push(ev('repo_state', 'warn', 'The repository is archived (read-only).'));
  }

  // 4. Promotional language is noted, never repeated as fact.
  const promo = `${i.title} ${i.description}`.match(PROMO_PATTERN);
  if (promo) out.push(ev('promotional_language', 'warn', `Source text uses promotional wording ("${promo[0]}"). The claim behind it is not verified.`));

  // 5. Metrics must come from an API, not from someone's post.
  if (i.kind === 'repository') {
    out.push(i.repo
      ? ev('metrics_available', 'pass', `Star, fork and issue counts read from the GitHub API (${i.repo.stars} stars at last check).`, i.canonicalUrl)
      : ev('metrics_available', 'unknown', 'Repository metrics have not been retrieved yet.'));
  }

  // 6. Dates.
  const dateProblems: string[] = [];
  if (i.publishedAt && i.publishedAt.getTime() > i.now.getTime() + DAY) dateProblems.push('publication date is in the future');
  if (i.repo?.createdAt && i.repo.pushedAt && i.repo.pushedAt.getTime() < i.repo.createdAt.getTime() - DAY) dateProblems.push('last push predates creation');
  const ageDays = i.repo?.createdAt ? (i.now.getTime() - i.repo.createdAt.getTime()) / DAY : null;
  const calledNew = i.refs.some((r) => !r.isPrimary && /\b(new|just (released|launched)|introducing|announcing|launch)\b/i.test(r.title));
  if (ageDays !== null && ageDays > 365 && calledNew) {
    out.push(ev('dates_consistent', 'warn', `Described as new, but the repository was created ${Math.round(ageDays / 365 * 10) / 10} years ago. Publication and discovery dates are kept separate.`));
  } else if (dateProblems.length) {
    out.push(ev('dates_consistent', 'fail', `Date problem: ${dateProblems.join('; ')}.`));
  } else if (i.publishedAt || i.repo?.createdAt) {
    out.push(ev('dates_consistent', 'pass', 'Dates come from the source and are internally consistent.'));
  } else {
    out.push(ev('dates_consistent', 'unknown', 'The source gives no publication date.'));
  }

  // 7. Code and documentation.
  if (i.hasCode) out.push(ev('code_available', 'pass', i.kind === 'model' || i.kind === 'demo' ? 'The published files are public on Hugging Face.' : 'Source code is publicly available.', i.codeUrl ?? i.canonicalUrl));
  else if (i.kind === 'paper' || i.kind === 'demo' || i.kind === 'model') out.push(ev('code_available', 'unknown', 'No public code has been linked.'));
  if (i.docs.length >= 600) out.push(ev('documentation', 'pass', `Technical documentation present (${Math.round(i.docs.length / 100) / 10}k characters read).`));
  else if (i.kind === 'repository' || i.kind === 'model') out.push(ev('documentation', 'warn', 'Little or no documentation.'));

  // 8. Independent corroboration.
  const others = corroborators(i.refs);
  if (others.length >= 2) out.push(ev('corroboration', 'pass', `Referenced independently by ${others.length} sources: ${others.map((r) => r.sourceName).join(', ')}.`, others[0].url));
  else if (others.length === 1) out.push(ev('corroboration', 'warn', `One independent reference so far: ${others[0].sourceName}.`, others[0].url));
  else out.push(ev('corroboration', 'unknown', 'No independent source has referenced this yet.'));

  // 9. How does it actually run? Only stated when the source says so.
  let executionMode: ExecutionMode | null = null;
  if (i.category === 'gaming-browser' || /\b(browser|emulat\w*|stream\w*|wasm|webassembly)\b/i.test(`${i.title} ${i.description}`)) {
    const found = detectExecutionMode(`${i.title} ${i.description}`, i.docs);
    if (found) {
      executionMode = found.mode;
      out.push(ev('execution_mode', 'pass', `Source text says: "${found.cue}".`));
    } else if (i.category === 'gaming-browser') {
      out.push(ev('execution_mode', 'unknown', 'The sources do not state whether this runs natively, through emulation, or by streaming from another machine.'));
    }
  }

  // 10. Engagement sanity and hostile content.
  if (i.anomaly.anomaly) out.push(ev('engagement_pattern', 'warn', `Engagement looks unusual: ${i.anomaly.reason}.`));
  if (INJECTION_PATTERN.test(allText)) out.push(ev('untrusted_content', 'warn', 'Source text contains instructions aimed at automated readers. They were ignored and excluded from the summary.'));
  if (i.claimType === 'preprint') out.push(ev('review_status', 'unknown', 'Preprint: not peer reviewed.'));
  else if (i.claimType === 'peer_reviewed') out.push(ev('review_status', 'pass', 'The authors report a journal or conference reference.'));

  return { evidence: out, executionMode };
}

export function levelFor(score: number): ConfidenceLevel {
  if (score >= 75) return 'high';
  if (score >= 55) return 'medium';
  if (score >= QUALITY_GATE) return 'low';
  return 'unverified';
}

/**
 * Stage 5. A transparent additive score: every point is attributable to a
 * named factor, and the factor list is stored and shown. Stars never add
 * points here.
 */
export function assessCredibility(i: VerificationInput, evidence: Evidence[]): { score: number; level: ConfidenceLevel; factors: CredibilityFactor[] } {
  const has = (check: string, outcome: CheckOutcome) => evidence.some((e) => e.check === check && e.outcome === outcome);
  const factors: CredibilityFactor[] = [{ label: 'Baseline', points: 10, detail: 'Every item starts here.' }];
  const add = (label: string, points: number, detail: string) => factors.push({ label, points, detail });

  if (has('url_exists', 'pass')) add('Exists', 8, 'The canonical URL was confirmed.');
  if (has('url_exists', 'fail')) add('Missing', -40, 'The canonical URL does not resolve.');
  if (has('primary_source', 'pass')) add('Primary source', 8, 'We read the original, not only reports about it.');
  if (has('code_available', 'pass')) add(i.kind === 'model' || i.kind === 'demo' ? 'Public files' : 'Public code', 8, 'Anyone can inspect what was published.');
  if (has('documentation', 'pass')) add('Technical documentation', 8, 'Documentation was available to check descriptions against.');
  if (has('metrics_available', 'pass')) add('Metrics from an API', 6, 'Reported numbers were read from the platform, not quoted.');
  if (has('dates_consistent', 'pass')) add('Dates check out', 4, 'Source dates are present and consistent.');
  if (has('dates_consistent', 'fail')) add('Date problem', -10, 'Source dates contradict each other.');
  if (has('dates_consistent', 'warn')) add('Not actually new', -4, 'Described as new but created long ago.');

  const others = corroborators(i.refs);
  if (others.length) {
    const points = Math.min(27, others.reduce((s, r) => s + (r.group === 'community' ? 6 : 9), 0));
    add('Independent references', points, `${others.length} independent ${others.length === 1 ? 'source' : 'sources'}: ${others.map((r) => r.sourceName).join(', ')}.`);
  }
  const best = Math.max(0, ...i.refs.map((r) => r.reliability));
  add('Source reliability', Math.round(best * 24), `Most reliable source in the trail is rated ${best.toFixed(2)} (a fixed prior per source).`);

  const reproducible = [i.repo?.license, i.repo?.releaseAt].filter(Boolean).length;
  if (reproducible) add('Reproducibility cues', reproducible * 3, 'Has a licence and/or a tagged release.');
  if (i.author) add('Named author', 2, 'The hosting source names who published it.');
  if (has('review_status', 'pass')) add('Peer review reported', 6, 'Authors cite a venue. We did not confirm acceptance independently.');

  if (has('promotional_language', 'warn')) add('Promotional wording', -10, 'Claims are phrased as marketing and are not independently supported.');
  if (has('description_match', 'warn')) add('Conflicting descriptions', -12, 'A secondary description does not match the primary source.');
  if (has('engagement_pattern', 'warn')) add('Unusual engagement', -12, 'Popularity signals do not match activity.');
  if (has('untrusted_content', 'warn')) add('Manipulative content', -10, 'Source text tries to instruct automated readers.');
  if (has('repo_state', 'warn')) add('Archived', -5, 'The repository is read-only.');

  const score = Math.max(0, Math.min(100, factors.reduce((s, f) => s + f.points, 0)));
  return { score, level: levelFor(score), factors };
}

/** Status after verification. A dead canonical URL is rejected outright, whatever the score. */
export function statusFor(score: number, evidence: Evidence[]): 'verified' | 'unverified' | 'rejected' {
  if (evidence.some((e) => e.check === 'url_exists' && e.outcome === 'fail')) return 'rejected';
  return score >= 55 ? 'verified' : 'unverified';
}
