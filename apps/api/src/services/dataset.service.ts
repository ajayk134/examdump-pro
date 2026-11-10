import { DatasetClient, type ProviderSummary } from '@examdump/data-client';
import type { Env } from '../config/env.js';
import { CatalogExam, CatalogProvider } from '../db/models/index.js';

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

/**
 * Pull provider/exam *metadata* from GitHub into MongoDB so discovery and search
 * are fast. Question bodies are intentionally never copied into the database.
 */
export async function syncDatasetCatalog(env: Env, logger?: { info: Function; warn: Function }): Promise<SyncResult> {
  const start = Date.now();
  const dataset = getDatasetClient(env);
  dataset.clearCache();

  const providers: ProviderSummary[] = await dataset.getProviders();
  const errors: string[] = [];
  let examCount = 0;

  const synced = await mapWithConcurrency(providers, 8, async (provider) => {
    try {
      const { exams } = await dataset.getProviderExams(provider.id);
      examCount += exams.length;
      await CatalogProvider.updateOne(
        { providerId: provider.id },
        {
          $set: {
            providerId: provider.id,
            file: provider.file,
            title: provider.title,
            slug: provider.slug,
            examCount: exams.length,
            totalQuestions: exams.reduce((sum, e) => sum + e.questionCount, 0),
            syncedAt: new Date(),
          },
        },
        { upsert: true },
      );

      if (exams.length > 0) {
        await CatalogExam.bulkWrite(
          exams.map((exam) => ({
            updateOne: {
              filter: { providerId: provider.id, key: exam.key },
              update: {
                $set: {
                  providerId: provider.id,
                  providerTitle: provider.title,
                  providerSlug: provider.slug,
                  key: exam.key,
                  code: exam.code,
                  title: exam.title,
                  slug: `${provider.slug}-${exam.code}`
                    .toLowerCase()
                    .replace(/[^a-z0-9]+/g, '-')
                    .replace(/^-+|-+$/g, '')
                    .slice(0, 140),
                  questionCount: exam.questionCount,
                  syncedAt: new Date(),
                },
              },
              upsert: true,
            },
          })),
          { ordered: false },
        );
      }
      return true;
    } catch (err) {
      errors.push(`${provider.id}: ${(err as Error).message}`);
      logger?.warn({ provider: provider.id, err }, 'dataset.sync_provider_failed');
      return false;
    }
  });

  const durationMs = Date.now() - start;
  logger?.info(
    { providers: providers.length, exams: examCount, durationMs, errors: errors.length },
    'dataset.sync_complete',
  );
  void synced;
  return { providers: providers.length, exams: examCount, durationMs, errors };
}