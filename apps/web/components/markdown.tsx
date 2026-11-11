'use client';

import { Fragment, useMemo, type ReactNode } from 'react';
import { latexToUnicode } from '@/lib/math';

/**
 * A small, dependency-free Markdown renderer tuned for AI answers.
 *
 * Why not react-markdown: the web app intentionally ships no third-party
 * Markdown or KaTeX bundle. This renderer covers the subset our prompts
 * actually produce (headings, lists, bold/italic, inline code, fenced code,
 * blockquotes, tables, links, LaTeX) and — critically — never uses
 * `dangerouslySetInnerHTML`, so model output cannot inject HTML or script.
 */

/* ------------------------------------------------------------------ */
/* Math                                                                */
/* ------------------------------------------------------------------ */

function MathInline({ latex }: { latex: string }) {
  return (
    <span className="inline-math rounded bg-surface-sunken/70 px-1 py-0.5 font-mono text-[0.92em] text-brand-700 dark:text-brand-200">
      {latexToUnicode(latex)}
    </span>
  );
}

function MathBlock({ latex }: { latex: string }) {
  return (
    <div className="my-3 overflow-x-auto rounded-xl border border-surface-border bg-surface-sunken/60 px-4 py-3 text-center font-mono text-sm text-brand-700 dark:text-brand-200">
      {latexToUnicode(latex)}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Inline formatting                                                   */
/* ------------------------------------------------------------------ */

interface InlineOptions {
  keyPrefix: string;
  /** Render `[label](url)` as an external link. */
  links?: boolean;
}

/** Tokenise one line of inline Markdown into React nodes. */
function renderInline(text: string, { keyPrefix, links = true }: InlineOptions): ReactNode[] {
  const nodes: ReactNode[] = [];
  let index = 0;
  let key = 0;

  // Ordered by priority: math and code first so their contents stay literal.
  const pattern = new RegExp(
    [
      '(\\$\\$[^$]+\\$\\$)',            // 1 block math on one line
      '(\\$[^$\\n]+\\$)',                // 2 inline math
      '(`[^`\\n]+`)',                    // 3 inline code
      '(\\*\\*[^*]+\\*\\*)',             // 4 bold
      '(?<!\\*)\\*[^*\\n]+\\*(?!\\*)',   // 5 italic  (single asterisk)
      '(_[^_\\n]+_)',                    // 6 italic via underscore
      '(~~[^~\\n]+~~)',                  // 7 strikethrough
      links ? '(\\[[^\\]]+\\]\\([^)\\s]+\\))' : '(\\0)', // 8 link
    ].join('|'),
    'g',
  );

  // Strip raw HTML tags from model output entirely.
  const safe = text.replace(/<[^>\n]{1,200}>/g, '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '');

  for (const match of safe.matchAll(pattern)) {
    const at = match.index ?? 0;
    if (at > index) nodes.push(safe.slice(index, at));
    const token = match[0];
    const k = `${keyPrefix}-i${key++}`;

    if (match[1]?.startsWith('$$') && match[1].endsWith('$$')) {
      nodes.push(<MathInline key={k} latex={match[1].slice(2, -2)} />);
    } else if (match[2]) {
      nodes.push(<MathInline key={k} latex={match[2].slice(1, -1)} />);
    } else if (match[3]) {
      nodes.push(
        <code
          key={k}
          className="rounded bg-surface-sunken px-1.5 py-0.5 font-mono text-[0.9em] text-content-primary"
        >
          {match[3].slice(1, -1)}
        </code>,
      );
    } else if (match[4]) {
      nodes.push(
        <strong key={k} className="font-semibold text-content-primary">
          {renderInline(match[4].slice(2, -2), { keyPrefix: `${k}b`, links })}
        </strong>,
      );
    } else if (match[5] || match[6]) {
      const inner = (match[5] ?? match[6])!.slice(1, -1);
      nodes.push(<em key={k}>{renderInline(inner, { keyPrefix: `${k}e`, links })}</em>);
    } else if (match[7]) {
      nodes.push(<del key={k}>{match[7].slice(2, -2)}</del>);
    } else if (match[8] && links) {
      const linkMatch = /^\[([^\]]+)\]\(([^)\s]+)\)$/.exec(match[8]);
      if (linkMatch) {
        const href = linkMatch[2]!;
        const safeHref = /^https?:/i.test(href) ? href : undefined;
        nodes.push(
          safeHref ? (
            <a
              key={k}
              href={safeHref}
              target="_blank"
              rel="noopener noreferrer nofollow"
              className="link font-medium"
            >
              {linkMatch[1]}
            </a>
          ) : (
            <Fragment key={k}>{linkMatch[1]}</Fragment>
          ),
        );
      } else {
        nodes.push(token);
      }
    } else {
      nodes.push(token);
    }
    index = at + token.length;
  }

  if (index < safe.length) nodes.push(safe.slice(index));
  return nodes;
}

/* ------------------------------------------------------------------ */
/* Block formatting                                                    */
/* ------------------------------------------------------------------ */

function renderTable(rows: string[], key: string): ReactNode {
  const cells = rows.map((row) =>
    row.replace(/^\||\|$/g, '').split('|').map((c) => c.trim()),
  );
  const header = cells[0] ?? [];
  const body = cells.slice(2); // index 1 is the |---| separator
  return (
    <div key={key} className="my-3 overflow-x-auto rounded-xl border border-surface-border">
      <table className="w-full text-sm">
        <thead className="bg-surface-sunken/70">
          <tr>
            {header.map((h, i) => (
              <th key={i} className="px-3 py-2 text-left font-semibold text-content-primary">
                {renderInline(h, { keyPrefix: `${key}-h${i}` })}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {body.map((row, r) => (
            <tr key={r} className="border-t border-surface-border/70">
              {row.map((cell, c) => (
                <td key={c} className="px-3 py-2 align-top text-content-secondary">
                  {renderInline(cell, { keyPrefix: `${key}-r${r}c${c}` })}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function Markdown({ content, className }: { content: string; className?: string }) {
  const blocks = useMemo(() => {
    const lines = content.replace(/\r\n/g, '\n').split('\n');
    const out: ReactNode[] = [];
    let i = 0;
    let key = 0;

    while (i < lines.length) {
      const line = lines[i]!;
      const k = `b${key++}`;

      // Fenced code block
      if (/^\s*```/.test(line)) {
        const lang = line.replace(/^\s*```/, '').trim();
        const code: string[] = [];
        i += 1;
        while (i < lines.length && !/^\s*```/.test(lines[i]!)) {
          code.push(lines[i]!);
          i += 1;
        }
        i += 1;
        out.push(
          <div key={k} className="my-3 overflow-hidden rounded-xl border border-surface-border">
            {lang ? (
              <div className="border-b border-surface-border bg-surface-sunken px-3 py-1 text-[11px] font-medium uppercase tracking-wide text-content-muted">
                {lang}
              </div>
            ) : null}
            <pre className="overflow-x-auto bg-surface-sunken/40 p-3 text-[13px] leading-relaxed">
              <code className="font-mono text-content-primary">{code.join('\n')}</code>
            </pre>
          </div>,
        );
        continue;
      }

      // Display math block
      if (/^\s*\$\$\s*$/.test(line)) {
        const math: string[] = [];
        i += 1;
        while (i < lines.length && !/^\s*\$\$\s*$/.test(lines[i]!)) {
          math.push(lines[i]!);
          i += 1;
        }
        i += 1;
        out.push(<MathBlock key={k} latex={math.join(' ')} />);
        continue;
      }

      // Heading
      const heading = /^(#{1,6})\s+(.*)$/.exec(line);
      if (heading) {
        const level = heading[1]!.length;
        const text = heading[2]!;
        const sizes: Record<number, string> = {
          1: 'mt-4 mb-2 text-lg font-bold',
          2: 'mt-4 mb-2 text-base font-bold',
          3: 'mt-3 mb-1.5 text-[15px] font-semibold',
          4: 'mt-3 mb-1.5 text-sm font-semibold',
          5: 'mt-2 mb-1 text-sm font-semibold',
          6: 'mt-2 mb-1 text-xs font-semibold uppercase tracking-wide',
        };
        const Tag = `h${Math.min(level + 2, 6)}` as 'h3';
        out.push(
          <Tag key={k} className={`${sizes[level]} text-content-primary`}>
            {renderInline(text, { keyPrefix: `${k}h` })}
          </Tag>,
        );
        i += 1;
        continue;
      }

      // Horizontal rule
      if (/^\s*([-*_])\s*\1\s*\1[\s\-*_]*$/.test(line)) {
        out.push(<hr key={k} className="my-4 border-surface-border" />);
        i += 1;
        continue;
      }

      // Table
      if (/^\s*\|/.test(line) && /^\s*\|?[\s:|-]+\|[\s:|-]*$/.test(lines[i + 1] ?? '')) {
        const rows: string[] = [];
        while (i < lines.length && /^\s*\|/.test(lines[i]!)) {
          rows.push(lines[i]!.trim());
          i += 1;
        }
        out.push(renderTable(rows, k));
        continue;
      }

      // Blockquote
      if (/^\s*>\s?/.test(line)) {
        const quote: string[] = [];
        while (i < lines.length && /^\s*>\s?/.test(lines[i]!)) {
          quote.push(lines[i]!.replace(/^\s*>\s?/, ''));
          i += 1;
        }
        out.push(
          <blockquote
            key={k}
            className="my-3 rounded-r-lg border-l-2 border-brand-400/60 bg-brand-500/5 py-2 pl-3 pr-2 text-sm text-content-secondary"
          >
            {quote.map((q, qi) => (
              <p key={qi} className="my-0.5">
                {renderInline(q, { keyPrefix: `${k}q${qi}` })}
              </p>
            ))}
          </blockquote>,
        );
        continue;
      }

      // Ordered list
      if (/^\s*\d+[.)]\s+/.test(line)) {
        const items: string[] = [];
        while (i < lines.length && /^\s*\d+[.)]\s+/.test(lines[i]!)) {
          items.push(lines[i]!.replace(/^\s*\d+[.)]\s+/, ''));
          i += 1;
        }
        out.push(
          <ol key={k} className="my-2 list-decimal space-y-1 pl-5 text-content-secondary">
            {items.map((item, ii) => (
              <li key={ii} className="pl-0.5 leading-relaxed">
                {renderInline(item, { keyPrefix: `${k}o${ii}` })}
              </li>
            ))}
          </ol>,
        );
        continue;
      }

      // Unordered list
      if (/^\s*[-*+]\s+/.test(line)) {
        const items: string[] = [];
        while (i < lines.length && /^\s*[-*+]\s+/.test(lines[i]!)) {
          items.push(lines[i]!.replace(/^\s*[-*+]\s+/, ''));
          i += 1;
        }
        out.push(
          <ul key={k} className="my-2 list-disc space-y-1 pl-5 text-content-secondary">
            {items.map((item, ii) => (
              <li key={ii} className="pl-0.5 leading-relaxed">
                {renderInline(item, { keyPrefix: `${k}u${ii}` })}
              </li>
            ))}
          </ul>,
        );
        continue;
      }

      // Blank line
      if (!line.trim()) {
        i += 1;
        continue;
      }

      // Paragraph: merge consecutive plain lines
      const para: string[] = [line];
      i += 1;
      while (
        i < lines.length &&
        lines[i]!.trim() &&
        !/^\s*(#{1,6}\s|```|>\s?|[-*+]\s|\d+[.)]\s|\||\$\$\s*$)/.test(lines[i]!) &&
        !/^\s*([-*_])\s*\1\s*\1/.test(lines[i]!)
      ) {
        para.push(lines[i]!);
        i += 1;
      }
      out.push(
        <p key={k} className="my-2 leading-relaxed text-content-secondary">
          {renderInline(para.join(' '), { keyPrefix: `${k}p` })}
        </p>,
      );
    }

    return out;
  }, [content]);

  return <div className={className}>{blocks}</div>;
}

