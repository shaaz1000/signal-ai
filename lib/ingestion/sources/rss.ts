import { XMLParser } from 'fast-xml-parser';
import { getText } from '@/lib/utils/http';
import { parseDate, DAY } from '@/lib/utils/time';
import { plainText } from '@/lib/utils/text';
import type { ClaimType, Kind, SourceGroup } from '@/lib/types';
import type { CandidateInput, SourceAdapter, SourceMeta } from '../types';

export interface FeedItem {
  id: string;
  title: string;
  link: string;
  summary: string;
  author: string | null;
  published: string | null;
  categories: string[];
}

const asArray = <T>(v: T | T[] | undefined | null): T[] => (v === undefined || v === null ? [] : Array.isArray(v) ? v : [v]);
const text = (v: unknown): string => {
  if (v === null || v === undefined) return '';
  if (typeof v === 'string' || typeof v === 'number') return String(v);
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>;
    return text(o['#text'] ?? o['#cdata'] ?? o.name ?? '');
  }
  return '';
};

function atomLink(link: unknown): string {
  const links = asArray<Record<string, string> | string>(link as Record<string, string> | string | undefined);
  for (const l of links) {
    if (typeof l === 'string') return l;
    if (l?.['@_rel'] === 'alternate' && l['@_href']) return l['@_href'];
  }
  const first = links[0];
  return typeof first === 'object' && first ? first['@_href'] ?? '' : '';
}

/** Parses RSS 2.0, RDF and Atom into one shape. Throws on anything that is not a feed. */
export function parseFeed(xml: string): FeedItem[] {
  if (!xml.trim().startsWith('<')) throw new Error('Feed response was not XML');
  const doc = new XMLParser({
    ignoreAttributes: false,
    cdataPropName: '#cdata',
    processEntities: true,
    // Feeds are untrusted input; never expand entity bombs.
    htmlEntities: false,
  }).parse(xml) as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

  const rssItems = asArray(doc.rss?.channel?.item ?? doc['rdf:RDF']?.item);
  if (rssItems.length || doc.rss?.channel) {
    return rssItems
      .map((it: Record<string, unknown>): FeedItem => ({
        id: text(it.guid) || text(it.link),
        title: text(it.title),
        link: text(it.link),
        summary: text(it.description) || text(it['content:encoded']),
        author: text(it['dc:creator']) || text(it.author) || null,
        published: text(it.pubDate) || text(it['dc:date']) || null,
        categories: asArray(it.category).map(text).filter(Boolean),
      }))
      .filter((i) => i.title && i.link);
  }
  if (doc.feed) {
    return asArray(doc.feed.entry)
      .map((e: Record<string, unknown>): FeedItem => ({
        id: text(e.id) || atomLink(e.link),
        title: text(e.title),
        link: atomLink(e.link),
        summary: text(e.summary) || text(e.content),
        author: text(asArray(e.author as unknown)[0]) || null,
        published: text(e.published) || text(e.updated) || null,
        categories: asArray<Record<string, string> | string>(e.category as Record<string, string> | undefined).map((c) => (typeof c === 'object' ? c?.['@_term'] ?? '' : text(c))).filter(Boolean),
      }))
      .filter((i) => i.title && i.link);
  }
  throw new Error('Unrecognised feed format');
}

interface FeedConfig extends SourceMeta {
  feedUrl: string;
  kind: Kind;
  claimType: ClaimType;
  /** Publisher-origin posts are primary sources for their own announcements. */
  primary: boolean;
  preFiltered?: boolean;
  maxAgeDays?: number;
}

const feed = (
  id: string, name: string, group: SourceGroup, reliability: number, homepage: string, feedUrl: string,
  extra: Partial<FeedConfig> = {},
): FeedConfig => ({
  id, name, group, reliability, homepage, feedUrl, owner: id,
  kind: 'article', claimType: group === 'news' ? 'third_party' : 'company_announcement', primary: group !== 'news', ...extra,
});

