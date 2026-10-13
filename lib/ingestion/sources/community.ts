import { getJson, request } from '@/lib/utils/http';
import { parseDate, DAY } from '@/lib/utils/time';
import { plainText } from '@/lib/utils/text';
import { SourceSkipped, type CandidateInput, type SourceAdapter } from '../types';

interface HnHit {
  objectID: string;
  title?: string;
  url?: string | null;
  author?: string;
  points?: number | null;
  num_comments?: number | null;
  created_at_i?: number;
  story_text?: string | null;
  _tags?: string[];
}

/** Hacker News through the official Algolia search API. */
export const hackerNewsSource: SourceAdapter = {
  meta: { id: 'hackernews', name: 'Hacker News', group: 'community', reliability: 0.55, owner: 'hackernews', homepage: 'https://news.ycombinator.com' },
  async fetch(ctx) {
    const since = Math.floor((ctx.now.getTime() - 3 * DAY) / 1000);
    const searches = [
      { tags: 'show_hn', filters: `created_at_i>${since},points>30`, show: true },
      { tags: 'story', filters: `created_at_i>${since},points>120`, show: false },
    ];
    const out: CandidateInput[] = [];
    for (const s of searches) {
      const url = `https://hn.algolia.com/api/v1/search?tags=${s.tags}&numericFilters=${encodeURIComponent(s.filters)}&hitsPerPage=60`;
      const body = await getJson<{ hits?: HnHit[] }>(url, ctx.http);
      if (!Array.isArray(body.hits)) throw new Error('Hacker News response had no hits array');
      for (const h of body.hits) {
        if (!h?.objectID || !h.title) continue;
        const thread = `https://news.ycombinator.com/item?id=${h.objectID}`;
        out.push({
          sourceId: 'hackernews',
          externalId: String(h.objectID),
          url: h.url || thread,
          sourceUrl: thread,
          title: plainText(h.title.replace(/^(Show|Launch) HN:\s*/i, ''), 300),
          description: plainText(h.story_text, 1500),
          author: h.author ?? null,
          publishedAt: parseDate(h.created_at_i, ctx.now),
          kindHint: h.url ? undefined : 'post',
          claimType: s.show ? 'independent_experiment' : 'community_post',
          tags: s.show ? ['show-hn'] : [],
          points: typeof h.points === 'number' ? h.points : null,
          comments: typeof h.num_comments === 'number' ? h.num_comments : null,
        });
      }
    }
    return out;
  },
};

interface LobstersStory {
  short_id: string;
  title: string;
  url: string;
  created_at: string;
  score: number;
  comment_count: number;
  description_plain?: string;
  submitter_user?: string | { username?: string };
  user_is_author?: boolean;
  tags?: string[];
  short_id_url: string;
}

export const lobstersSource: SourceAdapter = {
  meta: { id: 'lobsters', name: 'Lobsters', group: 'community', reliability: 0.55, owner: 'lobsters', homepage: 'https://lobste.rs' },
  async fetch(ctx) {
    const stories = await getJson<LobstersStory[]>('https://lobste.rs/hottest.json', ctx.http);
    if (!Array.isArray(stories)) throw new Error('Lobsters response was not an array');
    return stories
      .filter((s) => s?.short_id && s.title && s.score >= 10)
      .map((s): CandidateInput => {
        const submitter = typeof s.submitter_user === 'string' ? s.submitter_user : s.submitter_user?.username;
        return {
          sourceId: 'lobsters',
          externalId: s.short_id,
          url: s.url || s.short_id_url,
          sourceUrl: s.short_id_url,
          title: plainText(s.title, 300),
          description: plainText(s.description_plain, 1500),
          author: s.user_is_author ? submitter ?? null : null,
          publishedAt: parseDate(s.created_at, ctx.now),
          claimType: 'community_post',
          tags: Array.isArray(s.tags) ? s.tags : [],
          points: s.score,
          comments: s.comment_count ?? null,
        };
      });
  },
};

const SUBREDDITS = ['LocalLLaMA', 'MachineLearning', 'selfhosted', 'robotics', 'SideProject'];

/**
 * Reddit is only read through its official OAuth API. Unauthenticated JSON
 * endpoints are blocked for automated clients and scraping them would break
 * Reddit's terms, so without credentials this source reports itself skipped.
 */
export const redditSource: SourceAdapter = {
  meta: { id: 'reddit', name: 'Reddit', group: 'community', reliability: 0.45, owner: 'reddit', homepage: 'https://www.reddit.com' },
  async fetch(ctx) {
    const { REDDIT_CLIENT_ID: id, REDDIT_CLIENT_SECRET: secret } = ctx.env;
    if (!id || !secret) throw new SourceSkipped('Reddit API credentials are not configured');
    const tokenRes = await request('https://www.reddit.com/api/v1/access_token', {
      ...ctx.http,
      method: 'POST',
      body: 'grant_type=client_credentials',
      headers: {
        authorization: `Basic ${Buffer.from(`${id}:${secret}`).toString('base64')}`,
        'content-type': 'application/x-www-form-urlencoded',
      },
    });
    const token = (JSON.parse(tokenRes.text) as { access_token?: string }).access_token;
    if (!token) throw new Error('Reddit did not return an access token');
    const out: CandidateInput[] = [];
    for (const sub of SUBREDDITS) {
      const listing = await getJson<{ data?: { children?: { data: Record<string, unknown> }[] } }>(
        `https://oauth.reddit.com/r/${sub}/top?t=day&limit=25&raw_json=1`,
        { ...ctx.http, headers: { authorization: `Bearer ${token}` } },
      );
      for (const child of listing.data?.children ?? []) {
        const p = child.data;
        if (!p?.id || !p.title || p.over_18 || p.stickied) continue;
        const thread = `https://www.reddit.com${String(p.permalink ?? '')}`;
        const external = typeof p.url === 'string' && !p.is_self ? p.url : thread;
        out.push({
          sourceId: 'reddit',
          externalId: String(p.id),
          url: external,
          sourceUrl: thread,
          title: plainText(String(p.title), 300),
          description: plainText(typeof p.selftext === 'string' ? p.selftext : '', 1500),
          author: null,
          publishedAt: parseDate(p.created_utc, ctx.now),
          kindHint: p.is_self ? 'post' : undefined,
          claimType: 'community_post',
          tags: [`r-${sub.toLowerCase()}`],
          points: typeof p.score === 'number' ? Math.max(0, p.score) : null,
          comments: typeof p.num_comments === 'number' ? p.num_comments : null,
        });
      }
    }
    return out;
  },
};
