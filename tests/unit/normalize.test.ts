import { describe, expect, it } from 'vitest';
import { classify, detectExecutionMode } from '@/lib/ingestion/classify';
import { groupCandidates, normalizeCandidates, sameStory } from '@/lib/ingestion/normalize';
import { sourceMetaMap } from '@/lib/ingestion/registry';
import type { CandidateInput } from '@/lib/ingestion/types';

const metas = sourceMetaMap();

const candidate = (overrides: Partial<CandidateInput> = {}): CandidateInput => ({
  sourceId: 'hackernews',
  externalId: '1001',
  url: 'https://example.com/posts/local-llm-inference',
  title: 'Running a local LLM inference server on a laptop',
  ...overrides,
});

const repoFacts = (overrides: Partial<NonNullable<CandidateInput['repo']>> = {}): NonNullable<CandidateInput['repo']> => ({
  owner: 'Acme',
  name: 'VexDB',
  description: 'A small vector database for embedding search',
  stars: 1240,
  forks: 61,
  openIssues: 14,
  createdAt: new Date('2026-02-20T10:00:00Z'),
  pushedAt: new Date('2026-02-28T18:00:00Z'),
  ...overrides,
});

const githubHit = (overrides: Partial<CandidateInput> = {}): CandidateInput =>
  candidate({
    sourceId: 'github',
    externalId: '900100',
    url: 'https://github.com/Acme/VexDB',
    title: 'Acme/VexDB',
    description: 'A small vector database for embedding search',
    author: 'Acme',
    publishedAt: new Date('2026-02-20T10:00:00Z'),
    kindHint: 'repository',
    claimType: 'project_release',
    points: 1240,
    repo: repoFacts(),
    primary: true,
    preFiltered: true,
    ...overrides,
  });

const hnLinkToRepo = (overrides: Partial<CandidateInput> = {}): CandidateInput =>
  candidate({
    sourceId: 'hackernews',
    externalId: '4001',
    url: 'https://github.com/acme/vexdb/tree/main',
    sourceUrl: 'https://news.ycombinator.com/item?id=4001',
    title: 'Show HN: VexDB, a small vector database',
    author: 'throwaway_hn',
    publishedAt: new Date('2026-02-28T09:00:00Z'),
    points: 250,
    comments: 80,
    ...overrides,
  });

const group = (raw: CandidateInput[]) => groupCandidates(normalizeCandidates(raw, metas).items);

describe('normalizeCandidates', () => {
  it('counts malformed candidates instead of throwing', () => {
    const result = normalizeCandidates(
      [
        candidate({ title: '' }),
        candidate({ title: '<b> </b>' }),
        candidate({ url: 'not a url' }),
        candidate({ sourceId: 'no-such-source' }),
        { sourceId: 'hackernews' } as unknown as CandidateInput,
        candidate(),
      ],
      metas,
    );
    expect(result.malformed).toBe(5);
    expect(result.items).toHaveLength(1);
  });

  it('counts unsafe URLs separately', () => {
    const result = normalizeCandidates(
      [
        candidate({ url: 'http://127.0.0.1/admin' }),
        candidate({ url: 'http://169.254.169.254/latest/meta-data' }),
        candidate({ url: 'https://ci.internal/builds/llm' }),
      ],
      metas,
    );
    expect(result.unsafe).toBe(3);
    expect(result.malformed).toBe(0);
    expect(result.items).toHaveLength(0);
  });

  it('drops off-topic items from general feeds but keeps pre-filtered ones', () => {
    const offTopic = { url: 'https://example.com/food/sourdough', title: 'Twelve sourdough bread recipes for the weekend' };
    const result = normalizeCandidates(
      [
        candidate({ sourceId: 'arstechnica', externalId: 'a1', ...offTopic }),
        candidate({ sourceId: 'techcrunch', externalId: 't1', ...offTopic, url: 'https://example.com/food/sourdough-2', preFiltered: true }),
        candidate({ sourceId: 'arstechnica', externalId: 'a2' }),
      ],
      metas,
    );
    expect(result.offTopic).toBe(1);
    expect(result.items.map((i) => i.externalId)).toEqual(['t1', 'a2']);
  });

  it('sanitises markup out of titles and descriptions', () => {
    const { items } = normalizeCandidates(
      [candidate({ title: 'A <b>local</b> LLM&nbsp;runner', description: '<p>Runs models</p><script>steal()</script>' })],
      metas,
    );
    expect(items[0].title).toBe('A local LLM runner');
    expect(items[0].description).toBe('Runs models');
  });

  it('marks a source as primary only for items it actually hosts', () => {
    const { items } = normalizeCandidates([hnLinkToRepo({ primary: true }), githubHit()], metas);
    const hn = items.find((i) => i.sourceId === 'hackernews');
    const gh = items.find((i) => i.sourceId === 'github');
    expect(hn?.primary).toBe(false);
    expect(hn?.refUrl).toBe('https://news.ycombinator.com/item?id=4001');
    expect(gh?.primary).toBe(true);
    expect(hn?.key).toBe('github:acme/vexdb');
    expect(gh?.key).toBe('github:acme/vexdb');
  });
});

