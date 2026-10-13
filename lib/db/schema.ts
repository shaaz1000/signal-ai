import { sql } from 'drizzle-orm';
import {
  bigint, boolean, index, integer, jsonb, pgTable, primaryKey, real, text, timestamp, uniqueIndex,
} from 'drizzle-orm/pg-core';
import type {
  CredibilityFactor, Editorial, ProviderResult, WeeklyEdition,
} from '@/lib/types';

/**
 * Conventions: stable text keys where the outside world gives us an identity,
 * identity bigints elsewhere, timestamptz everywhere, every foreign key
 * indexed. Row level security is enabled on every table with no policies, so
 * a Supabase anon/authenticated key can read nothing; the server connects with
 * the database role and is unaffected.
 */

const id = () => bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity();
const ts = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });

export const sources = pgTable('sources', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  group: text('group').notNull(),
  /** 0..1 prior for how reliable this source's own statements are. A heuristic. */
  reliability: real('reliability').notNull(),
  /** Sources sharing an owner are not independent of each other. */
  owner: text('owner').notNull(),
  homepage: text('homepage'),
  enabled: boolean('enabled').notNull().default(true),
}).enableRLS();

export const categories = pgTable('categories', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  sort: integer('sort').notNull().default(0),
}).enableRLS();

export const projects = pgTable('projects', {
  id: id(),
  /** e.g. `github:owner/repo`, `arxiv:2510.01234`, `url:example.com/path`. */
  canonicalKey: text('canonical_key').notNull(),
  kind: text('kind').notNull(),
  name: text('name').notNull(),
  owner: text('owner'),
  url: text('url').notNull(),
  homepageUrl: text('homepage_url'),
  primaryLanguage: text('primary_language'),
  license: text('license'),
  sourceCreatedAt: ts('source_created_at'),
  /** Untrusted third-party text (description, README excerpt, topics). */
  metadata: jsonb('metadata').$type<ProjectMetadata>().notNull().default({}),
  createdAt: ts('created_at').notNull().defaultNow(),
  updatedAt: ts('updated_at').notNull().defaultNow(),
}, (t) => [uniqueIndex('projects_canonical_key_uq').on(t.canonicalKey)]).enableRLS();

export interface ProjectMetadata {
  description?: string;
  readmeExcerpt?: string;
  readmeLength?: number;
  topics?: string[];
  isFork?: boolean;
  archived?: boolean;
  contributors?: number | null;
  hfLikes?: number;
  hfDownloads?: number;
  hfPipeline?: string;
  hfLicense?: string;
  hasCode?: boolean;
  codeUrl?: string;
  enrichedAt?: string;
}

export const discoveries = pgTable('discoveries', {
  /** First 12 hex chars of sha256(canonical key): stable across reruns. */
  id: text('id').primaryKey(),
  projectId: bigint('project_id', { mode: 'number' }).notNull().references(() => projects.id, { onDelete: 'cascade' }),
  categoryId: text('category_id').notNull().references(() => categories.id),
  kind: text('kind').notNull(),
  title: text('title').notNull(),
  headline: text('headline').notNull(),
  summary: text('summary').notNull().default(''),
  canonicalUrl: text('canonical_url').notNull(),
  author: text('author'),
  authorVerified: boolean('author_verified').notNull().default(false),
  claimType: text('claim_type').notNull(),
  executionMode: text('execution_mode'),
  /** When the source says it was published. Never inferred from discovery time. */
  publishedAt: ts('published_at'),
  firstDiscoveredAt: ts('first_discovered_at').notNull().defaultNow(),
  lastSeenAt: ts('last_seen_at').notNull().defaultNow(),
  lastActivityAt: ts('last_activity_at'),
  lastVerifiedAt: ts('last_verified_at'),
  lastRankedAt: ts('last_ranked_at'),
  status: text('status').notNull().default('candidate'),
  confidence: integer('confidence').notNull().default(0),
  confidenceLevel: text('confidence_level').notNull().default('unverified'),
  editorial: jsonb('editorial').$type<Editorial | null>(),
  // Latest ranking, denormalised from ranking_snapshots for cheap feed queries.
  scoreTotal: real('score_total').notNull().default(0),
  scoreNovelty: real('score_novelty').notNull().default(0),
  scoreMomentum: real('score_momentum').notNull().default(0),
  scoreSignificance: real('score_significance').notNull().default(0),
  scoreUsefulness: real('score_usefulness').notNull().default(0),
  scoreFreshness: real('score_freshness').notNull().default(0),
  scoreGem: real('score_gem').notNull().default(0),
  reasons: jsonb('reasons').$type<string[]>().notNull().default([]),
  /** Latest credibility breakdown; history lives in credibility_assessments. */
  credibilityFactors: jsonb('credibility_factors').$type<CredibilityFactor[]>().notNull().default([]),
  /** Optional 0..100 judgement from the configured AI provider, blended into significance. */
  aiSignificance: real('ai_significance'),
  flags: jsonb('flags').$type<string[]>().notNull().default([]),
  industries: jsonb('industries').$type<string[]>().notNull().default([]),
  evidenceStage: text('evidence_stage'),
  evidenceStageCue: text('evidence_stage_cue'),
  conceptId: text('concept_id'),
  /** Provenance: which pipeline wrote this row. `fixture` rows are never shown as ingested. */
  origin: text('origin').notNull().default('ingestion'),
}, (t) => [
  uniqueIndex('discoveries_project_uq').on(t.projectId),
  index('discoveries_category_idx').on(t.categoryId),
  index('discoveries_feed_idx').on(t.status, t.firstDiscoveredAt.desc()),
  index('discoveries_score_idx').on(t.scoreTotal.desc()),
  index('discoveries_verify_queue_idx').on(t.lastVerifiedAt.asc().nullsFirst()),
]).enableRLS();

