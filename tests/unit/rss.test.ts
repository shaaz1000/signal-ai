import { describe, expect, it } from 'vitest';
import { parseFeed } from '@/lib/ingestion/sources/rss';

const RSS = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:content="http://purl.org/rss/1.0/modules/content/">
  <channel>
    <title>Example Tech</title>
    <link>https://news.example.com</link>
    <item>
      <title><![CDATA[Open-weights model runs on a phone & fits in 2 GB]]></title>
      <link>https://news.example.com/2026/02/phone-model</link>
      <guid isPermaLink="false">example-guid-1</guid>
      <description><![CDATA[<p>A <b>small</b> language model was released today.</p>]]></description>
      <dc:creator><![CDATA[Jane Doe]]></dc:creator>
      <pubDate>Fri, 27 Feb 2026 08:30:00 GMT</pubDate>
      <category>AI</category>
      <category><![CDATA[Mobile]]></category>
    </item>
    <item>
      <title>Plain item without a guid</title>
      <link>https://news.example.com/2026/02/plain</link>
      <description>Short summary.</description>
      <author>editor@example.com (The Editor)</author>
    </item>
    <item>
      <title>No link on this one</title>
      <guid>orphan-guid</guid>
    </item>
    <item>
      <link>https://news.example.com/2026/02/untitled</link>
      <description>No title on this one.</description>
    </item>
  </channel>
</rss>`;

const ATOM = `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>Example Blog</title>
  <entry>
    <id>tag:blog.example.com,2026:post-1</id>
    <title type="html">Notes on WebGPU inference</title>
    <link rel="self" href="https://blog.example.com/feed/post-1.atom"/>
    <link rel="alternate" type="text/html" href="https://blog.example.com/2026/webgpu-inference"/>
    <summary>Running a transformer in the browser.</summary>
    <author><name>Sam Writer</name></author>
    <published>2026-02-26T10:00:00Z</published>
    <updated>2026-02-27T10:00:00Z</updated>
    <category term="webgpu"/>
    <category term="llm"/>
  </entry>
  <entry>
    <id>tag:blog.example.com,2026:post-2</id>
    <title>Single link entry</title>
    <link href="https://blog.example.com/2026/single-link"/>
    <content type="html">Body text used when there is no summary.</content>
    <updated>2026-02-25T10:00:00Z</updated>
  </entry>
  <entry>
    <id>tag:blog.example.com,2026:post-3</id>
    <title>Entry without any link</title>
  </entry>
  <entry>
    <id>tag:blog.example.com,2026:post-4</id>
    <link rel="alternate" href="https://blog.example.com/2026/untitled"/>
  </entry>
</feed>`;

describe('parseFeed', () => {
  describe('RSS 2.0', () => {
    const items = parseFeed(RSS);

    it('drops items that are missing a title or a link', () => {
      expect(items.map((i) => i.link)).toEqual([
        'https://news.example.com/2026/02/phone-model',
        'https://news.example.com/2026/02/plain',
      ]);
    });

    it('reads CDATA fields, dc:creator, guid and categories', () => {
      expect(items[0]).toEqual({
        id: 'example-guid-1',
        title: 'Open-weights model runs on a phone & fits in 2 GB',
        link: 'https://news.example.com/2026/02/phone-model',
        summary: '<p>A <b>small</b> language model was released today.</p>',
        author: 'Jane Doe',
        published: 'Fri, 27 Feb 2026 08:30:00 GMT',
        categories: ['AI', 'Mobile'],
      });
    });

    it('falls back to the link as id, <author> as author, and null for a missing date', () => {
      expect(items[1]).toMatchObject({
        id: 'https://news.example.com/2026/02/plain',
        author: 'editor@example.com (The Editor)',
        published: null,
        categories: [],
      });
    });

    it('handles a channel with a single item and an empty channel', () => {
      const single = parseFeed('<rss><channel><item><title>Only one</title><link>https://news.example.com/one</link></item></channel></rss>');
      expect(single).toHaveLength(1);
      expect(parseFeed('<rss><channel><title>Empty</title></channel></rss>')).toEqual([]);
    });
  });

  describe('Atom', () => {
    const items = parseFeed(ATOM);

    it('drops entries that are missing a title or a link', () => {
      expect(items.map((i) => i.title)).toEqual(['Notes on WebGPU inference', 'Single link entry']);
    });

    it('picks the rel=alternate link over other links', () => {
      expect(items[0]).toEqual({
        id: 'tag:blog.example.com,2026:post-1',
        title: 'Notes on WebGPU inference',
        link: 'https://blog.example.com/2026/webgpu-inference',
        summary: 'Running a transformer in the browser.',
        author: 'Sam Writer',
        published: '2026-02-26T10:00:00Z',
        categories: ['webgpu', 'llm'],
      });
    });

    it('uses the only link, the content and the updated date when that is all there is', () => {
      expect(items[1]).toMatchObject({
        link: 'https://blog.example.com/2026/single-link',
        summary: 'Body text used when there is no summary.',
        author: null,
        published: '2026-02-25T10:00:00Z',
      });
    });
  });

  it('throws on a response that is not XML', () => {
    expect(() => parseFeed('{"error":"rate limited"}')).toThrow('Feed response was not XML');
    expect(() => parseFeed('')).toThrow('Feed response was not XML');
  });

  it('throws on XML that is not a feed', () => {
    expect(() => parseFeed('<!doctype html><html><body><h1>Just a moment...</h1></body></html>')).toThrow('Unrecognised feed format');
    expect(() => parseFeed('<sitemapindex><sitemap><loc>https://example.com/a.xml</loc></sitemap></sitemapindex>')).toThrow('Unrecognised feed format');
  });
});
