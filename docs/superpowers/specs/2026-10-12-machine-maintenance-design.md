# Machine maintenance: preventive and breakdown (decision 066)

The maintenance item of [09 · Roadmap](../../09-roadmap.md) (Phase 2: "maintenance (preventive/breakdown)") and
[07 · IoT](../../07-iot.md) ("maintenance counters → maintenance orders"). It builds on:

- machines and work centres (decision 044);
- the scheduler's machine blocks (decision 049);
- the taps' metered machine states (decisions 063 and 064).

User choices, 2026-10-12:

1. **Preventive triggers:**
   - each plan has a calendar interval, a running-hours interval, or both; whichever comes first is due;
   - running hours come from the machine's tap (metered `running` time) or, on machines without a tap, from job card
     run time.
2. **Breakdowns:**
   - any operator raises one from the shop floor or the machine page;
   - the machine is blocked on the schedule from that moment until maintenance closes it;
   - MTTR and MTBF per machine;
   - a tap in `alarm` for a while offers to raise one.
3. **Spares and cost:**
   - maintenance orders issue spares from stores by FIFO (stock purpose `maintenance`), expensed to a repairs and
     maintenance account;
   - technician hours are recorded at the work centre's labour rate;
   - a cost-per-machine report.
4. **Orders:**
   - plans carry a checklist, with measured readings and limits where needed;
   - an order completes only when every item is done and the technician signs;
   - machines marked critical also need a supervisor's verification.

## Model (migration `0048_maintenance`)

- **Machines:** `machine.critical` (bool), and `machine.maintenance_owner` (a user, optional).
- **Maintenance plans** (`maintenance_plan`):
  - machine, name and instructions;
  - `every_days` and/or `every_run_hours` (at least one);
  - `lead_days`: due-soon warning;
  - `planned_minutes`: blocks the schedule for that long when the order is scheduled;
  - active flag.
  - A checklist (`maintenance_plan_item`): ordered text, optional unit with min/max (a reading is required and checked
    against the limits), and optional required spares (item and qty).
  - The baseline: `last_done_at` and `last_done_run_hours`, set from the last completed order. When a plan is created,
    the baseline is entered or taken as today.
- **Running hours** (pure function in `@factoryos/core`, unit-tested):
  - a machine with a tap: metered `running` minutes from `machine_state_event` (decision 063 timeline);
  - otherwise: sum of job card run minutes on the machine (decision 044).
  - The machine page shows the source used.
- **Due:** a plan is due when today ≥ last done + every days, or running hours since last done ≥ every run hours.
  Due soon is within lead days, or within 10 % of the hours.
- **Maintenance orders** (`maintenance_order`, series `MO`):
  - kind `preventive` (from a plan) or `breakdown`;
  - status `open` → `in_progress` → `done` → `verified` (critical machines), or `cancelled` (with a reason);
  - preventive orders are opened by **Generate due orders** (one open order per plan at a time) or by hand;
  - `scheduled_start`: when set, a `maintenance` machine block of the plan's planned minutes is created for the
    scheduler, and moved or removed with the order;
  - breakdown orders hold the reporter, symptom, `failed_at`, and an optional link to the tap alarm that suggested it.
    They create a `breakdown` machine block from `failed_at` that stays open until the order is done;
  - **checklist results** (`maintenance_result`): per item, done, reading (inside the limits or refused with a note),
    who and when;
  - **labour** (`maintenance_labour`): technician, minutes and date, costed at the machine's work centre rate;
  - **spares**: an issue with stock purpose `maintenance` from a stores warehouse (batch/serial aware, FIFO). It is
    posted Dr repairs and maintenance (new account role `maintenance`), Cr inventory, and can be cancelled while the
    order is not done;
  - **done:** every checklist item done, the technician's sign-off, and for a breakdown the cause and action taken;
  - **verified:** a supervisor (`maintenance.order.approve`) other than the technician, required for critical
    machines. A done or verified order sets the plan's baseline;
  - append-only history in the audit log.
- **Breakdown block:** while a breakdown is open, the scheduler sees the machine as unavailable from `failed_at` to
  "now + 1 day", extended daily. When the order is done the block ends at the completion time, so the schedule is
  rebuilt around the real downtime.

## Reports

- Per machine and period:
  - **availability**: scheduled time minus breakdown downtime;
  - **MTBF**: running hours between breakdowns;
  - **MTTR**: mean breakdown duration from `failed_at` to done;
  - **planned vs breakdown** order counts;
  - **cost**: spares value plus labour.
- **Due list:** overdue, due soon, and next due date or hours per plan.

## API and permissions

- New permissions:
  - `maintenance.plan.read|create|update`;
  - `maintenance.order.read|create|update|approve|cancel`;
  - `maintenance.breakdown.create`.
- Roles:
  - a new Maintenance role: plans and orders, issue spares, read stock;
  - operators: `maintenance.breakdown.create` and order read;
  - production planners: read;
  - administrators: everything.
- Endpoints:
  - plans: CRUD and checklist, due list, generate due orders;
  - orders: create, schedule, start, record result, labour, spares issue/cancel, done, verify, cancel; breakdown
    report;
  - machine maintenance summary;
  - reports.

## Web

- **Maintenance → Due**, with Generate due orders.
- **Maintenance → Orders:** list and order page with checklist, labour, spares, sign-off and verification.
- **Maintenance → Plans.**
- **Reports:** availability, MTBF, MTTR, cost.
- **Shop floor and machine page:**
  - a **Report breakdown** button;
  - the machine page shows open orders, the next due plan, running hours and its source, and the history;
  - a tap alarm of 10 minutes or more shows "Raise a breakdown?".
- The schedule already shows maintenance and breakdown blocks.

## Not in this slice

- Condition-based triggers from analog values (vibration, temperature) and predictive alerts.
- Purchase requests for missing spares (the order shows shortages).
- Contractor (AMC) visits as service purchase orders.
- Mobile push notifications.

## Tasks

1. Claim in STATUS, this design and decision 066 to main (docs-only PR).
2. Core: running hours from states or job cards, due calculation, MTBF/MTTR/availability (unit tests).
3. Migration `0048_maintenance`, permissions, roles, the `MO` series, the `maintenance` stock purpose and account role.
4. API:
   - plans, the due list and generation;
   - orders with checklist, labour, spares issue (GL), done and verify;
   - breakdowns with machine blocks;
   - reports;
   - smoke `smoke-maintenance.mjs`.
5. Web:
   - Maintenance pages;
   - breakdown from the shop floor and machine page;
   - machine page summary;
   - browser walkthrough.
6. Regression and wrap-up:
   - scheduling, manufacturing, IoT and inventory smokes and browsers;
   - root checks;
   - review, STATUS/LOG and the PR.
