import type { Editorial } from '@/lib/types';
import type { Logger } from '@/lib/utils/log';
import { anthropicProvider } from './anthropic';
import { extractiveEditorial, type ExtractiveInput } from './extractive';
import { guardDraft } from './guard';
import { openaiProvider } from './openai';
import type { AiProvider, EvidencePack } from './types';

const extractiveOnly: AiProvider = { name: 'extractive', model: null, summarize: async () => null };

/** Picks the summariser from the environment. Missing keys degrade to extractive, never to an error. */
export function resolveProvider(env: Record<string, string | undefined>, log: Logger): AiProvider {
  const choice = (env.AI_PROVIDER ?? 'extractive').toLowerCase();
  if (choice === 'anthropic') {
    if (env.ANTHROPIC_API_KEY) return anthropicProvider({ apiKey: env.ANTHROPIC_API_KEY, model: env.ANTHROPIC_MODEL, log });
    log.warn('AI_PROVIDER=anthropic but ANTHROPIC_API_KEY is not set; using extractive summaries');
  } else if (choice === 'openai') {
    if (env.OPENAI_API_KEY && env.OPENAI_MODEL) return openaiProvider({ apiKey: env.OPENAI_API_KEY, model: env.OPENAI_MODEL, baseUrl: env.OPENAI_BASE_URL, log });
    log.warn('AI_PROVIDER=openai needs OPENAI_API_KEY and OPENAI_MODEL; using extractive summaries');
  }
  return extractiveOnly;
}

export interface SummaryResult {
  headline: string;
  summary: string;
  editorial: Editorial;
  aiSignificance: number | null;
  guardViolations: number;
}

/**
 * Stage 6. The extractive summary is always built first. A model draft, when
 * available, is checked field by field against the evidence; any field that
 * fails the guard keeps its extractive value.
 */
export async function summarize(provider: AiProvider, pack: EvidencePack, base: ExtractiveInput, log: Logger): Promise<SummaryResult> {
  const fallback = extractiveEditorial(base);
  const result: SummaryResult = { ...fallback, aiSignificance: null, guardViolations: 0 };
  if (provider.name === 'extractive') return result;

  const draft = await provider.summarize(pack);
  if (!draft) return result;
  const { draft: safe, violations } = guardDraft(draft, pack);
  if (violations.length) log.warn('summary guard rejected fields', { id: pack.id, violations });
  // If most of the draft failed the guard, none of it is trustworthy.
  if (violations.length > 3 || !safe.what) return { ...result, guardViolations: violations.length };

  return {
    headline: safe.headline || fallback.headline,
    summary: safe.summary || fallback.summary,
    editorial: {
      what: safe.what,
      why: safe.why || fallback.editorial.why,
      how: safe.how,
      whoCares: safe.whoCares || fallback.editorial.whoCares,
      applications: safe.applications,
      // Evidence-derived limitations are always kept; the model may add to them.
      limitations: [...new Set([...fallback.editorial.limitations, ...safe.limitations])].slice(0, 7),
      method: 'llm',
      model: provider.model,
    },
    aiSignificance: safe.significance,
    guardViolations: violations.length,
  };
}
