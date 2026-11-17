# Frontend

Next.js 15 App Router, React 19, TypeScript strict, Tailwind CSS.

> **Detailed:** [docs/performance/FRONTEND.md](docs/performance/FRONTEND.md) ·
> [UI_UX.md](UI_UX.md) · [ACCESSIBILITY.md](ACCESSIBILITY.md)

## Structure

```
apps/web/app/          App Router pages (30+ routes)
apps/web/components/   31 shared components
apps/web/lib/          client helpers, local-store, session mechanics
```

67 `.tsx` files; 55 are client components (exam practice, timers, admin consoles
are inherently interactive).

### Information architecture

Discovery is search-first, not a long scroll. Each action has a hub that
configures it and a runner that performs it:

| Route | Role |
| --- | --- |
| `/exams` | Discover: search, certification-body filter, compact result rows, recents |
| `/exams/:providerId` | every exam from one provider |
| `/exams/:providerId/:examKey` | exam workspace with Overview / Practice / Mock exam / Attempts tabs |
| `/practice` | practice hub: exam, focus ("difficulty for you"), question type, count |
| `/practice/session` | practice runner: paging, palette, immediate feedback, AI tutor dock |
| `/mock` | simulator: exam, question count, time limit (suggested from the paper length until changed), instructions, attempt history |
| `/mock/session` | mock runner: timer, paging, palette, submit confirmation, score report and filtered review |
| `/dashboard` | Progress: next best action, metrics, weak areas, attempts |
| `/pricing` | Plans: comparable cards, exam picker for scoped passes, sticky checkout |
| `/study` | compatibility redirect into the practice/mock runner |

Shared entry points: `components/exam-select.tsx` (searchable exam picker),
`components/practice-config.tsx`, `components/mock-config.tsx`.

## Question workspace

Practice and mock share one workspace and one set of session mechanics, so a
learner does not have to relearn the interface between the two modes.

- **`components/workspace/question-workspace.tsx`** is the frame: a sticky
  session bar (exam, visible range, progress, timer), a session-map rail from
  `xl`, the open reading column, and the study companion from `lg`. Phones keep
  one column and reach map / hint / explain / ask from a floating utility bar
  above the site navigation; mock sessions show the clock and a single exam-info
  action there instead of the AI actions.
- **`components/workspace/question-sheet.tsx`** renders one question as an open
  editorial sheet — number, stem, options and actions in one reading column with
  hairline separation, not a stack of cards. Correctness colours and the verified
  answer appear only when the caller passes `revealed` plus an answer key, and the
  mock runner never does before submission. Images open in a `Dialog`; notes and
  bookmarks are per question.
- **`components/workspace/question-map.tsx`** is the session map: filters
  (all / open / flagged), state colours for current, answered, flagged and
  answered+flagged, a legend, first-unanswered and first-flagged jumps, and the
  page-size picker. A jump always targets the true session index, even while a
  filter is active.
- **`components/workspace/study-companion.tsx`** keeps Guide (progressive
  hints), Explain (verified answer, option-by-option reasoning, source
  explanation, AI walkthrough) and Ask (tutor) mounted in one panel, so a
  streaming hint, a half-written answer or a scroll position survives a tab
  switch. It is a sticky third column on desktop and a full-height sheet on
  phones. Mock sessions replace the tabs with a sealed exam-mode panel.
- **`components/question-content.tsx`** renders stems and options, including
  fenced and inline code and images.
- **`lib/question-session.ts`** is pure and unit-tested
  (`test/question-session.test.ts`): supported page sizes (`5`, `10`, `20`, `50`,
  `all`), page bounds and clamping, jump-to-page mapping, pager links, selection
  rules, status derivation and the elapsed clock. Nothing here touches the DOM.
- **Paging.** Five cards per page is the default. The map offers only sizes the
  session can fill (plus `All`), and the runner remembers the cursor, not a raw
  page index, so changing the page size keeps the current question on screen.
  With more than one question visible, the cursor's card carries an accent rule.
