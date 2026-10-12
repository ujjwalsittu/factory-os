# SMT board traceability with printed 2D labels — review and evidence (decision 065)

[Design](../specs/2026-10-12-smt-traceability-design.md). Migration `0047_smt_traceability`.

## What changed

- **DB:**
  - `label_printer` (behind an edge) and `print_job` (queued → sent with a lease → printed or failed, three attempts);
  - `smt_container` (reel or paste jar of a lot) and `smt_container_event` (append-only by trigger);
  - `smt_feeder_load`, with one open load per slot and per container;
  - `smt_panel`, and `smt_board` (a serial reserved per position, the output batch, scrap);
  - `bom.boards_per_panel`, and `item.paste_thaw_minutes` / `paste_open_hours`.
- **Permissions:** `manufacturing.smt.read|create|update`.
  - Planners get all three (`manufacturing.*`); operators read and update; stores all three; quality read.
  - Printers use `plant.device.manage`.
- **Core** (`smt.ts`, 10 tests):
  - the MSL floor-life clock: J-STD-033 floor lives, paused in the dry cabinet, reset by a bake; MSL 6 needs a bake
    and uses its label time;
  - paste thaw, open time and expiry (end of the day in India);
  - which loads a placed panel saw;
  - ZPL labels with a DataMatrix and escaped field data.
- **API:**
  - containers: create from a lot in stock, list (least time left first), detail with events and boards, events
    allowed by phase, print;
  - feeder: load, unload and splice. Loading is refused for:
    - a part that is not on the work order, or a container already on a feeder;
    - a busy slot (unless splicing);
    - an expired reel or lot, or paste that isn't ready.

    Scanning a container on records it as opened, out of the dry cabinet, or paste opened.
  - panels:
    - print N panels, reserving serials from the item's counter; at most the order's remaining quantity;
    - the placement scan is refused with nothing loaded or a loaded container out of date. It lists BOM materials not
      on the machine's feeders;
    - the depaneling scan prints board labels;
    - board scrap;
  - output takes depaneled good boards (scanned or oldest). Cancelling frees them, and output again reuses their
    serial batches;
  - trace: a board's reels per slot with the state at placement; a reel's or lot's boards; scan resolve; ZPL
    downloads;
  - printers CRUD and test; print jobs and reprint; the edge endpoints `GET /iot/print-jobs` (claim, 60 s lease) and
    `POST /iot/print-jobs/:id/result`.
- **Edge agent:** `PrintRelay` polls every 3 s, sends the ZPL over TCP and reports each result.
  - It only prints to `PRINTER_PORTS` (default 9100) and, if set, `PRINTER_HOSTS`, so FactoryOS can't direct the edge
    at other plant machines.
- **Web:**
  - Manufacturing → SMT line: work order, machine and printer remembered per browser; Feeder setup, Panels, Reels and
    paste;
  - the SMT section on batch pages: a board's reels, or a lot's boards for a recall;
  - a Label printers card and recent labels in Plant → Devices;
  - paste times on items and boards per panel on BOMs.

## Evidence

| Check | Result |
|---|---|
| `smoke-smt.mjs` (new) | 139 request checks: everything in "What changed" above, plus isolation |
| Core unit tests | 142 (10 new) |
| Edge agent tests | 15 (4 new): ZPL over TCP to a fake printer, an unreachable printer, allowed ports and hosts, results |
| Edge agent `check-against-api.mjs` | A test label from FactoryOS reached a fake TCP printer through the edge and was reported printed, plus the metering and tap config checks |
| `e2e/smt.mjs` (new), desktop and 390 px | Open a reel; load two reels by scanning; a wrong part refused; panel labels printed; placement and depaneling scans; after output, the board page shows its reels and the lot page its boards; the printer and labels in Plant → Devices |
| Regression smokes | Manufacturing 104, serials 59, job work 101, quality 112, scheduling 58, IoT metering 72, tap config 37 |
| Regression browsers | Manufacturing, IoT metering, batch page |
| Firmware check | Passed (unchanged) |
| Root checks | Typecheck 20, build 12, tests 14 |

What `smoke-smt.mjs` covers:

- paste and panel masters;
- containers;
- the MSL clock, with bake;
- paste thaw;
- wrong part, busy slot, splice;
- panel limits;
- the placement and depaneling rules;
- scrap;
- output (oldest and scanned), and cancel and re-output with the same serials;
- board and recall trace;
- emptying while loaded;
- the dry cabinet;
- edge claim, retry, failure and reprint;
- ZPL download;
- isolation;
- review fixes: a serial received by hand is not taken over by a board's output; scrap can be scoped to a work order;
  retiring a printer fails its labels in flight.

## Changes from the design during the build

1. **Placement doesn't require every BOM material on the feeders.**
   - The design refused a placement scan with a material missing. Real BOMs carry the bare board and hand-fitted
     parts that never go on a feeder, so the rule would block every panel.
   - Placement is now refused only when nothing is loaded on the machine, or a loaded container is out of date. The
     response and the page list the materials not on that machine's feeders.
2. **Permissions use the catalog's actions:** `read`, `create` (new reels and jars) and `update` (scans, loads,
   events, printing), not `operate`/`manage`. Panelization is edited with `manufacturing.bom.update` like the rest of
   the BOM.

## Review fixes

From the PR's automated review:

- **Re-output after a cancel** reuses a serial batch only if this work order's own output made it. Before, a unit
  received by hand under a reserved board serial would have been taken over.
- **Board serials shared by two items:** scrap is scoped to the work order on the SMT page. Trace and scan resolve
  refuse an ambiguous serial instead of picking one.
- **Retiring a printer** fails its in-flight (sent) labels as well as queued ones.
- **The edge agent** refuses a `PRINT_POLL_MS` that isn't 0 or at least 500 ms, which would otherwise poll in a tight
  loop.
- **The feeder load note** uses the submitted slot and splice, not the fields as they are when the request finishes.

## Self-review

Limits and follow-ups (not blocking):

1. **Board-scanned output is API only.** The work order's output dialog doesn't scan boards yet, so it outputs the
   oldest depaneled boards.
2. **Active BOMs are frozen.** An existing PCBA BOM needs a new revision to set boards per panel.
3. **Long panel codes.** Panel codes carry the full work order number (`P-AZ/WO/26-27/00001-001`). The DataMatrix holds
   it easily, but the human-readable line is long on small labels.
4. **Labels can print twice.** If the edge prints a label but its result is lost, the lease runs out and it prints
   again. Losing a label would be worse.
5. **List speed.** The reel list and trace read each container's events one by one (up to 500 containers). This is fine
   for one line; add a summary view if lists grow.
6. **Reel quantities aren't counted down.** They are not reduced by placements, and there is no reel merge. Both
   belong with CFX pick counts.
7. **MSL rules.** The dry-cabinet pause is by scan and conservative (no J-STD-033 partial resets). The cabinet's own
   RH logger is the environment-node slice.
