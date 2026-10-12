# SMT board traceability with printed 2D labels (decision 065)

The SMT line case of [11 · IoT machine plan](../../11-iot-machine-plan.md) §2A and
[03 · Manufacturing](../../03-manufacturing-inventory.md) §4 (SMT):

- every board can be traced to the reels, component lots and solder paste it was built with;
- moisture-sensitive parts and paste are controlled on the line.

Machine interfaces (IPC-CFX) are not confirmed or installed yet, so this slice works by **scanning**. CFX data plugs in
later against the same panels and boards.

User choices, 2026-10-12:

1. **Scope:**
   - 2D board labels;
   - reels as tracked containers;
   - feeder setup per work order by scanning;
   - MSL floor-life clocks and solder paste control;
   - the board serial page.
   - Not in this slice: CFX ingest.
2. **Board identity:**
   - one label on the **panel** rail before the paste printer;
   - FactoryOS assigns a serial to every **board position** on the panel;
   - at depaneling each board gets its own label, so the link is kept.
3. **Printing:** FactoryOS sends ZPL to the plant's **edge agent**, which prints to a Zebra-compatible printer on the
   plant network (raw TCP, port 9100).
4. **Granularity:**
   - **reels per feeder setup**: reels are scanned onto feeder slots for a work order;
   - every board placed while a reel was loaded links to that reel and its lot;
   - reel changes and splices are scanned too;
   - not per placement.

## Building on what exists

- **Serials and genealogy.** A PCBA is a **serial-tracked item** (decision 046): a serial is a batch of one. Genealogy
  and the batch page (decision 053) already show serials.
- **Work orders.** Material issue, backflush and output stay as they are (decision 044). Component lots are still
  issued to the work order by batch, and stock and cost do not change.
  - New here: which reel (and so which lot) each board saw, and when.
- **Printers.** Edges and keys come from decision 063. Printers hang off an edge like taps do.

## Model (migration `0047_smt_traceability`)

### Masters

- `bom.boards_per_panel` (1–100, null = not panelized). Set on the PCBA's BOM; only serial-tracked items.
- On items:
  - `msl_level` already exists. Its floor life follows **J-STD-033**: 1 unlimited, 2 one year, 2a 4 weeks, 3 168 h,
    4 72 h, 5 48 h, 5a 24 h. Level 6 parts must be baked before use; their time on label is entered per reel.
  - New for solder paste: `paste_thaw_minutes` (e.g. 240) and `paste_open_hours` (e.g. 24). An item with these set is a
    paste. The jar's expiry is the batch expiry.
- Label printers (`label_printer`) belong to an edge:
  - code, name, host, port (default 9100), dpi (203/300/600), label width and height in mm;
  - managed in Plant → Devices.

### Containers: reels and paste jars

- `smt_container` is a **reel** or a **paste jar**:
  - a code: its own printed label, or the supplier's reel ID scanned;
  - the item and **batch (component lot)**;
  - the quantity on it when created;
  - its warehouse at creation;
  - an MSL time-on-label for level 6.
- Reels are created from a lot already in stock, any number per lot. Creating a reel is a **split** of the lot for
  traceability only: stock and FIFO stay at lot level. **Merge** is out of scope: a partial reel is just a reel with
  less on it.
- **Events** (`smt_container_event`) are append-only, each with who and when:
  - reels: `opened` (dry pack opened), `cabinet_in`, `cabinet_out`, `baked`, `resealed`, `empty`;
  - paste jars: `out_of_fridge`, `opened`, `back_in_fridge`, `empty`.
- **MSL clock** (pure function in `@factoryos/core`, unit-tested): floor time used is the time since `opened`.
  - The clock pauses between `cabinet_in` and `cabinet_out`, and stops while `resealed`.
  - `baked` resets it to zero.
  - The reel is **expired** when time used ≥ floor life; it must be baked before it can be loaded.
  - We **pause** in the dry cabinet rather than apply J-STD-033's partial resets. This is conservative: it never
    gives more floor life than the standard.
- **Paste** (pure function, unit-tested):
  - **ready** once `out_of_fridge` is at least `paste_thaw_minutes` old;
  - **over open time** once `opened` is more than `paste_open_hours` old;
  - **expired** after the batch expiry date.
  - `back_in_fridge` is allowed only before `opened`.

### Feeder setup

- `smt_feeder_load` records:
  - the work order and the line's placement machine (a `machine` on the SMT work centre);
  - the slot (free text, e.g. `F12-L` or `PASTE`);
  - the container;
  - loaded at and by; unloaded at and by.
- **Loading is refused** when:
  - the container's item is not a material of the work order's BOM (wrong part);
  - a reel is expired, or a paste jar isn't ready, is over its open time or is expired;
  - the slot already has a container (unload it first, or **splice**: one scan unloads the old reel and loads the new
    one at the same moment).
- An `opened` event is recorded automatically when an MSL reel still in dry pack is loaded.

### Panels and boards

