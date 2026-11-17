# Frontend

Next.js 15 App Router, React 19, TypeScript strict, Tailwind CSS.

> **Detailed:** [docs/performance/FRONTEND.md](docs/performance/FRONTEND.md) ·
> [UI_UX.md](UI_UX.md) · [ACCESSIBILITY.md](ACCESSIBILITY.md)

## Structure

```
apps/web/app/          App Router pages (30+ routes)
apps/web/components/   26 shared components
apps/web/lib/          client helpers, local-store
```

60 `.tsx` files; 48 are client components (exam practice, timers, admin consoles
are inherently interactive).

## Design system ("Nova")

One token set in `apps/web/app/globals.css` + `apps/web/tailwind.config.ts`
drives both themes; components never branch on theme directly.

- **Type.** Three self-hosted faces via `next/font` (no runtime request, no
  layout shift): **Space Grotesk** for display headings (`--font-display`, used
  by `.display-1/2` and `.heading-1/2`), **Manrope** for body text
  (`--font-sans`), **JetBrains Mono** for code and keycaps (`--font-mono`). All
  are open-source (OFL).
- **Tokens.** `surface-{base,raised,overlay,sunken,inset,border,border-strong}`,
  `content-{primary,secondary,muted}`, `accent` (violet), `accent-2` (magenta),
  `accent-3` (cyan), `positive`, `caution`, `negative`, and
  `shadow-{xs,sm,md,lg,glow,glow-sm}`. The named ramps `iris`/`flare`/`aqua`/`ink`
  are the identity's palette; the legacy `brand` (violet) and `sky` (cyan) names
  were remapped onto the same hues so pre-redesign gradients inherit the identity
  instead of introducing a second blue.
- **Layout idioms.** `panel`/`panel-lg` (bordered content container), `tile`
  (borderless interactive block), `section`/`section-head` (a page region),
  `rail` (horizontal snap carousel), `hairline`, `grid-fade`.
- **Signature language.** `mesh` (full-bleed brand gradient panel),
  `gradient-text` (the brand gradient as text), `ring-gradient` (1 px gradient
  hairline that follows any radius), `orb` (blurred glow blob for hero art),
  `animate-float`/`-gradient`/`-marquee`/`-glow`, and a `.reveal`/`.reveal-in`
  scroll fade driven by `<Reveal>` (`components/reveal.tsx`) through an
  IntersectionObserver — it degrades to visible with no observer or reduced
  motion. `components/brand.tsx` owns the `BrandMark` prism and the `Wordmark`.
- **Controls.** `btn` (+ `-primary -secondary -ghost -danger -sm -lg -block`; all
  pills), `icon-btn`, `input`, `select`, `chip`, `badge` (+ tones), `kbd`,
  `link`, `link-quiet`. Coarse-pointer rules grow the hit area of every one of
  these to at least 44 px, so a component can state its mouse size and let the
  media query handle touch.
- **Data.** `tbl` (dense table), `metric-value`/`metric-label`, `progress-track`.
- **Primitives.** `apps/web/components/ui.tsx` exports `PageShell`,
  `PageHeader`, `Panel`-scale helpers, `StatCard`/`StatStrip`, `ProgressBar`/
  `ProgressRing`, `Tabs`, `Chip`, `Badge`, `EmptyState`, `ErrorState`, `Alert`,
  `Skeleton`, plus `useOverlay` and the `Drawer`/`Dialog` built on it.

Use these rather than restyling raw divs; `.surface`/`.card` remain as aliases so
older markup inherits the current look. Every table that can exceed its column
goes in `TableScroll` (it is `relative`, which is what keeps a table's
`sr-only` caption from widening the document).

## Rules

- **Server components by default.** Extract the interactive part rather than
  converting a whole page.
- **Never `dangerouslySetInnerHTML`.** One audited exception: the server-rendered
  own UPI QR SVG.
- **No new Markdown/LaTeX dependencies.** The custom renderer is
  `apps/web/components/markdown.tsx`.
- **Limits shown in the UI are advisory.** The API enforces entitlement.
- **Never expose secrets.** Only `NEXT_PUBLIC_*` reaches the browser, and never a
  credential.
- **Dark and light parity.** Use Tailwind tokens, not hardcoded colours.
- **Never say "student".** Use "you", "candidate" or "professional".
- **Checkout follows server availability.** Pricing uses
  `youpi.available` from `/subscriptions/plans` and calls
  `/payments/pay/youpi/checkout` only when both payment flags and YouPI
  credentials are live; otherwise it keeps the existing gateway/mock path.
  Never infer payment availability from a local flag.

## Build

```bash
npm run build -w @examdump/web
```

`output: 'standalone'` for the container; type errors fail the build; ESLint is
skipped during builds because CI runs it separately.

## Data fetching

Server components call `PUBLIC_API_URL` directly. Client components fetch with
credentials and must handle 401 by refreshing the token.

The browser-facing base comes from `NEXT_PUBLIC_API_URL`, which Next inlines at
build time (`apps/web/lib/api.ts`). `apps/web/lib/api-base.ts` ignores loopback
values in production and falls back to same-origin (`""`), so a developer's
`.env.local` can never point production visitors at their own `localhost`.

## Related

- [UI/UX](UI_UX.md)
- [Accessibility](ACCESSIBILITY.md)
- [API](API.md)
