/**
 * Resolve the browser-facing API origin.
 *
 * `NEXT_PUBLIC_API_URL` is inlined into the client bundle at build time. A
 * loopback value (for example from a developer's `.env.local`) must never reach
 * a production bundle: in a visitor's browser `127.0.0.1` is *their* machine, so
 * every API call would fail with ERR_CONNECTION_REFUSED and the app would render
 * without data. In production we therefore ignore loopback values and fall back
 * to same-origin (`""`), which nginx routes to the API under `/api`.
 *
 * Development keeps the value so `next dev` can talk to a separately started API.
 */
export function resolveApiBase(raw: string | undefined, nodeEnv: string | undefined): string {
  const value = (raw ?? '').trim();
  if (!value) return '';
  const isLoopback = /^(https?:\/\/)?(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])(:\d+)?\/?$/i.test(value);
  if (nodeEnv === 'production' && isLoopback) return '';
  return value.replace(/\/+$/, '');
}