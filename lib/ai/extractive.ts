import type { CategoryId, Editorial } from '@/lib/types';
import { firstSentence, INJECTION_PATTERN, markdownParagraphs, plainText, truncate } from '@/lib/utils/text';
import type { Evidence } from '@/lib/verification/checks';

export interface ExtractiveInput {
  kind: string;
  category: CategoryId;
  title: string;
  description: string;
  /** README, model card or abstract. Untrusted. */
  docs: string;
  /** Facts our pipeline measured, already phrased as sentences. */
  facts: string[];
  evidence: Evidence[];
  repoName?: string;
}

const AUDIENCE: Record<CategoryId, string> = {
  'ai-tools': 'People evaluating AI tools for day-to-day work.',
  'open-source': 'Teams looking for self-hostable or inspectable alternatives to commercial software.',
  agents: 'Developers building or operating agents that use tools, browsers or computers.',
  llms: 'Engineers who run, fine-tune or evaluate language models.',
  'dev-tools': 'Software engineers looking to change how they build, test or ship code.',
  research: 'Researchers and practitioners tracking methods before they reach products.',
  robotics: 'Robotics engineers and researchers working on embodied systems.',
  creative: 'Designers, artists and developers working with generative media.',
  'gaming-browser': 'Web platform and emulation enthusiasts, and anyone curious what a browser can run.',
  launches: 'Early adopters and people watching what new companies are shipping.',
};

const HOW_HEADING = /\b(how it works|architecture|design|under the hood|implementation|internals|approach|method(ology)?|technical (details|overview))\b/i;
const WHY_HEADING = /\b(why|motivation|features|highlights|what makes|key (features|ideas)|overview|about)\b/i;
const LIMITS_HEADING = /\b(limitations?|known issues|caveats|not (yet )?supported|status|disclaimer|roadmap)\b/i;
const METHOD_SENTENCE = /\b(we (propose|introduce|present|develop|train)|our (method|approach|model|framework)|this (paper|work) (proposes|introduces|presents))\b/i;

const safe = (text: string) => !INJECTION_PATTERN.test(text);

function sentencesMatching(text: string, re: RegExp, max: number): string | null {
  const hits = plainText(text, 6000).split(/(?<=[.!?])\s+/).filter((s) => re.test(s) && safe(s) && s.length > 40);
  return hits.length ? truncate(hits.slice(0, 2).join(' '), max) : null;
}

/**
 * Builds the editorial fields without a model, by selecting source sentences
 * and restating measured facts. It cannot invent anything because it never
 * generates text: where the sources are silent the field stays null and the
 * UI says "not verified".
 */
export function extractiveEditorial(i: ExtractiveInput): { editorial: Editorial; headline: string; summary: string } {
  const paragraphs = i.kind === 'paper' ? [] : markdownParagraphs(i.docs).filter((p) => safe(p.text));
  const description = safe(i.description) ? plainText(i.description, 1200) : '';
  const intro = paragraphs.find((p) => !description || !p.text.toLowerCase().startsWith(description.toLowerCase().slice(0, 40)));

  const summary = description ? firstSentence(description, 220) : intro ? firstSentence(intro.text, 220) : i.title;
  const headline = i.repoName
    ? truncate(description ? `${i.repoName}: ${firstSentence(description, 90).replace(/[.!]$/, '')}` : i.repoName, 110)
    : truncate(i.title, 110);

  const whatParts: string[] = [];
  if (description) whatParts.push(truncate(description, 420));
  if (intro && whatParts.join(' ').length < 260) whatParts.push(`From the documentation: "${truncate(intro.text, 320)}"`);
  const what = whatParts.join(' ') || 'The source gives no description beyond its title.';

  const whySource = paragraphs.find((p) => p.heading && WHY_HEADING.test(p.heading) && p !== intro);
  const whyParts = [...i.facts.slice(0, 3)];
  if (whySource) whyParts.push(`The documentation highlights: "${truncate(whySource.text, 260)}"`);
  const why = whyParts.join(' ') || 'No distinguishing evidence has been collected yet beyond the listing itself.';

  const howSource = paragraphs.find((p) => p.heading && HOW_HEADING.test(p.heading));
  const how = howSource
    ? `According to the documentation: "${truncate(howSource.text, 420)}"`
    : i.kind === 'paper'
      ? sentencesMatching(i.docs || i.description, METHOD_SENTENCE, 420)
      : null;

  const limitations: string[] = [];
  const stated = paragraphs.find((p) => p.heading && LIMITS_HEADING.test(p.heading));
  if (stated) limitations.push(`The project's own notes: "${truncate(stated.text, 240)}"`);
  for (const e of i.evidence) {
    if (e.outcome === 'pass') continue;
    if (['corroboration', 'execution_mode', 'review_status', 'promotional_language', 'documentation', 'code_available', 'engagement_pattern', 'description_match', 'dates_consistent', 'primary_source', 'repo_state', 'untrusted_content'].includes(e.check)) {
      limitations.push(e.detail);
    }
  }
  if (!limitations.length) limitations.push('No specific limitations are documented in the sources we read.');

  return {
    headline,
    summary,
    editorial: {
      what,
      why,
      how,
      whoCares: AUDIENCE[i.category],
      limitations: [...new Set(limitations)].slice(0, 6),
      applications: null,
      method: 'extractive',
      model: null,
    },
  };
}
