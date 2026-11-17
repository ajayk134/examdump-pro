# UI / UX

Principles and constraints for the interface.

## Audience

Working professionals preparing for certification exams. Time-poor, outcome-driven,
often studying on a phone between other commitments. Copy addresses them as "you"
— never "student".

## Principles

1. **Practice is the product.** The path from landing to working questions should
   be as short as possible. Any step that does not add value is a defect.
2. **The free tier must feel real.** A user hitting 5 questions should understand
   what they are missing, not feel blocked by a gimmick.
3. **State is always visible.** Current exam, progress, time remaining and answer
   state must never be ambiguous mid-session.
4. **Failures explain themselves.** Errors say what happened and what to do, not
   just that something broke.
5. **No dark patterns.** Cancellation is as easy to find as upgrade. Payment state
   is never overstated.
6. **Every surface is purpose-built.** Pages share one design language but not
   one template: the exam interface is quiet and focused, the dashboard reads as
   a workspace, analytics lead with charts, discovery leads with search, and the
   admin console is dense. A section should not be laid out just because another
   section was.

## Core journeys

| Journey | Path |
| --- | --- |
| Discover | landing / Discover → search or filter by certification body → exam workspace |
| Practise | Practice hub → exam → focus (your history, type, count) → runner → progress |
| Sit a mock | Mock simulator → exam → count + timer → instructions → attempt → score report |
| Evaluate | landing → Discover → exam workspace → free questions |
| Convert | limit reached → pricing → choose pass (step 2 scrolls in) → exams → checkout (or UPI QR) |
| Track | Progress → next best action → weak areas → practice or mock |
| Repeat | recommendations, streak, leaderboard |

The product is organised around five destinations: **Discover** (`/exams`),
**Practice** (`/practice`), **Mock** (`/mock`), **Progress** (`/dashboard`) and
**Plans** (`/pricing`). Each has a hub that configures the action and a runner
that performs it; `/study` is a compatibility redirect into the runners.

## Visual identity

The interface's visual language is "Nova" — deliberately not a neutral blue
dashboard. A deep indigo ink neutral; an electric-violet primary with magenta and
cyan gradient partners; a geometric display face (Space Grotesk) over a rounded
text face (Manrope), self-hosted by `next/font`; generous radii and pill controls;
and a soft brand mesh behind every page. Light and dark share the same token
names, so no component branches on the theme.

The identity is defined once, in `apps/web/app/globals.css` +
`apps/web/tailwind.config.ts`. Components compose from `panel`, `tile`, `btn`,
`badge`, `mesh`, `gradient-text`, `ring-gradient` and `orb` rather than inventing
their own colour or shape, so a single token change moves the whole product. See
[FRONTEND.md](FRONTEND.md) for the full list of tokens and idioms.

## Interaction standards

- Touch targets ≥ 44 px; usable at 360 px width.
- Every interactive element reachable by keyboard with a visible focus ring.
- Loading and error states for every async view — no blank screens.
- Destructive actions confirm and are reversible where possible. Confirmations
  use the shared `Dialog` (focus trap, Escape, scroll lock), never a bare div.
- Timers derive from a stored deadline, never from incrementing a counter.
- The exam surface stays quiet: no decorative motion or celebration while a
  question is on screen, and the answer options are operable with 1–9 as well as
  a pointer.
- **Question workspace.** Practice and mock are one studio, not a form with
  buttons beside it. A sticky session bar carries the exam, the visible range,
  progress and the clock; the reading column is a single editorial sheet per
  question with the number, stem, options and actions sharing one measure. On
  desktop a session map sits to the left and the study companion to the right;
  on phones the same three surfaces open as sheets from a floating utility bar
  above the site navigation, so nothing is ever more than a thumb away.
- **Session map.** Every question is one cell, coloured for current, answered,
  flagged or answered-and-flagged, with filters for all / open / flagged, a
  first-unanswered and first-flagged jump, a legend, and the page-size picker.
  A jump lands on the true session position even while a filter is active. The
  cursor's card carries an accent rule when several cards are on screen.
- **Paging.** 5, 10, 20, 50 or all questions per page, defaulting to five. Sizes
  the paper cannot fill are omitted; `All` is always available and never exceeds
  the server-side entitlement. The reader stays on the question they were on when
  the size changes, and `←`/`→` (or `j`/`k`) bring the next card into view.
  Answers, flags, page size and the cursor survive a refresh.
- **Grading.** Practice reveals correctness, the verified answer, the source
  explanation and an option-by-option breakdown as soon as an answer is checked;
  the mock never shows an answer key or a per-question verdict before submission.
- **Progressive hints.** Hint 1 is a reading prompt built from the question
  shape and costs no model call. Hint 2 narrows the constraint, hint 3 says what
  the surviving answer must contain — none of them names the option. The three
  steps read as a numbered ladder, and the panel tells the learner when the
  walkthrough is the better next move.
- **Study companion.** Guide, Explain and Ask live in one panel and stay mounted
  so streams and scroll positions survive tab switches. It docks beside the
  question on desktop and takes the full height of a phone sheet. The mock
  replaces it with a sealed exam-mode panel that explains why nothing can be
  revealed mid-sitting.
- **AI tutor.** Anchored to the exam and the current question, remembering the
  teaching mode and resuming its thread across reloads. Streaming can be stopped
  without discarding the text already shown. Suggested follow-ups sit directly
  above the composer — never inside the transcript — so they remain attached to
  the input while messages scroll.
- Lists and tables that can exceed the column scroll inside `TableScroll`, never
  by widening the page.

## Payment UI

- UPI: show the exact suffixed amount and state clearly that it differs from the
  plan price by a few paise, and why.
- After transfer, the UI must say "awaiting verification" — never "paid" — until
  the server confirms. The client cannot know a payment succeeded.
- Never display a success state optimistically.

## Theming

Light and dark are both first-class. Tokens live in `apps/web/app/globals.css` and
`tailwind.config.ts`. Check both for any new component.

## Related

- [Frontend](FRONTEND.md)
- [Accessibility](ACCESSIBILITY.md)
- [Payments](PAYMENTS.md)
