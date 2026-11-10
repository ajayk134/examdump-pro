import type { ContentItem } from '@/lib/types';

export function QuestionContent({ items, className }: { items: ContentItem[]; className?: string }) {
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
          return (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              key={index}
              src={item.src}
              alt="Question diagram"
              loading="lazy"
              referrerPolicy="no-referrer"
              className="my-3 max-h-80 w-auto max-w-full rounded-xl border border-surface-border bg-white object-contain p-1"
            />
          );
        }
        return null;
      })}
    </div>
  );
}