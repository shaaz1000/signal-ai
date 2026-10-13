/**
 * Plans and limits for paid work (model generation and translation).
 *
 * "Units" are characters sent to a provider plus characters received. They
 * are the one currency every budget is counted in, so a budget does not need
 * to know each provider's price list. `GENERATION_UNIT_COST` maps one unit to
 * money (in whatever currency the operator accounts in) for the `cost` column
 * of `usage_counters`; it is reporting only and never changes a decision.
 *
 * Every value can be overridden from the environment. An override that is
 * not a whole number in range is a configuration error, and a configuration
 * error denies paid work: a typo must not silently become a looser limit.
 */
import { DAY, HOUR } from '@/lib/utils/time';

export type Env = Record<string, string | undefined>;

export const PAID_KINDS = ['translation', 'explanation', 'story', 'draft'] as const;
export type PaidKind = (typeof PAID_KINDS)[number];

export const PLANS = ['free', 'pro'] as const;
export type Plan = (typeof PLANS)[number];

export const MINUTE = 60_000;

export interface KindLimit {
  /** Uncached requests allowed per window. */
  limit: number;
  windowMs: number;
}

export interface Limits {
  plan: Plan;
  perKind: Record<PaidKind, KindLimit>;
  /** Jobs one user may have running at once. */
  concurrentJobs: number;
  /** Units one user may spend per UTC day. */
  userDailyUnits: number;
  /** Units the whole deployment may spend per UTC day. */
  globalDailyUnits: number;
  /** Units any single provider may be sent per UTC day. */
  providerDailyUnits: number;
  /** Largest source text accepted per kind, checked before any other work. */
  maxInputChars: Record<PaidKind, number>;
  /** Hard ceiling on one provider operation. */
  requestTimeoutMs: number;
  /** Money per unit, for reporting. */
  unitCost: number;
  /** Per-address hourly volume above which an abuse signal is recorded. Never blocks on its own. */
  ipHourlyRequests: number;
  abuse: {
    denials: number;
    denialWindowMs: number;
    distinctUncached: number;
    distinctWindowMs: number;
    cooldownMs: number;
  };
  breaker: { threshold: number; openMs: number };
}

export class ConfigError extends Error {
  constructor(readonly variables: string[]) {
    // Names only: values may be secrets pasted into the wrong variable.
    super(`Invalid limit configuration: ${variables.join(', ')} must be whole numbers in range.`);
    this.name = 'ConfigError';
  }
}

interface Spec {
  env: string;
  fallback: number;
  min: number;
  max: number;
}

const int = (env: string, fallback: number, min = 0, max = 1_000_000_000): Spec => ({ env, fallback, min, max });

/** Per-plan values. The environment variable is `LIMIT_<PLAN>_<NAME>`, e.g. `LIMIT_PRO_STORY_PER_DAY`. */
const PLAN_DEFAULTS: Record<Plan, Record<string, number>> = {
  free: { TRANSLATION_PER_HOUR: 10, EXPLANATION_PER_HOUR: 5, STORY_PER_DAY: 3, DRAFT_PER_DAY: 10, CONCURRENT_JOBS: 2, DAILY_UNITS: 60_000 },
  pro: { TRANSLATION_PER_HOUR: 100, EXPLANATION_PER_HOUR: 40, STORY_PER_DAY: 20, DRAFT_PER_DAY: 60, CONCURRENT_JOBS: 4, DAILY_UNITS: 600_000 },
};

const GLOBAL_SPECS = {
  globalDailyUnits: int('GENERATION_GLOBAL_DAILY_UNITS', 2_000_000),
  providerDailyUnits: int('GENERATION_PROVIDER_DAILY_UNITS', 2_000_000),
  requestTimeoutMs: int('GENERATION_TIMEOUT_MS', 45_000, 1_000, 300_000),
  maxTranslation: int('GENERATION_MAX_INPUT_TRANSLATION', 8_000, 1, 200_000),
  maxExplanation: int('GENERATION_MAX_INPUT_EXPLANATION', 12_000, 1, 200_000),
  maxStory: int('GENERATION_MAX_INPUT_STORY', 12_000, 1, 200_000),
  maxDraft: int('GENERATION_MAX_INPUT_DRAFT', 12_000, 1, 200_000),
  ipHourlyRequests: int('GENERATION_IP_HOURLY_REQUESTS', 120, 1),
  abuseDenials: int('ABUSE_DENIALS', 20, 1),
  abuseDistinct: int('ABUSE_DISTINCT_UNCACHED', 8, 1),
  abuseCooldownMinutes: int('ABUSE_COOLDOWN_MINUTES', 15, 1, 24 * 60),
} satisfies Record<string, Spec>;

interface Parsed {
  plans: Record<Plan, Record<string, number>>;
  global: Record<keyof typeof GLOBAL_SPECS, number>;
  unitCost: number;
}

