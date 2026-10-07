# Manufacturing slice 2a — design

Status: written design, choices from decision 044 (user, 2026-10-07). Phase 2 in
[roadmap](../../09-roadmap.md); flow in [docs/03 §6–7](../../03-manufacturing-inventory.md).

## Scope

In: work centres and machines; bill of materials with operations (one revisioned document, "BOM");
work orders that freeze the BOM revision at release; issue of material to the work order (WIP);
return of unused material; job cards per operation with start/pause/stop; output of the finished
item into stock (lot = batch for batch-tracked items); close with actual cost; GL when books are
active; traceability from output batch back to issued batches.

Out (later slices): serial-tracked items (2b, with the genealogy explorer and serial-level
issue/delivery); remnant bars; job work and ITC-04; inspection plans/FAI/NCR; finite scheduling;
MRP; offline shop-floor app and IoT auto-fill; customer-owned material on work orders.

## Model

| Table | Purpose |
|---|---|
| `work_centre` | Entity-scoped machine group. `hourly_rate` (INR, machine + labour) is the absorption rate. |
| `machine` | Belongs to a work centre. Optional on a job card. |
| `bom` | Entity-scoped, for one item, `revision` unique per item, `quantity` it makes, status `draft → active → obsolete`. One active default per item. Active BOMs are frozen; change = new revision. |
| `bom_material` | Item, qty per BOM quantity, `backflush` flag. |
| `bom_operation` | Sequence (10, 20…), name, work centre, setup minutes, run minutes per unit, instructions. |
| `work_order` | Number `{ENTITY}/WO/{FY}/{#####}` on release. Item, planned qty, BOM, source and target warehouses, optional sales order, status `draft → released → completed`, or `cancelled` (only before anything posts). |
| `work_order_material` / `work_order_operation` | Copied from the BOM at release, scaled to planned qty. Later BOM revisions never change them (AS9100 configuration control). |
| `job_card` + `job_card_event` | One card per operation run. Events are append-only: start, pause (reason), resume, stop. Minutes = sum of running intervals. On completion: good/rework/scrap qty, rate snapshot, value = minutes / 60 × rate. |
| `work_order_cost` | Append-only WIP ledger per work order: issue (+), return (−), absorption (+), output (−), close variance (−), each reversal negates its row. WIP balance = sum. |

Stock movements reuse the stock entry engine with three new purposes, created by the work order
(`system_generated`, `work_order_id` set): `production_issue` (out), `production_return` (in, at
the cost it was issued) and `production_output` (in). FIFO, bins, expiry, availability and
"cancel through the source document" behave exactly as today.

## Rules

- **Issue**: any item, any qty; over-issue against the requirement is allowed but shown. Batch is
  chosen by the user (FIFO suggestion, or the specific heat). Customer-owned stock is refused.
- **Return**: at most what was issued net for that item and batch, valued at the issued average
  for that item/batch on this work order.
- **Backflush**: on output, backflush lines are issued automatically (`required per unit × output
  qty`) from the source warehouse. Backflush items must not be batch-tracked.
- **Job card**: one running card per operator at a time. Stop requires quantities; completion
  absorbs cost into WIP.
- **Output value (actual costing)**: `value = WIP balance × q / (planned − produced)`; the output
  that reaches the planned qty takes the whole remaining balance. Outputs beyond planned qty are
  allowed and take the remaining balance (zero if nothing left). Rate = value / q.
- **Close**: allowed once released. Remaining WIP balance (labour after the last output, issues
  without output) goes to *Manufacturing variance*. Closed work orders accept nothing more.
- **Cancellation** (exact reversals, append-only): output can be cancelled only if it is the
  latest active output, its stock is untouched, and the work order isn't closed. Issues, returns
  and job cards can be cancelled only while the work order has no active output. Close can be
  reopened (reverses the variance). Cancelling a draft/released order with nothing posted is
  allowed.

## GL (books active only, decision 034)

| Event | Debit | Credit |
|---|---|---|
| Issue | WIP | Inventory |
| Return | Inventory | WIP |
| Job card completion | WIP | Manufacturing overhead absorbed |
| Output | Inventory | WIP |
| Close variance | Manufacturing variance | WIP |

New account roles: `wip` (Stock-in-Hand), `overhead_absorbed` (Direct Expenses, credit balance
offsets actual wages/machine costs), `production_variance` (Direct Expenses). Seeded like the
other roles; postings on inactive entities do nothing.

## Permissions

`manufacturing.work_centre.{read,create,update}`, `manufacturing.bom.{read,create,update,submit,cancel}`,
existing `manufacturing.work_order.*` (create/submit = release/cancel/approve = close) and
`manufacturing.job_card.*`. Production Planner gets all; Operator gets job cards plus reads.

## Screens

Manufacturing nav: Work orders, Shop floor (job cards), BOMs, Work centres. Work order page:
requirements vs issued, issue/return dialogs with batch picker, operations with job cards, outputs,
cost card (material, absorbed, output, WIP balance), close. Shop floor: mobile list of released
operations, big start/pause/stop buttons, quantity entry. Trace view: output batch → work order →
issued batches (backward) and issued batch → outputs (forward).
