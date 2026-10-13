import { XMLParser } from 'fast-xml-parser';
import { getJson, getText } from '@/lib/utils/http';
import { parseDate } from '@/lib/utils/time';
import { plainText } from '@/lib/utils/text';
import type { CandidateInput, SourceAdapter } from '../types';

const asArray = <T>(v: T | T[] | undefined | null): T[] => (v === undefined || v === null ? [] : Array.isArray(v) ? v : [v]);
const githubUrlIn = (text: string): string | undefined =>
  text.match(/https?:\/\/github\.com\/[\w.-]+\/[\w.-]+/)?.[0]?.replace(/[.,)]+$/, '');

interface ArxivEntry {
  id?: string;
  title?: string;
  summary?: string;
  published?: string;
  author?: { name?: string } | { name?: string }[];
  category?: { '@_term'?: string } | { '@_term'?: string }[];
  'arxiv:journal_ref'?: string;
  'arxiv:comment'?: string;
}

/** arXiv listing API. Everything here is a preprint unless it carries a journal reference. */
export const arxivSource: SourceAdapter = {
  meta: { id: 'arxiv', name: 'arXiv', group: 'research', reliability: 0.7, owner: 'arxiv', homepage: 'https://arxiv.org' },
  async fetch(ctx) {
    const query = encodeURIComponent('cat:cs.AI OR cat:cs.CL OR cat:cs.LG OR cat:cs.RO');
    const xml = await getText(
      `https://export.arxiv.org/api/query?search_query=${query}&sortBy=submittedDate&sortOrder=descending&max_results=60`,
      { ...ctx.http, timeoutMs: 30_000 },
    );
    const parsed = new XMLParser({ ignoreAttributes: false, processEntities: true }).parse(xml) as { feed?: { entry?: ArxivEntry | ArxivEntry[] } };
    if (!parsed.feed) throw new Error('arXiv response was not an Atom feed');
    const out: CandidateInput[] = [];
    for (const e of asArray(parsed.feed.entry)) {
      const id = String(e.id ?? '').match(/abs\/(\d{4}\.\d{4,5})/)?.[1];
      if (!id || !e.title) continue;
      const summary = plainText(e.summary, 2500);
      const comment = plainText(e['arxiv:comment'], 400);
      const authors = asArray(e.author).map((a) => a?.name).filter(Boolean) as string[];
      out.push({
        sourceId: 'arxiv',
        externalId: id,
        url: `https://arxiv.org/abs/${id}`,
        title: plainText(e.title, 300),
        description: summary,
        author: authors.length ? (authors.length > 3 ? `${authors.slice(0, 3).join(', ')} et al.` : authors.join(', ')) : null,
        publishedAt: parseDate(e.published, ctx.now),
        kindHint: 'paper',
        // A journal reference is the author's own statement of acceptance.
        claimType: e['arxiv:journal_ref'] ? 'peer_reviewed' : 'preprint',
        tags: asArray(e.category).map((c) => c?.['@_term']).filter(Boolean).slice(0, 5) as string[],
        primary: true,
        preFiltered: true,
        codeUrl: githubUrlIn(`${summary} ${comment}`),
      });
    }
    return out;
  },
};

interface HfPaper {
  paper?: { id?: string; title?: string; summary?: string; upvotes?: number; publishedAt?: string; authors?: { name?: string }[]; githubRepo?: string };
  title?: string;
  numComments?: number;
  publishedAt?: string;
}

export const hfPapersSource: SourceAdapter = {
  meta: { id: 'hf-papers', name: 'Hugging Face Papers', group: 'research', reliability: 0.65, owner: 'huggingface', homepage: 'https://huggingface.co/papers' },
  async fetch(ctx) {
    const items = await getJson<HfPaper[]>('https://huggingface.co/api/daily_papers?limit=50', ctx.http);
    if (!Array.isArray(items)) throw new Error('Hugging Face papers response was not an array');
    const out: CandidateInput[] = [];
    for (const it of items) {
      const p = it?.paper;
      if (!p?.id || !/^\d{4}\.\d{4,5}$/.test(p.id) || !(p.title ?? it.title)) continue;
      const authors = (p.authors ?? []).map((a) => a?.name).filter(Boolean) as string[];
      const summary = plainText(p.summary, 2500);
      out.push({
        sourceId: 'hf-papers',
        externalId: p.id,
        url: `https://arxiv.org/abs/${p.id}`,
        sourceUrl: `https://huggingface.co/papers/${p.id}`,
        title: plainText(p.title ?? it.title, 300),
        description: summary,
        author: authors.length ? (authors.length > 3 ? `${authors.slice(0, 3).join(', ')} et al.` : authors.join(', ')) : null,
        publishedAt: parseDate(p.publishedAt ?? it.publishedAt, ctx.now),
        kindHint: 'paper',
        claimType: 'preprint',
        tags: [],
        points: typeof p.upvotes === 'number' ? p.upvotes : null,
        comments: typeof it.numComments === 'number' ? it.numComments : null,
        preFiltered: true,
        codeUrl: (typeof p.githubRepo === 'string' && p.githubRepo.startsWith('https://github.com/') ? p.githubRepo : undefined) ?? githubUrlIn(summary),
      });
    }
    return out;
  },
};

interface HfRepo {
  id?: string;
  likes?: number;
  downloads?: number;
  tags?: string[];
  pipeline_tag?: string;
  createdAt?: string;
  sdk?: string;
  private?: boolean;
}

function hfAdapter(kind: 'models' | 'spaces'): SourceAdapter {
  const isModel = kind === 'models';
  return {
    meta: {
      id: isModel ? 'hf-models' : 'hf-spaces',
      name: isModel ? 'Hugging Face Models' : 'Hugging Face Spaces',
      group: 'research',
      reliability: 0.5,
      owner: 'huggingface',
      homepage: `https://huggingface.co/${kind}`,
    },
    async fetch(ctx) {
      const items = await getJson<HfRepo[]>(`https://huggingface.co/api/${kind}?sort=trendingScore&direction=-1&limit=40`, ctx.http);
      if (!Array.isArray(items)) throw new Error(`Hugging Face ${kind} response was not an array`);
      const out: CandidateInput[] = [];
      for (const m of items) {
        if (!m?.id || !m.id.includes('/') || m.private) continue;
        const [org] = m.id.split('/');
        const facts = [
          m.pipeline_tag ? `Task: ${m.pipeline_tag.replace(/-/g, ' ')}` : null,
          !isModel && m.sdk ? `Built with ${m.sdk}` : null,
        ].filter(Boolean).join('. ');
        out.push({
          sourceId: isModel ? 'hf-models' : 'hf-spaces',
          externalId: m.id,
          url: isModel ? `https://huggingface.co/${m.id}` : `https://huggingface.co/spaces/${m.id}`,
          title: m.id,
          description: facts,
          author: org,
          publishedAt: parseDate(m.createdAt, ctx.now),
          kindHint: isModel ? 'model' : 'demo',
          claimType: 'project_release',
          tags: (m.tags ?? []).filter((t) => !t.includes(':') && t.length < 30).slice(0, 12),
          points: typeof m.likes === 'number' ? m.likes : null,
          primary: true,
          preFiltered: true,
          hf: { likes: m.likes, downloads: m.downloads, pipeline: m.pipeline_tag },
        });
      }
      return out;
    },
  };
}

export const hfModelsSource = hfAdapter('models');
export const hfSpacesSource = hfAdapter('spaces');
