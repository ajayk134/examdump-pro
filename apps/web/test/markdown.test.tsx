import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { Markdown } from '@/components/markdown';

/**
 * The tutor and the walkthrough both render model output through this
 * component, so its guarantees are part of the question workspace contract:
 * structured headings, emphasis, and code must all survive, and raw HTML must
 * never reach the DOM.
 */
function html(source: string): string {
  return renderToStaticMarkup(<Markdown content={source} />);
}

describe('Markdown', () => {
  it('renders level-2 headings as demoted document headings', () => {
    const out = html('## Short answer\nThe route is a network route.');
    expect(out).toContain('<h4');
    expect(out).toContain('Short answer');
    expect(out).not.toContain('##');
  });

  it('renders emphasis inside a paragraph that also contains bold text', () => {
    const out = html(
      '**Step 1 – Principle**  \nThe *type* of a route is determined by its **prefix length**.',
    );
    expect(out).toContain('<em>type</em>');
    expect(out).toContain('prefix length');
    expect(out).not.toContain('*type*');
  });

  it('renders inline code and fenced code blocks', () => {
    const out = html('Use `show ip route` here.\n\n```text\nR1# show ip route\nO 10.0.0.0/8\n```');
    expect(out).toContain('<code');
    expect(out).toContain('show ip route');
    expect(out).toContain('<pre');
    expect(out).toContain('10.0.0.0/8');
  });

  it('renders option lists as lists', () => {
    const out = html('- A. default route\n- B. network route');
    expect(out).toContain('<ul');
    expect(out.match(/<li/g)).toHaveLength(2);
  });

  it('strips raw HTML from model output', () => {
    const out = html('Safe text <script>alert(1)</script> after');
    expect(out).not.toContain('<script');
    expect(out).toContain('Safe text');
  });

  it('renders strikethrough and external links', () => {
    const out = html('Was ~~deprecated~~ see [the guide](https://example.com/guide).');
    expect(out).toContain('<del>deprecated</del>');
    expect(out).toContain('href="https://example.com/guide"');
  });

  it('keeps underscore emphasis working alongside asterisk emphasis', () => {
    const out = html('_One_ and *two*');
    expect(out.match(/<em>/g)).toHaveLength(2);
  });
});
