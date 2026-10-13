# Machine maintenance, preventive and breakdown — review and evidence (decision 066)

[Design](../specs/2026-10-12-machine-maintenance-design.md). Migration `0048_maintenance`.

## What changed

- **DB:**
  - `maintenance_plan` with a calendar and/or running-hours interval (at least one), lead days, planned minutes and
    the baseline `last_done_at`; `maintenance_plan_item` checklist lines (unit and limits for a reading, a usual spare);
  - `maintenance_order` (preventive or breakdown; open → in progress → done → verified, or cancelled), one open order
    per plan, a breakdown needs its failure time and symptom; it holds its `machine_block`;
  - `maintenance_result` (one per checklist line), `maintenance_labour` (rate and cost fixed when recorded),
    `maintenance_spare` (a system stock entry per issue);
  - `machine.critical`; stock purpose `maintenance`.
- **Accounting:** a "Repairs and maintenance (machinery)" expense role; spares issued post stock out at FIFO value
  against it when the books are active (never activated here).
- **Permissions:** `maintenance.plan.read|create|update`, `maintenance.order.read|create|update|approve|cancel`,
  `maintenance.breakdown.create`.
  - A new Maintenance role has all of them plus the reads it needs (stock, machines, schedule).
  - Operators raise breakdowns and read orders; planners read plans and orders and raise breakdowns.
- **Core** (`maintenance.ts`, 6 tests): running minutes from tap segments; `planDue` (whichever interval comes first;
  due soon within the lead days or the last 10 % of the hours); `reliability` (breakdowns starting in the period,
  downtime clipped to it, MTTR, MTBF as running hours per breakdown, availability against working hours).
- **API** (`/maintenance`):
  - plans: create, update (the checklist is fixed once the plan has orders), detail, due list (active, or all with
    `all=1`), open an order, open every due order once;
  - breakdowns: one open per machine (advisory lock), failure time not in the future and at most 7 days back; a
    breakdown block from the failure to a day ahead, extended while open and ended when the order is done;
  - orders: schedule (a maintenance block of the plan's planned minutes; reschedule moves it, clearing releases it),
    start, checklist results (a reading where there is a unit; outside the limits it needs a note), labour at the
    work-centre rate, spares issued from a warehouse and returned through the order, done (checklist complete; a
    breakdown needs cause and action; the plan counts from now; an unused reservation is released), verify (critical
    machines, by someone other than the technician), cancel (not while spares are issued);
  - machine summary (plans, open orders, history, the tap in alarm since when, last 90 days) and a per-machine report
    (breakdowns, downtime, MTTR, MTBF, availability, preventive count, spares and labour cost).
  - Running hours come from the machine's tap when it has one (gaps of up to three heartbeats count), else from
    completed job cards on that machine.
- **Web:**
  - Maintenance → Due and orders (open due orders, report a breakdown, orders by status), the order page, Plans
    (with inactive ones to reactivate) and Reliability and cost;
  - Report breakdown on the shop floor and the machine page; the machine page shows maintenance, the alarm prompt and
    the critical toggle; every machine on Plant → Machines links to its page;
  - work centres: a critical flag when adding a machine, machine codes link to their page (`*` marks critical);
  - stock entries label the `maintenance` purpose.

## Evidence

- `smoke-maintenance.mjs`: 92 request checks — plans and their due state (calendar, running hours from job cards and
  from the tap), generate once, scheduling and rescheduling the block, readings and limits, labour and spares cost,
  spares stock and GL, sign-off and release of the block, verification by a second maintenance user, breakdown block
  and its end, MTTR/MTBF/availability, cancel rules, an inactive plan, an operator who reports but cannot close,
  the tap alarm prompt, tenant isolation.
- Browser walkthrough `e2e/maintenance.mjs` (desktop and 390 px): plan with a reading and a spare, due list, order with
  an out-of-limits reading, spares, time, sign-off without self-verification, a breakdown from the machine page, the
  report, the critical mark on work centres.
- Regression: manufacturing 104, scheduling 58, IoT metering 72 and inventory smokes; manufacturing, scheduling,
  IoT metering, skill matrix and SMT browsers (the manufacturing walkthrough's machine selector now matches a link);
  typecheck 20, build 12, tests 14.

## Review notes

- Fixed during the build: the limits message showed numeric padding (`0.0000–0.0050`); the plans list dropped
  inactive plans so they could not be reactivated; the plan editor refuses to save before its checklist has loaded
  (a save would otherwise have sent an empty checklist).
- Labour in the UI is the signed-in technician's own time; the API accepts another technician for later use.
- Breakdown blocks are extended lazily, when orders, the schedule or reports are read, not by a timer. The scheduler
  run and view extend them first, so planning never sees a breakdown that has "ended".
- Availability needs a calendar; without one the report leaves it out rather than guessing.
- Not built (per the design): meter readings other than running hours, spare-part reorder planning, maintenance
  contracts with outside service companies.
