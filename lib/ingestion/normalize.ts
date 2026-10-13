import type { ClaimType, CategoryId, Kind } from '@/lib/types';
import { canonicalize, cleanUrl, stableId } from '@/lib/utils/url';
import { firstSentence, jaccard, plainText, tokens } from '@/lib/utils/text';
import { DAY } from '@/lib/utils/time';
import { classify, defaultClaimType, isRelevant } from './classify';
import { CandidateSchema, type Candidate, type CandidateInput, type SourceMeta } from './types';

export interface Normalized extends Candidate {
  key: string;
  canonicalUrl: string;
  kind: Kind;
  meta: SourceMeta;
  /** Where this source's own page for the item lives. */
  refUrl: string;
}

export interface NormalizeResult {
  items: Normalized[];
  malformed: number;
  offTopic: number;
  unsafe: number;
}

/** Stage 2: validate, sanitise and map every candidate onto a canonical identity. */
export function normalizeCandidates(raw: CandidateInput[], metas: Map<string, SourceMeta>): NormalizeResult {
  const result: NormalizeResult = { items: [], malformed: 0, offTopic: 0, unsafe: 0 };
  for (const input of raw) {
    const parsed = CandidateSchema.safeParse(input);
    const meta = parsed.success ? metas.get(parsed.data.sourceId) : undefined;
    if (!parsed.success || !meta) {
      result.malformed++;
      continue;
    }
    const c = parsed.data;
    const canonical = canonicalize(c.url);
    if (!canonical) {
      result.unsafe++;
      continue;
    }
    const refUrl = (c.sourceUrl && cleanUrl(c.sourceUrl)) || canonical.url;
    const pointsAtItself = !c.sourceUrl || canonicalize(c.sourceUrl)?.key === canonical.key;
    const kind: Kind =
      canonical.kind ??
      (c.kindHint && c.kindHint !== 'repository' && c.kindHint !== 'paper' ? c.kindHint : undefined) ??
      (c.tags.includes('show-hn') ? 'demo' : meta.group === 'community' && pointsAtItself ? 'post' : 'article');

    const title = plainText(c.title, 300);
    const description = plainText(c.description, 4000);
    if (!title) {
      result.malformed++;
      continue;
    }
    const projectLike = kind === 'repository' || kind === 'paper' || kind === 'model';
    if (!c.preFiltered && !projectLike && !isRelevant(`${title} ${description} ${c.tags.join(' ')}`)) {
      result.offTopic++;
      continue;
    }
    // A source is only the primary source for items it actually hosts or publishes.
    const hostsIt =
      (canonical.kind === 'repository' && meta.id === 'github') ||
      (canonical.kind === 'paper' && meta.id === 'arxiv') ||
      ((canonical.kind === 'model' || canonical.kind === 'demo') && meta.owner === 'huggingface') ||
      (canonical.kind === null && pointsAtItself && c.primary);
    result.items.push({
      ...c,
      title,
      description,
      author: c.author ? plainText(c.author, 160) : null,
      primary: Boolean(hostsIt),
      key: canonical.key,
      canonicalUrl: canonical.url,
      kind,
      meta,
      refUrl,
    });
  }
  return result;
}

export interface CandidateGroup {
  key: string;
  id: string;
  kind: Kind;
  canonicalUrl: string;
  lead: Normalized;
  members: Normalized[];
  title: string;
  description: string;
  author: string | null;
  authorVerified: boolean;
  publishedAt: Date | null;
  claimType: ClaimType;
  category: CategoryId;
  tags: string[];
}

function pickLead(members: Normalized[]): Normalized {
  return [...members].sort(
    (a, b) =>
      Number(b.primary) - Number(a.primary) ||
      Number(Boolean(b.repo)) - Number(Boolean(a.repo)) ||
      b.meta.reliability - a.meta.reliability ||
      (a.publishedAt?.getTime() ?? Infinity) - (b.publishedAt?.getTime() ?? Infinity),
  )[0];
}

