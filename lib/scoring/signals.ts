import type { CategoryId, ClaimType, Kind, RepoGrowth, Scores, SourceGroup } from '@/lib/types';
import { DAY, HOUR } from '@/lib/utils/time';
import { fmtInt } from '@/lib/utils/text';
import { DEFAULT_WEIGHTS, QUALITY_GATE, type Weights } from './weights';

export interface ScoringRef {
  group: SourceGroup;
  owner: string;
  sourceName: string;
  isPrimary: boolean;
  points: number | null;
  comments: number | null;
}

export interface ScoringInput {
  now: Date;
  kind: Kind;
  category: CategoryId;
  claimType: ClaimType;
  tags: string[];
  text: string;
  publishedAt: Date | null;
  firstDiscoveredAt: Date;
  lastActivityAt: Date | null;
  confidence: number;
  refs: ScoringRef[];
  repo: {
    stars: number;
    forks: number;
    createdAt: Date | null;
    pushedAt: Date | null;
    license: string | null;
    homepage: string | null;
    readmeLength: number;
    releaseAt: Date | null;
    releaseTag: string | null;
    contributors: number | null;
  } | null;
  growth: RepoGrowth | null;
  anomaly: boolean;
  anomalyReason?: string | null;
  hf: { likes: number | null; downloads: number | null } | null;
  hasCode: boolean;
  /** Optional 0..100 judgement from the configured AI provider. */
  aiSignificance?: number | null;
}

export interface CorpusStats {
  total: number;
  tagDocFreq: Map<string, number>;
}

export interface ScoreResult {
  scores: Scores;
  reasons: string[];
  flags: string[];
}

const clamp = (n: number, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, n));
/** Maps a count onto 0..100 on a log scale where `full` scores 100. */
const logScale = (value: number, full: number) => (value <= 0 ? 0 : clamp((Math.log10(1 + value) / Math.log10(1 + full)) * 100));
const decay = (ageMs: number, halfLifeMs: number) => 100 * Math.pow(0.5, Math.max(0, ageMs) / halfLifeMs);
const round1 = (n: number) => Math.round(n * 10) / 10;

const LIST_PATTERN = /\b(awesome[- ]|curated list|list of|collection of (links|resources|prompts)|cheat ?sheet|interview questions|roadmap)\b/i;
const FRONTIER_TOPICS: Partial<Record<CategoryId, number>> = {
  agents: 12, llms: 10, robotics: 12, 'gaming-browser': 10, research: 8, creative: 8, 'dev-tools': 6, 'ai-tools': 5, 'open-source': 5, launches: 2,
};
const EVIDENCE_CUES = /\b(benchmark\w*|ablation\w*|we (release|open[- ]source)|code (is )?(available|released)|dataset|reproduc\w+|evaluat\w+ on|outperform\w*|human (study|evaluation))\b/gi;

export function independentRefs(refs: ScoringRef[]): ScoringRef[] {
  const seen = new Set<string>();
  const out: ScoringRef[] = [];
  for (const r of refs) {
    if (r.isPrimary || seen.has(r.owner)) continue;
    seen.add(r.owner);
    out.push(r);
  }
  return out;
}

function communityAttention(refs: ScoringRef[]) {
  const community = refs.filter((r) => r.group === 'community');
  const best = [...community].sort((a, b) => (b.points ?? 0) - (a.points ?? 0))[0];
  return { best, points: community.reduce((s, r) => s + (r.points ?? 0), 0), comments: community.reduce((s, r) => s + (r.comments ?? 0), 0) };
}