export const sourceReferences = pgTable('source_references', {
  id: id(),
  discoveryId: text('discovery_id').notNull().references(() => discoveries.id, { onDelete: 'cascade' }),
  sourceId: text('source_id').notNull().references(() => sources.id),
  /** The source's own id for the item; with source_id it makes reruns idempotent. */
  externalId: text('external_id').notNull(),
  url: text('url').notNull(),
  title: text('title').notNull(),
  author: text('author'),
  publishedAt: ts('published_at'),
  firstSeenAt: ts('first_seen_at').notNull().defaultNow(),
  lastSeenAt: ts('last_seen_at').notNull().defaultNow(),
  isPrimary: boolean('is_primary').notNull().default(false),
  points: integer('points'),
  comments: integer('comments'),
  description: text('description').notNull().default(''),
}, (t) => [
  uniqueIndex('source_refs_source_external_uq').on(t.sourceId, t.externalId),
  index('source_refs_discovery_idx').on(t.discoveryId),
]).enableRLS();

export const repoMetricSnapshots = pgTable('repo_metric_snapshots', {
  id: id(),
  projectId: bigint('project_id', { mode: 'number' }).notNull().references(() => projects.id, { onDelete: 'cascade' }),
  observedAt: ts('observed_at').notNull(),
  /** Hour bucket (UTC). One snapshot per project per hour keeps reruns idempotent. */
  bucket: text('bucket').notNull(),
  stars: integer('stars').notNull(),
  forks: integer('forks').notNull(),
  openIssues: integer('open_issues').notNull(),
  watchers: integer('watchers'),
  contributors: integer('contributors'),
  pushedAt: ts('pushed_at'),
  latestReleaseTag: text('latest_release_tag'),
  latestReleaseAt: ts('latest_release_at'),
}, (t) => [
  uniqueIndex('repo_snapshots_project_bucket_uq').on(t.projectId, t.bucket),
  index('repo_snapshots_observed_idx').on(t.observedAt),
]).enableRLS();

export const tags = pgTable('tags', {
  id: id(),
  slug: text('slug').notNull(),
}, (t) => [uniqueIndex('tags_slug_uq').on(t.slug)]).enableRLS();

export const discoveryTags = pgTable('discovery_tags', {
  discoveryId: text('discovery_id').notNull().references(() => discoveries.id, { onDelete: 'cascade' }),
  tagId: bigint('tag_id', { mode: 'number' }).notNull().references(() => tags.id, { onDelete: 'cascade' }),
}, (t) => [
  primaryKey({ columns: [t.discoveryId, t.tagId] }),
  index('discovery_tags_tag_idx').on(t.tagId),
]).enableRLS();

export const verificationEvidence = pgTable('verification_evidence', {
  id: id(),
  discoveryId: text('discovery_id').notNull().references(() => discoveries.id, { onDelete: 'cascade' }),
  check: text('check').notNull(),
  outcome: text('outcome').notNull(),
  detail: text('detail').notNull(),
  evidenceUrl: text('evidence_url'),
  checkedAt: ts('checked_at').notNull().defaultNow(),
}, (t) => [uniqueIndex('evidence_discovery_check_uq').on(t.discoveryId, t.check)]).enableRLS();

export const credibilityAssessments = pgTable('credibility_assessments', {
  id: id(),
  discoveryId: text('discovery_id').notNull().references(() => discoveries.id, { onDelete: 'cascade' }),
  assessedAt: ts('assessed_at').notNull().defaultNow(),
  score: integer('score').notNull(),
  level: text('level').notNull(),
  factors: jsonb('factors').$type<CredibilityFactor[]>().notNull(),
}, (t) => [index('credibility_discovery_idx').on(t.discoveryId, t.assessedAt.desc())]).enableRLS();