- **Panel labels.** On a released work order with a panelized BOM, **Print panel labels** for N panels:
  - creates `smt_panel` rows (code `P-{work order number}-{nnn}`);
  - **reserves the board serials** (`smt_board`: panel, position 1…boards per panel, serial number) from the same
    gapless counter as production output (decision 046);
  - queues one label per panel.
  - At most the work order's remaining quantity, rounded up to whole panels.
- **Scans along the line**, each recording when and who:
  - **Placed**: at line entry, before the placer. This is the moment that ties the panel's boards to the reels loaded
    on the work order then. It is refused if a BOM material has no container loaded.
  - **Depaneled**: prints a label for each board on the panel.
  - **Board scrap**: a board scrapped on the line (AOI reject not repaired, damage), with a reason. Its serial is never
    used again and shows as scrapped.
- **Production output.** For a panelized work order, output takes **depaneled, not scrapped, not yet output boards**:
  - by scanning, or the oldest first;
  - their serial numbers become the output batches instead of newly generated ones;
  - everything else in output stays the same: backflush, value split, final inspection and as-built.
- **Traceability.**
  - A board's reels: the feeder loads of its work order with `loaded_at ≤ placed_at < unloaded_at` (or still loaded).
  - The reverse, for a recall: the boards of a reel or a lot.

### Labels (pure, in `@factoryos/core`, unit-tested)

ZPL for each kind, with a **DataMatrix** (`^BX`) of the code and readable text, sized from the printer's dpi and the
label size:

- **Panel:** panel code, work order, item code and revision, board count.
- **Board:** serial, item code and revision.
- **Reel and paste jar:** container code, item code, lot, quantity, and MSL level or paste.

### Printing through the edge

- `print_job` records:
  - the printer and the ZPL;
  - the source (panel, board, container) and how many copies;
  - the status (`queued` → `sent` → `printed` or `failed`), attempts, the error, and who created it.
- The edge agent:
  - polls `GET /iot/print-jobs` every few seconds with its key. This claims the queued jobs for the edge's printers,
    with a 60 s lease, so a crashed agent's jobs return to the queue;
  - sends each job over TCP to the printer;
  - reports `POST /iot/print-jobs/:id/result`.
- A job that fails 3 times stays **failed**, with **Reprint** on the web.
- Every label can also be **downloaded as ZPL** from the web, for a printer the edge can't reach.

### API and permissions

- New permissions:
  - `manufacturing.smt.read`: the pages;
  - `manufacturing.smt.operate`: scans, feeder loads, container events, printing;
  - `manufacturing.smt.manage`: creating containers, and panelization on BOMs.
- Printers use `plant.device.manage`.
- Roles:
  - planners read;
  - operators read and operate;
  - stores create reels;
  - administrators get everything.
- Endpoints:
  - containers: create, events, list, detail with clock state;
  - feeder: load, unload, splice, the work order's setup;
  - panels: print labels, scan placed or depaneled, board scrap, reprint;
  - the board trace; reel and lot reverse trace;
  - printers CRUD and jobs, plus the edge print-job endpoints;
  - output gains `boards: string[]` (serials) for panelized work orders.

### Web

- **Manufacturing → SMT line**: a tablet page for scanners in keyboard mode, with one input that understands what was
  scanned. Tabs:
  - **Setup:** the work order and placement machine; slot then reel; a list per slot with the clock state; splice;
    unload.
  - **Panels:** print labels for N panels, scan placed, scan depaneled (prints board labels), and scrap a board.
  - **Containers:** create reels from a lot (print labels), open, dry cabinet in and out, bake, reseal, empty; paste
    out of the fridge, opened, empty.
  - **MSL board:** reels sorted by time left, with expired and under-4-hours highlighted.
- **Board page:** the batch page for a serial gains an SMT section: panel and position, placed and depaneled times,
  reels per slot (part, lot, supplier lot, MSL state when placed), paste lot, and scrap. Reel and lot pages list their
  boards.
- **Plant → Devices:** a Label printers card, and print jobs with reprint.

## Not in this slice

- IPC-CFX and Hermes data: SPI, AOI and reflow results per board, placer pick and drop counts (decision 016, next SMT
  slice).
- Per-placement traceability, reel quantity decrement from placements, and reel merge.
- The dry cabinet's own RH logger (environment node, docs/11 §6.5). The cabinet pause is by scan.
- MRP attrition factors.

## Tasks

1. Claim in STATUS, this design and decision 065 to main (docs-only PR).
2. Core:
   - MSL clock and paste state;
   - board-to-reel matching;
   - ZPL labels (unit tests).
3. Migration `0047_smt_traceability`, permissions and roles.
4. API:
   - containers and events;
   - feeder setup;
   - panels, boards and output;
   - trace;
   - printers and print jobs;
   - smoke `smoke-smt.mjs`.
5. Edge agent: print-job polling and the TCP printer driver, tested with a fake printer socket; the agent against the
   API.
6. Web:
   - SMT line page;
   - board, reel and lot sections;
   - printers card;
   - browser walkthrough (desktop and tablet/390 px).
7. Regression and wrap-up:
   - manufacturing, scheduling, quality and IoT smokes and browsers;
   - root checks;
   - review, STATUS/LOG and the PR.
