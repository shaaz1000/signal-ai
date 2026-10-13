/** Prints every fixed string a bundled language must translate, as JSON. `npm run i18n:extract > strings.json` */
import { conceptStrings, interfaceStrings, NAME_STRINGS } from '@/lib/i18n/source-strings';

console.log(JSON.stringify({ interface: interfaceStrings(), content: [...new Set([...NAME_STRINGS, ...conceptStrings()])] }, null, 1));
