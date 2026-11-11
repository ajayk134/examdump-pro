/**
 * Small, dependency-free helpers for device-local UI state: recent exams and
 * bookmark shortcuts. These are convenience caches only — the authoritative
 * bookmark list still lives in the database via the API.
 */

const RECENTS_KEY = 'examdump:recent-exams';
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