- **Keys.** `←`/`→` or `k`/`j` move the cursor, `1`–`9` pick an option, `F`
  flags, `H` opens hints, `E` opens the walkthrough, `G` opens the map, and
  `Escape` closes overlays. Inputs are ignored while a text field has focus. The
  same handler is installed in both runners.
- **Persistence.** Flags, typed answers, revealed state and the cursor are saved
  per session in `localStorage` (`lib/local-store.ts`) so a refresh does not lose
  work. Practice still records graded answers through
  `POST /api/analytics/practice`. A mock stores its attempt id, question set and
  timer anchor once, then the mutable answers as they change; a reload re-reads
  the attempt from `GET /api/attempts/:id`, refuses to resume anything that is no
  longer `in_progress`, and computes the remaining clock from the server's
  `startedAt` + `timeLimitSeconds`. Submission is still the only grading step.
  The device cache is convenience state, never the grading authority.
- **Page-size preference.** Stored per surface (`practice` / `mock`) and restored
  before the first paint after mount, so returning to a session keeps the chosen
  layout. A size the current paper cannot fill folds into `All` instead of
  leaving no option selected.
- **Mock conditions.** Paging and flags are presentation only. No answer key is
  sent to the browser, no per-question grading happens, and the submitted
  payload is unchanged. Review only becomes available after the attempt is
  graded, and filters by all / incorrect / skipped / flagged.

## AI tutor workspace

- **`components/workspace/tutor-chat.tsx`** is the in-session tutor. It resumes
  the thread anchored to the current question (`GET /api/ai/chat/by-question`),
  sends the learner's current selection so the answer can target the gap,
  remembers the teaching mode, and renders Markdown through
  `components/markdown.tsx`. Copy, regenerate and stop keep the text already
  received; quota errors appear in the thread rather than replacing the panel.
- **`components/workspace/hint-panel.tsx`** is the progressive hint ladder.
  Level 1 is a deterministic reading prompt built from the question shape, so the
  learner always gets somewhere to start without spending a model call. Levels 2
  (narrow the constraint) and 3 (what the surviving answer must contain) request
  `/api/ai/hint/stream` with `level`, and every level is instructed never to name
  the answer. Re-opening the tab keeps the hints already received.
- **`components/workspace/explain-panel.tsx`** stays locked until the learner
  commits to an answer — the walkthrough cannot become an answer key. Once
  revealed it shows the verified answer, the option-by-option breakdown from the
  dataset, the source explanation, then an optional AI walkthrough. The streamed
  walkthrough is anchored at its first `##` heading, so planning text from a
  reasoning model never reaches the reader.
- **Teaching modes.** `TUTOR_MODES` in `components/ai-chat.tsx` (ids mirrored by
  `AI_TUTOR_MODES` in `packages/shared`) offers step-by-step, Socratic, plain
  English, real-world and quiz. The chosen id is sent as `mode` on the message,
  applied to that turn's system prompt server-side, and remembered per device.
- **Follow-ups.** Suggested prompts live in a dedicated strip immediately above
  the composer, outside the transcript scroller: they wrap instead of clipping,
  never overlap messages, and stay put while the transcript scrolls. They are
  hidden while an answer streams, while a thread loads, and when the daily
  allowance is spent.
- **Full-page tutor.** `/ask` still uses `components/ai-chat.tsx` for the
  history rail and the wider conversation surface; the in-session companion
  reuses the same API contract.
- **Markdown.** `components/markdown.tsx` is the only renderer (no new
  dependency, no `dangerouslySetInnerHTML`). It covers headings, lists, tables,
  emphasis, `~~strikethrough~~`, inline and fenced code, links and LaTeX, and is
  covered by `apps/web/test/markdown.test.tsx`.

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
- **Choosing a pass advances the flow.** `apps/web/app/pricing/page.tsx` scrolls
  step 2 (exams) into view on selection, using
  `apps/web/lib/scroll.ts` to skip the jump when the step is already fully on
  screen and to honour `prefers-reduced-motion`. Clearing the pass never
  scrolls.

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
