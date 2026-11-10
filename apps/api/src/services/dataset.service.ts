import { sql } from 'drizzle-orm';
import { DatasetClient, type ProviderSummary } from '@examdump/data-client';
import type { Env } from '../config/env.js';
import { getDb } from '../db/client.js';
import { catalogExams, catalogProviders } from '../db/schema/index.js';

let client: DatasetClient | null = null;
let clientKey = '';
let injected = false;

export function createDatasetClient(env: Env): DatasetClient {
  return new DatasetClient({
    owner: env.DATASET_OWNER,
    repo: env.DATASET_REPO,
    branch: env.DATASET_BRANCH,
    token: env.GITHUB_TOKEN,
    cacheTtlSeconds: env.DATASET_CACHE_TTL_SECONDS,
    maxCacheEntries: 400,
  });
}

export function getDatasetClient(env: Env): DatasetClient {
  if (injected && client) return client;
  const key = `${env.DATASET_OWNER}/${env.DATASET_REPO}@${env.DATASET_BRANCH}:${Boolean(env.GITHUB_TOKEN)}`;
  if (!client || clientKey !== key) {
    client = createDatasetClient(env);
    clientKey = key;
  }
  return client;
}

/** Test seam: inject a deterministic dataset client. */
export function setDatasetClientForTests(instance: DatasetClient | null): void {
  client = instance;
  clientKey = instance ? 'test' : '';
  injected = Boolean(instance);
}

export function resetDatasetClient(): void {
  client = null;
  clientKey = '';
  injected = false;
}

const mapWithConcurrency = async <T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> => {
  const results: R[] = new Array(items.length);
  let index = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (index < items.length) {
      const current = index++;
      results[current] = await fn(items[current] as T);
    }
  });
  await Promise.all(workers);
  return results;
};

export interface SyncResult {
  providers: number;
  exams: number;
  durationMs: number;
  errors: string[];
}

function examSlug(providerSlug: string, code: string): string {
  return `${providerSlug}-${code}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 140);
}

/**
 * Pull provider/exam metadata from GitHub into PostgreSQL so discovery and
 * search are fast. Question bodies are intentionally never copied into the DB.
 */
export async function syncDatasetCatalog(
  env: Env,
  logger?: { info: Function; warn: Function },
): Promise<SyncResult> {
  const start = Date.now();
  const db = getDb();
  const dataset = getDatasetClient(env);
  dataset.clearCache();

  const providers: ProviderSummary[] = await dataset.getProviders();
  const errors: string[] = [];
  let examCount = 0;

  await mapWithConcurrency(providers, 8, async (provider) => {
    try {
      const { exams } = await dataset.getProviderExams(provider.id);
      examCount += exams.length;

      await db
        .insert(catalogProviders)
        .values({
          providerId: provider.id,
          file: provider.file,
          title: provider.title,
          slug: provider.slug,
          examCount: exams.length,
          totalQuestions: exams.reduce((sum, e) => sum + e.questionCount, 0),
          syncedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: catalogProviders.providerId,
          set: {
            file: provider.file,
            title: provider.title,
            slug: provider.slug,
            examCount: exams.length,
            totalQuestions: exams.reduce((sum, e) => sum + e.questionCount, 0),
            syncedAt: new Date(),
            updatedAt: new Date(),
          },
        });

      if (exams.length > 0) {
        await db
          .insert(catalogExams)
          .values(
            exams.map((exam) => ({
              providerId: provider.id,
              providerTitle: provider.title,
              providerSlug: provider.slug,
              key: exam.key,
              code: exam.code,
              title: exam.title,
              slug: examSlug(provider.slug, exam.code),
              questionCount: exam.questionCount,
              syncedAt: new Date(),
            })),
          )
          .onConflictDoUpdate({
            target: [catalogExams.providerId, catalogExams.key],
            set: {
              providerTitle: sql`excluded.provider_title`,
              providerSlug: sql`excluded.provider_slug`,
              code: sql`excluded.code`,
              title: sql`excluded.title`,
              slug: sql`excluded.slug`,
              questionCount: sql`excluded.question_count`,
              syncedAt: sql`excluded.synced_at`,
              updatedAt: new Date(),
            },
          });
      }
    } catch (err) {
      errors.push(`${provider.id}: ${(err as Error).message}`);
      logger?.warn({ provider: provider.id, err }, 'dataset.sync_provider_failed');
    }
  });

  const durationMs = Date.now() - start;
  logger?.info(
    { providers: providers.length, exams: examCount, durationMs, errors: errors.length },
    'dataset.sync_complete',
  );
  return { providers: providers.length, exams: examCount, durationMs, errors };
}