export const FEEDS: FeedConfig[] = [
  feed('arstechnica', 'Ars Technica', 'news', 0.85, 'https://arstechnica.com', 'https://feeds.arstechnica.com/arstechnica/technology-lab'),
  feed('techcrunch', 'TechCrunch', 'news', 0.75, 'https://techcrunch.com', 'https://techcrunch.com/category/artificial-intelligence/feed/', { preFiltered: true }),
  feed('theverge', 'The Verge', 'news', 0.75, 'https://www.theverge.com', 'https://www.theverge.com/rss/ai-artificial-intelligence/index.xml', { preFiltered: true }),
  feed('mit-tech-review', 'MIT Technology Review', 'news', 0.9, 'https://www.technologyreview.com', 'https://www.technologyreview.com/feed/'),
  feed('venturebeat', 'VentureBeat', 'news', 0.65, 'https://venturebeat.com', 'https://venturebeat.com/category/ai/feed/', { preFiltered: true }),
  feed('ieee-spectrum', 'IEEE Spectrum', 'news', 0.9, 'https://spectrum.ieee.org', 'https://spectrum.ieee.org/feeds/topic/artificial-intelligence.rss', { preFiltered: true }),
  feed('github-blog', 'GitHub Blog', 'blog', 0.8, 'https://github.blog', 'https://github.blog/feed/'),
  feed('huggingface-blog', 'Hugging Face Blog', 'blog', 0.75, 'https://huggingface.co/blog', 'https://huggingface.co/blog/feed.xml', { preFiltered: true }),
  feed('openai-news', 'OpenAI News', 'blog', 0.75, 'https://openai.com/news', 'https://openai.com/news/rss.xml', { preFiltered: true }),
  feed('deepmind-blog', 'Google DeepMind Blog', 'blog', 0.75, 'https://deepmind.google/blog', 'https://deepmind.google/blog/rss.xml', { preFiltered: true }),
  feed('google-research', 'Google Research Blog', 'blog', 0.8, 'https://research.google/blog', 'https://research.google/blog/rss/', { preFiltered: true }),
  feed('microsoft-research', 'Microsoft Research', 'blog', 0.8, 'https://www.microsoft.com/en-us/research', 'https://www.microsoft.com/en-us/research/feed/'),
  feed('meta-engineering', 'Engineering at Meta', 'blog', 0.75, 'https://engineering.fb.com', 'https://engineering.fb.com/feed/'),
  feed('nvidia-blog', 'NVIDIA Blog', 'blog', 0.7, 'https://blogs.nvidia.com', 'https://blogs.nvidia.com/feed/'),
  feed('mit-news-ai', 'MIT News: Artificial intelligence', 'blog', 0.85, 'https://news.mit.edu', 'https://news.mit.edu/rss/topic/artificial-intelligence2', { preFiltered: true, claimType: 'third_party' }),
  feed('simonwillison', "Simon Willison's Weblog", 'blog', 0.7, 'https://simonwillison.net', 'https://simonwillison.net/atom/everything/', {
    claimType: 'third_party', primary: false, preFiltered: true,
  }),
  feed('producthunt', 'Product Hunt', 'community', 0.4, 'https://www.producthunt.com', 'https://www.producthunt.com/feed', {
    kind: 'product', claimType: 'company_announcement', primary: false,
  }),
];

export function feedSource(cfg: FeedConfig): SourceAdapter {
  const { feedUrl, kind, claimType, primary, preFiltered, maxAgeDays = 10, ...meta } = cfg;
  return {
    meta,
    async fetch(ctx) {
      const xml = await getText(feedUrl, { ...ctx.http, headers: { accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml' } });
      const items = parseFeed(xml);
      const cutoff = ctx.now.getTime() - maxAgeDays * DAY;
      const out: CandidateInput[] = [];
      for (const it of items.slice(0, 40)) {
        const publishedAt = parseDate(it.published, ctx.now);
        if (publishedAt && publishedAt.getTime() < cutoff) continue;
        out.push({
          sourceId: meta.id,
          externalId: it.id.slice(0, 300),
          url: it.link,
          title: plainText(it.title, 300),
          description: plainText(it.summary, 1500),
          author: it.author ? plainText(it.author, 120) : null,
          publishedAt,
          kindHint: kind,
          claimType,
          tags: it.categories.slice(0, 8),
          primary,
          preFiltered: Boolean(preFiltered),
        });
      }
      return out;
    },
  };
}