export const rankingSnapshots = pgTable('ranking_snapshots', {
  id: id(),
  discoveryId: text('discovery_id').notNull().references(() => discoveries.id, { onDelete: 'cascade' }),
  computedAt: ts('computed_at').notNull().defaultNow(),
  day: text('day').notNull(),
  total: real('total').notNull(),
  novelty: real('novelty').notNull(),
  momentum: real('momentum').notNull(),
  significance: real('significance').notNull(),
  credibility: real('credibility').notNull(),
  usefulness: real('usefulness').notNull(),
  freshness: real('freshness').notNull(),
  weightsVersion: text('weights_version').notNull(),
  explanation: jsonb('explanation').$type<string[]>().notNull(),
}, (t) => [
  // One row per discovery per day: history without unbounded growth.
  uniqueIndex('ranking_discovery_day_uq').on(t.discoveryId, t.day),
  index('ranking_computed_idx').on(t.computedAt),
]).enableRLS();

export const ingestionRuns = pgTable('ingestion_runs', {
  id: id(),
  job: text('job').notNull(),
  status: text('status').notNull(),
  startedAt: ts('started_at').notNull().defaultNow(),
  finishedAt: ts('finished_at'),
  providers: jsonb('providers').$type<ProviderResult[]>().notNull().default([]),
  stats: jsonb('stats').$type<Record<string, number>>().notNull().default({}),
  error: text('error'),
}, (t) => [index('runs_job_started_idx').on(t.job, t.startedAt.desc())]).enableRLS();

export const editions = pgTable('editions', {
  id: id(),
  kind: text('kind').notNull(),
  /** ISO date: the day for `daily`, the Monday for `weekly`. */
  periodStart: text('period_start').notNull(),
  generatedAt: ts('generated_at').notNull().defaultNow(),
  featuredId: text('featured_id'),
  payload: jsonb('payload').$type<WeeklyEdition | { ids: string[] }>().notNull(),
}, (t) => [uniqueIndex('editions_kind_period_uq').on(t.kind, t.periodStart)]).enableRLS();

// Accounts are optional at launch. The tables exist so server-side bookmarks
// can be switched on without a schema change; the UI currently stores
// bookmarks in the browser.
export const users = pgTable('users', {
  id: id(),
  externalId: text('external_id').notNull(),
  name: text('name'),
  /** Entitlement tier; limits per plan live in lib/security/config.ts. */
  plan: text('plan').notNull().default('free'),
  role: text('role').notNull().default('user'),
  /** SHA-256 of the access token. The token itself is shown once at creation and never stored. */
  tokenHash: text('token_hash'),
  preferences: jsonb('preferences').$type<Record<string, unknown>>().notNull().default({}),
  disabledAt: ts('disabled_at'),
  createdAt: ts('created_at').notNull().defaultNow(),
}, (t) => [uniqueIndex('users_external_uq').on(t.externalId), uniqueIndex('users_token_hash_uq').on(t.tokenHash)]).enableRLS();

export const modelReleases = pgTable('model_releases', {
  discoveryId: text('discovery_id').primaryKey().references(() => discoveries.id, { onDelete: 'cascade' }),
  vendor: text('vendor'),
  openWeights: boolean('open_weights'),
  license: text('license'),
  modalities: jsonb('modalities').$type<string[]>().notNull().default([]),
  independentlyTested: boolean('independently_tested').notNull().default(false),
  updatedAt: ts('updated_at').notNull().defaultNow(),
}).enableRLS();

export const trendSnapshots = pgTable('trend_snapshots', {
  id: id(),
  topicKind: text('topic_kind').notNull(),
  topic: text('topic').notNull(),
  day: text('day').notNull(),
  items: integer('items').notNull(),
  sources: integer('sources').notNull(),
  repos: integer('repos').notNull(),
  papers: integer('papers').notNull(),
  launches: integer('launches').notNull(),
  momentum: real('momentum').notNull(),
  credibility: real('credibility').notNull(),
  topIds: jsonb('top_ids').$type<string[]>().notNull().default([]),
}, (t) => [uniqueIndex('trend_topic_day_uq').on(t.topicKind, t.topic, t.day), index('trend_day_idx').on(t.day)]).enableRLS();

/**
 * Everything a model or translator produced. Kept apart from discoveries so
 * generated text can never overwrite a verified source record, and versioned
 * by the hash of the source it was made from so a changed source invalidates it.
 */
