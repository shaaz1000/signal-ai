/** Structured JSON logs, one object per line, so workflow logs are greppable. */

type Level = 'debug' | 'info' | 'warn' | 'error';

const SECRET_KEYS = /(token|secret|password|authorization|api[_-]?key|database_url)/i;

function redact(value: unknown, depth = 0): unknown {
  if (depth > 4 || value === null || typeof value !== 'object') {
    if (typeof value === 'string') return value.replace(/(gh[opsu]_|sk-|Bearer\s+)[A-Za-z0-9_\-.]{8,}/g, '$1[redacted]');
    return value;
  }
  if (Array.isArray(value)) return value.slice(0, 50).map((v) => redact(v, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    out[k] = SECRET_KEYS.test(k) ? '[redacted]' : redact(v, depth + 1);
  }
  return out;
}

export interface Logger {
  debug(msg: string, data?: Record<string, unknown>): void;
  info(msg: string, data?: Record<string, unknown>): void;
  warn(msg: string, data?: Record<string, unknown>): void;
  error(msg: string, data?: Record<string, unknown>): void;
  child(scope: Record<string, unknown>): Logger;
}

export function createLogger(scope: Record<string, unknown> = {}, sink?: (line: string) => void): Logger {
  const write = (level: Level, msg: string, data?: Record<string, unknown>) => {
    if (level === 'debug' && !process.env.DEBUG) return;
    if (process.env.LOG_SILENT && !sink) return;
    const line = JSON.stringify({ ts: new Date().toISOString(), level, msg, ...(redact({ ...scope, ...data }) as object) });
    if (sink) sink(line);
    else if (level === 'error' || level === 'warn') console.error(line);
    else console.log(line);
  };
  return {
    debug: (m, d) => write('debug', m, d),
    info: (m, d) => write('info', m, d),
    warn: (m, d) => write('warn', m, d),
    error: (m, d) => write('error', m, d),
    child: (s) => createLogger({ ...scope, ...s }, sink),
  };
}

export const log = createLogger();