describe('groupCandidates', () => {
  it('collapses a Hacker News link and a GitHub search hit into one group led by GitHub', () => {
    const groups = group([hnLinkToRepo(), githubHit()]);
    expect(groups).toHaveLength(1);
    const g = groups[0];
    expect(g.key).toBe('github:acme/vexdb');
    expect(g.kind).toBe('repository');
    expect(g.members).toHaveLength(2);
    expect(g.lead.sourceId).toBe('github');
    expect(g.lead.primary).toBe(true);
    expect(g.members.find((m) => m.sourceId === 'hackernews')?.primary).toBe(false);
    expect(g.title).toBe('Acme/VexDB');
    expect(g.claimType).toBe('project_release');
    // A repository is dated by its creation, not by when someone posted a link to it.
    expect(g.publishedAt?.toISOString()).toBe('2026-02-20T10:00:00.000Z');
  });

  it('keeps one copy when the same source returns an item twice', () => {
    const groups = group([githubHit({ points: 1200 }), githubHit({ points: 1240 }), githubHit({ points: 1100 })]);
    expect(groups).toHaveLength(1);
    expect(groups[0].members).toHaveLength(1);
    expect(groups[0].members[0].points).toBe(1240);
  });

  it('merges near-identical headlines from different outlets and keeps unrelated ones apart', () => {
    const published = new Date('2026-02-28T15:00:00Z');
    const groups = group([
      candidate({
        sourceId: 'arstechnica', externalId: 'ars-1', kindHint: 'article', publishedAt: published,
        url: 'https://arstechnica.com/ai/2026/02/openai-gpt-5-reasoning',
        title: 'OpenAI releases GPT-5 model with improved reasoning capabilities',
      }),
      candidate({
        sourceId: 'techcrunch', externalId: 'tc-1', kindHint: 'article', publishedAt: new Date('2026-02-28T16:30:00Z'), preFiltered: true,
        url: 'https://techcrunch.com/2026/02/28/openai-gpt-5',
        title: 'OpenAI releases GPT-5 model with better reasoning capabilities',
      }),
      candidate({
        sourceId: 'theverge', externalId: 'verge-1', kindHint: 'article', publishedAt: published, preFiltered: true,
        url: 'https://www.theverge.com/2026/2/28/humanoid-robot-factory',
        title: 'Humanoid robot startup opens its first factory in Texas',
      }),
    ]);
    expect(groups).toHaveLength(2);
    const story = groups.find((g) => g.members.length === 2);
    expect(story?.members.map((m) => m.sourceId).sort()).toEqual(['arstechnica', 'techcrunch']);
    // The more reliable outlet leads and the group takes its identity.
    expect(story?.lead.sourceId).toBe('arstechnica');
    expect(story?.canonicalUrl).toBe('https://arstechnica.com/ai/2026/02/openai-gpt-5-reasoning');
    expect(groups.find((g) => g.members.length === 1)?.lead.sourceId).toBe('theverge');
  });

  it('merges an arXiv listing and its Hugging Face Papers page', () => {
    const groups = group([
      candidate({
        sourceId: 'hf-papers', externalId: '2501.01234', url: 'https://huggingface.co/papers/2501.01234',
        title: 'Sparse attention for long-context transformers', points: 42,
      }),
      candidate({
        sourceId: 'arxiv', externalId: '2501.01234v2', url: 'https://arxiv.org/abs/2501.01234v2',
        title: 'Sparse attention for long-context transformers', author: 'A. Researcher', primary: true,
        publishedAt: new Date('2026-02-25T00:00:00Z'),
      }),
    ]);
    expect(groups).toHaveLength(1);
    const g = groups[0];
    expect(g.key).toBe('arxiv:2501.01234');
    expect(g.kind).toBe('paper');
    expect(g.members).toHaveLength(2);
    expect(g.lead.sourceId).toBe('arxiv');
    expect(g.claimType).toBe('preprint');
    expect(g.category).toBe('research');
    expect(g.canonicalUrl).toBe('https://arxiv.org/abs/2501.01234');
  });

  describe('authorship', () => {
    it('does not take an author from a community thread', () => {
      const [g] = group([candidate({ sourceUrl: 'https://news.ycombinator.com/item?id=1001', author: 'throwaway_hn' })]);
      expect(g.lead.meta.group).toBe('community');
      expect(g.author).toBeNull();
      expect(g.authorVerified).toBe(false);
    });

    it('keeps the author stated by a publisher', () => {
      const [g] = group([
        candidate({
          sourceId: 'openai-news', externalId: 'oa-1', url: 'https://openai.com/news/a-new-model', title: 'A new reasoning model',
          author: 'Jane Doe', primary: true, preFiltered: true, kindHint: 'article',
        }),
      ]);
      expect(g.author).toBe('Jane Doe');
      expect(g.authorVerified).toBe(true);
    });

    it('uses the repository owner, not the person who posted the link', () => {
      const [g] = group([hnLinkToRepo(), githubHit()]);
      expect(g.author).toBe('Acme');
      expect(g.authorVerified).toBe(true);
    });

    it('leaves the author empty when a repository is only known through a thread', () => {
      const [g] = group([hnLinkToRepo()]);
      expect(g.kind).toBe('repository');
      expect(g.author).toBeNull();
      expect(g.authorVerified).toBe(false);
    });
  });
});

