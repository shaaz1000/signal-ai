import type { FeedQuery, QueryScope, SortId } from '@/lib/feed/query';
import { passesGate } from '@/lib/feed/query';
import type { DiscoveryView } from '@/lib/types';

/** The fixed slices of the catalogue that each product area shows. Shared by pages and the API. */
export interface ScopeConfig extends QueryScope {
  defaults: Partial<FeedQuery>;
  sorts?: SortId[];
}

export const SCOPES = {
  discover: { defaults: {} },
  radar: {
    defaults: { sort: 'momentum' },
    sorts: ['momentum', 'trending', 'latest', 'gems', 'useful', 'innovative'],
    scope: (d: DiscoveryView) => d.kind === 'repository',
  },
  research: {
    defaults: { sort: 'trending' },
    sorts: ['trending', 'latest', 'innovative', 'verified'],
    scope: (d: DiscoveryView) => d.kind === 'paper' || d.kind === 'model' || d.category === 'research',
  },
  gems: {
    defaults: { sort: 'gems' },
    sorts: ['gems', 'latest', 'useful'],
    scope: (d: DiscoveryView) => d.scores.gem > 0,
  },
  unverified: {
    defaults: { sort: 'latest' },
    sorts: ['latest', 'trending'],
    scope: (d: DiscoveryView) => !passesGate(d),
    includeUnverified: true,
  },
  models: {
    defaults: { sort: 'latest' },
    sorts: ['latest', 'trending', 'innovative', 'verified'],
    scope: (d: DiscoveryView) => d.model !== null,
  },
  industries: {
    defaults: { sort: 'trending' },
    sorts: ['trending', 'latest', 'innovative', 'verified'],
    scope: (d: DiscoveryView) => d.industries.length > 0,
  },
  learn: {
    defaults: { sort: 'trending' },
    sorts: ['trending', 'latest', 'innovative'],
    // Something to teach from: a matching concept or a documented mechanism.
    scope: (d: DiscoveryView) => Boolean(d.conceptId || d.editorial.how),
  },
  content: {
    defaults: { sort: 'content' },
    sorts: ['content', 'latest', 'trending'],
    scope: (d: DiscoveryView) => d.status === 'verified',
  },
} satisfies Record<string, ScopeConfig>;

export type ScopeId = keyof typeof SCOPES;
