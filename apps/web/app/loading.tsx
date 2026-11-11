import { Skeleton } from '@/components/ui';

/** App-wide loading shell so navigations never flash an empty screen. */
export default function Loading() {
  return (
    <div className="mx-auto w-full max-w-7xl" role="status" aria-live="polite">
      <span className="sr-only">Loading</span>
      <Skeleton className="mb-5 h-7 w-2/5" />
      <Skeleton className="mb-6 h-4 w-3/5" />
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-32 rounded-2xl" />
        ))}
      </div>
    </div>
  );
}
