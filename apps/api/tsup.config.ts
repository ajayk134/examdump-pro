import { defineConfig } from 'tsup';

export default defineConfig({
  entry: { index: 'src/index.ts', migrate: 'src/scripts/migrate.ts' },
  format: ['esm'],
  target: 'node20',
  platform: 'node',
  sourcemap: true,
  clean: true,
  dts: false,
  // Bundle workspace packages so the runtime Docker image stays small and
  // self-contained, but keep node_modules for native/optional resolution.
  noExternal: ['@examdump/shared', '@examdump/data-client'],
  external: ['fastify', 'bcryptjs', 'jose', 'google-auth-library', 'nodemailer', 'node-cron', 'postgres', 'drizzle-orm'],
});