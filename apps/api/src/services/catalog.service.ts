import { and, asc, count, desc, eq, ilike, or, sql } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';
import { getDb } from '../db/client.js';
import { catalogExams, catalogProviders, type CatalogExam, type CatalogProvider } from '../db/schema/index.js';
import { parsePage, paginate } from '../lib/pagination.js';

export interface SearchExamsParams {
  q?: string;
  provider?: string;
  sort?: 'popular' | 'title' | 'questions' | 'newest';
  page?: number;
  pageSize?: number;
}

export async function listProviders(): Promise<CatalogProvider[]> {
  const db = getDb();
  return db.select().from(catalogProviders).orderBy(asc(catalogProviders.title));
}

export async function getProviderById(id: string): Promise<CatalogProvider | null> {
  const db = getDb();
  const [row] = await db
    .select()
    .from(catalogProviders)
    .where(or(eq(catalogProviders.providerId, id), eq(catalogProviders.slug, id)))
    .limit(1);
  return row ?? null;
}

export async function searchExams(params: SearchExamsParams) {
  const db = getDb();
  const page = parsePage(params.page, params.pageSize);
  const conditions: SQL[] = [];

  if (params.provider) {
    conditions.push(
      or(eq(catalogExams.providerId, params.provider), eq(catalogExams.providerSlug, params.provider))!,
    );
  }
  if (params.q && params.q.trim()) {
    const term = `%${params.q.trim()}%`;
    conditions.push(
      or(
        ilike(catalogExams.title, term),
        ilike(catalogExams.code, term),
        ilike(catalogExams.providerTitle, term),
      )!,
    );
  }
  const where = conditions.length ? and(...conditions) : undefined;

  const orderBy =
    params.sort === 'title'
      ? asc(catalogExams.title)
      : params.sort === 'newest'
        ? desc(catalogExams.syncedAt)
        : desc(catalogExams.questionCount);

  const [items, [totalRow]] = await Promise.all([
    db.select().from(catalogExams).where(where).orderBy(orderBy).offset(page.skip).limit(page.limit),
    db.select({ value: count() }).from(catalogExams).where(where),
  ]);

  return paginate(items, Number(totalRow?.value ?? 0), page);
}

export async function getProviderExamsFromCatalog(providerId: string): Promise<CatalogExam[]> {
  const db = getDb();
  return db
    .select()
    .from(catalogExams)
    .where(or(eq(catalogExams.providerId, providerId), eq(catalogExams.providerSlug, providerId)))
    .orderBy(asc(catalogExams.title));
}

export async function getCatalogExam(providerId: string, examKey: string): Promise<CatalogExam | null> {
  const db = getDb();
  const keyMatch = or(eq(catalogExams.key, examKey), eq(catalogExams.code, examKey))!;
  const [row] = await db
    .select()
    .from(catalogExams)
    .where(
      and(
        or(eq(catalogExams.providerId, providerId), eq(catalogExams.providerSlug, providerId)),
        keyMatch,
      ),
    )
    .limit(1);
  return row ?? null;
}

export async function catalogCounts() {
  const db = getDb();
  const [[providers], [exams], [totals]] = await Promise.all([
    db.select({ value: count() }).from(catalogProviders),
    db.select({ value: count() }).from(catalogExams),
    db.select({ value: sql<number>`coalesce(sum(${catalogExams.questionCount}), 0)` }).from(catalogExams),
  ]);
  return {
    providers: Number(providers?.value ?? 0),
    exams: Number(exams?.value ?? 0),
    totalQuestions: Number(totals?.value ?? 0),
  };
}
