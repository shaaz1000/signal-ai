/**
 * Keeps the parts of a text that must survive translation exactly as they
 * are. Before text goes to a provider, each such part is swapped for an
 * opaque placeholder (⟦0⟧, ⟦1⟧, ...); afterwards the originals are put back.
 * The provider never sees a URL, a figure or a code sample, so it cannot
 * alter one, and `validateTranslation` refuses any response that lost,
 * repeated or invented a placeholder.
 *
 * Protected: fenced and inline code, URLs, glossary terms, established
 * technical terms and product names, dates, `owner/repo` identifiers, model
 * and version identifiers, and numbers with their currency, percent or unit.
 */
import { INJECTION_PATTERN } from '@/lib/utils/text';

/** Terms left in English because that is how practitioners write them in every language. Extend per call with `terms`. */
export const TECHNICAL_TERMS: readonly string[] = [
  'LLM', 'LLMs', 'RAG', 'MCP', 'GPU', 'GPUs', 'CPU', 'CPUs', 'TPU', 'NPU', 'API', 'APIs', 'SDK', 'SDKs', 'CLI', 'IDE', 'OCR', 'TTS', 'ASR', 'NLP',
  'WebAssembly', 'WASM', 'Wasm', 'WebGPU', 'WebGL', 'GitHub', 'GitLab', 'Hugging Face', 'arXiv', 'Hacker News', 'Lobsters', 'Product Hunt', 'Reddit',
  'transformer', 'transformers', 'Transformer', 'Transformers', 'LoRA', 'QLoRA', 'GGUF', 'ONNX', 'CUDA', 'PyTorch', 'TensorFlow', 'JAX', 'MLX',
  'OpenAI', 'Anthropic', 'NVIDIA', 'Google DeepMind', 'Meta', 'Mistral', 'Claude', 'GPT', 'Gemini', 'Llama', 'Nemotron', 'Qwen', 'DeepSeek', 'Stable Diffusion', 'Whisper',
  'Kubernetes', 'Docker', 'Linux', 'macOS', 'Postgres', 'PostgreSQL', 'SQLite', 'Redis', 'Rust', 'Python', 'TypeScript', 'JavaScript', 'Node.js', 'React', 'Next.js',
  'JSON', 'YAML', 'HTTP', 'HTTPS', 'SQL', 'README', 'RAM', 'VRAM', 'KV cache', 'RISC-V', 'ARM64', 'x86', 'open-weights',
];

export interface ProtectOptions {
  /** Source term to the form it must take in the output. Map a term to itself to keep it verbatim. */
  glossary?: Record<string, string>;
  /** Extra terms to keep verbatim, such as the project's own name. */
  terms?: readonly string[];
}

export interface Protected {
  /** The text with every protected part replaced by a placeholder. */
  text: string;
  /** What each placeholder stood for in the source, by index. */
  tokens: string[];
  /** What each placeholder becomes in the output. Differs from `tokens` only for glossary terms with a fixed translation. */
  replacements: string[];
}

const OPEN = '⟦';
const CLOSE = '⟧';
const PLACEHOLDER = /⟦\s*(\d+)\s*⟧/g;

const MONTH = '(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)';
const NOT_WORD_BEFORE = '(?<![\\p{L}\\p{N}_])';
const NOT_WORD_AFTER = '(?![\\p{L}\\p{N}_])';
const ATTACHED_UNIT = '(?:%|°[CF]|[kKmMbBxX×])';
const SPACED_UNIT =
  '(?:%|GiB|MiB|GB|MB|KB|kB|TB|ms|µs|ns|min|kHz|MHz|GHz|Hz|kWh|kW|mAh|fps|px|nm|mm|cm|km|kg|USD|EUR|INR|GBP|tokens/s|tok/s|req/s)';

const PATTERNS: [name: string, source: string][] = [
  ['fence', '```[\\s\\S]*?```'],
  ['code', '`[^`\\n]+`'],
  ['url', 'https?://[^\\s<>"\'⟦⟧]+'],
  ['repo', '(?<![\\p{L}\\p{N}_/.@-])[A-Za-z0-9][\\w.-]*/[A-Za-z0-9][\\w.-]*(?![\\w/])'],
  // Model and build identifiers: letters and digits in one token, e.g. Llama-3.1-70B, GPT-4o, x86_64, v0.3.1.
  // Tried before the term list so a model name stays one token rather than "Llama" plus loose figures.
  ['ident', `${NOT_WORD_BEFORE}[A-Za-z][A-Za-z_]*(?:[-.][A-Za-z_]+)*[-._]?\\d\\w*(?:[-.]\\w+)*`],
  // The term list is spliced in here per call.
  ['term', ''],
  [
    'date',
    [
      '\\d{4}-\\d{2}-\\d{2}(?:T\\d{2}:\\d{2}(?::\\d{2})?(?:\\.\\d+)?(?:Z|[+-]\\d{2}:?\\d{2})?)?',
      `\\d{1,2}(?:st|nd|rd|th)?\\s+${MONTH}\\.?,?\\s+\\d{4}`,
      `${MONTH}\\.?\\s+\\d{1,2}(?:st|nd|rd|th)?,?\\s+\\d{4}`,
      `${MONTH}\\.?\\s+\\d{4}`,
      '\\d{1,2}/\\d{1,2}/\\d{2,4}',
    ].map((p) => `${NOT_WORD_BEFORE}${p}${NOT_WORD_AFTER}`).join('|'),
  ],
  ['version', `${NOT_WORD_BEFORE}\\d+\\.\\d+\\.\\d+(?:\\.\\d+)*(?:[-+][A-Za-z0-9.]+)?${NOT_WORD_AFTER}`],
  ['number', `${NOT_WORD_BEFORE}[$€£₹¥]?\\d+(?:,\\d{3})*(?:\\.\\d+)?(?:${ATTACHED_UNIT}${NOT_WORD_AFTER}|\\s?${SPACED_UNIT}${NOT_WORD_AFTER})?`],
];

