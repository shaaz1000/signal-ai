import { INJECTION_PATTERN, plainText, PROMO_PATTERN } from '@/lib/utils/text';
import type { EditorialDraft, EvidencePack } from './types';

export interface GuardResult {
  draft: EditorialDraft;
  /** Field name and why it was rejected. Rejected fields are blanked for the caller to backfill. */
  violations: { field: string; reason: string }[];
}

const NUMBER = /\d[\d,]*(?:\.\d+)?%?[kKmMbB]?/g;
const URL = /https?:\/\/[^\s)"'>]+/g;

function normaliseNumber(raw: string): string {
  return raw.replace(/,/g, '').replace(/%$/, '').toLowerCase();
}

/**
 * Checks model output against the evidence it was given. A figure or URL
 * that does not appear in the evidence cannot have come from it, so the field
 * containing it is discarded. This is the last line of defence against
 * invented star counts, benchmark numbers and links.
 */
export function guardDraft(draft: EditorialDraft, pack: EvidencePack): GuardResult {
  const corpus = [pack.title, pack.canonicalUrl, ...pack.facts, ...pack.sources.map((s) => s.text)].join('\n');
  const knownNumbers = new Set((corpus.match(NUMBER) ?? []).map(normaliseNumber));
  const corpusLower = corpus.toLowerCase();
  const violations: GuardResult['violations'] = [];

  const check = (field: string, value: string): string => {
    const text = plainText(value, 900);
    for (const raw of text.match(NUMBER) ?? []) {
      const n = normaliseNumber(raw);
      // Single digits and counts of things ("two sources") are prose, not metrics.
      if (n.length < 2) continue;
      if (!knownNumbers.has(n)) {
        violations.push({ field, reason: `number "${raw}" is not in the evidence` });
        return '';
      }
    }
    for (const url of text.match(URL) ?? []) {
      if (!corpusLower.includes(url.toLowerCase().replace(/[.,]$/, ''))) {
        violations.push({ field, reason: `URL "${url}" is not in the evidence` });
        return '';
      }
    }
    if (INJECTION_PATTERN.test(text)) {
      violations.push({ field, reason: 'echoes instruction-like text' });
      return '';
    }
    if (PROMO_PATTERN.test(text) && !/\b(says|claims?|describes?|reports?|according|states?|calls?)\b/i.test(text)) {
      violations.push({ field, reason: 'unattributed promotional wording' });
      return '';
    }
    return text;
  };

  const out: EditorialDraft = {
    headline: check('headline', draft.headline).slice(0, 120),
    summary: check('summary', draft.summary),
    what: check('what', draft.what),
    why: check('why', draft.why),
    how: draft.how ? check('how', draft.how) || null : null,
    whoCares: check('whoCares', draft.whoCares),
    applications: draft.applications ? check('applications', draft.applications) || null : null,
    limitations: draft.limitations.map((l, idx) => check(`limitations[${idx}]`, l)).filter(Boolean).slice(0, 6),
    significance: Number.isFinite(draft.significance) ? Math.max(0, Math.min(100, Math.round(draft.significance))) : 50,
  };
  return { draft: out, violations };
}
