---
applyTo: "apps/web/**"
---

# Frontend instructions

The web app is Next.js 15 App Router + React 19 + Tailwind CSS 3. Pages live in
`apps/web/app`, shared UI in `apps/web/components`, browser utilities in
`apps/web/lib`.

## Architecture

- Most interactive pages are `'use client'` components. Keep server-only concerns
  (secrets, dataset fetches, database access) out of the browser bundle.
- `components/providers.tsx` owns auth, theme, and toast context. Use
  `useAuth()` / `useToast()` instead of creating parallel state.
- `lib/api.ts` is the only browser HTTP client. It sends cookies with
  `credentials: 'include'`, performs a single-flight refresh on 401, and exposes
  `get` / `post` / `patch` / `del` plus `streamPost` for SSE.
- `lib/api-base.ts` resolves the API origin. In production, loopback values are
  ignored and the app uses same-origin (`/api`). Never hard-code an API host in a
  component.
- Auth is cookie-based. Never store tokens in `localStorage`, `sessionStorage`, or
  a readable cookie.

## UI rules

- Reuse existing primitives from `components/ui.tsx`, icons from
  `components/icons.tsx`, charts, and formatters. Do not add a second button,
  modal, spinner, or toast implementation.
- Use the Tailwind tokens and CSS variables already defined in `app/globals.css`.
  Preserve light/dark parity and visible focus states.
- The exam interface must work at 360 px on touch and on desktop. Test responsive
  layout rather than assuming a wide viewport.
- Label every control; keep keyboard navigation and screen-reader semantics.
- Preserve `loading.tsx`, `error.tsx`, and `not-found.tsx` behaviour.
- Do not use `dangerouslySetInnerHTML` for user content, AI output, or any
  untrusted string. `components/markdown.tsx` escapes first; keep it that way.
  The static theme bootstrap in `app/layout.tsx` is the only existing use.
- Do not add frontend dependencies for Markdown, LaTeX, icons, charts, or state
  management. The project deliberately implements these locally.

## Study flows

- `components/study-session.tsx` is the practice runner (instant feedback,
  autosave).
- `components/mock-session.tsx` is the timed/mock runner (no answer leakage
  before submission).
- `components/workspace/*` contains the question workspace, question map,
  explain/hint panels, and tutor chat.
- Session state and API payloads must match `packages/shared/src/schemas.ts`.
  Do not duplicate grading logic in the browser; the server is authoritative.
- SSE chat uses `streamPost`; do not switch to `EventSource` (it cannot send the
  POST body or cookie-auth request the endpoint expects).

## Payments UI

- `app/pricing/page.tsx` reads payment availability from the API. It prefers
  YouPI when `youpi.available`, then HyperSwitch when `paymentsEnabled`, then
  dev-only mock activation.
- Never enable a pay button based on a hard-coded flag or client-side guess.
- Never mark a payment successful from the return page. `app/checkout/return`
  polls the API status; the API settles only from verified evidence.
- Do not add card/UPI credential fields. Checkout is hosted by the gateway.

## Verification

```bash
npm run typecheck
npm run test -w @examdump/web
npm run build -w @examdump/web
```

CI does not run `apps/web/test`; run it locally for any change to `lib/` or
session logic. For UI-only changes, at minimum typecheck and exercise the page in
a browser at desktop and 360 px widths.