const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');

function buildPattern(terms: string[]): RegExp {
  // Longest first, so "Hugging Face" wins over a shorter term that starts the same way.
  const alternatives = [...new Set(terms)].filter((t) => t.trim().length > 1).sort((a, b) => b.length - a.length).map(escapeRegex);
  const parts = PATTERNS.map(([name, source]) => {
    if (name !== 'term') return `(?<${name}>${source})`;
    return alternatives.length ? `(?<term>${NOT_WORD_BEFORE}(?:${alternatives.join('|')})${NOT_WORD_AFTER})` : null;
  }).filter(Boolean);
  return new RegExp(parts.join('|'), 'gu');
}

/** Words joined by a slash that are ordinary prose ("and/or"), not an identifier. */
const looksLikeIdentifier = (s: string) => /[A-Z0-9_.-]/.test(s);

/** Replaces everything that must survive verbatim with placeholders. */
export function protect(input: string, options: ProtectOptions = {}): Protected {
  const glossary = options.glossary ?? {};
  const pattern = buildPattern([...TECHNICAL_TERMS, ...(options.terms ?? []), ...Object.keys(glossary)]);
  const tokens: string[] = [];
  const replacements: string[] = [];
  const hold = (original: string): string => {
    tokens.push(original);
    replacements.push(Object.hasOwn(glossary, original) && glossary[original] ? glossary[original] : original);
    return `${OPEN}${tokens.length - 1}${CLOSE}`;
  };

  // The source cannot be allowed to contain our own delimiters.
  const source = input.replace(/[⟦⟧]/g, '');
  const text = source.replace(pattern, (match: string, ...rest: unknown[]) => {
    const groups = rest.at(-1) as Record<string, string | undefined>;
    if (groups.url !== undefined || groups.repo !== undefined || groups.ident !== undefined) {
      // Sentence punctuation after a URL or identifier is prose, not part of it.
      const trailing = /[.,;:!?)\]'"-]+$/.exec(match)?.[0] ?? '';
      const core = trailing ? match.slice(0, -trailing.length) : match;
      if (!core) return match;
      if (groups.repo !== undefined && !looksLikeIdentifier(core)) return match;
      return hold(core) + trailing;
    }
    return hold(match);
  });
  return { text, tokens, replacements };
}

/** Puts the protected parts back. Call only on text that passed `validateTranslation`. */
export function restore(translated: string, held: Protected): string {
  return translated.replace(PLACEHOLDER, (whole, index: string) => held.replacements[Number(index)] ?? whole);
}

/** The text with placeholders removed: what the provider is actually asked to translate. */
export function translatableText(held: Protected): string {
  return held.text.replace(PLACEHOLDER, ' ');
}

export type Validation = { ok: true } | { ok: false; reason: string };

const MARKUP = /<\s*\/?\s*[a-zA-Z!][^>]*>|<\s*script|javascript\s*:|data\s*:\s*text\/html|\bon[a-z]+\s*=\s*["']/i;

/**
 * Decides whether a provider's response may be used. `translated` is the raw
 * response, placeholders still in place. A rejected response is never
 * restored, stored or shown.
 */
export function validateTranslation(original: string, protectedOriginal: Protected, translated: string): Validation {
  const reject = (reason: string): Validation => ({ ok: false, reason });
  if (typeof translated !== 'string' || !translated.trim()) return reject('empty response');
  if (translated.length > 4 * Math.max(original.length, 40)) return reject('response is far longer than the source');

  const seen = new Map<number, number>();
  for (const match of translated.matchAll(PLACEHOLDER)) seen.set(Number(match[1]), (seen.get(Number(match[1])) ?? 0) + 1);
  for (let i = 0; i < protectedOriginal.tokens.length; i++) {
    const n = seen.get(i) ?? 0;
    if (n === 0) return reject(`placeholder ${i} is missing`);
    if (n > 1) return reject(`placeholder ${i} is repeated`);
  }
  if (seen.size > protectedOriginal.tokens.length) return reject('response contains a placeholder that was not in the source');

  const prose = translated.replace(PLACEHOLDER, ' ');
  if (prose.includes(OPEN) || prose.includes(CLOSE)) return reject('response contains a malformed placeholder');
  if (MARKUP.test(prose)) return reject('response contains markup or script');
  if (INJECTION_PATTERN.test(prose)) return reject('response echoes instruction-like text');
  return { ok: true };
}
