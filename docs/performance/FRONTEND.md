# Frontend performance

Next.js 15 App Router, React 19, Tailwind. 58 `.tsx` files, 46 of which are client
components.

## Rendering strategy

`apps/web/next.config.mjs`:

```js
output: 'standalone'        // minimal server image
reactStrictMode: true
poweredByHeader: false
transpilePackages: ['@examdump/shared']
eslint: { ignoreDuringBuilds: true }   // lint runs in CI, not the build
typescript: { ignoreBuildErrors: false }  // build fails on type errors
```

Pages are **server components by default**. The split:

| Kind | Count | Why |
| --- | --- | --- |
| Server | ~12 | data fetch, SEO, no interactivity |
| Client (`"use client"`) | 46 | exam practice, forms, charts, admin consoles |

The high client-component count is inherent — study sessions, timers and admin
tables are interactive. It is not a defect, but it means client bundle size is
worth watching.

Server components fetch from `PUBLIC_API_URL` directly (no CORS, no extra hop
through the browser). Client components call the API via fetch with credentials.

## Bundle size

There is no bundle-size budget enforced in CI. To inspect the current size:

```bash
npm run build -w @examdump/web
du -sh apps/web/.next/static/chunks/
```

Guidance:

- `lucide-react` icons are imported individually; never `import * as icons`.
- Charts are heavy — keep them in a component that is dynamically imported if a
  page does not always show them.
- `@examdump/shared` is transpiled, so its Zod schemas ship to the client. That is
  intentional (shared validation) but keep new schemas small.
- No Markdown/LaTeX libraries are permitted; the custom renderer in
  `apps/web/components/markdown.tsx` exists to keep the bundle small.

## Code splitting and lazy loading

- App Router splits per route automatically.
- Use `next/dynamic` for heavy interactive panels not needed on first paint
  (admin consoles, charts).
- Do not convert a server component to a client component just to add one
  interaction; extract the interactive part instead — that keeps the payload of
  the rest of the page server-rendered.

## Images

No `next/image` optimisation is configured. Any raster imagery must be sized and
compressed before committing; prefer inline SVG for icons and diagrams.

The only generated image is the UPI QR, rendered as SVG on the server
(`services/upi/qr.ts`) — no client-side canvas work.

## CSS

- Tailwind purges unused classes at build time.
- `globals.css` holds design tokens and a small number of base rules.
- Avoid inline style objects for static values; they defeat Tailwind's
  deduplication and add to the JS payload.

## Avoiding unnecessary re-renders

- Keep state as local as possible; do not lift exam state to a page-level
  provider.
- Memoise derived values with `useMemo` only when the computation is genuinely
  expensive — the exam question list and stats aggregation qualify, simple
  string formatting does not.
- Timers (mock exam countdown) must use a single interval and derive display
  values from a stored deadline, not by incrementing a counter on every tick.

## Mobile

- Layout is responsive with a single breakpoint system from Tailwind's defaults.
- The exam UI must remain usable at 360 px width; touch targets ≥ 44 px.
- Avoid hover-only affordances — they do not exist on touch.

## Core Web Vitals

Not currently measured in this repository, so no numbers are claimed. To collect
real data, measure LCP/CLS/INP on the study and pricing pages first — they are
the highest-traffic entry points — before optimising anything else.

## Accessibility interplay

Accessibility work and performance overlap: semantic HTML is smaller than
div-and-ARIA equivalents, and keyboard-first interactions avoid heavy custom
widgets. See [ACCESSIBILITY.md](../../ACCESSIBILITY.md).

## Related

- [Performance budgets](PERFORMANCE_BUDGETS.md)
- [Infrastructure](INFRASTRUCTURE.md)
- [FRONTEND.md](../../FRONTEND.md)
