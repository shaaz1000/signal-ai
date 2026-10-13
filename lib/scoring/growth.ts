import type { RepoGrowth } from '@/lib/types';
import { DAY, HOUR } from '@/lib/utils/time';

export interface SnapshotPoint {
  observedAt: Date;
  stars: number;
  forks: number;
  openIssues: number;
}

const WINDOW_DAYS = 7;
/** Below this span a per-day rate is extrapolation, so it is not reported. */
const MIN_RATE_HOURS = 2;

/**
 * Star growth from snapshots we actually recorded. Nothing is back-filled:
 * with a single snapshot the observed fields stay null and only the lifetime
 * average (stars / age) is available, labelled as such.
 */
export function computeGrowth(snaps: SnapshotPoint[], createdAt: Date | null, now: Date): RepoGrowth {
  const sorted = [...snaps].sort((a, b) => a.observedAt.getTime() - b.observedAt.getTime());
  const last = sorted.at(-1);
  const growth: RepoGrowth = {
    observedDelta: null,
    observedHours: null,
    starsPerDayObserved: null,
    starsPerDayLifetime: null,
    snapshots: sorted.length,
  };
  if (!last) return growth;

  const windowStart = last.observedAt.getTime() - WINDOW_DAYS * DAY;
  const first = sorted.find((s) => s.observedAt.getTime() >= windowStart) ?? sorted[0];
  const hours = (last.observedAt.getTime() - first.observedAt.getTime()) / HOUR;
  if (first !== last && hours >= 0.25) {
    growth.observedDelta = last.stars - first.stars;
    growth.observedHours = Math.round(hours * 10) / 10;
    if (hours >= MIN_RATE_HOURS) growth.starsPerDayObserved = Math.round((growth.observedDelta / hours) * 24 * 10) / 10;
  }
  if (createdAt) {
    const ageDays = (now.getTime() - createdAt.getTime()) / DAY;
    if (ageDays >= 0.25) growth.starsPerDayLifetime = Math.round((last.stars / ageDays) * 10) / 10;
  }
  return growth;
}

export interface AnomalyInput {
  stars: number;
  forks: number;
  openIssues: number;
  createdAt: Date | null;
  snaps: SnapshotPoint[];
  now: Date;
}

/**
 * Flags star counts that look purchased or botted: lots of stars with almost
 * no forks, issues or fork growth. A flag discounts momentum and credibility;
 * it is a heuristic and says so in the UI.
 */
export function detectAnomaly(i: AnomalyInput): { anomaly: boolean; reason: string | null } {
  const ageDays = i.createdAt ? (i.now.getTime() - i.createdAt.getTime()) / DAY : null;
  if (i.stars >= 400 && ageDays !== null && ageDays <= 30 && i.forks / i.stars < 0.006 && i.openIssues === 0) {
    return { anomaly: true, reason: `${i.stars} stars but only ${i.forks} forks and no open issues` };
  }
  const sorted = [...i.snaps].sort((a, b) => a.observedAt.getTime() - b.observedAt.getTime());
  const first = sorted[0];
  const last = sorted.at(-1);
  if (first && last && first !== last) {
    const starDelta = last.stars - first.stars;
    const forkDelta = last.forks - first.forks;
    if (starDelta >= 500 && forkDelta <= 0 && last.forks / Math.max(1, last.stars) < 0.01) {
      return { anomaly: true, reason: `+${starDelta} stars between snapshots with no new forks` };
    }
  }
  return { anomaly: false, reason: null };
}
