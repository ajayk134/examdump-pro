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

export interface VisibilityState {
  /** Whether the provider/exam exists in the synced catalogue. */
  known: boolean;
  /** Effective visibility: false when the exam or its provider is disabled. */
  visible: boolean;
}

interface VisibilityOptions {
  /** Admin consoles see disabled rows so they can be toggled back on. */
  includeDisabled?: boolean;
}

/**
 * Effective exam visibility. An exam is hidden when either the exam itself or
 * its owning provider is disabled, so disabling a provider hides every exam
 * under it without rewriting per-exam state.
 */
const providerVisible = sql`not exists (
  select 1 from ${catalogProviders}
  where ${catalogProviders.providerId} = ${catalogExams.providerId}
    and ${catalogProviders.enabled} = false
)`;

/**
 * SQL conditions that keep hidden exams out of any discovery query: the exam
 * itself must be enabled and its provider must not be disabled.
 */
export function visibleExamConditions(): SQL[] {
  return [eq(catalogExams.enabled, true), providerVisible];
}

export async function listProviders(options: VisibilityOptions = {}): Promise<CatalogProvider[]> {
  const db = getDb();
  return db
    .select()
    .from(catalogProviders)
    .where(options.includeDisabled ? undefined : eq(catalogProviders.enabled, true))
    .orderBy(asc(catalogProviders.title));
}

/** True once the catalogue has ever been synced, even if every row is hidden. */
export async function hasCatalogProviders(): Promise<boolean> {
  const db = getDb();
  const [row] = await db.select({ value: count() }).from(catalogProviders);
  return Number(row?.value ?? 0) > 0;
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
  // Hidden exams and exams under a disabled provider never surface in search.
  conditions.push(...visibleExamConditions());
  const where = and(...conditions);

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

export async function getProviderExamsFromCatalog(
  providerId: string,
  options: VisibilityOptions = {},
): Promise<CatalogExam[]> {
  const db = getDb();
  const conditions: SQL[] = [
    or(eq(catalogExams.providerId, providerId), eq(catalogExams.providerSlug, providerId))!,
  ];
  if (!options.includeDisabled) conditions.push(eq(catalogExams.enabled, true));

  return db
    .select()
    .from(catalogExams)
    .where(and(...conditions))
    .orderBy(asc(catalogExams.title));
}

export async function getCatalogExam(
  providerId: string,
  examKey: string,
  options: VisibilityOptions = {},
): Promise<CatalogExam | null> {
  const db = getDb();
  const keyMatch = or(eq(catalogExams.key, examKey), eq(catalogExams.code, examKey))!;
  const conditions: SQL[] = [
    or(eq(catalogExams.providerId, providerId), eq(catalogExams.providerSlug, providerId))!,
    keyMatch,
  ];
  if (!options.includeDisabled) {
    conditions.push(eq(catalogExams.enabled, true));
    conditions.push(providerVisible);
  }

  const [row] = await db
    .select()
    .from(catalogExams)
    .where(and(...conditions))
    .limit(1);
  return row ?? null;
}

/** Effective visibility of a provider. Unknown providers are treated as visible. */
export async function getProviderVisibility(id: string): Promise<VisibilityState> {
  const db = getDb();
  const [row] = await db
    .select({ enabled: catalogProviders.enabled })
    .from(catalogProviders)
    .where(or(eq(catalogProviders.providerId, id), eq(catalogProviders.slug, id)))
    .limit(1);
  if (!row) return { known: false, visible: true };
  return { known: true, visible: row.enabled };
}

/** Effective visibility of one exam, accounting for its provider's switch. */
export async function getExamVisibility(
  providerId: string,
  examKey: string,
): Promise<VisibilityState> {
  const db = getDb();
  const keyMatch = or(eq(catalogExams.key, examKey), eq(catalogExams.code, examKey))!;
  const [row] = await db
    .select({ enabled: catalogExams.enabled, providerEnabled: catalogProviders.enabled })
    .from(catalogExams)
    .leftJoin(catalogProviders, eq(catalogProviders.providerId, catalogExams.providerId))
    .where(
      and(
        or(eq(catalogExams.providerId, providerId), eq(catalogExams.providerSlug, providerId))!,
        keyMatch,
      ),
    )
    .limit(1);
  if (!row) return { known: false, visible: true };
  return { known: true, visible: row.enabled && (row.providerEnabled ?? true) };
}

/* ------------------------------------------------------------------------ */
/* Admin management                                                         */
/* ------------------------------------------------------------------------ */

export interface AdminProviderView extends CatalogProvider {
  enabledExamCount: number;
}

export async function listProvidersForAdmin(): Promise<AdminProviderView[]> {
  const db = getDb();
  const providers = await db.select().from(catalogProviders).orderBy(asc(catalogProviders.title));
  const counts = await db
    .select({
      providerId: catalogExams.providerId,
      enabledExamCount: sql<number>`count(*) filter (where ${catalogExams.enabled})::int`,
    })
    .from(catalogExams)
    .groupBy(catalogExams.providerId);

  const countMap = new Map(counts.map((row) => [row.providerId, Number(row.enabledExamCount)]));
  return providers.map((provider) => ({
    ...provider,
    enabledExamCount: countMap.get(provider.providerId) ?? 0,
  }));
}

export async function listExamsForAdmin(providerId: string): Promise<CatalogExam[]> {
  return getProviderExamsFromCatalog(providerId, { includeDisabled: true });
}

export async function setProviderEnabled(
  providerId: string,
  enabled: boolean,
): Promise<CatalogProvider | null> {
  const db = getDb();
  const [row] = await db
    .update(catalogProviders)
    .set({ enabled, updatedAt: new Date() })
    .where(or(eq(catalogProviders.providerId, providerId), eq(catalogProviders.slug, providerId)))
    .returning();
  return row ?? null;
}

export async function setExamEnabled(
  providerId: string,
  examKey: string,
  enabled: boolean,
): Promise<CatalogExam | null> {
  const db = getDb();
  const [row] = await db
    .update(catalogExams)
    .set({ enabled, updatedAt: new Date() })
    .where(
      and(
        or(eq(catalogExams.providerId, providerId), eq(catalogExams.providerSlug, providerId))!,
        or(eq(catalogExams.key, examKey), eq(catalogExams.code, examKey))!,
      ),
    )
    .returning();
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
