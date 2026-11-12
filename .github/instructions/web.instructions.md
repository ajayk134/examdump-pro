---
applyTo: "apps/web/**/*.{ts,tsx,css}"
---
# Frontend rules (apps/web)

- Next.js 15 App Router, React 19, TypeScript strict, Tailwind CSS.
- Server Components by default. Add `"use client"` only when state, effects or
  browser APIs are genuinely required.
- **Never use `dangerouslySetInnerHTML`.** The only allowed exception is the
  server-rendered own UPI QR SVG. Render Markdown through
  `apps/web/components/markdown.tsx`.
- **No new dependencies** for Markdown or LaTeX rendering.
- All user-visible limits are advisory only. The API enforces entitlements; never
  present a client-side check as security.
- Never expose secrets to the browser. Only `NEXT_PUBLIC_*` variables may be
  read client-side, and they must never contain credentials. AI keys stay on the
  server.
- Accessibility is a requirement, not a nicety: labelled controls, keyboard
  focus, sufficient contrast, semantic elements.
- Dark and light themes must both be correct. Use existing Tailwind tokens rather
  than hardcoded colours.
- Copy: address the reader as "you", or say "candidate"/"professional". **Never
  use the word "student".**
- Payment UI must never show a success state that the server did not confirm.
  UPI shows "awaiting verification" until the admin approves.

## Verification

```bash
npm run typecheck
npm run build
```
