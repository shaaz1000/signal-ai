/**
 * Translation of a record's fields, and the store for finished translations.
 *
 * Each field goes: protect -> provider -> validate -> restore. One rejected
 * field rejects the whole translation, so a half-translated or tampered
 * record is never stored or shown.
 *
 * A stored translation is addressed by subject, content version, language,
 * provider and model. The content version is a hash of the source text, so
 * editing the source makes every earlier translation a miss. That is the
 * whole of cache invalidation; old rows are kept, never returned.
 */
import { createHash } from 'node:crypto';
import type { Db } from '@/lib/db/client';
import type { DiscoveryView } from '@/lib/types';
import { getCachedContent, saveContent, type StoredContent } from '@/lib/security/content';
import { isSupportedLanguage } from './languages';
import { protect, restore, translatableText, validateTranslation } from './protect';
import type { ConfiguredTranslationProvider, TranslationProvider } from './provider';

export const TRANSLATION_KIND = 'translation';

export type TranslatedFields = Record<string, string>;

/** A provider response that failed validation. The reason is for logs; the response itself is discarded. */
export class TranslationRejectedError extends Error {
  constructor(readonly field: string, readonly reason: string) {
    super(`translation rejected for "${field}": ${reason}`);
    this.name = 'TranslationRejectedError';
  }
}

/** Version of a source text: the first 16 hex characters of its SHA-256. */
export function contentVersionOf(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex').slice(0, 16);
}

/** The parts of a discovery that are translated, keyed the way the interface reads them back. */
export function translatableFields(view: DiscoveryView): Record<string, string> {
  const fields: Record<string, string> = {
    headline: view.headline,
    summary: view.summary,
    'editorial.what': view.editorial.what,
    'editorial.why': view.editorial.why,
    'editorial.how': view.editorial.how ?? '',
    'editorial.whoCares': view.editorial.whoCares,
  };
  view.editorial.limitations.forEach((text, index) => {
    fields[`limitation.${index}`] = text;
  });
  return Object.fromEntries(Object.entries(fields).filter(([, text]) => typeof text === 'string' && text.trim()));
}

/**
 * Names that must not be translated for this discovery: a one-word title (a
 * project name, not a sentence), the author, and a repository's owner and name.
 */
export function protectedTermsOf(view: DiscoveryView): string[] {
  const terms = [/\s/.test(view.title) ? '' : view.title, view.repo ? `${view.repo.owner}/${view.repo.name}` : '', view.repo?.name ?? '', view.author ?? ''];
  return terms.filter((t) => t.trim().length > 2 && t.length <= 60);
}

export interface TranslateFieldsInput {
  subject: string;
  contentVersion: string;
  fields: Record<string, string>;
  sourceLanguage: 'en';
  targetLanguage: string;
  provider: TranslationProvider;
  /** Source term to required output form. */
  glossary?: Record<string, string>;
  /** Extra terms to keep verbatim, such as the project's name. */
  terms?: readonly string[];
  /** Checked between fields, so a timed-out request stops calling the provider. */
  signal?: AbortSignal;
}

export interface TranslateFieldsResult {
  fields: TranslatedFields;
  provider: string;
  model: string;
  /** Characters sent to the provider plus characters received. */
  units: number;
}

/**
 * Translates every non-empty field. Throws `TranslationRejectedError` if any
 * response fails validation, and whatever the provider throws if a call
 * fails. Does not read or write the store: callers run this inside
 * `runProtected`, which caches, meters and saves. The database handle is part
 * of the signature for that caller's convenience and is not used here.
 */
export async function translateFields(_db: Db, input: TranslateFieldsInput): Promise<TranslateFieldsResult> {
  if (!isSupportedLanguage(input.targetLanguage)) throw new Error(`Unsupported language "${input.targetLanguage}".`);
  const fields: TranslatedFields = {};
  let provider = '';
  let model = '';
  let units = 0;

  for (const [name, original] of Object.entries(input.fields)) {
    if (!original?.trim()) continue;
    if (input.signal?.aborted) throw new Error('translation aborted');
    const held = protect(original, { glossary: input.glossary, terms: input.terms });
    // Nothing but protected content (a bare URL, a figure): there is nothing to translate, and no reason to pay.
    if (!/\p{L}/u.test(translatableText(held))) {
      fields[name] = restore(held.text, held);
      continue;
    }
    const response = await input.provider.translate({ text: held.text, sourceLanguage: input.sourceLanguage, targetLanguage: input.targetLanguage });
    units += held.text.length + (typeof response.text === 'string' ? response.text.length : 0);
    // One request, one provider, one model. A change part-way through is refused rather than stored under the wrong name.
    if (provider && (response.provider !== provider || response.model !== model)) throw new TranslationRejectedError(name, 'provider or model changed between fields');
    provider = response.provider;
    model = response.model;
    const verdict = validateTranslation(original, held, response.text);
    if (!verdict.ok) throw new TranslationRejectedError(name, verdict.reason);
    fields[name] = restore(response.text, held).trim();
  }
  if (!provider) {
    // Every field was protected content only, so no call was made. Report the provider that would have been used.
    const configured = input.provider as Partial<ConfiguredTranslationProvider>;
    return { fields, provider: configured.name ?? 'none', model: configured.model ?? 'none', units: 0 };
  }
  return { fields, provider, model, units };
}

export interface TranslationKey {
  subject: string;
  contentVersion: string;
  language: string;
  /** Omit both to accept a stored translation from any provider. */
  provider?: string;
  model?: string;
}

/** A stored translation for exactly this content version, or null. */
export async function getCachedTranslation(db: Db, key: TranslationKey): Promise<StoredContent<TranslatedFields> | null> {
  return getCachedContent<TranslatedFields>(db, { kind: TRANSLATION_KIND, variant: '', ...key });
}

export async function saveTranslation(
  db: Db,
  record: Required<TranslationKey> & { fields: TranslatedFields; createdBy?: number | null },
): Promise<number> {
  const { fields, ...identity } = record;
  return saveContent(db, { kind: TRANSLATION_KIND, variant: '', ...identity, payload: fields });
}
