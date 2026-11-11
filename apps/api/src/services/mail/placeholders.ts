/**
 * Placeholder rendering for ExamDump Mail.
 *
 * Templates use `{{token}}` syntax. Two rules keep this safe:
 *
 *  1. **Every substituted value is HTML-escaped in HTML context.** Admin-authored
 *     templates are trusted, user data is not. A display name of
 *     `<img onerror=...>` must never execute in a recipient's inbox.
 *  2. **Unknown tokens are an error, not empty string.** Silently rendering
 *     "Hi ," hides a broken template until a customer sees it.
 *
 * Plain text uses the same tokens without escaping.
 */

export type PlaceholderValues = Record<string, string | number | null | undefined>;

const TOKEN = /\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g;

export function escapeHtml(value: string): string {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Tokens present in a template body. */
export function extractPlaceholders(template: string): string[] {
  const found = new Set<string>();
  for (const match of template.matchAll(TOKEN)) {
    const token = match[1];
    if (token) found.add(token);
  }
  return [...found].sort();
}

export interface RenderOptions {
  /** Fail on a missing token instead of leaving it blank. Default true. */
  strict?: boolean;
}

/**
 * Render a template string.
 *
 * `html` controls escaping. Tokens that resolve to `null`/`undefined` render as
 * an empty string (an optional field), but a token with *no entry at all* is
 * treated as a bug when `strict` is on.
 */
export function renderTemplate(
  template: string,
  values: PlaceholderValues,
  options: { html: boolean } & RenderOptions,
): string {
  const { html, strict = true } = options;
  const missing: string[] = [];

  const output = template.replace(TOKEN, (_match, rawToken: string) => {
    const token = rawToken.trim();
    if (!(token in values)) {
      missing.push(token);
      return '';
    }
    const value = values[token];
    if (value === null || value === undefined) return '';
    return html ? escapeHtml(String(value)) : String(value);
  });

  if (strict && missing.length > 0) {
    const unique = [...new Set(missing)];
    throw new Error(`Unknown template placeholder(s): ${unique.join(', ')}`);
  }
  return output;
}

/**
 * Derive a readable plain-text body from HTML.
 *
 * Used when an admin has not written a text alternative. Not a full parser -
 * it handles the shapes our templates actually produce (headings, paragraphs,
 * links, line breaks) so the text part is never empty or a wall of markup.
 */
export function htmlToText(html: string): string {
  let out = html;
  // Drop non-content elements entirely.
  out = out.replace(/<(script|style|head)[\s\S]*?<\/\1>/gi, '');
  // Links: keep the label and the href, since transactional mail is link-driven.
  out = out.replace(
    /<a\b[^>]*href=["']([^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi,
    (_m, href: string, label: string) => {
      const text = label.replace(/<[^>]+>/g, '').trim();
      if (!text) return href;
      return href && href !== text ? `${text} (${href})` : text;
    },
  );
  // Block-level boundaries become newlines.
  out = out.replace(/<\/(p|div|tr|h[1-6]|table|li)>/gi, '\n');
  out = out.replace(/<br\s*\/?>/gi, '\n');
  out = out.replace(/<li\b[^>]*>/gi, '  - ');
  out = out.replace(/<[^>]+>/g, '');
  // Decode the entities we emit.
  out = out
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
  // Collapse excess whitespace.
  out = out.replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n');
  return out
    .split('\n')
    .map((line) => line.trim())
    .join('\n')
    .trim();
}

/**
 * Validate a template before it can be saved or sent.
 *
 * Returns a list of human-readable problems. Empty means OK. This is the guard
 * that stops an admin shipping `{{usre_name}}`.
 */
export function validateTemplate(input: {
  subject: string;
  html: string;
  text?: string;
  allowedVariables?: string[];
}): string[] {
  const problems: string[] = [];
  const source = `${input.subject}\n${input.html}\n${input.text ?? ''}`;
  const used = extractPlaceholders(source);

  if (!input.subject.trim()) problems.push('Subject is required.');
  if (!input.html.trim()) problems.push('HTML body is required.');
  if (input.subject.length > 200) problems.push('Subject must be 200 characters or fewer.');

  const allowed = input.allowedVariables ? new Set(input.allowedVariables) : null;
  if (allowed) {
    const unknown = used.filter((token) => !allowed.has(token));
    if (unknown.length > 0) {
      problems.push(`Unknown placeholder(s): ${unknown.join(', ')}.`);
    }
  }

  return problems;
}
