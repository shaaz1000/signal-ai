import type { DiscoveryView } from '@/lib/types';

/** A verified repository record with sensible defaults; tests override what they care about. */
export function makeView(overrides: Partial<DiscoveryView> = {}): DiscoveryView {
  return {
    id: 'abcdef012345', kind: 'repository', title: 'acme/agent-kit', headline: 'acme/agent-kit: A small agent runtime', summary: 'A small agent runtime that calls tools.',
    category: 'agents', tags: ['agents', 'mcp'], claimType: 'project_release', executionMode: null, canonicalUrl: 'https://github.com/acme/agent-kit',
    author: 'acme', authorVerified: true, publishedAt: '2026-10-10T00:00:00.000Z', firstDiscoveredAt: '2026-10-12T00:00:00.000Z', lastVerifiedAt: '2026-10-13T00:00:00.000Z',
    lastActivityAt: '2026-10-13T00:00:00.000Z', status: 'verified', confidence: 72, confidenceLevel: 'medium',
    scores: { total: 70, novelty: 80, momentum: 60, significance: 70, credibility: 72, usefulness: 70, freshness: 90, gem: 0 },
    reasons: ['+120 stars across 6 h of our own snapshots', 'Hacker News: 210 points, 54 comments'],
    credibilityFactors: [{ label: 'Baseline', points: 10, detail: 'Every item starts here.' }],
    evidence: [
      { check: 'url_exists', outcome: 'pass', detail: 'Confirmed reachable (GitHub API)', url: null },
      { check: 'corroboration', outcome: 'warn', detail: 'One independent reference so far: Hacker News.', url: null },
    ],
    sources: [
      { sourceId: 'github', sourceName: 'GitHub', group: 'github', url: 'https://github.com/acme/agent-kit', title: 'acme/agent-kit', publishedAt: null, primary: true, points: 900, comments: null },
      { sourceId: 'hackernews', sourceName: 'Hacker News', group: 'community', url: 'https://news.ycombinator.com/item?id=1', title: 'Agent kit', publishedAt: null, primary: false, points: 210, comments: 54 },
    ],
    editorial: {
      what: 'A small agent runtime that calls tools.', why: 'The GitHub API reports 900 stars.',
      how: 'According to the documentation: "Each step serialises the tool list, asks the model for one action and executes it."',
      whoCares: 'Developers building agents.', limitations: ['One independent reference so far: Hacker News.'], applications: null, method: 'extractive', model: null,
    },
    repo: {
      owner: 'acme', name: 'agent-kit', language: 'TypeScript', license: 'MIT', stars: 900, forks: 40, openIssues: 5, contributors: 3, createdAt: '2026-10-10T00:00:00.000Z',
      pushedAt: '2026-10-13T00:00:00.000Z', topics: ['agents'], latestRelease: { tag: 'v0.2.0', publishedAt: '2026-10-12T00:00:00.000Z' },
      growth: { observedDelta: 120, observedHours: 6, starsPerDayObserved: 480, starsPerDayLifetime: 300, snapshots: 2 }, anomaly: false,
    },
    industries: [], evidenceStage: null, conceptId: 'agent-loop', model: null, flags: [], fixture: false,
    ...overrides,
  };
}
