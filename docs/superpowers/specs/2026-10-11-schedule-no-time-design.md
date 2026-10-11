# Operations without routing time on the schedule — design (decision 054)

Follow-up from the [2e design](2026-10-09-manufacturing-2e-design.md) (risk 1) and review: "the Gantt shows operations
with zero duration as a warning" was never built. Today an in-house operation whose planned minutes are 0 is skipped
by the scheduler without a trace, so the plan looks complete when it is not. User choices, 2026-10-11: **warn and keep
planning** (no marker on the Gantt, no blocking), and **warn in the BOM routing editor** without refusing the save.

## Behaviour

- **Scheduler:** unchanged. A 0-minute in-house operation still occupies no machine time and does not stop the
  operations after it.
- **Schedule view** (`GET /manufacturing/schedule`) adds `noTime`: in-house operations of released work orders with
  0 planned minutes and quantity still to make (completed good quantity below the planned quantity). Each row has the
  operation (seq, name), work order (id, number, kind), item code and work centre. Computed when the view is read, so
  it is current even before the next reschedule. Repair and rework orders (one 0-minute operation by design) are
  listed too, marked with their kind.
- **Bars** carry `noTime: true` when their work order has such an operation.
- **Schedule page:** a "No routing time" warning list next to Late and Not scheduled, linking to the work order;
  marked bars show a warning in their tooltip/details, and the phone list shows the same marker.
- **Work order → Schedule panel:** "Operation N has no set-up or run time, so it is not on the schedule" per row.
- **BOM routing editor:** an in-house operation with 0 set-up and 0 run minutes shows an inline warning ("Not
  scheduled: no set-up or run time"); saving is still allowed.

No migration, no new permissions (`manufacturing.schedule.read` for the view, existing BOM permissions).

## Tasks

1. Claim in STATUS, this design and decision 054 to main (docs-only PR).
2. API: `noTime` list and bar flag in the schedule view; extend `smoke-scheduling` (or a new smoke) for a 0-minute
   operation, a finished one (not listed) and a rework order.
3. Web: Schedule page list and bar marker, work order panel line, BOM editor warning; extend the scheduling browser
   walkthrough (desktop and 390 px).
4. Regression (scheduling, manufacturing smokes; scheduling and manufacturing browsers), root checks, review,
   STATUS/LOG, PR.
