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
| Evaluate | landing → browse exams → provider → exam → practice questions (free) |
| Convert | wall → pricing → checkout (or UPI QR) |
| Study | dashboard → exam → practice / mock / timed → results → weak topics |
| Repeat | recommendations, streak, leaderboard |

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
