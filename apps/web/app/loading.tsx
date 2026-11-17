import { Skeleton } from '@/components/ui';

/**
 * App-wide loading shell so navigations never flash an empty screen.
 *
 * Heights stay at or above the base `h-4` so the utility order in the compiled
 * stylesheet cannot silently shrink a placeholder.
 */
export default function Loading() {
  return (
    <div className="relative isolate mx-auto w-full max-w-7xl" role="status" aria-live="polite">
      <span className="sr-only">Loading</span>
      <span aria-hidden="true" className="pointer-events-none absolute inset-0 -z-10 overflow-hidden">
        <span className="grid-fade absolute inset-x-0 top-0 h-48 opacity-50" />
        <span className="orb right-0 top-0 h-56 w-56 bg-brand-500/15" />
      </span>

      <div className="relative mb-6 flex flex-wrap items-end justify-between gap-4">
        <div className="w-full max-w-md">
          <Skeleton className="mb-3 h-4 w-24" />
          <Skeleton className="mb-3 h-7 w-3/5" />
          <Skeleton className="h-4 w-4/5" />
        </div>
        <Skeleton className="h-10 w-28 rounded-full" />
      </div>

      <div className="relative grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="panel space-y-3 p-4">
            <Skeleton className="h-5 w-2/5" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-4/5" />
          </div>
        ))}
      </div>
    </div>
  );
}
