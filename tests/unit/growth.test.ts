import { describe, expect, it } from 'vitest';
import { computeGrowth, detectAnomaly, type SnapshotPoint } from '@/lib/scoring/growth';

const now = new Date('2026-03-01T12:00:00Z');
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const hoursAgo = (h: number) => new Date(now.getTime() - h * HOUR);
const daysAgo = (d: number) => new Date(now.getTime() - d * DAY);
const snap = (observedAt: Date, stars: number, forks = 50, openIssues = 10): SnapshotPoint => ({ observedAt, stars, forks, openIssues });

describe('computeGrowth', () => {
  it('reports nothing when there are no snapshots', () => {
    expect(computeGrowth([], daysAgo(10), now)).toEqual({
      observedDelta: null, observedHours: null, starsPerDayObserved: null, starsPerDayLifetime: null, snapshots: 0,
    });
  });

  it('gives a lifetime average but no observed velocity from a single snapshot', () => {
    const growth = computeGrowth([snap(hoursAgo(1), 500)], daysAgo(10), now);
    expect(growth).toEqual({
      observedDelta: null, observedHours: null, starsPerDayObserved: null, starsPerDayLifetime: 50, snapshots: 1,
    });
  });

  it('leaves the lifetime average null when the creation date is unknown', () => {
    expect(computeGrowth([snap(hoursAgo(1), 500)], null, now).starsPerDayLifetime).toBeNull();
  });

  it('measures delta, hours and a per-day rate from two snapshots six hours apart', () => {
    const growth = computeGrowth([snap(hoursAgo(6), 1000), snap(hoursAgo(0), 1150)], daysAgo(20), now);
    expect(growth.observedDelta).toBe(150);
    expect(growth.observedHours).toBe(6);
    expect(growth.starsPerDayObserved).toBe(600);
    expect(growth.snapshots).toBe(2);
  });

  it('does not depend on the order snapshots arrive in', () => {
    const ordered = computeGrowth([snap(hoursAgo(6), 1000), snap(hoursAgo(3), 1100), snap(hoursAgo(0), 1150)], daysAgo(20), now);
    const shuffled = computeGrowth([snap(hoursAgo(0), 1150), snap(hoursAgo(6), 1000), snap(hoursAgo(3), 1100)], daysAgo(20), now);
    expect(shuffled).toEqual(ordered);
    expect(ordered.observedDelta).toBe(150);
  });

  it('reports a delta but no per-day rate when snapshots are under two hours apart', () => {
    const growth = computeGrowth([snap(hoursAgo(1), 1000), snap(hoursAgo(0), 1020)], daysAgo(20), now);
    expect(growth.observedDelta).toBe(20);
    expect(growth.observedHours).toBe(1);
    expect(growth.starsPerDayObserved).toBeNull();
  });

  it('reports nothing observed when snapshots are only minutes apart', () => {
    const growth = computeGrowth([snap(hoursAgo(0.1), 1000), snap(hoursAgo(0), 1005)], daysAgo(20), now);
    expect(growth.observedDelta).toBeNull();
    expect(growth.starsPerDayObserved).toBeNull();
  });

  it('measures over the last seven days only', () => {
    const growth = computeGrowth([snap(daysAgo(10), 100), snap(daysAgo(6), 400), snap(daysAgo(0), 700)], daysAgo(40), now);
    expect(growth.observedDelta).toBe(300);
    expect(growth.observedHours).toBe(144);
    expect(growth.starsPerDayObserved).toBe(50);
    expect(growth.snapshots).toBe(3);
  });

  it('reports a negative delta when stars were lost', () => {
    const growth = computeGrowth([snap(hoursAgo(12), 1000), snap(hoursAgo(0), 990)], daysAgo(200), now);
    expect(growth.observedDelta).toBe(-10);
    expect(growth.starsPerDayObserved).toBe(-20);
  });
});

describe('detectAnomaly', () => {
  it('flags many stars with almost no forks or issues on a young repository', () => {
    const result = detectAnomaly({ stars: 2000, forks: 5, openIssues: 0, createdAt: daysAgo(10), snaps: [], now });
    expect(result.anomaly).toBe(true);
    expect(result.reason).toBe('2000 stars but only 5 forks and no open issues');
  });

  it('flags a large star jump with no fork growth', () => {
    const result = detectAnomaly({
      stars: 1800, forks: 5, openIssues: 3, createdAt: daysAgo(700), now,
      snaps: [snap(hoursAgo(12), 1000, 5, 3), snap(hoursAgo(0), 1800, 5, 3)],
    });
    expect(result.anomaly).toBe(true);
    expect(result.reason).toBe('+800 stars between snapshots with no new forks');
  });

  it('does not flag a healthy repository', () => {
    const result = detectAnomaly({
      stars: 2600, forks: 240, openIssues: 40, createdAt: daysAgo(10), now,
      snaps: [snap(hoursAgo(12), 1900, 170, 31), snap(hoursAgo(0), 2600, 240, 40)],
    });
    expect(result).toEqual({ anomaly: false, reason: null });
  });

  it('does not flag an old, quiet repository with few forks', () => {
    const result = detectAnomaly({ stars: 900, forks: 2, openIssues: 0, createdAt: daysAgo(900), snaps: [snap(hoursAgo(0), 900, 2, 0)], now });
    expect(result.anomaly).toBe(false);
  });

  it('does not flag a small young repository', () => {
    const result = detectAnomaly({ stars: 120, forks: 0, openIssues: 0, createdAt: daysAgo(3), snaps: [], now });
    expect(result.anomaly).toBe(false);
  });
});