function momentum(i: ScoringInput, reasons: string[]): number {
  const attention = communityAttention(i.refs);
  const indep = independentRefs(i.refs);
  let score: number;

  if (i.kind === 'repository' && i.repo) {
    const g = i.growth;
    const ageDays = i.repo.createdAt ? (i.now.getTime() - i.repo.createdAt.getTime()) / DAY : null;
    const observed = g?.starsPerDayObserved != null ? logScale(Math.max(0, g.starsPerDayObserved), 1500) : null;
    // A lifetime average is only a momentum signal while the project is young.
    const lifetime = g?.starsPerDayLifetime != null && ageDays !== null && ageDays <= 60 ? 0.65 * logScale(g.starsPerDayLifetime, 1500) : 0;
    score = Math.max(observed ?? 0, lifetime);

    if (g?.observedDelta != null && g.observedHours != null && g.observedDelta > 0) {
      const rate = g.starsPerDayObserved != null ? `, about ${fmtInt(g.starsPerDayObserved)} a day` : '';
      reasons.push(`+${fmtInt(g.observedDelta)} stars across ${g.observedHours} h of our own snapshots${rate}`);
      const previous = i.repo.stars - g.observedDelta;
      if (previous > 0 && g.observedDelta / previous >= 0.2) score += 8;
    } else if (ageDays !== null && ageDays <= 60 && g?.starsPerDayLifetime != null) {
      const days = Math.max(1, Math.round(ageDays));
      reasons.push(`${fmtInt(i.repo.stars)} stars in the ${days === 1 ? 'day' : `${days} days`} since it was created (average ${fmtInt(g.starsPerDayLifetime)} a day; not yet a measured velocity)`);
    }
    if (i.repo.releaseAt && i.now.getTime() - i.repo.releaseAt.getTime() <= 14 * DAY) {
      score += 8;
      const relDays = Math.max(0, Math.round((i.now.getTime() - i.repo.releaseAt.getTime()) / DAY));
      reasons.push(`Release ${i.repo.releaseTag ?? ''} published ${relDays === 0 ? 'today' : `${relDays} d ago`}`.replace(/\s+/g, ' '));
    }
    if (i.repo.pushedAt && i.now.getTime() - i.repo.pushedAt.getTime() <= 3 * DAY) score += 5;
    else if (i.repo.pushedAt && i.now.getTime() - i.repo.pushedAt.getTime() > 90 * DAY) {
      score = Math.min(score, 8);
      reasons.push(`No commits pushed in ${Math.round((i.now.getTime() - i.repo.pushedAt.getTime()) / DAY)} days`);
    }
    score += 0.15 * logScale(attention.points, 800);
  } else if (i.kind === 'paper') {
    const hf = i.refs.find((r) => r.sourceName.startsWith('Hugging Face') && r.points != null);
    const cues = new Set((i.text.match(EVIDENCE_CUES) ?? []).map((c) => c.toLowerCase())).size;
    score = 0.45 * logScale(hf?.points ?? 0, 150) + (i.hasCode ? 20 : 0) + Math.min(20, cues * 5) + Math.min(15, indep.length * 6 + 0.1 * logScale(attention.points, 500));
    if (hf?.points) reasons.push(`${hf.points} upvotes on Hugging Face Papers`);
    if (i.hasCode) reasons.push('Code is linked from the paper');
  } else if (i.kind === 'model' || (i.kind === 'demo' && i.hf)) {
    score = 0.55 * logScale(i.hf?.likes ?? 0, 3000) + 0.25 * logScale(i.hf?.downloads ?? 0, 2_000_000) + Math.min(20, indep.length * 8);
    if (i.hf?.likes) reasons.push(`${fmtInt(i.hf.likes)} likes on Hugging Face${i.hf.downloads ? `, ${fmtInt(i.hf.downloads)} downloads` : ''}; listed in its trending feed`);
  } else {
    // Coverage and community posts: spread across independent sources matters more than raw points.
    const groups = new Set(i.refs.map((r) => r.group)).size;
    const owners = new Set(i.refs.map((r) => r.owner)).size;
    score = Math.min(55, (owners - 1) * 22) + Math.min(15, (groups - 1) * 8) + 0.4 * logScale(attention.points, 800) + 0.1 * logScale(attention.comments, 400);
    if (owners >= 2) reasons.push(`Reported by ${owners} independent sources: ${[...new Set(i.refs.map((r) => r.sourceName))].slice(0, 4).join(', ')}`);
  }

  if (attention.best && (attention.best.points ?? 0) >= 20) {
    reasons.push(`${attention.best.sourceName}: ${attention.best.points} points${attention.best.comments ? `, ${attention.best.comments} comments` : ''}`);
  }
  if (i.anomaly) {
    score *= 0.5;
    reasons.push(`Engagement looks unusual (${i.anomalyReason ?? 'stars without matching activity'}); momentum is discounted`);
  }
  return clamp(score);
}

function novelty(i: ScoringInput, corpus: CorpusStats): number {
  const born = i.repo?.createdAt ?? i.publishedAt;
  const ageScore = born ? decay(i.now.getTime() - born.getTime(), 30 * DAY) : 35;
  const seenScore = decay(i.now.getTime() - i.firstDiscoveredAt.getTime(), 5 * DAY);
  // Rare tag combinations score higher than the hundredth "llm chatbot".
  let rarity = 50;
  if (i.tags.length && corpus.total > 20) {
    const idf = i.tags.map((t) => Math.log((corpus.total + 1) / ((corpus.tagDocFreq.get(t) ?? 0) + 1)));
    const max = Math.log(corpus.total + 1);
    rarity = clamp((idf.reduce((a, b) => a + b, 0) / idf.length / max) * 100);
  }
  const visibility = i.repo ? i.repo.stars : Math.max(0, ...i.refs.map((r) => r.points ?? 0)) * 10;
  let score = 0.5 * ageScore + 0.25 * rarity + 0.15 * seenScore + (visibility < 1500 ? 10 : 0);
  if (LIST_PATTERN.test(i.text)) score *= 0.5;
  return clamp(score);
}