describe('sameStory', () => {
  const at = (iso: string) => new Date(iso);
  const a = { title: 'OpenAI releases GPT-5 model with improved reasoning capabilities', publishedAt: at('2026-02-28T15:00:00Z') };

  it('matches near-identical headlines', () => {
    expect(sameStory(a, { title: 'OpenAI releases GPT-5 model with better reasoning capabilities', publishedAt: at('2026-02-28T20:00:00Z') })).toBe(true);
  });

  it('does not match unrelated headlines', () => {
    expect(sameStory(a, { title: 'Humanoid robot startup opens its first factory in Texas', publishedAt: at('2026-02-28T15:00:00Z') })).toBe(false);
  });

  it('does not match the same headline published more than four days apart', () => {
    expect(sameStory(a, { ...a, publishedAt: at('2026-03-06T15:00:00Z') })).toBe(false);
  });

  it('does not match headlines too short to compare', () => {
    expect(sameStory({ title: 'GPT-5 released', publishedAt: null }, { title: 'GPT-5 released', publishedAt: null })).toBe(false);
  });
});

describe('classify', () => {
  const base = { description: '', tags: [] as string[], kind: 'article' as const, group: 'news' as const, sourceId: 'arstechnica' };

  it.each([
    ['A humanoid robot that folds laundry', 'robotics'],
    ['LangGraph workflows for multi-agent systems', 'agents'],
    ['Doom running in the browser via WebAssembly', 'gaming-browser'],
    ['Text-to-video diffusion with consistent characters', 'creative'],
    ['Quantized GGUF builds of an open-weights language model', 'llms'],
    ['A faster Postgres CLI written in Rust', 'dev-tools'],
    ['An OCR service for scanned invoices', 'ai-tools'],
    ['A self-hosted alternative to Google Photos', 'open-source'],
    ['Payments startup raises a seed round', 'launches'],
  ])('"%s" is %s', (title, expected) => {
    expect(classify({ ...base, title }).category).toBe(expected);
  });

  it('falls back to open-source for a repository with no topical cue', () => {
    expect(classify({ ...base, title: 'acme/tidy', description: 'Keeps folders neat', kind: 'repository', group: 'github', sourceId: 'github' }).category).toBe('open-source');
  });

  it('files papers under research unless they are about robots', () => {
    const paper = { ...base, kind: 'paper' as const, group: 'research' as const, sourceId: 'arxiv' };
    expect(classify({ ...paper, title: 'Efficient fine-tuning of language models' }).category).toBe('research');
    expect(classify({ ...paper, title: 'Learning dexterous manipulation for humanoid robots' }).category).toBe('robotics');
  });

  it('files Product Hunt items under launches and models under LLMs', () => {
    expect(classify({ ...base, title: 'An AI agent for spreadsheets', kind: 'product', group: 'community', sourceId: 'producthunt' }).category).toBe('launches');
    expect(classify({ ...base, title: 'acme/tiny-speech', kind: 'model', group: 'research', sourceId: 'hf-models' }).category).toBe('llms');
  });

  it('slugs source tags, drops registry-style ones and adds rule tags', () => {
    const { tags } = classify({ ...base, title: 'A browser automation agent', tags: ['Browser Automation', 'license:mit', 'arxiv:2501.01234', 'browser_automation'] });
    expect(tags).toContain('browser-automation');
    expect(tags).toContain('agents');
    expect(tags.filter((t) => t === 'browser-automation')).toHaveLength(1);
    expect(tags.some((t) => t.includes('license') || t.includes('arxiv'))).toBe(false);
  });
});