function planSpecs(): { plan: Plan; name: string; spec: Spec }[] {
  return PLANS.flatMap((plan) =>
    Object.entries(PLAN_DEFAULTS[plan]).map(([name, fallback]) => ({ plan, name, spec: int(`LIMIT_${plan.toUpperCase()}_${name}`, fallback) })),
  );
}

const ALL_VARIABLES = [...planSpecs().map((p) => p.spec.env), ...Object.values(GLOBAL_SPECS).map((s) => s.env), 'GENERATION_UNIT_COST'];

function parse(env: Env): Parsed {
  const bad: string[] = [];
  const read = (spec: Spec): number => {
    const raw = env[spec.env]?.trim();
    if (!raw) return spec.fallback;
    const n = Number(raw);
    if (!/^\d+$/.test(raw) || !Number.isSafeInteger(n) || n < spec.min || n > spec.max) {
      bad.push(spec.env);
      return spec.fallback;
    }
    return n;
  };

  const plans = { free: {}, pro: {} } as Parsed['plans'];
  for (const { plan, name, spec } of planSpecs()) plans[plan][name] = read(spec);
  const global = Object.fromEntries(Object.entries(GLOBAL_SPECS).map(([k, spec]) => [k, read(spec)])) as Parsed['global'];

  let unitCost = 0;
  const rawCost = env.GENERATION_UNIT_COST?.trim();
  if (rawCost) {
    unitCost = Number(rawCost);
    if (!/^\d+(\.\d+)?$/.test(rawCost) || !Number.isFinite(unitCost) || unitCost > 1) bad.push('GENERATION_UNIT_COST');
  }
  if (bad.length) throw new ConfigError(bad);
  return { plans, global, unitCost };
}

// Parsed once per distinct set of values. The signature check keeps the cache
// honest if the environment is changed in place (tests, a reloaded .env).
let cached: { signature: string; parsed: Parsed } | null = null;

function load(env: Env): Parsed {
  const signature = ALL_VARIABLES.map((k) => env[k] ?? '').join('\u0001');
  if (cached?.signature !== signature) cached = { signature, parsed: parse(env) };
  return cached.parsed;
}

export function isPlan(value: unknown): value is Plan {
  return (PLANS as readonly string[]).includes(value as string);
}

/**
 * Limits for a plan. An unknown plan gets the free limits (least privilege).
 * Throws `ConfigError` when an override is invalid; callers deny paid work.
 */
export function limitsFor(plan: string | null | undefined, env: Env): Limits {
  const parsed = load(env);
  const tier: Plan = isPlan(plan) ? plan : 'free';
  const p = parsed.plans[tier];
  const g = parsed.global;
  return {
    plan: tier,
    perKind: {
      translation: { limit: p.TRANSLATION_PER_HOUR, windowMs: HOUR },
      explanation: { limit: p.EXPLANATION_PER_HOUR, windowMs: HOUR },
      story: { limit: p.STORY_PER_DAY, windowMs: DAY },
      draft: { limit: p.DRAFT_PER_DAY, windowMs: DAY },
    },
    concurrentJobs: p.CONCURRENT_JOBS,
    userDailyUnits: p.DAILY_UNITS,
    globalDailyUnits: g.globalDailyUnits,
    providerDailyUnits: g.providerDailyUnits,
    maxInputChars: { translation: g.maxTranslation, explanation: g.maxExplanation, story: g.maxStory, draft: g.maxDraft },
    requestTimeoutMs: g.requestTimeoutMs,
    unitCost: parsed.unitCost,
    ipHourlyRequests: g.ipHourlyRequests,
    abuse: {
      denials: g.abuseDenials,
      denialWindowMs: 10 * MINUTE,
      distinctUncached: g.abuseDistinct,
      distinctWindowMs: 2 * MINUTE,
      cooldownMs: g.abuseCooldownMinutes * MINUTE,
    },
    breaker: { threshold: 5, openMs: MINUTE },
  };
}

/** True when the operator has switched paid work off from the environment. */
export function disabledByEnv(env: Env): boolean {
  return /^(true|1|yes|on)$/i.test(env.GENERATION_DISABLED?.trim() ?? '');
}

/**
 * Name of the configured generation provider, or null. Mirrors
 * `resolveProvider` in lib/ai/provider.ts: a provider without its key (or,
 * for OpenAI, its model) is not configured.
 */
export function generationProvider(env: Env): string | null {
  const choice = (env.AI_PROVIDER ?? '').trim().toLowerCase();
  if (choice === 'anthropic' && env.ANTHROPIC_API_KEY) return 'anthropic';
  if (choice === 'openai' && env.OPENAI_API_KEY && env.OPENAI_MODEL) return 'openai';
  return null;
}
