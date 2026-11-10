export interface DatasetConfig {
  owner: string;
  repo: string;
  branch: string;
  token?: string;
  cacheTtlSeconds?: number;
  maxCacheEntries?: number;
  fetchImpl?: typeof fetch;
  /** Optional base URL override for tests / GitHub Enterprise. */
  baseUrl?: string;
}

export interface ProviderSummary {
  /** Stable provider id from data/index.json. */
  id: string;
  /** Directory/file name used to fetch provider data. */
  file: string;
  title: string;
  slug: string;
}

export interface ExamSummary {
  /** Full dataset key, e.g. `200-301` or `200-301__25a1158c9a2fb678`. */
  key: string;
  /** Human exam code/title, e.g. `200-301`. */
  code: string;
  title: string;
  providerId: string;
  questionCount: number;
}

export interface ProviderExams {
  provider: ProviderSummary;
  exams: ExamSummary[];
}

export interface ExamDataset {
  provider: ProviderSummary;
  exam: ExamSummary;
  /** Normalised raw questions keyed by dataset question id. */
  questions: unknown;
}