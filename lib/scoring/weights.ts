export interface Weights {
  novelty: number;
  momentum: number;
  significance: number;
  credibility: number;
  usefulness: number;
  freshness: number;
}

/** Starting heuristics from the product brief. Not statistically validated. */
export const DEFAULT_WEIGHTS: Weights = {
  novelty: 0.25,
  momentum: 0.2,
  significance: 0.2,
  credibility: 0.2,
  usefulness: 0.1,
  freshness: 0.05,
};

export const WEIGHTS_VERSION = 'v1';

/** Credibility is a ranking input and also an independent gate. */
export const QUALITY_GATE = 40;
export const FEATURE_GATE = 55;
export const VERIFIED_GATE = 75;

/**
 * Optional override: RANKING_WEIGHTS='{"novelty":0.3,"momentum":0.3}'.
 * Supplied values replace the defaults and the result is renormalised to 1.
 */
export function resolveWeights(raw: string | undefined): { weights: Weights; version: string } {
  if (!raw) return { weights: DEFAULT_WEIGHTS, version: WEIGHTS_VERSION };
  try {
    const parsed = JSON.parse(raw) as Partial<Weights>;
    const merged = { ...DEFAULT_WEIGHTS };
    for (const key of Object.keys(DEFAULT_WEIGHTS) as (keyof Weights)[]) {
      const v = parsed[key];
      if (typeof v === 'number' && Number.isFinite(v) && v >= 0) merged[key] = v;
    }
    const sum = Object.values(merged).reduce((a, b) => a + b, 0);
    if (sum <= 0) return { weights: DEFAULT_WEIGHTS, version: WEIGHTS_VERSION };
    for (const key of Object.keys(merged) as (keyof Weights)[]) merged[key] = merged[key] / sum;
    return { weights: merged, version: `custom:${Object.values(merged).map((v) => v.toFixed(2)).join('/')}` };
  } catch {
    return { weights: DEFAULT_WEIGHTS, version: WEIGHTS_VERSION };
  }
}
