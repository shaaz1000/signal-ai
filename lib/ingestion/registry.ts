import { githubSource } from './sources/github';
import { hackerNewsSource, lobstersSource, redditSource } from './sources/community';
import { arxivSource, hfModelsSource, hfPapersSource, hfSpacesSource } from './sources/research';
import { FEEDS, feedSource } from './sources/rss';
import type { SourceAdapter, SourceMeta } from './types';

export const ADAPTERS: SourceAdapter[] = [
  githubSource,
  hackerNewsSource,
  lobstersSource,
  redditSource,
  arxivSource,
  hfPapersSource,
  hfModelsSource,
  hfSpacesSource,
  ...FEEDS.map(feedSource),
];

export const SOURCE_META: SourceMeta[] = ADAPTERS.map((a) => a.meta);

export function sourceMetaMap(adapters: SourceAdapter[] = ADAPTERS): Map<string, SourceMeta> {
  return new Map(adapters.map((a) => [a.meta.id, a.meta]));
}
