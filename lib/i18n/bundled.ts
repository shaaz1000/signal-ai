import { registerContent } from './content';
import { registerDictionary, type Dictionary } from './index';

/**
 * Registers one bundled language. The language files themselves are loaded on
 * demand (a separate chunk in the app, a separate JSON file beside the static
 * page), because each is larger than the rest of the interface code.
 */
export function registerBundled(language: string, data: { ui: Record<string, string>; content: Record<string, string> }): void {
  registerDictionary(language, data.ui as Dictionary);
  registerContent(language, data.content);
}
