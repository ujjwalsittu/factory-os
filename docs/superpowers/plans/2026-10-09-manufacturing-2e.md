# Manufacturing slice 2e — implementation plan

Design: [spec](../specs/2026-10-09-manufacturing-2e-design.md), decision 049. Status: approved by the user
2026-10-09.

| # | Task | Verify |
|---|---|---|
| 1 | **Core engine (`packages/core/src/scheduling.ts`):**<br>• expand a calendar (shifts, overnight shifts, holidays, time zone) into working intervals;<br>• subtract blocks and booked intervals;<br>• allocate a duration across intervals (spanning breaks);<br>• forward scheduler with priority/due-date order, routing precedence, earliest-finish machine choice, pinned and running anchors, outsourced lead days. | Unit tests: shifts across midnight, holidays, IST boundaries, spanning, ties, pinned conflicts, zero durations |
| 2 | **Migration `--name scheduling`:** calendars, shifts, holidays, machine blocks, schedule runs, scheduled operations; work order priority and scheduled finish; work centre calendar; lead days; out-of-sequence reason. | Migrate a fresh DB and a copy of the current one |
| 3 | **Calendar API:**<br>• calendars, shifts, holidays and default;<br>• work centre calendar choice;<br>• machine blocks with overlap checks;<br>• permissions. | `smoke-calendar.mjs` |
| 4 | **Scheduling API:**<br>• run (advisory lock, transaction, run record);<br>• view by time range;<br>• move, pin and unpin, with run-id check;<br>• late and unscheduled lists;<br>• priority on work orders. | `smoke-scheduling.mjs`; manufacturing and job work suites stay green |
| 5 | **Web Gantt:**<br>• Manufacturing → Schedule with zoom, drag, pin, details, late and unscheduled lists;<br>• list view at 390 px. | `e2e:scheduling` at desktop and 390 px |
| 6 | **Calendars and blocks screens; work order priority and schedule panel.** | Covered by `e2e:scheduling` |
| 7 | **Dispatch list:** shop-floor ordering and the out-of-sequence reason dialog; out-of-sequence list for planners. | `smoke-scheduling.mjs` extension; `e2e:manufacturing` stays green |
| 8 | **Handoff:**<br>• full regression and self-review;<br>• STATUS, LOG, MEMORY updated;<br>• PR to `main`. | typecheck, build, all suites |
