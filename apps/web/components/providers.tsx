'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { ApiError, get, post, refreshSession } from '@/lib/api';
import type { User } from '@/lib/types';

/* ----------------------------- Theme ----------------------------- */

type Theme = 'light' | 'dark' | 'system';

interface ThemeContextValue {
  theme: Theme;
  resolved: 'light' | 'dark';
  setTheme: (theme: Theme) => void;
  toggle: () => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);
const THEME_KEY = 'examdump-theme';

function applyTheme(theme: Theme): 'light' | 'dark' {
  const resolved =
    theme === 'system'
      ? window.matchMedia('(prefers-color-scheme: dark)').matches
        ? 'dark'
        : 'light'
      : theme;
  document.documentElement.classList.toggle('dark', resolved === 'dark');
  document.documentElement.style.colorScheme = resolved;
  return resolved;
}

function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>('system');
  const [resolved, setResolved] = useState<'light' | 'dark'>('dark');

  useEffect(() => {
    const stored = (localStorage.getItem(THEME_KEY) as Theme | null) ?? 'system';
    setThemeState(stored);
    setResolved(applyTheme(stored));
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const listener = () => {
      if ((localStorage.getItem(THEME_KEY) as Theme | null) === 'system') {
        setResolved(applyTheme('system'));
      }
    };
    mq.addEventListener('change', listener);
    return () => mq.removeEventListener('change', listener);
  }, []);

  const setTheme = useCallback((next: Theme) => {
    localStorage.setItem(THEME_KEY, next);
    setThemeState(next);
    setResolved(applyTheme(next));
  }, []);

  const toggle = useCallback(() => {
    setTheme(resolved === 'dark' ? 'light' : 'dark');
  }, [resolved, setTheme]);

  const value = useMemo(() => ({ theme, resolved, setTheme, toggle }), [theme, resolved, setTheme, toggle]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used within ThemeProvider');
  return ctx;
}

/* ----------------------------- Toasts ----------------------------- */

type ToastType = 'success' | 'error' | 'info';
interface Toast {
  id: number;
  type: ToastType;
  message: string;
}

interface ToastContextValue {
  toast: (message: string, type?: ToastType) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const counter = useRef(0);

  const toast = useCallback((message: string, type: ToastType = 'info') => {
    const id = ++counter.current;
    setToasts((prev) => [...prev, { id, type, message }]);
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 4500);
  }, []);

  const value = useMemo(() => ({ toast }), [toast]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 bottom-4 z-[100] flex flex-col items-center gap-2 px-4" aria-live="polite">
        {toasts.map((t) => (
          <div
            key={t.id}
            role="status"
            className={`pointer-events-auto w-full max-w-sm animate-fade-in rounded-xl border px-4 py-3 text-sm shadow-xl backdrop-blur ${
              t.type === 'success'
                ? 'border-emerald-400/40 bg-emerald-500/15 text-emerald-700 dark:text-emerald-200'
                : t.type === 'error'
                  ? 'border-rose-400/40 bg-rose-500/15 text-rose-700 dark:text-rose-200'
                  : 'border-surface-border bg-surface-raised/95 text-content-primary'
            }`}
          >
            {t.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used within ToastProvider');
  return ctx;
}

/* ----------------------------- Auth ----------------------------- */

interface AuthContextValue {
  user: User | null;
  loading: boolean;
  refresh: () => Promise<void>;
  setUser: (user: User | null) => void;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const data = await get<{ user: User }>('/auth/me');
      setUser(data.user);
    } catch (err) {
      // A 401 here usually means the 15-minute access cookie expired while the
      // refresh cookie is still valid, so try one silent refresh before
      // deciding the visitor is signed out. `get` already attempts this, but
      // handling it again keeps the state correct if only /auth/me failed.
      if (err instanceof ApiError && err.status === 401) {
        if (await refreshSession()) {
          try {
            const retried = await get<{ user: User }>('/auth/me');
            setUser(retried.user);
            return;
          } catch {
            /* fall through to signed-out */
          }
        }
      }
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Re-validate when the tab becomes visible again. Sessions can change while
  // the page is backgrounded (expiry, sign-out in another tab), and the old
  // behaviour left a stale user object on screen until a manual reload.
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible') void refresh();
    };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onVisible);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onVisible);
    };
  }, [refresh]);

  const logout = useCallback(async () => {
    try {
      await post('/auth/logout');
    } finally {
      setUser(null);
    }
  }, []);

  const value = useMemo(() => ({ user, loading, refresh, setUser, logout }), [user, loading, refresh, logout]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}

export function AppProviders({ children }: { children: ReactNode }) {
  return (
    <ThemeProvider>
      <ToastProvider>
        <AuthProvider>{children}</AuthProvider>
      </ToastProvider>
    </ThemeProvider>
  );
}