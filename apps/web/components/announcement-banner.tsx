'use client';

import { useEffect, useState } from 'react';
import { get } from '@/lib/api';
import type { Announcement } from '@/lib/types';
import { IconX } from './icons';

const DISMISS_KEY = 'examdump-dismissed-announcements';

const TONE: Record<string, string> = {
  info: 'border-accent/40 bg-accent/[0.08] text-content-primary',
  success: 'border-positive/40 bg-positive/[0.08] text-content-primary',
  warning: 'border-caution/40 bg-caution/[0.08] text-content-primary',
  critical: 'border-negative/40 bg-negative/[0.08] text-content-primary',
};

function readDismissed(): string[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(DISMISS_KEY);
    return raw ? (JSON.parse(raw) as string[]) : [];
  } catch {
    return [];
  }
}

/**
 * Site-wide banners. Dismissals are stored locally per announcement id so a
 * new message always shows up again.
 */
export function AnnouncementBanner() {
  const [items, setItems] = useState<Announcement[]>([]);

  useEffect(() => {
    let cancelled = false;
    get<{ announcements: Announcement[] }>('/support/announcements')
      .then((data) => {
        if (cancelled) return;
        const dismissed = readDismissed();
        setItems(data.announcements.filter((a) => !dismissed.includes(a.id)).slice(0, 2));
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  function dismiss(id: string) {
    const next = [...readDismissed(), id];
    try {
      window.localStorage.setItem(DISMISS_KEY, JSON.stringify(next));
    } catch {
      /* storage may be unavailable */
    }
    setItems((prev) => prev.filter((a) => a.id !== id));
  }

  if (items.length === 0) return null;

  return (
    <div className="mx-auto w-full max-w-7xl px-4 pt-4 sm:px-6">
      {items.map((a) => (
        <div
          key={a.id}
          role="status"
          className={`mb-2 flex items-start justify-between gap-3 rounded-xl border px-4 py-3 text-sm ${TONE[a.level] ?? TONE.info}`}
        >
          <div>
            <p className="font-semibold">{a.title}</p>
            <p className="mt-0.5 opacity-90">{a.body}</p>
          </div>
          <button
            type="button"
            onClick={() => dismiss(a.id)}
            className="grid h-11 w-11 shrink-0 place-items-center rounded-lg transition-colors hover:bg-black/5 dark:hover:bg-white/10"
            aria-label="Dismiss announcement"
          >
            <IconX width={16} height={16} />
          </button>
        </div>
      ))}
    </div>
  );
}
