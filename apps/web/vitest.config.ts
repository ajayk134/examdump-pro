import { defineConfig } from 'vitest/config';

/**
 * Unit tests for the web app. `@/` mirrors the TypeScript path alias in
 * `tsconfig.json`, and JSX is compiled with the automatic runtime so the same
 * components can be imported from tests.
 */
export default defineConfig({
  esbuild: { jsx: 'automatic' },
  resolve: {
    alias: {
      '@': new URL('.', import.meta.url).pathname.replace(/\/$/, ''),
    },
  },
  test: {
    include: ['test/**/*.test.{ts,tsx}'],
    environment: 'node',
  },
});
