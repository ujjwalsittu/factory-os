# Manufacturing slice 2e — self-review

Design: [spec](../specs/2026-10-09-manufacturing-2e-design.md), [plan](../plans/2026-10-09-manufacturing-2e.md),
decision 049. Migration `0031_scheduling`. A review by a fresh agent or human is still recommended.

## What was built

- **Core engine** (`packages/core/src/scheduling.ts`, pure, 19 unit tests):
  - Expands a calendar into working time in its own IANA time zone:
    - weekly shifts, including night shifts past midnight that belong to the day they start;
    - holidays.
  - Subtracts downtime, and refuses calendars whose shifts overlap within the week (a Sunday night shift wraps into Monday).
  - Allocates work minute by minute across breaks.
  - Forward scheduler:
    - pinned and running operations are placed first, as fixed;
    - work orders by priority, then due date (none last), then release time;
    - operations in routing order, each on the machine of its work centre that finishes it earliest (ties to the first listed);
    - outsourced operations take their lead days off-machine;
    - operations it can't place are listed with a reason, together with those after them.
- **Calendars and downtime:**
  - **Calendars:** shifts and holidays per entity, replaced as a whole on save.
    - The first calendar becomes the default; moving the default is explicit.
    - A calendar in use by a work centre stays active.
    - Time zones are validated.
  - **Work centres** may name a calendar; otherwise they use the default.
  - **Machine downtime:** `maintenance` and `breakdown` blocks, with no overlap on one machine.
    - `booking` is reserved for Phase 3 and refused from the API.
- **Scheduling API:**
  - **Reschedule:**
    - runs under a per-entity advisory lock;
    - places released work over 28 days;
    - replaces the placements in one transaction;
    - keeps pinned ones;
    - records the run with its unscheduled operations and conflicts;
    - sets each work order's scheduled finish.
  - **View:** bars in a time range, with downtime, working time per calendar, and lists of late, unscheduled and conflicting work.
    - Each bar is marked when it is late, pinned, running, or its order has no material issued.
    - The view is flagged out of date when any work order changed after the run.
  - **Move:**
    - another time, or another machine in the same work centre;
    - the work fills free time from the new start;
    - the bar is pinned.
  - **Move refusals:**
    - overlap with another bar;
    - a start inside downtime or downtime within the span;
    - starting before the previous operation finishes, or finishing after the next machine operation starts;
    - a start in the past;
    - a running operation;
    - a run id that isn't the latest.
  - **Other endpoints:** unpin, work order priority, and the out-of-sequence list.
- **Dispatch list:**
  - The shop floor lists operations in schedule order (unscheduled last) and shows each machine's next job.
  - Starting anything but the next job on the chosen machine, or on another machine than scheduled, returns 409 until a reason is given.
  - The reason is kept on the job card and in its start event, and listed for planners.
- **Screens:**
  - Manufacturing → **Schedule:**
    - per-machine Gantt with day and week zoom, shaded non-working time, hatched downtime and a now line;
    - drag snapped to quarter hours; click for details and unpin;
    - late, not-scheduled and out-of-sequence lists;
    - a per-machine list instead of the Gantt on phones.
  - Manufacturing → **Calendars:**
    - shift editor with "copy Monday to Tue–Sat";
    - holidays with "copy to next year";
    - downtime table.
  - **Elsewhere:**
    - work centre calendar choice;
    - BOM lead days for outsourced operations;
    - work order priority at creation, plus a Schedule panel on the order (priority, scheduled finish, its operations);
    - shop-floor "Next on M1" and the reason prompt.
- **Permissions:**
  - `manufacturing.schedule.read|update` and `manufacturing.calendar.read|update`;
  - Production Planner gets all of them; Operator gets `schedule.read`.

## Deviations from the written design

1. **Remaining time is proportional to quantity.** A work order operation stores only its total planned minutes, so the time left is that total × quantity still to make ÷ planned quantity. Setup is spread over the pieces rather than counted once.
2. **Outsourced lead time counts from the previous operation's finish.** It doesn't use the date pieces were sent. Operations whose pieces are all back are left out.
3. **Due dates come from the sales order header.** Sales order lines have no delivery date. Without a sales order, the work order's planned end is the due date, interpreted in the default calendar's time zone.
4. **Out of date means any work order changed since the run.** The spec said release or cancel only. Priority changes and movements also count.
5. **Starting a job card without a machine never needs a reason.** The dispatch check needs a machine to compare.
6. **Operations with no routing time are skipped.** The spec wanted them shown as a warning. They can't yet be told apart from finished operations; this is a follow-up.

## Deliberate limits

1. **No material or labour constraints.** The Gantt marks orders with no material issued, as the spec says.
2. **A move doesn't push the operations after it.** It is refused instead. The planner moves the later one first, or reschedules.
3. **Calendars are per work centre.** A single machine on a different shift needs its own work centre or downtime blocks.
4. **Job card events update the schedule only on the next Reschedule.** No automatic re-run.
5. **The week view is coarse (10 px per hour).** The day view is for detailed moves.
6. **Booking blocks have no screen.** They wait for Phase 3 MaaS.

## Verification

- Core unit tests: 113 pass, 19 of them for scheduling (zoned time, night shifts, holidays, allocation, overlaps, ordering, pinning, running cards, outsourcing, unscheduled).
- `smoke-calendar.mjs`: 32 checks.
- `smoke-scheduling.mjs`: 58 checks. It covers exact placements on a round-the-clock calendar, moves and every refusal, pin and unpin, priority, stale runs, unscheduled operations, running job cards, downtime, dispatch order and the out-of-sequence reason.
- `smoke-manufacturing` (104), `smoke-job-work` (101) and `smoke-quality` (112) still pass.
- `e2e:scheduling` passes on desktop and at 390 px; `e2e:manufacturing` still passes.
- Root typecheck (19 tasks), build (12) and tests pass. Full API regression: 74/74 suites.
