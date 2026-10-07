# Manufacturing slice 2a — self-review

Design: [spec](../specs/2026-10-07-manufacturing-2a-design.md), [plan](../plans/2026-10-07-manufacturing-2a.md), decision 044.
A review by a fresh agent or human is still recommended before Finance relies on the GL side.

## What was built

- `packages/core/src/manufacturing.ts`: output valuation, exact BOM scaling, job-card minutes and
  absorption, job-card state machine (13 unit tests).
- Schema `0027_manufacturing`: work centres, machines, BOMs with materials and operations, work
  orders with frozen materials/operations, job cards with append-only events, append-only WIP
  ledger (`work_order_cost`, trigger-protected), stock purposes `production_issue/return/output`
  and `stock_entry.work_order_id`.
- API `apps/api/src/modules/manufacturing/`: masters controller, work-order service, work orders /
  shop floor / trace controller. Chart roles `wip`, `overhead_absorbed`, `production_variance`.
- Web: Work orders (list, new, detail with cost card and dialogs), Shop floor (mobile), BOMs
  (list, editor, revisions), Work centres.

## Deliberate deviations and limits

1. **Serial-tracked items are refused** in BOMs and work orders. Serial issue/output/delivery
   touches every stock movement, so it moves to slice 2b with the genealogy explorer. Batch lots
   and heat traceability work now.
2. **BOM and routing are one revisioned document.** One revision freezes both, which is what a
   work order needs; a separate routing master can come later if the same routing is shared.
3. **Rounding residue.** The stock engine stores a 6-place rate, so an output's value
   (qty × rate) can differ from its WIP share by micro-rupees. The residue stays in WIP and goes to
   variance at close. Tested.
4. **Only the operator who runs a card can pause or stop it.** Supervisors cancel instead. A
   supervisor override can be added if the floor needs it.
5. **Issues, returns and job cards can't be cancelled while an output stands**, and outputs cancel
   newest first, because each output's value was taken from what was in WIP. Over-issue is allowed
   and highlighted, not blocked.
6. **Cut-over with open work orders.** A work order with WIP when books are activated has no WIP
   balance in the GL. Enter open WIP on the WIP account in the opening worksheet, or close such
   orders before cut-over. Not enforced in code.
7. **Permissions for stores staff.** Issue/return/output need `manufacturing.work_order.submit`;
   the Inventory role doesn't have it yet. Production Planner has everything, Operator has job
   cards.

## Verification

- `pnpm --filter @factoryos/core test`: 76 tests pass (13 new).
- `apps/api/scripts/smoke-manufacturing.mjs`: 104 checks. Activated books (GL WIP/inventory/
  absorbed/variance balances at each step, close/reopen, output cancel with backflush, trace) and
  inactive books (no GL).
- Build 12/12 and typecheck 19/19 tasks pass.
- Regression: all 64 existing stock, buying, selling, accounting, settlement, sales-note,
  supplier-return, bank and withholding suites pass; `smoke-supplier-returns-races.mjs` failed twice
  then passed three times (intermittent, outside this slice; noted in STATUS).
- `e2e:manufacturing` passes on desktop and 390 px mobile.
