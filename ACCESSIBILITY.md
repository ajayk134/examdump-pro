# Accessibility

A requirement, not a nice-to-have. Certification candidates include people using
screen readers, keyboard-only navigation and zoom.

## Standards

Target **WCAG 2.1 AA** for interactive surfaces. No formal audit has been run — this
is the standard new work is measured against.

## Non-negotiables

| Requirement | Detail |
| --- | --- |
| Semantic HTML | real `<button>`, `<a>`, `<input>`, `<label>` — not divs with handlers |
| Labels | every input has a programmatically associated label |
| Keyboard | every interactive element reachable by Tab, operable by Enter/Space |
| Focus | visible focus ring; never `outline: none` without a replacement |
| Contrast | 4.5:1 for body text, 3:1 for large text and UI edges |
| Touch targets | ≥ 44 px |
| Images | meaningful `alt`; decorative images `alt=""` |
| Headings | one `<h1>` per page, no skipped levels |
| Errors | announced, associated with the field, not colour-only |
| Motion | no essential information conveyed by animation alone |
| Dark mode | contrast must hold in dark theme too |

## Exam interface specifics

- The question, options and timer must be readable in order by a screen reader.
- Time remaining must be available as text, not only a visual bar.
- Answer selection must work without a mouse.
- After submitting, focus must move to the result heading so the change is
  announced.

## Verification

```bash
npm run build -w @examdump/web   # type safety
```

Manual checks before shipping UI work:

1. Tab through the page — nothing unreachable, focus always visible.
2. Zoom to 200 % — no horizontal scrolling for content.
3. View in dark mode — contrast holds.
4. Screen-reader spot check on the page's main action.

No automated a11y test exists in CI; that is a gap recorded in
[TECH_DEBT.md](TECH_DEBT.md).

## Related

- [UI/UX](UI_UX.md)
- [Frontend](FRONTEND.md)
