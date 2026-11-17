import { cn } from '@/lib/format';

/**
 * The Nova brand mark: a gradient prism. Kept as one component so the logo is
 * identical in the header, the footer and any future surface, and so the only
 * place the mark's geometry lives is here.
 */
export function BrandMark({ size = 34, className }: { size?: number; className?: string }) {
  return (
    <span
      className={cn(
        'relative grid shrink-0 place-items-center rounded-[0.85rem] bg-gradient-to-br from-brand-500 via-brand-600 to-accent-2 text-white shadow-glow-sm',
        className,
      )}
      style={{ width: size, height: size }}
      aria-hidden="true"
    >
      <svg viewBox="0 0 24 24" width={size * 0.6} height={size * 0.6} fill="none">
        <path
          d="M12 2.6 20 7.2v9.6L12 21.4 4 16.8V7.2L12 2.6Z"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinejoin="round"
          opacity="0.85"
        />
        <path d="M12 7.4 16.2 9.8v4.4L12 16.6 7.8 14.2V9.8L12 7.4Z" fill="currentColor" />
      </svg>
    </span>
  );
}

/** The wordmark: plain name with a gradient "Pro". */
export function Wordmark({ className }: { className?: string }) {
  return (
    <span className={cn('font-display text-[1.05rem] font-bold tracking-[-0.02em]', className)}>
      ExamDump
      <span className="gradient-text"> Pro</span>
    </span>
  );
}
