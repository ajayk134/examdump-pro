import type { ContentItem } from '@/lib/types';
import { cn } from '@/lib/format';

/**
 * Renders a question stem or answer option.
 *
 * Text keeps its original line breaks, and images can be made expandable by
 * passing `onImage` — the exam interface uses that to open a full-size viewer
 * without losing the answers already chosen.
 */
export function QuestionContent({
  items,
  className,
  onImage,
}: {
  items: ContentItem[];
  className?: string;
  onImage?: (src: string) => void;
}) {
  if (!items || items.length === 0) return null;
  return (
    <div className={className}>
      {items.map((item, index) => {
        if (item.type === 'text') {
          return (
            <span key={index} className="whitespace-pre-wrap">
              {item.value}
            </span>
          );
        }
        if (item.type === 'break') {
          return <br key={index} />;
        }
        if (item.type === 'image' && item.src) {
          const image = (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={item.src}
              alt="Question diagram"
              loading="lazy"
              referrerPolicy="no-referrer"
              className={cn(
                'my-3 max-h-80 w-auto max-w-full rounded-xl border border-surface-border bg-white object-contain p-1',
                onImage && 'transition-transform duration-200 group-hover:scale-[1.01]',
              )}
            />
          );
          if (!onImage) return <span key={index}>{image}</span>;
          return (
            <button
              key={index}
              type="button"
              onClick={() => onImage(item.src!)}
              className="group relative block max-w-full cursor-zoom-in rounded-xl text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
              aria-label="Open this diagram full size"
            >
              {image}
              <span className="pointer-events-none absolute right-2 top-2 inline-flex items-center gap-1 rounded-full bg-slate-950/70 px-2 py-1 text-[0.625rem] font-semibold text-white opacity-0 backdrop-blur transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
                Expand
              </span>
            </button>
          );
        }
        return null;
      })}
    </div>
  );
}