import { APP_EN } from './app.en';
import { LEARN_EN } from './learn.en';

export const EN = { ...LEARN_EN, ...APP_EN } as const;
export type StringKey = keyof typeof EN;
export type Dictionary = Partial<Record<StringKey, string>>;
export type T = (key: StringKey, vars?: Record<string, string | number>) => string;

/** Bundled interface translations, registered by language code. English is always the fallback. */
const DICTIONARIES: Record<string, Dictionary> = {};
export function registerDictionary(language: string, dictionary: Dictionary): void {
  DICTIONARIES[language] = { ...(DICTIONARIES[language] ?? {}), ...dictionary };
}
export const hasDictionary = (language: string): boolean => language === 'en' || Boolean(DICTIONARIES[language]);

export function makeT(language: string): T {
  const dictionary = DICTIONARIES[language] ?? {};
  return (key, vars) => {
    const template = dictionary[key] ?? EN[key] ?? key;
    return vars ? template.replace(/\{(\w+)\}/g, (m, name: string) => (name in vars ? String(vars[name]) : m)) : template;
  };
}