describe('detectExecutionMode', () => {
  it.each([
    ['A Game Boy emulator you can open in a tab', 'emulation'],
    ['Boots Windows 95 in a virtual machine using v86', 'emulation'],
    ['Play your Steam library through cloud gaming', 'cloud_streaming'],
    ['The game is streamed from a GPU server over WebRTC', 'cloud_streaming'],
    ['Connects to your PC over remote desktop', 'remote_desktop'],
    ['A VNC client written in TypeScript', 'remote_desktop'],
    ['A world model that predicts the next frame of Minecraft', 'ai_generated'],
    ['Every frame is generated by a diffusion network', 'ai_generated'],
    ['Quake ported to WebAssembly', 'native'],
    ['A native port built by static recompilation', 'native'],
  ] as const)('"%s" is %s', (text, mode) => {
    expect(detectExecutionMode(text)?.mode).toBe(mode);
  });

  it('returns the matched phrase so it can be quoted', () => {
    expect(detectExecutionMode('Quake ported to WebAssembly')).toEqual({ mode: 'native', cue: 'ported to WebAssembly' });
  });

  it('prefers the description over documentation text', () => {
    const description = 'Quake compiled to WebAssembly';
    const docs = 'Unlike projects that rely on an emulator such as DOSBox, this build needs no virtual machine.';
    expect(detectExecutionMode(description, docs)?.mode).toBe('native');
  });

  it('falls back to documentation when the description says nothing', () => {
    expect(detectExecutionMode('A classic racing game', 'The original binary runs under QEMU.')?.mode).toBe('emulation');
  });

  it('returns null when nothing is stated', () => {
    expect(detectExecutionMode('A classic racing game in a tab', 'Install the dependencies and open the page.')).toBeNull();
    expect(detectExecutionMode()).toBeNull();
  });
});
