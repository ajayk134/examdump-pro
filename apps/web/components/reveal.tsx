'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { cn } from '@/lib/format';

/**
 * Fades a section in as it scrolls into view.
 *
 * The element starts hidden via the `.reveal` class and gains `.reveal-in` once
 * an IntersectionObserver fires. It degrades safely: with no observer support,
 * or reduced-motion, globals.css renders `.reveal` fully visible, so content is
 * never trapped behind an animation that did not run.
 */
export function Reveal({
  children,
  className,
  delay = 0,
}: {
  children: ReactNode;
  className?: string;
  delay?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [shown, setShown] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === 'undefined') {
      setShown(true);
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setShown(true);
            io.disconnect();
          }
        }
      },
      { rootMargin: '0px 0px -8% 0px', threshold: 0.12 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <div
      ref={ref}
      className={cn('reveal', shown && 'reveal-in', className)}
      style={delay ? { transitionDelay: `${delay}ms` } : undefined}
    >
      {children}
    </div>
  );
}
