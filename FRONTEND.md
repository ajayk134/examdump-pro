# Frontend

Next.js 15 App Router, React 19, TypeScript strict, Tailwind CSS.

> **Detailed:** [docs/performance/FRONTEND.md](docs/performance/FRONTEND.md) ·
> [UI_UX.md](UI_UX.md) · [ACCESSIBILITY.md](ACCESSIBILITY.md)

## Structure

```
apps/web/app/          App Router pages (30+ routes)
apps/web/components/   23 shared components
apps/web/lib/          client helpers, local-store
```

58 `.tsx` files; 46 are client components (exam practice, timers, admin consoles
are inherently interactive).

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

## Build

```bash
npm run build -w @examdump/web
```

`output: 'standalone'` for the container; type errors fail the build; ESLint is
skipped during builds because CI runs it separately.

## Data fetching

Server components call `PUBLIC_API_URL` directly. Client components fetch with
credentials and must handle 401 by refreshing the token.

## Related

- [UI/UX](UI_UX.md)
- [Accessibility](ACCESSIBILITY.md)
- [API](API.md)
