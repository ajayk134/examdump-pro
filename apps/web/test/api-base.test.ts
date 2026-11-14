import { describe, expect, it } from 'vitest';
import { resolveApiBase } from '../lib/api-base';

describe('resolveApiBase', () => {
  it('uses same-origin when the variable is unset', () => {
    expect(resolveApiBase(undefined, 'production')).toBe('');
    expect(resolveApiBase('', 'production')).toBe('');
  });

  it('never ships a loopback base to production', () => {
    // This is the regression: a developer .env.local value was inlined into the
    // production bundle, so visitors' browsers called their own 127.0.0.1.
    expect(resolveApiBase('http://127.0.0.1:4100', 'production')).toBe('');
    expect(resolveApiBase('http://localhost:4100', 'production')).toBe('');
    expect(resolveApiBase('http://0.0.0.0:4100', 'production')).toBe('');
    expect(resolveApiBase('http://[::1]:4100', 'production')).toBe('');
  });

  it('keeps a loopback base in development so next dev can reach a local API', () => {
    expect(resolveApiBase('http://127.0.0.1:4100', 'development')).toBe('http://127.0.0.1:4100');
  });

  it('keeps a real production origin and normalises a trailing slash', () => {
    expect(resolveApiBase('https://examtopicspro.duckdns.org/', 'production')).toBe(
      'https://examtopicspro.duckdns.org',
    );
    expect(resolveApiBase('https://examtopicspro.duckdns.org', 'production')).toBe(
      'https://examtopicspro.duckdns.org',
    );
  });
});