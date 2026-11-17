/**
 * Small, dependency-free helpers for device-local UI state: recent exams and
 * bookmark shortcuts. These are convenience caches only — the authoritative
 * bookmark list still lives in the database via the API.
 */

const RECENTS_KEY = 'examdump:recent-exams';
const RECENT_DETAIL_KEY = 'examdump:recent-exam-detail';
const BOOKMARK_KEY = 'examdump:exam-bookmarks';
const MAX_RECENTS = 8;

function readList(key: string): string[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : [];
  } catch {
    return [];
  }
}

function writeList(key: string, value: string[]): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* private mode or quota exceeded — non-critical */
  }
}

/** Identifier shared by recents and bookmark shortcuts. */
export function examId(providerId: string, examKey: string): string {
  return `${providerId}:${examKey}`;
}

export function getRecents(): string[] {
  return readList(RECENTS_KEY);
}

export function pushRecent(providerId: string, examKey: string): void {
  const id = examId(providerId, examKey);
  const next = [id, ...readList(RECENTS_KEY).filter((v) => v !== id)].slice(0, MAX_RECENTS);
  writeList(RECENTS_KEY, next);
}

/**
 * Recent exams with enough metadata to render them without a round trip.
 *
 * The selector and the dashboard show "continue" shortcuts before any network
 * request resolves, so the id list alone is not enough.
 */
export interface RecentExam {
  providerId: string;
  examKey: string;
  code: string;
  title: string;
  providerTitle: string;
  questionCount: number;
}

export function getRecentExams(): RecentExam[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(RECENT_DETAIL_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as RecentExam[];
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (item): item is RecentExam =>
          Boolean(item) &&
          typeof item.providerId === 'string' &&
          typeof item.examKey === 'string' &&
          typeof item.code === 'string',
      )
      .slice(0, MAX_RECENTS);
  } catch {
    return [];
  }
}

export function pushRecentExam(exam: RecentExam): void {
  pushRecent(exam.providerId, exam.examKey);
  if (typeof window === 'undefined') return;
  try {
    const id = examId(exam.providerId, exam.examKey);
    const next = [exam, ...getRecentExams().filter((item) => examId(item.providerId, item.examKey) !== id)].slice(
      0,
      MAX_RECENTS,
    );
    window.localStorage.setItem(RECENT_DETAIL_KEY, JSON.stringify(next));
  } catch {
    /* non-critical */
  }
}

export function clearRecents(): void {
  writeList(RECENTS_KEY, []);
}

export const toggleExamBookmark = Object.assign(
  function list(): string[] {
    return readList(BOOKMARK_KEY);
  },
  {
    toggle(id: string): string[] {
      const current = readList(BOOKMARK_KEY);
      const next = current.includes(id) ? current.filter((v) => v !== id) : [id, ...current];
      writeList(BOOKMARK_KEY, next);
      return next;
    },
    has(id: string): boolean {
      return readList(BOOKMARK_KEY).includes(id);
    },
  },
);

/** Practice/attempt autosave so a refresh never loses in-progress work. */
export interface AutosaveSnapshot<T> {
  examId: string;
  savedAt: number;
  state: T;
}

const AUTOSAVE_PREFIX = 'examdump:autosave:';

export function saveAutosave<T>(key: string, state: T): void {
  if (typeof window === 'undefined') return;
  try {
    const payload: AutosaveSnapshot<T> = { examId: key, savedAt: Date.now(), state };
    window.localStorage.setItem(AUTOSAVE_PREFIX + key, JSON.stringify(payload));
  } catch {
    /* ignore quota errors */
  }
}

export function loadAutosave<T>(key: string, maxAgeMs = 1000 * 60 * 60 * 12): T | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(AUTOSAVE_PREFIX + key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as AutosaveSnapshot<T>;
    if (!parsed || typeof parsed.savedAt !== 'number') return null;
    if (Date.now() - parsed.savedAt > maxAgeMs) {
      window.localStorage.removeItem(AUTOSAVE_PREFIX + key);
      return null;
    }
    return parsed.state;
  } catch {
    return null;
  }
}

export function clearAutosave(key: string): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(AUTOSAVE_PREFIX + key);
  } catch {
    /* ignore */
  }
}

/* ------------------------------------------------------------------ */
/* Device preferences                                                  */
/* ------------------------------------------------------------------ */

const PREF_PREFIX = 'examdump:pref:';

function readPref(key: string): string | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage.getItem(PREF_PREFIX + key);
  } catch {
    return null;
  }
}

function writePref(key: string, value: string | null): void {
  if (typeof window === 'undefined') return;
  try {
    if (value === null) window.localStorage.removeItem(PREF_PREFIX + key);
    else window.localStorage.setItem(PREF_PREFIX + key, value);
  } catch {
    /* private mode or quota exceeded — non-critical */
  }
}

/**
 * Questions-per-page choice. Kept per surface ("practice", "mock") so a
 * one-question drill does not force the simulator into the same layout.
 */
export function getPageSizePreference(scope: string): string | null {
  return readPref(`page-size:${scope}`);
}

export function setPageSizePreference(scope: string, size: string): void {
  writePref(`page-size:${scope}`, size);
}

/** Last AI tutor teaching mode the learner picked. */
export function getAiModePreference(): string | null {
  return readPref('ai-mode');
}

export function setAiModePreference(mode: string): void {
  writePref('ai-mode', mode);
}
