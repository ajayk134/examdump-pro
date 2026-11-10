import {
  normalizeQuestion,
  type NormalizedQuestion,
  type RawQuestion,
} from '@examdump/shared';
import { TtlCache } from './cache.js';
import type {
  DatasetConfig,
  ExamSummary,
  ProviderExams,
  ProviderSummary,
} from './types.js';

export class DatasetError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
  ) {
    super(message);
    this.name = 'DatasetError';
  }
}

const cleanExamKey = (key: string): string => key.split('__')[0] ?? key;

const slugify = (value: string): string =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120);

export class DatasetClient {
  private readonly cache: TtlCache;
  private readonly fetchImpl: typeof fetch;
  private readonly baseUrl: string;
  private providersPromise?: Promise<ProviderSummary[]>;

  constructor(private readonly config: DatasetConfig) {
    this.cache = new TtlCache((config.cacheTtlSeconds ?? 300) * 1000, config.maxCacheEntries ?? 400);
    this.fetchImpl = config.fetchImpl ?? fetch;
    this.baseUrl =
      config.baseUrl ?? `https://raw.githubusercontent.com/${config.owner}/${config.repo}/${config.branch}`;
  }

  get branch(): string {
    return this.config.branch;
  }

  clearCache(): void {
    this.cache.clear();
    this.providersPromise = undefined;
  }

  private pathSegments(...segments: string[]): string {
    return segments.map((s) => encodeURIComponent(s)).join('/');
  }

  private async fetchJson<T>(relativePath: string): Promise<T> {
    const cacheKey = `${this.config.branch}:${relativePath}`;
    const cached = this.cache.get(cacheKey);
    if (cached !== undefined) return cached as T;

    const url = `${this.baseUrl}/${relativePath.replace(/^\/+/, '')}`;
    const headers: Record<string, string> = {
      Accept: 'application/json',
      'User-Agent': 'examdump-pro-data-client',
    };
    if (this.config.token) headers.Authorization = `Bearer ${this.config.token}`;

    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        headers,
        signal: AbortSignal.timeout(15_000),
      });
    } catch (err) {
      throw new DatasetError(
        `Dataset request failed: ${(err as Error).message}`,
        502,
        'DATASET_UNREACHABLE',
      );
    }

    if (response.status === 404) {
      throw new DatasetError('Dataset resource not found', 404, 'DATASET_NOT_FOUND');
    }
    if (!response.ok) {
      throw new DatasetError(
        `Dataset upstream responded ${response.status}`,
        502,
        'DATASET_UPSTREAM_ERROR',
      );
    }

    const json = (await response.json()) as T;
    this.cache.set(cacheKey, json);
    return json;
  }

  async getProviders(): Promise<ProviderSummary[]> {
    if (!this.providersPromise) {
      this.providersPromise = this.loadProviders().catch((err) => {
        this.providersPromise = undefined;
        throw err;
      });
    }
    return this.providersPromise;
  }

  private async loadProviders(): Promise<ProviderSummary[]> {
    const index = await this.fetchJson<Record<string, { file?: string; title?: string }>>(
      this.pathSegments('data', 'index.json'),
    );
    return Object.entries(index)
      .map(([id, meta]) => {
        const title = meta.title?.trim() || id;
        return {
          id,
          file: meta.file || id,
          title,
          slug: slugify(id),
        } satisfies ProviderSummary;
      })
      .sort((a, b) => a.title.localeCompare(b.title));
  }

  async getProvider(providerId: string): Promise<ProviderSummary> {
    const providers = await this.getProviders();
    const found = providers.find((p) => p.id === providerId || p.slug === providerId);
    if (!found) {
      throw new DatasetError('Provider not found', 404, 'PROVIDER_NOT_FOUND');
    }
    return found;
  }

  async getProviderExams(providerId: string): Promise<ProviderExams> {
    const provider = await this.getProvider(providerId);
    const raw = await this.fetchJson<Record<string, Record<string, number>>>(
      this.pathSegments('data', provider.file, 'exams.json'),
    );
    // Provider key inside the file can differ from the index key on masked branches.
    const providerEntry = raw[provider.id] ?? Object.values(raw)[0] ?? {};

    const exams: ExamSummary[] = Object.entries(providerEntry)
      .map(([key, count]) => {
        const code = cleanExamKey(key);
        return {
          key,
          code,
          title: code,
          providerId: provider.id,
          questionCount: Number(count) || 0,
        } satisfies ExamSummary;
      })
      .sort((a, b) => a.title.localeCompare(b.title));

    return { provider, exams };
  }

  async getExamQuestions(
    providerId: string,
    examKey: string,
  ): Promise<{ provider: ProviderSummary; exam: ExamSummary; questions: NormalizedQuestion[] }> {
    const { provider, exams } = await this.getProviderExams(providerId);
    const summary = exams.find((e) => e.key === examKey || e.code === examKey);
    if (!summary) {
      throw new DatasetError('Exam not found', 404, 'EXAM_NOT_FOUND');
    }

    const raw = await this.fetchJson<Record<string, Record<string, RawQuestion>>>(
      this.pathSegments('data', provider.file, `${summary.key}.json`),
    );
    const rawQuestions = raw[summary.key] ?? Object.values(raw)[0];
    if (!rawQuestions || typeof rawQuestions !== 'object') {
      throw new DatasetError('Exam data malformed', 502, 'EXAM_DATA_MALFORMED');
    }

    const questions = Object.entries(rawQuestions)
      .map(([id, q]) => normalizeQuestion(id, q))
      .sort((a, b) => {
        if (a.number !== null && b.number !== null) return a.number - b.number;
        return a.id.localeCompare(b.id, undefined, { numeric: true });
      });

    return { provider, exam: { ...summary, questionCount: questions.length }, questions };
  }

  async getQuestion(
    providerId: string,
    examKey: string,
    questionId: string,
  ): Promise<{ provider: ProviderSummary; exam: ExamSummary; question: NormalizedQuestion }> {
    const { provider, exam, questions } = await this.getExamQuestions(providerId, examKey);
    const question = questions.find((q) => q.id === questionId);
    if (!question) {
      throw new DatasetError('Question not found', 404, 'QUESTION_NOT_FOUND');
    }
    return { provider, exam, question };
  }
}