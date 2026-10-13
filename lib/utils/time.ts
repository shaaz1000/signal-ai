export const HOUR = 3_600_000;
export const DAY = 24 * HOUR;

export function hoursBetween(a: Date | string, b: Date | string): number {
  return (new Date(b).getTime() - new Date(a).getTime()) / HOUR;
}

export function daysBetween(a: Date | string, b: Date | string): number {
  return (new Date(b).getTime() - new Date(a).getTime()) / DAY;
}

export function isoDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Parses a date and rejects values that cannot be real publication dates. */
export function parseDate(value: unknown, now = new Date()): Date | null {
  if (value === null || value === undefined || value === '') return null;
  const d = typeof value === 'number' ? new Date(value < 1e12 ? value * 1000 : value) : new Date(String(value));
  if (Number.isNaN(d.getTime())) return null;
  if (d.getUTCFullYear() < 1995) return null;
  if (d.getTime() > now.getTime() + 2 * DAY) return null;
  return d;
}

/** Relative time against an explicit `now`, so server and client render the same string. */
export function relativeTime(iso: string | null, now: string | Date): string {
  if (!iso) return 'date unknown';
  const mins = Math.round((new Date(now).getTime() - new Date(iso).getTime()) / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  if (days < 14) return `${days} d ago`;
  if (days < 60) return `${Math.round(days / 7)} wk ago`;
  if (days < 730) return `${Math.round(days / 30)} mo ago`;
  return `${Math.round(days / 365)} yr ago`;
}

export function shortDate(iso: string | null): string {
  if (!iso) return 'Unknown';
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
}

export function dateTime(iso: string | null): string {
  if (!iso) return 'Never';
  return `${new Date(iso).toLocaleString('en-GB', {
    day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'UTC', hour12: false,
  })} UTC`;
}

/** Next firing of the discovery workflow cron (`17 *\/3 * * *`, UTC). */
export function nextDiscoveryRun(now: Date): Date {
  const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), now.getUTCHours(), 17, 0));
  while (next.getUTCHours() % 3 !== 0 || next.getTime() <= now.getTime()) {
    next.setUTCHours(next.getUTCHours() + 1);
  }
  return next;
}

export function mondayOf(d: Date): Date {
  const out = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  out.setUTCDate(out.getUTCDate() - ((out.getUTCDay() + 6) % 7));
  return out;
}
