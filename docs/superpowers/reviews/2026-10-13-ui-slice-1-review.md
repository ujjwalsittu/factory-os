# UI slice 1: page pattern, phone and date fixes (review and evidence, decision 068)

This is slice 1 of the [design](../specs/2026-10-13-ui-menu-connections-design.md), built from the
[UI audit](2026-10-13-ui-audit.md). Business rules, API, data and permissions are unchanged.

## What changed

- **Dates read DD-MM-YYYY.** The shared `DateInput` (`@factoryos/ui`) shows and accepts DD-MM-YYYY. It also accepts `/`
  or `.` as separators and a pasted ISO date, and it has a calendar button that opens the browser's picker. It still
  stores the same ISO date. An impossible date (31-02) is marked invalid and clears the value, so the previous date is never
  submitted by mistake; a date outside the field's limits is marked invalid. It replaces every native date field: 65 direct uses in 41 files, plus the shared helpers that
  draw the bank reconciliation and sales form dates. The 9 date-and-time fields stay native for now. The parser has unit tests.
- **Page header.** The title block shrinks beside the actions, so "New …" stays at the top right even with a long
  description. Before, a long description pushed the button under it on the left, which caused the "actions on the
  left" drift on BOMs, calendars, CAPA, NCR and other pages. On phones the actions wrap under the title. Card headers
  work the same way.
- **One empty state.** `EmptyState` gains a compact, one-line size. Forty plain "No … yet" sentences in cards and
  tables now use it, plus the e-mail delivery table.
- **Phones.** No page now scrolls sideways at 390 px. There were three causes. Fieldsets size to their widest content
  by default (now `min-width: 0`). A card in a grid grew to the width of its table instead of letting the table scroll
  (cards are now `min-w-0`). Some button rows did not wrap (stock entries, GST sandbox, credit application).
- **Draft headings.** Monospace is used only for a document number. "New purchase order" and "Draft landed cost" use
  the normal heading font. The sales forms now show their number in monospace.
- **Small fixes.** The GST % select on purchase orders and invoices fits "From HSN". Home loses the development roadmap
  and the "from Phase 1" text. The Finance pages' description is in plain words.
- **Audit script.** It is now a regression check. For each page that overflows it names the elements wider than their
  container. `ROUTES` and `WIDTHS` re-check chosen pages.

## Checked and left as is

- **Sidebar background.** The audit's full-page screenshots showed the background ending after one screen. The sidebar
  is `sticky` and full height, so in a real browser it stays in view while the page scrolls. The screenshot only
  captures it at the top. It is not a bug.
- **One-line components.** Only the lines touched here were changed. Reformatting whole files would hide the real
  changes in review, so it waits for slices that rework those screens.

## Evidence

- UI audit: 194 page views (97 pages at 1400 px and 390 px), **0 overflowing pages** (10 before), 0 console errors, 0
  failed calls, every page has a heading.
- Browser walkthroughs: see the PR for the full list and results.
- `@factoryos/ui` date tests (3), web and root typecheck, build and tests.