function significance(i: ScoringInput): number {
  const indep = independentRefs(i.refs);
  let score = 28 + (FRONTIER_TOPICS[i.category] ?? 4);
  if (i.repo) {
    score += Math.min(10, (i.repo.readmeLength / 4000) * 10);
    score += i.repo.releaseAt ? 5 : 0;
    score += 0.15 * logScale(i.repo.stars, 50_000);
    score += i.repo.contributors && i.repo.contributors >= 3 ? 4 : 0;
  }
  if (i.hasCode) score += 8;
  if (i.claimType === 'peer_reviewed') score += 10;
  if (i.kind === 'paper') score += Math.min(10, new Set((i.text.match(EVIDENCE_CUES) ?? []).map((c) => c.toLowerCase())).size * 3);
  score += Math.min(15, indep.length * 5);
  score += 0.12 * logScale(communityAttention(i.refs).points, 1000);
  if (LIST_PATTERN.test(i.text)) score -= 15;
  score = clamp(score);
  // When a model has read the evidence, blend its judgement with the heuristic.
  return i.aiSignificance != null ? clamp(0.5 * score + 0.5 * i.aiSignificance) : score;
}

function usefulness(i: ScoringInput): number {
  if (i.repo) {
    let s = 15;
    if (i.repo.license) s += 20;
    if (i.repo.readmeLength >= 1500) s += 20;
    else if (i.repo.readmeLength >= 400) s += 10;
    if (i.repo.releaseAt) s += 15;
    if (/\b(npm (i|install)|pip install|cargo (add|install)|docker (run|pull|compose)|brew install|go install|npx |uvx? |quick ?start|getting started|installation)\b/i.test(i.text)) s += 15;
    if (i.repo.homepage) s += 10;
    if (LIST_PATTERN.test(i.text)) s -= 10;
    return clamp(s);
  }
  if (i.kind === 'paper') return clamp(30 + (i.hasCode ? 30 : 0));
  if (i.kind === 'model') return clamp(35 + 0.3 * logScale(i.hf?.downloads ?? 0, 1_000_000) + (i.tags.some((t) => /gguf|onnx|mlx/.test(t)) ? 10 : 0));
  if (i.kind === 'demo') return 50;
  if (i.kind === 'product') return 45;
  return 25;
}

function freshness(i: ScoringInput): number {
  const latest = Math.max(
    i.lastActivityAt?.getTime() ?? 0,
    i.publishedAt?.getTime() ?? 0,
    i.repo?.releaseAt?.getTime() ?? 0,
  ) || i.firstDiscoveredAt.getTime();
  return clamp(decay(i.now.getTime() - latest, 96 * HOUR));
}

/** Hidden gems must be low-visibility by construction, not just low-ranked. */
export const GEM_MAX_STARS = 1500;
export const GEM_MAX_POINTS = 150;

export function scoreDiscovery(i: ScoringInput, corpus: CorpusStats, weights: Weights = DEFAULT_WEIGHTS): ScoreResult {
  const reasons: string[] = [];
  const flags: string[] = [];
  const m = momentum(i, reasons);
  const n = novelty(i, corpus);
  const s = significance(i);
  const u = usefulness(i);
  const f = freshness(i);
  const c = clamp(i.confidence);
  if (i.anomaly) flags.push('engagement-anomaly');
  if (LIST_PATTERN.test(i.text)) flags.push('list');

  const total =
    weights.novelty * n + weights.momentum * m + weights.significance * s +
    weights.credibility * c + weights.usefulness * u + weights.freshness * f;

  const lowVisibility = i.repo
    ? i.repo.stars < GEM_MAX_STARS
    : Math.max(0, ...i.refs.map((r) => r.points ?? 0)) < GEM_MAX_POINTS && i.kind !== 'article';
  const gemEligible = lowVisibility && c >= 50 && !i.anomaly && !flags.includes('list') && i.kind !== 'article' && i.kind !== 'post';
  const gem = gemEligible ? 0.45 * n + 0.3 * s + 0.25 * u : 0;
  if (gemEligible && i.repo) flags.push('low-visibility');

  const hoursSeen = (i.now.getTime() - i.firstDiscoveredAt.getTime()) / HOUR;
  if (hoursSeen <= 24) reasons.push(`First picked up ${hoursSeen < 1 ? 'in the last hour' : `${Math.round(hoursSeen)} h ago`}`);
  if (c < QUALITY_GATE) reasons.push('Evidence is limited; held out of featured sections until verified');

  return {
    scores: {
      total: round1(total), novelty: round1(n), momentum: round1(m), significance: round1(s),
      credibility: round1(c), usefulness: round1(u), freshness: round1(f), gem: round1(gem),
    },
    reasons: reasons.slice(0, 6),
    flags,
  };
}
