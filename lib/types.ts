/**
 * Shared domain types. Everything the UI renders is a `DiscoveryView`; the
 * Next.js app builds them from Postgres and the Claude Artifact reads the same
 * shape from an exported snapshot file.
 */

export const CATEGORIES = [
  { id: 'ai-tools', name: 'AI tools' },
  { id: 'open-source', name: 'Open source' },
  { id: 'agents', name: 'Agents' },
  { id: 'llms', name: 'LLMs' },
  { id: 'dev-tools', name: 'Developer tools' },
  { id: 'research', name: 'Research' },
  { id: 'robotics', name: 'Robotics' },
  { id: 'creative', name: 'Creative technology' },
  { id: 'gaming-browser', name: 'Gaming and browser experiments' },
  { id: 'launches', name: 'Startups and launches' },
] as const;

export type CategoryId = (typeof CATEGORIES)[number]['id'];
export const CATEGORY_IDS = CATEGORIES.map((c) => c.id) as CategoryId[];
export const categoryName = (id: string): string =>
  CATEGORIES.find((c) => c.id === id)?.name ?? id;

export const KINDS = ['repository', 'paper', 'model', 'demo', 'article', 'product', 'post'] as const;
export type Kind = (typeof KINDS)[number];

/** How a claim reached us. Research Lab keeps these visibly distinct. */
export const CLAIM_TYPES = [
  'peer_reviewed',
  'preprint',
  'company_announcement',
  'independent_experiment',
  'third_party',
  'project_release',
  'community_post',
] as const;
export type ClaimType = (typeof CLAIM_TYPES)[number];

export const CLAIM_LABELS: Record<ClaimType, string> = {
  peer_reviewed: 'Peer-reviewed',
  preprint: 'Preprint',
  company_announcement: 'Company announcement',
  independent_experiment: 'Independent experiment',
  third_party: 'Third-party report',
  project_release: 'Project release',
  community_post: 'Community post',
};

/** How a demo actually runs. Only set when source text states it. */
export const EXECUTION_MODES = [
  'native',
  'emulation',
  'cloud_streaming',
  'remote_desktop',
  'ai_generated',
] as const;
export type ExecutionMode = (typeof EXECUTION_MODES)[number];

export const EXECUTION_LABELS: Record<ExecutionMode, string> = {
  native: 'Runs natively (ported or compiled, not emulated)',
  emulation: 'Runs through emulation',
  cloud_streaming: 'Streamed from a remote machine',
  remote_desktop: 'Remote desktop session',
  ai_generated: 'AI-generated output',
};

export type SourceGroup = 'github' | 'community' | 'research' | 'news' | 'blog';
export const SOURCE_GROUPS: { id: SourceGroup; name: string }[] = [
  { id: 'github', name: 'GitHub' },
  { id: 'community', name: 'Communities' },
  { id: 'research', name: 'Research' },
  { id: 'news', name: 'Technology news' },
  { id: 'blog', name: 'Engineering blogs' },
];

export type ConfidenceLevel = 'high' | 'medium' | 'low' | 'unverified';
export const CONFIDENCE_LABELS: Record<ConfidenceLevel, string> = {
  high: 'High confidence',
  medium: 'Medium confidence',
  low: 'Low confidence',
  unverified: 'Not verified',
};

export type DiscoveryStatus = 'candidate' | 'verified' | 'unverified' | 'rejected' | 'archived';

export type CheckOutcome = 'pass' | 'warn' | 'fail' | 'unknown';

export interface EvidenceView {
  check: string;
  outcome: CheckOutcome;
  detail: string;
  url: string | null;
}

export interface CredibilityFactor {
  label: string;
  points: number;
  detail: string;
}

export interface SourceRefView {
  sourceId: string;
  sourceName: string;
  group: SourceGroup;
  url: string;
  title: string;
  publishedAt: string | null;
  primary: boolean;
  points: number | null;
  comments: number | null;
}

export interface Scores {
  total: number;
  novelty: number;
  momentum: number;
  significance: number;
  credibility: number;
  usefulness: number;
  freshness: number;
  /** Hidden-gem score; independent of `total`. */
  gem: number;
}

export interface RepoGrowth {
  /** Stars gained between the first and last observation we made. Null until two snapshots exist. */
  observedDelta: number | null;
  observedHours: number | null;
  starsPerDayObserved: number | null;
  /** stars / age in days. A lifetime average, not a measured velocity. */
  starsPerDayLifetime: number | null;
  snapshots: number;
}

export interface RepoView {
  owner: string;
  name: string;
  language: string | null;
  license: string | null;
  stars: number | null;
  forks: number | null;
  openIssues: number | null;
  contributors: number | null;
  createdAt: string | null;
  pushedAt: string | null;
  topics: string[];
  latestRelease: { tag: string; publishedAt: string | null } | null;
  growth: RepoGrowth;
  anomaly: boolean;
}

export interface Editorial {
  what: string;
  why: string;
  /** Null when sources do not describe the implementation. */
  how: string | null;
  whoCares: string;
  limitations: string[];
  applications: string | null;
  method: 'extractive' | 'llm';
  model: string | null;
}

export interface DiscoveryView {
  id: string;
  kind: Kind;
  title: string;
  headline: string;
  summary: string;
  category: CategoryId;
  tags: string[];
  claimType: ClaimType;
  executionMode: ExecutionMode | null;
  canonicalUrl: string;
  author: string | null;
  authorVerified: boolean;
  publishedAt: string | null;
  firstDiscoveredAt: string;
  lastVerifiedAt: string | null;
  lastActivityAt: string | null;
  status: DiscoveryStatus;
  confidence: number;
  confidenceLevel: ConfidenceLevel;
  scores: Scores;
  reasons: string[];
  credibilityFactors: CredibilityFactor[];
  evidence: EvidenceView[];
  sources: SourceRefView[];
  editorial: Editorial;
  repo: RepoView | null;
  flags: string[];
  /** True for records created by the fixture seeder, never by ingestion. */
  fixture: boolean;
}

export interface ProviderResult {
  source: string;
  name: string;
  group: SourceGroup;
  status: 'ok' | 'failed' | 'skipped';
  fetched: number;
  accepted: number;
  durationMs: number;
  error: string | null;
}

export interface JobSummary {
  job: string;
  status: 'running' | 'success' | 'degraded' | 'failed';
  startedAt: string;
  finishedAt: string | null;
  providers: ProviderResult[];
  stats: Record<string, number>;
  error: string | null;
}

export interface StatusView {
  generatedAt: string;
  lastIngestion: JobSummary | null;
  lastVerification: JobSummary | null;
  lastRanking: JobSummary | null;
  lastCuration: JobSummary | null;
  nextScheduledIngestion: string;
  counts: { total: number; last24h: number; last7d: number; verified: number; unverified: number };
  stale: boolean;
  /** `fixture` when every record came from the fixture seeder. */
  dataMode: 'ingested' | 'fixture' | 'empty';
  /** `snapshot`: a fixed export (the Claude Artifact). `site`: the static site the pipeline republishes after every run. */
  storage: 'postgres' | 'pglite' | 'snapshot' | 'site';
}

export interface WeeklyEdition {
  weekStart: string;
  weekEnd: string;
  generatedAt: string;
  intro: string;
  sections: { category: CategoryId; ids: string[] }[];
}

/** The file the Artifact reads. Written by `npm run export:snapshot`. */
export interface Snapshot {
  schemaVersion: 1;
  status: StatusView;
  discoveries: DiscoveryView[];
  weekly: WeeklyEdition | null;
  featuredId: string | null;
}
