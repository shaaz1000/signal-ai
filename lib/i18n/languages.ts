/** Languages offered in the interface. Browser-safe; the server-side registry adds prompt style notes. */
export interface UiLanguage {
  code: string;
  name: string;
  native: string;
  dir: 'ltr' | 'rtl';
  /** True when general explanations and interface labels ship with the app for this language. */
  bundled: boolean;
}

export const UI_LANGUAGES: UiLanguage[] = [
  { code: 'en', name: 'English', native: 'English', dir: 'ltr', bundled: true },
  { code: 'hi', name: 'Hindi', native: 'हिन्दी', dir: 'ltr', bundled: true },
  { code: 'hinglish', name: 'Hinglish', native: 'Hinglish', dir: 'ltr', bundled: true },
  { code: 'mr', name: 'Marathi', native: 'मराठी', dir: 'ltr', bundled: false },
  { code: 'ar', name: 'Arabic', native: 'العربية', dir: 'rtl', bundled: false },
  { code: 'fr', name: 'French', native: 'Français', dir: 'ltr', bundled: false },
  { code: 'es', name: 'Spanish', native: 'Español', dir: 'ltr', bundled: false },
  { code: 'de', name: 'German', native: 'Deutsch', dir: 'ltr', bundled: false },
];

export const uiLanguage = (code: string): UiLanguage => UI_LANGUAGES.find((l) => l.code === code) ?? UI_LANGUAGES[0];
