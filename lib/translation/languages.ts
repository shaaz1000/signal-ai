/**
 * Languages the interface can be translated into. English is the source
 * language of every record. `TRANSLATION_LANGUAGES` (comma-separated codes)
 * narrows the list for a deployment; it cannot add a code that is not here.
 */

export interface Language {
  code: string;
  /** English name. */
  name: string;
  nativeName: string;
  dir: 'ltr' | 'rtl';
  /** Guidance given to the translator about register and script. */
  styleNote: string;
}

const define = (code: string, name: string, nativeName: string, styleNote: string, dir: Language['dir'] = 'ltr'): Language => ({ code, name, nativeName, dir, styleNote });

export const SOURCE_LANGUAGE = 'en';

export const LANGUAGES: Record<string, Language> = {
  en: define('en', 'English', 'English', 'Plain, neutral English.'),
  hi: define('hi', 'Hindi', 'हिन्दी', 'Standard Hindi in Devanagari script. Clear and neutral, as in a quality newspaper. Keep widely used English technical terms as they are.'),
  hinglish: define(
    'hinglish',
    'Hinglish',
    'Hinglish',
    'Hinglish: Hindi written in Latin script, mixed with the English words Indian engineers actually use. Natural and conversational, the way a colleague would explain it. Translate the meaning, not word by word. Do not use Devanagari.',
  ),
  mr: define('mr', 'Marathi', 'मराठी', 'Standard Marathi in Devanagari script. Clear and neutral. Keep widely used English technical terms as they are.'),
  ar: define('ar', 'Arabic', 'العربية', 'Modern Standard Arabic. Clear and neutral. Keep product names and technical identifiers in Latin script.', 'rtl'),
  fr: define('fr', 'French', 'Français', 'Standard French. Clear and neutral, using the technical vocabulary French-speaking engineers use.'),
  es: define('es', 'Spanish', 'Español', 'Neutral international Spanish. Clear, using the technical vocabulary Spanish-speaking engineers use.'),
  de: define('de', 'German', 'Deutsch', 'Standard German. Clear and neutral, using the technical vocabulary German-speaking engineers use.'),
};

/** Languages enabled on this deployment, English first. */
export function enabledLanguages(env: Record<string, string | undefined> = {}): Language[] {
  const wanted = (env.TRANSLATION_LANGUAGES ?? '').split(',').map((c) => c.trim().toLowerCase()).filter(Boolean);
  const all = Object.values(LANGUAGES);
  if (!wanted.length) return all;
  return all.filter((l) => l.code === SOURCE_LANGUAGE || wanted.includes(l.code));
}

export function isSupportedLanguage(code: unknown, env: Record<string, string | undefined> = {}): code is string {
  return typeof code === 'string' && enabledLanguages(env).some((l) => l.code === code);
}

export function getLanguage(code: string): Language | null {
  return Object.hasOwn(LANGUAGES, code) ? LANGUAGES[code] : null;
}
