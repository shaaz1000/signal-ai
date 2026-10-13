import { z } from 'zod';
import { CLAIM_TYPES, KINDS, type SourceGroup } from '@/lib/types';
import type { HttpOptions } from '@/lib/utils/http';
import type { Logger } from '@/lib/utils/log';

export const RepoFactsSchema = z.object({
  owner: z.string().min(1),
  name: z.string().min(1),
  description: z.string().nullable().default(null),
  stars: z.number().int().nonnegative(),
  forks: z.number().int().nonnegative(),
  openIssues: z.number().int().nonnegative(),
  watchers: z.number().int().nonnegative().nullable().default(null),
  language: z.string().nullable().default(null),
  license: z.string().nullable().default(null),
  topics: z.array(z.string()).default([]),
  createdAt: z.date().nullable(),
  pushedAt: z.date().nullable(),
  homepage: z.string().nullable().default(null),
  isFork: z.boolean().default(false),
  archived: z.boolean().default(false),
});
export type RepoFacts = z.infer<typeof RepoFactsSchema>;

/** What every source adapter emits. Text fields are untrusted third-party content. */
export const CandidateSchema = z.object({
  sourceId: z.string().min(1),
  externalId: z.string().min(1).max(300),
  /** The thing being discovered. */
  url: z.string().url().max(2000),
  /** Where the source itself discusses it (a thread, a listing), if different. */
  sourceUrl: z.string().url().max(2000).optional(),
  title: z.string().min(1).max(400),
  description: z.string().max(6000).default(''),
  author: z.string().max(200).nullable().default(null),
  publishedAt: z.date().nullable().default(null),
  kindHint: z.enum(KINDS).optional(),
  claimType: z.enum(CLAIM_TYPES).optional(),
  tags: z.array(z.string()).max(40).default([]),
  points: z.number().int().nonnegative().nullable().default(null),
  comments: z.number().int().nonnegative().nullable().default(null),
  repo: RepoFactsSchema.optional(),
  /** True when the source is the origin of the item (a repo host, a paper server, a publisher's own post). */
  primary: z.boolean().default(false),
  /** Skip the topical relevance filter: the adapter already searched by topic. */
  preFiltered: z.boolean().default(false),
  hf: z.object({ likes: z.number().optional(), downloads: z.number().optional(), pipeline: z.string().optional() }).optional(),
  codeUrl: z.string().url().optional(),
});
export type Candidate = z.infer<typeof CandidateSchema>;
export type CandidateInput = z.input<typeof CandidateSchema>;

export interface SourceMeta {
  id: string;
  name: string;
  group: SourceGroup;
  /** 0..1 heuristic prior. Documented in docs/scoring.md. */
  reliability: number;
  /** Independence key: two sources with the same owner count once as corroboration. */
  owner: string;
  homepage: string;
}

export interface SourceContext {
  now: Date;
  http: HttpOptions;
  log: Logger;
  env: Record<string, string | undefined>;
}

export class SourceSkipped extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = 'SourceSkipped';
  }
}

export interface SourceAdapter {
  meta: SourceMeta;
  /** Returns raw candidates. May throw; the runner isolates failures per source. */
  fetch(ctx: SourceContext): Promise<CandidateInput[]>;
}
