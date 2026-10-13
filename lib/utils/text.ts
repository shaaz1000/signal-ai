/** Text helpers for untrusted third-party content. Pure and dependency-free. */

const ENTITIES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'", '#x27': "'",
  mdash: '-', ndash: '-', hellip: '...', rsquo: "'", lsquo: "'", rdquo: '"', ldquo: '"',
};

export function decodeEntities(s: string): string {
  return s
    .replace(/&(#x?[0-9a-f]+|\w+);/gi, (m, e: string) => {
      const key = e.toLowerCase();
      if (ENTITIES[key]) return ENTITIES[key];
      if (key.startsWith('#x')) return safeCodePoint(parseInt(key.slice(2), 16), m);
      if (key.startsWith('#')) return safeCodePoint(parseInt(key.slice(1), 10), m);
      return m;
    });
}

function safeCodePoint(n: number, fallback: string): string {
  return Number.isFinite(n) && n > 31 && n < 0x10ffff ? String.fromCodePoint(n) : fallback;
}

/** Strips markup, control and zero-width characters; collapses whitespace. */
export function plainText(input: string | null | undefined, max = 5000): string {
  if (!input) return '';
  let s = String(input);
  s = s.replace(/<!--[\s\S]*?-->/g, ' ');
  s = s.replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ');
  s = s.replace(/<[^>]{0,2000}>/g, ' ');
  s = decodeEntities(s);
  // Zero-width and bidi controls are a common way to hide injected text.
  s = s.replace(/[​-‏‪-‮⁠-⁯﻿]/g, '');
  s = s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, ' ');
  s = s.replace(/\s+/g, ' ').trim();
  return s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s;
}

/** Reduces a README to readable prose paragraphs (no badges, tables, code, headings). */
export function markdownParagraphs(md: string): { heading: string | null; text: string }[] {
  const out: { heading: string | null; text: string }[] = [];
  let heading: string | null = null;
  const body = md
    .replace(/```[\s\S]*?```/g, '\n')
    .replace(/<!--[\s\S]*?-->/g, '\n')
    // A heading directly under a paragraph still starts a new section.
    .replace(/^(#{1,6}\s.*)$/gm, '\n$1\n');
  for (const block of body.split(/\n\s*\n/)) {
    const first = block.trim();
    if (!first) continue;
    const h = first.match(/^#{1,6}\s+(.+)$/m);
    if (h && first.startsWith('#')) {
      heading = plainText(h[1].replace(/[#*_`]/g, ''), 120);
      const rest = first.split('\n').slice(1).join('\n').trim();
      if (!rest) continue;
      pushParagraph(out, heading, rest);
      continue;
    }
    pushParagraph(out, heading, first);
  }
  return out;
}

function pushParagraph(out: { heading: string | null; text: string }[], heading: string | null, raw: string) {
  if (/^\s*(\||[-*+]\s|\d+\.\s|>|!\[|\[!\[|<(img|p|div|a|h\d|table|picture|br)\b)/i.test(raw)) {
    // Lists, tables, quotes, badges and raw HTML blocks are not prose.
    if (!/^\s*[-*+]\s/.test(raw)) return;
  }
  let t = raw
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/^\s*[-*+]\s+/gm, '')
    .replace(/[*_`~]{1,3}/g, '');
  t = plainText(t, 900);
  if (t.length < 40 || /^(license|mit license|table of contents)/i.test(t)) return;
  out.push({ heading, text: t });
}

export function firstSentence(text: string, max = 220): string {
  const t = plainText(text, 2000);
  const m = t.match(/^(.{20,}?[.!?])(\s|$)/);
  const s = m ? m[1] : t;
  return s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s;
}

export function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max - 1);
  const space = cut.lastIndexOf(' ');
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

const STOP = new Set(
  'a an the and or of to in on for with by from at as is are was be this that it its into your you we our new how why what when using use via vs can will now just more most over under about show hn ask launch released release introducing announcing'.split(' '),
);

export function tokens(text: string): string[] {
  return (text.toLowerCase().match(/[a-z0-9][a-z0-9.+#-]*[a-z0-9+#]|[a-z0-9]/g) ?? []).filter(
    (t) => t.length > 1 && !STOP.has(t),
  );
}

export function jaccard(a: string[], b: string[]): number {
  if (!a.length || !b.length) return 0;
  const A = new Set(a);
  const B = new Set(b);
  let inter = 0;
  for (const t of A) if (B.has(t)) inter++;
  return inter / (A.size + B.size - inter);
}

/** Share of `needle` tokens that also occur in `haystack`. */
export function coverage(needle: string[], haystack: string[]): number {
  if (!needle.length) return 0;
  const H = new Set(haystack);
  const unique = [...new Set(needle)];
  return unique.filter((t) => H.has(t)).length / unique.length;
}

export function slugTag(raw: string): string | null {
  const t = raw.toLowerCase().trim().replace(/[\s_]+/g, '-').replace(/[^a-z0-9.+#-]/g, '').replace(/^-+|-+$/g, '');
  return t.length >= 2 && t.length <= 32 ? t : null;
}

export const PROMO_PATTERN =
  /\b(revolutionary|game[- ]?chang\w+|world'?s (first|best|fastest)|mind[- ]?blowing|insane(ly)?|unbelievable|10x|100x|kill(s|er)? (of )?(chatgpt|gpt|photoshop|google)|destroys?|beats? (gpt|claude|gemini|every)\w*|state[- ]of[- ]the[- ]art|sota|best[- ]in[- ]class|breakthrough|agi|superhuman|guaranteed)\b/i;

export const INJECTION_PATTERN =
  /(ignore (all |any )?(previous|prior|above) (instructions|prompts)|disregard (the |all )?(previous|above)|you are (now )?(an?|the) (ai|assistant|language model)|system prompt|as an ai (language )?model|do not (summari[sz]e|mention)|respond only with|rate this (project|repo\w*) (as )?(10|highly)|<\/?(system|assistant|instructions?)>)/i;

export function fmtInt(n: number): string {
  if (n >= 999_500) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
  if (n >= 10_000) return `${Math.round(n / 1000)}k`;
  if (n >= 1000) return `${(n / 1000).toFixed(1).replace(/\.0$/, '')}k`;
  return String(Math.round(n));
}
