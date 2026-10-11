# Operations without routing time on the schedule — review and evidence (decision 054)

[Design](../specs/2026-10-11-schedule-no-time-design.md). Closes risk 1 of the
[2e design](../specs/2026-10-09-manufacturing-2e-design.md) ("the Gantt shows operations with zero duration as a
warning"). No migration, no new permissions; the scheduler itself is unchanged.

## What changed

- **API** (`scheduling.service.ts`): the schedule view returns `noTime`, the in-house operations of released work
  orders with 0 planned minutes and quantity still to make. It skips any with a running or paused job card and is
  computed when the view is read. Each row names the operation, order, item and work centre, and whether it is a rework
  or repair order. Bars carry `noTime` when their order has such an operation.
- **Web:**
  - **Schedule page:** a "No routing time" list linking to the work order. A warning icon on marked bars, with tooltip
    text and a badge in the selected-bar details. A "No routing time" badge in the phone list. The four lists sit in
    two columns.
  - **Work order → Schedule panel:** "Operation N has no set-up or run time, so it is not on the schedule".
  - **BOM routing editor:** "Not scheduled: no set-up or run time" under an in-house row with a work centre and no
    set-up or run minutes. Saving is unchanged.

## Review

One adversarial pass over the diff. No Critical or Important finding.

- Checked:
  - The list is scoped to the active entity, and the new smoke shows another tenant sees nothing.
  - Outsourced operations are excluded, since they are planned by lead days.
  - An operation drops off once its completed good quantity reaches the planned quantity. Partial completion keeps it
    listed.
  - A running 0-minute operation is placed by the scheduler as running, so it is not listed.
  - Rework and repair orders (always one 0-minute operation) are listed and marked as rework.
- **Noticed, not changed:** a rework order's operation can never get a routing time (it has no BOM), so it stays in
  the list until done. This is intended by the design and visible as "Rework".

## Evidence

| Check | Result |
|---|---|
| `smoke-schedule-no-time.mjs` (new) | 32 request checks PASS |
| `smoke-scheduling.mjs` / `smoke-manufacturing.mjs` / `smoke-quality.mjs` | 58 / 104 / 112 PASS |
| `e2e:schedule-no-time` (new, desktop + 390 px) | PASS |
| `e2e:scheduling` / `e2e:manufacturing` | PASS |
| `pnpm typecheck` / `pnpm build` / `turbo run test --force` | 19 / 12 / 11 tasks PASS |
| `pnpm lint` | 0 configured tasks |
| `git diff --check` | clean |