export const generatedContent = pgTable('generated_content', {
  id: id(),
  kind: text('kind').notNull(),
  /** `discovery:<id>` or `concept:<id>`. */
  subject: text('subject').notNull(),
  contentVersion: text('content_version').notNull(),
  language: text('language').notNull().default('en'),
  /** Format and tone for drafts; empty otherwise. */
  variant: text('variant').notNull().default(''),
  provider: text('provider').notNull(),
  model: text('model').notNull(),
  payload: jsonb('payload').$type<unknown>().notNull(),
  createdBy: bigint('created_by', { mode: 'number' }).references(() => users.id, { onDelete: 'set null' }),
  createdAt: ts('created_at').notNull().defaultNow(),
}, (t) => [
  uniqueIndex('generated_identity_uq').on(t.kind, t.subject, t.contentVersion, t.language, t.variant, t.provider, t.model),
  index('generated_subject_idx').on(t.subject, t.kind, t.language),
  index('generated_created_by_idx').on(t.createdBy),
]).enableRLS();

/** Fixed-window counters, incremented atomically with INSERT .. ON CONFLICT DO UPDATE .. RETURNING. */
export const usageCounters = pgTable('usage_counters', {
  key: text('key').notNull(),
  windowStart: ts('window_start').notNull(),
  count: integer('count').notNull().default(0),
  cost: real('cost').notNull().default(0),
}, (t) => [primaryKey({ columns: [t.key, t.windowStart] }), index('usage_window_idx').on(t.windowStart)]).enableRLS();

export const generationJobs = pgTable('generation_jobs', {
  id: id(),
  userId: bigint('user_id', { mode: 'number' }).references(() => users.id, { onDelete: 'cascade' }),
  kind: text('kind').notNull(),
  subject: text('subject').notNull(),
  /** Same user, same request: the second caller gets the first job's result instead of a second paid call. */
  idempotencyKey: text('idempotency_key').notNull(),
  status: text('status').notNull().default('running'),
  costEstimate: real('cost_estimate').notNull().default(0),
  resultId: bigint('result_id', { mode: 'number' }),
  error: text('error'),
  startedAt: ts('started_at').notNull().defaultNow(),
  finishedAt: ts('finished_at'),
}, (t) => [
  uniqueIndex('jobs_idempotency_uq').on(t.idempotencyKey),
  index('jobs_user_status_idx').on(t.userId, t.status),
]).enableRLS();

export const abuseEvents = pgTable('abuse_events', {
  id: id(),
  userId: bigint('user_id', { mode: 'number' }).references(() => users.id, { onDelete: 'cascade' }),
  /** Salted hash; raw addresses are not stored. */
  ipHash: text('ip_hash'),
  kind: text('kind').notNull(),
  detail: jsonb('detail').$type<Record<string, unknown>>().notNull().default({}),
  createdAt: ts('created_at').notNull().defaultNow(),
}, (t) => [index('abuse_user_idx').on(t.userId, t.createdAt.desc()), index('abuse_created_idx').on(t.createdAt)]).enableRLS();

export const auditLogs = pgTable('audit_logs', {
  id: id(),
  actor: text('actor').notNull(),
  action: text('action').notNull(),
  subject: text('subject').notNull(),
  detail: jsonb('detail').$type<Record<string, unknown>>().notNull().default({}),
  createdAt: ts('created_at').notNull().defaultNow(),
}, (t) => [index('audit_created_idx').on(t.createdAt.desc())]).enableRLS();

/** Runtime switches an operator can flip without a deploy, e.g. `generation_disabled`. */
export const appFlags = pgTable('app_flags', {
  key: text('key').primaryKey(),
  value: jsonb('value').$type<unknown>().notNull(),
  updatedAt: ts('updated_at').notNull().defaultNow(),
}).enableRLS();

export const collections = pgTable('collections', {
  id: id(),
  userId: bigint('user_id', { mode: 'number' }).notNull().references(() => users.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  createdAt: ts('created_at').notNull().defaultNow(),
}, (t) => [uniqueIndex('collections_user_name_uq').on(t.userId, t.name)]).enableRLS();

export const bookmarks = pgTable('bookmarks', {
  id: id(),
  userId: bigint('user_id', { mode: 'number' }).notNull().references(() => users.id, { onDelete: 'cascade' }),
  discoveryId: text('discovery_id').notNull().references(() => discoveries.id, { onDelete: 'cascade' }),
  collectionId: bigint('collection_id', { mode: 'number' }).references(() => collections.id, { onDelete: 'set null' }),
  createdAt: ts('created_at').notNull().defaultNow(),
}, (t) => [
  uniqueIndex('bookmarks_user_discovery_uq').on(t.userId, t.discoveryId),
  index('bookmarks_discovery_idx').on(t.discoveryId),
  index('bookmarks_collection_idx').on(t.collectionId),
]).enableRLS();

export const now = sql`now()`;
