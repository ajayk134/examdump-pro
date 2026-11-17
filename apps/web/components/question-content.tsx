import type { ContentItem } from '@/lib/types';
import { cn } from '@/lib/format';

/** Inline `code` spans inside a block of question text. */
function renderInline(value: string, key: string) {
  const parts = value.split(/(`[^`\n]+`)/g);
  return parts.map((part, index) => {
    if (part.startsWith('`') && part.endsWith('`') && part.length > 2) {
      return (
        <code
          key={`${key}-c${index}`}
          className="rounded bg-surface-sunken px-1 py-0.5 font-mono text-[0.92em] text-content-primary"
        >
          {part.slice(1, -1)}
        </code>
      );
    }
    return part ? <span key={`${key}-t${index}`}>{part}</span> : null;
  });
}

/**
 * Renders a question stem or answer option.
 *
 * Text keeps its original line breaks. Fenced blocks and inline backticks are
 * shown as monospace code so CLI output and configuration snippets stay
 * readable in a question; no HTML from the dataset is ever interpreted.
 * Images can be made expandable by passing `onImage` — the exam interface uses
 * that to open a full-size viewer without losing the answers already chosen.
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
          const value = item.value ?? '';
          // Even indexes are prose, odd indexes sit between ``` fences.
          const segments = value.split('```');
          return (
            <span key={index}>
              {segments.map((segment, segmentIndex) => {
                if (segmentIndex % 2 === 1) {
                  const code = segment.replace(/^[a-zA-Z0-9+#-]*\n/, '');
                  return (
                    <code
                      key={`code-${segmentIndex}`}
                      className="my-2 block max-w-full overflow-x-auto rounded-xl border border-surface-border bg-surface-sunken/70 px-3 py-2 font-mono text-[0.8125rem] leading-relaxed text-content-primary whitespace-pre"
                    >
                      {code}
                    </code>
                  );
                }
                return (
                  <span key={`text-${segmentIndex}`} className="whitespace-pre-wrap">
                    {renderInline(segment, `${index}-${segmentIndex}`)}
                  </span>
                );
              })}
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
                'my-3 max-h-72 w-auto max-w-full rounded-xl border border-surface-border bg-white object-contain p-1 sm:max-h-80',
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