function buildGroup(key: string, members: Normalized[]): CandidateGroup {
  // The same source can return an item twice (two queries, two feeds); keep the richest copy.
  const unique = new Map<string, Normalized>();
  for (const m of members) {
    const k = `${m.sourceId}:${m.externalId}`;
    const prev = unique.get(k);
    if (!prev || (m.points ?? 0) >= (prev.points ?? 0)) unique.set(k, m);
  }
  const list = [...unique.values()];
  const lead = pickLead(list);
  const description = lead.description || list.map((m) => m.description).find(Boolean) || '';
  const tags = [...new Set(list.flatMap((m) => m.tags))];
  const { category, tags: finalTags } = classify({
    title: lead.title, description, tags, kind: lead.kind, group: lead.meta.group, sourceId: lead.sourceId,
  });
  // For a repository the meaningful date is its creation; for anything else, earliest publication.
  const dates = list.map((m) => m.publishedAt).filter((d): d is Date => d !== null);
  const publishedAt = lead.repo?.createdAt ?? (lead.primary ? lead.publishedAt : null) ??
    (dates.length ? new Date(Math.min(...dates.map((d) => d.getTime()))) : null);
  return {
    key,
    id: stableId(key),
    kind: lead.kind,
    canonicalUrl: lead.canonicalUrl,
    lead,
    members: list,
    title: lead.title,
    description,
    // Authorship is only trusted when the host or publisher states it, never from a link-sharing thread.
    author: lead.primary || lead.meta.group === 'news' || lead.meta.group === 'blog' ? lead.author : null,
    authorVerified: (lead.primary || lead.meta.group === 'news' || lead.meta.group === 'blog') && Boolean(lead.author),
    publishedAt,
    claimType: lead.claimType ?? defaultClaimType(lead.kind, lead.meta.group),
    category,
    tags: finalTags,
  };
}

export const SAME_STORY_THRESHOLD = 0.6;

/** True when two headlines describe the same event closely enough to merge. */
export function sameStory(a: { title: string; publishedAt: Date | null }, b: { title: string; publishedAt: Date | null }): boolean {
  if (a.publishedAt && b.publishedAt && Math.abs(a.publishedAt.getTime() - b.publishedAt.getTime()) > 4 * DAY) return false;
  const ta = tokens(a.title);
  const tb = tokens(b.title);
  if (ta.length < 4 || tb.length < 4) return false;
  return jaccard(ta, tb) >= SAME_STORY_THRESHOLD;
}

/**
 * Stage 3: collapse candidates into one group per real-world item. Exact
 * identity first (canonical key), then near-identical headlines for
 * coverage-type items so three outlets reporting one launch become one
 * discovery with three source references.
 */
export function groupCandidates(items: Normalized[]): CandidateGroup[] {
  const byKey = new Map<string, Normalized[]>();
  for (const it of items) {
    const list = byKey.get(it.key);
    if (list) list.push(it);
    else byKey.set(it.key, [it]);
  }
  const groups = [...byKey.entries()].map(([key, members]) => buildGroup(key, members));

  const merged: CandidateGroup[] = [];
  for (const g of groups) {
    const fuzzy = g.kind === 'article' || g.kind === 'product';
    const target = fuzzy
      ? merged.find((m) => (m.kind === 'article' || m.kind === 'product') && sameStory(m, g))
      : undefined;
    if (!target) {
      merged.push(g);
      continue;
    }
    const combined = buildGroup(target.key, [...target.members, ...g.members]);
    // Keep the identity of whichever group holds the lead so reruns stay stable.
    const leadKey = combined.lead.key;
    merged[merged.indexOf(target)] = { ...combined, key: leadKey, id: stableId(leadKey), canonicalUrl: combined.lead.canonicalUrl };
  }
  return merged;
}

export function summaryOf(description: string, title: string): string {
  return description ? firstSentence(description, 220) : title;
}
