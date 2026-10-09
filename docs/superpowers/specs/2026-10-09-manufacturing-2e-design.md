# Manufacturing slice 2e — finite capacity scheduling (design)

Status: **approved by the user 2026-10-09**. User choices recorded 2026-10-09 as decision 049. Builds on:
- 2a work centres, machines, BOM routing (setup and run minutes), work orders and job cards;
- 2c outsourced operations;
- 2d rework orders.

docs/03 §6 ("job-shop scheduling: finite-capacity Gantt per machine, drag-to-reschedule, clashes with MaaS
bookings") and the Phase 2 roadmap line "Scheduler (finite capacity Gantt)" are the requirement.

## Scope

In:
- **Working calendars:** weekly shift patterns, plant holidays, and blocked time per machine.
- **Automatic forward scheduling** of released work orders onto specific machines:
  - by priority, then due date;
  - operations in routing order, never overlapping on a machine;
  - only within working time.
- **Gantt per machine:** planners drag bars to another time or another machine in the same work centre. Moved bars are pinned and stay put when the schedule is re-run.
- **Lateness:** each work order gets a scheduled finish, flagged when it is after the due date.
- **Dispatch list:** each machine's queue in schedule order on the shop-floor screen. It is advisory: an operator may start another released operation, but must give a reason, which is logged.

Out (later):
- **Material availability and MRP.** The scheduler doesn't check that material is in stock or issued. The Gantt marks operations whose work order has no material issued yet.
- **Labour and operator skills** as constraints.
- **Backward scheduling** and optimisation (minimising changeovers or tardiness).
- **Real MaaS bookings** (Phase 3). The `booking` kind of machine block is reserved for them.
- **IoT actuals** (Phase 5). Actual progress comes from job cards only.

## 1. Working calendars

- **`work_calendar`** per legal entity:
  - name and time zone (default `Asia/Kolkata`);
  - one calendar marked the entity's default.
- **`calendar_shift`:** weekday (Mon–Sun), start and end time, and name, e.g. "Mon–Sat 06:00–14:00 and 14:00–22:00".
  - A shift may end after midnight (22:00–06:00); its time belongs to the day it starts.
  - Breaks are gaps between shifts.
- **`calendar_holiday`:** date and name. No shift runs on that date.
- **Work centres** use the entity's default calendar unless they name another (`work_centre.calendar_id`), e.g. a CNC cell running three shifts.
- **`machine_block`:** a machine, a start and end, a kind (`maintenance | breakdown | booking`) and a reason.
  - Blocked time is not available to the scheduler.
  - Blocks are edited, not append-only: they are a plan.
  - `booking` is reserved for Phase 3 MaaS bookings and can't be created from the UI yet.
- **No calendar configured:** scheduling is refused with a message pointing to the calendar settings.

## 2. Durations

- **Operation duration** = setup minutes + run minutes per unit × quantity still to make. These come from the BOM routing frozen on the work order at release (2a).
  - The quantity still to make is the order quantity minus good pieces already reported on that operation's completed job cards.
  - An operation with nothing left is not scheduled.
- **Running job cards:**
  - An operation with a running or paused job card is anchored: it starts at the card's actual start on that machine and runs for its remaining duration.
  - If it runs over its plan, it is extended to now plus 15 minutes, so successors move.
- **Outsourced operations (2c):** not on a machine.
  - They take a lead time in calendar days (`lead_days` on the BOM operation, copied to the work order operation; default 7).
  - Pieces already sent count from the send date.
- **Interruptions:** an operation may span non-working time. A 10-hour job on an 8-hour shift continues next shift; the bar shows the gap.

## 3. Automatic scheduling

- **Trigger:** a planner runs "Reschedule" for the entity, which places every released work order. Releasing or cancelling a work order doesn't re-run it automatically; the Gantt shows "schedule out of date" until the next run.
- **Order of work orders:**
  1. pinned and running operations are placed first, as fixed;
  2. then work orders by **priority** (new `work_order.priority`, 1 = highest … 5, default 3);
  3. then **due date**: the sales order line's delivery date, else the work order's planned end, else none (last);
  4. then release time.
- **Each work order:** operations in sequence order.
  - An operation's earliest start is the latest of now, the previous operation's finish, and the work order's planned start.
  - It goes on the machine in its work centre where it **finishes earliest**, using that machine's free working time.
  - Ties go to the machine listed first.
- **Machines:** a work centre with no active machines can't be scheduled. Its operations are listed as unscheduled, with the reason.
- **Results:** stored as `scheduled_operation` rows (operation, machine, start, finish, pinned, run).
  - Each run replaces the unpinned rows in one transaction, under a per-entity advisory lock.
  - **`schedule_run`** records who, when, counts, and late orders.
- **Work orders** get `scheduled_finish`. The user's own `planned_start` and `planned_end` are kept as inputs.
- **Engine:** the algorithm is pure and lives in `packages/core` (calendar expansion, interval allocation, the scheduler), with unit tests.
- **Expected load:** an entity of about 50 machines and a few hundred open orders schedules well under a second.

## 4. Gantt and manual changes

- **Layout:**
  - one row per machine, grouped by work centre;
  - day and week zoom, from today to four weeks ahead;
  - non-working time shaded and blocks hatched;
  - one colour per work order (red outline when late);
  - outsourced operations in a separate "Job work" lane.
- **Drag:** a bar can move to another time or to another machine **in the same work centre**, snapping to 15 minutes. The API refuses a move that would:
  - overlap another bar or a block on that machine;
  - start before the previous operation finishes, or after the next one starts, unless that one is moved too;
  - start before now.
- **Pinned bars:**
  - A moved bar is **pinned** and stays fixed on re-run, until the planner unpins it.
  - Work after it isn't moved automatically; the Gantt shows conflicts, and "Reschedule" places the unpinned work around pinned bars.
- **Optimistic check:** every move carries the run id it was based on. A move made on an older run is refused ("the schedule changed; reload").
- **Detail:** clicking a bar shows the work order, operation, quantity, duration, due date, and a link to the work order.
- **Lists:** "Late orders" lists work orders whose scheduled finish is after their due date. "Unscheduled" lists operations that couldn't be placed, with reasons.
- **Phones:** the Gantt is for desktop and tablet. At 390 px the page shows the per-machine queue as a list instead.

## 5. Dispatch list (shop floor)

- **Queue:** the shop-floor screen sorts released operations per machine by scheduled start, showing the next few. Unscheduled operations follow, as today.
- **Starting out of sequence:** an operator who starts an operation that isn't first in that machine's queue, or on another machine than scheduled, is asked for a reason. Starting is not blocked.
  - The reason goes on the job card (`out_of_sequence_reason`) and in its start event.
  - A planner can list out-of-sequence starts.
- **Feedback:** job cards update the schedule only through the anchoring rules in §2, on the next run.

## Data changes (one migration, `--name scheduling`)

New tables:
- `work_calendar`, `calendar_shift`, `calendar_holiday`;
- `machine_block`;
- `schedule_run`, `scheduled_operation`.

Changes to existing tables:
- `work_centre.calendar_id`;
- `work_order.priority`, `work_order.scheduled_finish`;
- `bom_operation.lead_days` and `work_order_operation.lead_days` (outsourced only);
- `job_card.out_of_sequence_reason`.

## Screens

- **Settings → Working calendars:** shifts per weekday, holidays (with a copy from last year), and the default.
- **Manufacturing → Schedule:** Gantt, Reschedule button, late and unscheduled lists.
- **Work centres:** calendar choice. **Machines:** downtime blocks.
- **Work order:** priority field, scheduled finish, and the schedule of its operations.
- **Shop floor:** dispatch order per machine, with the out-of-sequence reason dialog.

## Permissions

New:
- `manufacturing.schedule` (read/update): view; run and drag;
- `manufacturing.calendar` (read/update): calendars, holidays, machine blocks.

The Production Planner role gets both. Operators and Supervisors get `schedule.read`.

## Risks

1. **Plan quality depends on routing times.** Set-up and run minutes are often missing or rough. The Gantt shows operations with zero duration as a warning.
2. **No material check:** a scheduled operation may have no material. The marker in §Scope is the mitigation until MRP.
3. **Migration number:** 0031 on main after 2d. The passkeys branch must renumber again (see STATUS).
4. **No new dependency:** the Gantt is built with the existing UI kit, CSS grid and pointer events, not a charting library.
