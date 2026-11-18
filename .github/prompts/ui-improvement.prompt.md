---
description: "Improve the UI while preserving accessibility, responsiveness, and existing design tokens"
---

# UI improvement

## 1. Inspect before designing

- Identify the page/component and its states: loading, empty, error,
  unauthenticated, free-tier limit, premium, mobile, dark mode.
- Read `apps/web/app/globals.css`, `components/ui.tsx`, `components/icons.tsx`,
  and the nearest existing page for patterns.
- Check whether the same control already exists. Do not add a second button,
  modal, toast, spinner, or form style.
- Preserve API calls and data shapes. A visual change must not silently change
  behaviour.

## 2. Constraints

- Next.js 15 App Router, React 19, Tailwind 3. Keep client/server boundaries
  intact; do not move secrets or server-only data into a client component.
- Use existing colour, spacing, radius, and typography tokens. Maintain light and
  dark parity.
- Must work at 360 px and on desktop, with touch targets and keyboard access.
- Label controls, keep visible focus, preserve heading order, and announce errors.
- Respect `prefers-reduced-motion`; avoid gratuitous animation.
- No new dependencies for icons, charts, Markdown, LaTeX, or state management.
- No `dangerouslySetInnerHTML` for untrusted or model-generated content.
- Do not change payment availability, entitlement display, or auth flow as part of
  a cosmetic change.

## 3. Implement

- Prefer small, composable changes in the owning component.
- Keep copy concise and consistent with existing product language.
- Handle long exam names, missing data, and narrow widths.
- If the change affects session logic, update `apps/web/test` too.

## 4. Verify

```bash
npm run typecheck
npm run test -w @examdump/web
npm run build -w @examdump/web
```

Exercise the page at desktop and 360 px, in light and dark mode, with keyboard
navigation. Report what was visually checked and what was only typechecked.
