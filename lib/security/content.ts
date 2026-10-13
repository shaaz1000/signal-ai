/**
 * Storage for everything a model or translator produced. Records live in
 * `generated_content`, never in `discoveries`: generated text cannot
 * overwrite a verified source record. A record is addressed by the hash of
 * the source it was made from (`contentVersion`), so when the source changes
 * the old record simply stops matching. It is kept, not served.
 */
import { and, desc, eq } from 'drizzle-orm';
import type { Db } from '@/lib/db/client';
import { generatedContent } from '@/lib/db/schema';

export interface ContentIdentity {
  kind: string;
  subject: string;
  contentVersion: string;
  language: string;
  variant?: string;
  /** When both are given the lookup is exact; otherwise the newest record from any provider matches. */
  provider?: string;
  model?: string;
}

export interface StoredContent<T = unknown> {
  id: number;
  kind: string;
  subject: string;
  contentVersion: string;
  language: string;
  variant: string;
  provider: string;
  model: string;
  payload: T;
  createdAt: Date;
}

export const subjectOf = (discoveryId: string) => `discovery:${discoveryId}`;

export async function getCachedContent<T = unknown>(db: Db, identity: ContentIdentity): Promise<StoredContent<T> | null> {
  const [row] = await db
    .select()
    .from(generatedContent)
    .where(
      and(
        eq(generatedContent.kind, identity.kind),
        eq(generatedContent.subject, identity.subject),
        eq(generatedContent.contentVersion, identity.contentVersion),
        eq(generatedContent.language, identity.language),
        eq(generatedContent.variant, identity.variant ?? ''),
        identity.provider ? eq(generatedContent.provider, identity.provider) : undefined,
        identity.model ? eq(generatedContent.model, identity.model) : undefined,
      ),
    )
    .orderBy(desc(generatedContent.createdAt), desc(generatedContent.id))
    .limit(1);
  return (row as StoredContent<T> | undefined) ?? null;
}

export async function getContentById<T = unknown>(db: Db, id: number): Promise<StoredContent<T> | null> {
  const [row] = await db.select().from(generatedContent).where(eq(generatedContent.id, id)).limit(1);
  return (row as StoredContent<T> | undefined) ?? null;
}

/**
 * Stores a record and returns its id. Two users producing the same record at
 * the same moment collide on the identity index; the first one stands and
 * both get its id.
 */
export async function saveContent(
  db: Db,
  record: Required<Pick<ContentIdentity, 'kind' | 'subject' | 'contentVersion' | 'language' | 'provider' | 'model'>> & { variant?: string; payload: unknown; createdBy?: number | null },
): Promise<number> {
  const variant = record.variant ?? '';
  const inserted = await db
    .insert(generatedContent)
    .values({ ...record, variant, createdBy: record.createdBy ?? null })
    .onConflictDoNothing()
    .returning({ id: generatedContent.id });
  if (inserted.length) return inserted[0].id;
  const existing = await getCachedContent(db, { ...record, variant });
  if (!existing) throw new Error('Generated content could not be stored.');
  return existing.id;
}

/** Every stored record for a subject at one content version, newest first. */
export async function listContent(db: Db, input: { subject: string; contentVersion: string; language?: string }): Promise<StoredContent[]> {
  const rows = await db
    .select()
    .from(generatedContent)
    .where(
      and(
        eq(generatedContent.subject, input.subject),
        eq(generatedContent.contentVersion, input.contentVersion),
        input.language ? eq(generatedContent.language, input.language) : undefined,
      ),
    )
    .orderBy(desc(generatedContent.createdAt), desc(generatedContent.id))
    .limit(100);
  return rows as StoredContent[];
}
