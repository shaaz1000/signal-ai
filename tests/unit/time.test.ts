import { describe, expect, it } from 'vitest';
import { nextDiscoveryRun, parseDate, relativeTime } from '@/lib/utils/time';

describe('parseDate', () => {
  const now = new Date('2026-03-01T12:00:00Z');

  it('accepts unix seconds', () => {
    expect(parseDate(1_700_000_000, now)?.toISOString()).toBe('2023-11-14T22:13:20.000Z');
  });

  it('accepts unix milliseconds', () => {
    expect(parseDate(1_700_000_000_000, now)?.toISOString()).toBe('2023-11-14T22:13:20.000Z');
  });

  it('accepts ISO strings and RFC 822 feed dates', () => {
    expect(parseDate('2026-02-27T08:30:00Z', now)?.toISOString()).toBe('2026-02-27T08:30:00.000Z');
    expect(parseDate('Fri, 27 Feb 2026 08:30:00 GMT', now)?.toISOString()).toBe('2026-02-27T08:30:00.000Z');
  });

  it('allows small clock skew into the future', () => {
    expect(parseDate('2026-03-02T12:00:00Z', now)).not.toBeNull();
  });

  it('rejects dates before 1995', () => {
    expect(parseDate('1990-06-01T00:00:00Z', now)).toBeNull();
    expect(parseDate(0, now)).toBeNull();
  });

  it('rejects far-future dates', () => {
    expect(parseDate('2026-03-10T12:00:00Z', now)).toBeNull();
    expect(parseDate('2099-01-01T00:00:00Z', now)).toBeNull();
  });

  it.each([['not a date'], [''], [null], [undefined], [Number.NaN], [{}]])('rejects garbage: %j', (value) => {
    expect(parseDate(value, now)).toBeNull();
  });
});

describe('relativeTime', () => {
  const now = '2026-03-01T12:00:00Z';
  const ago = (ms: number) => new Date(new Date(now).getTime() - ms).toISOString();
  const MIN = 60_000;
  const HOUR = 60 * MIN;
  const DAY = 24 * HOUR;

  it.each([
    [10_000, 'just now'],
    [5 * MIN, '5 min ago'],
    [59 * MIN, '59 min ago'],
    [3 * HOUR, '3 h ago'],
    [23 * HOUR, '23 h ago'],
    [2 * DAY, '2 d ago'],
    [13 * DAY, '13 d ago'],
    [21 * DAY, '3 wk ago'],
    [90 * DAY, '3 mo ago'],
    [3 * 365 * DAY, '3 yr ago'],
  ])('%d ms ago reads "%s"', (ms, expected) => {
    expect(relativeTime(ago(ms), now)).toBe(expected);
  });

  it('says so when the date is unknown', () => {
    expect(relativeTime(null, now)).toBe('date unknown');
  });

  it('treats a date slightly in the future as just now', () => {
    expect(relativeTime('2026-03-01T12:05:00Z', now)).toBe('just now');
  });
});

describe('nextDiscoveryRun', () => {
  it.each([
    ['at midnight', '2026-03-01T00:00:00Z', '2026-03-01T00:17:00.000Z'],
    ['one second before a slot', '2026-03-01T03:16:59Z', '2026-03-01T03:17:00.000Z'],
    ['exactly on a slot', '2026-03-01T03:17:00Z', '2026-03-01T06:17:00.000Z'],
    ['one second after a slot', '2026-03-01T03:17:01Z', '2026-03-01T06:17:00.000Z'],
    ['in an off hour', '2026-03-01T04:40:00Z', '2026-03-01T06:17:00.000Z'],
    ['late in the hour before a slot', '2026-03-01T08:59:59Z', '2026-03-01T09:17:00.000Z'],
    ['before the last slot of the day', '2026-03-01T21:00:00Z', '2026-03-01T21:17:00.000Z'],
    ['after the last slot of the day', '2026-03-01T21:17:30Z', '2026-03-02T00:17:00.000Z'],
    ['just before midnight', '2026-03-01T23:59:59Z', '2026-03-02T00:17:00.000Z'],
    ['across a month boundary', '2026-01-31T22:30:00Z', '2026-02-01T00:17:00.000Z'],
    ['across a year boundary', '2025-12-31T23:00:00Z', '2026-01-01T00:17:00.000Z'],
  ])('%s', (_label, now, expected) => {
    expect(nextDiscoveryRun(new Date(now)).toISOString()).toBe(expected);
  });

  it('always lands on hh:17 with hh divisible by 3, strictly after now', () => {
    const start = Date.parse('2026-03-01T00:00:00Z');
    // Every 7 minutes across two days.
    for (let t = start; t < start + 48 * 3_600_000; t += 7 * 60_000) {
      const now = new Date(t);
      const next = nextDiscoveryRun(now);
      expect(next.getUTCHours() % 3).toBe(0);
      expect(next.getUTCMinutes()).toBe(17);
      expect(next.getUTCSeconds()).toBe(0);
      expect(next.getTime()).toBeGreaterThan(t);
      expect(next.getTime() - t).toBeLessThanOrEqual(3 * 3_600_000);
    }
  });
});
