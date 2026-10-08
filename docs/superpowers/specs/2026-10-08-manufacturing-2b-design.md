# Manufacturing slice 2b — serials, remnants and genealogy (design)

Status: written design for review. Choices made by the user on 2026-10-08 (decision 046). Builds
on slice 2a ([design](2026-10-07-manufacturing-2a-design.md), decision 044) and
[docs/03 §4, §7](../../03-manufacturing-inventory.md).

## Scope

**In scope:**
- Serial-tracked items end to end: receipt, transfer, issue, production output, sales delivery,
  sales and supplier returns, landed cost and stock reports.
- Automatic serial numbers on production output.
- As-built record: which component serials are in each assembly serial.
- Remnant pieces of bar stock.
- A multi-level genealogy explorer with an exportable recall list.

**Out of scope (later):**
- Certificate attachments (MTC, CoC pack), because there is no document store yet.
- Serial-level inspection and FAI.
- Customer-owned serials (job work).
- Barcode label printing.
- Powder blends and AM build jobs (Phase 6).

## 1. A serial is a batch of one

`item.tracking = 'serial'` items use the existing `batch` table. Each serial is one batch row with
`kind = 'serial'`, and its bin quantity is only ever 0 or 1. Every flow that already carries a
`batchId` therefore carries a serial unchanged: FIFO layers, bins, the ledger, landed cost, sales
invoices, returns, supplier returns and traces.

**Rules enforced by the stock engine** for serial items:
- Every line has quantity exactly 1 and names one serial. Documents use one line per serial; the
  UI expands "10 pcs" into ten serial lines.
- A receipt may not bring in a serial that is already in stock. Serials stay unique per item.
- Moving or issuing a serial needs the serial to be in that bin.

**Where numbers come from:**
- *Purchase receipt:* the serial numbers are typed or scanned, one per unit.
- *Production output:* numbers are generated as `item.serial_prefix` plus a running number, e.g.
  `BRK-000041`.
  - The running number is gapless per item per tenant, kept in a new `serial_counter` table. It
    does not reset by financial year.
  - The prefix is set on the item; if it is empty, the item code is used.

**Cost:** each serial gets its own FIFO layer. An output of N serials splits the output value
(decision 044 actual costing) equally; the last serial takes the exact remainder.

## 2. As-built (component serials in an assembly)

When a work order's output item is serial-tracked and its BOM has serial-tracked materials, the
output dialog asks for each new assembly serial: which issued component serials went in, and how
many per unit (from the BOM).

**Stored:** an append-only `serial_component` row (`assembly batch`, `component batch`,
`work order`, `output stock entry`).

**Rules:**
- The component serial must have been issued to this work order (net of returns).
- A component serial can sit in at most one live assembly.
- Cancelling the output reverses its rows, which frees the components.

## 3. Remnant pieces (bars kept in kg)

Bars stay in kg against the heat batch. A new **Cut** action in stores turns part of a heat into a
piece that is tracked separately.

**The Cut action:** a system stock entry with a new purpose, `cut`.
- It moves the given weight out of the source batch and into a new child batch.
- The child batch has `kind = 'remnant'`, `parent_batch_id` = the source batch (the column already
  exists), `length_mm`, and the same heat number.
- The value moves at the FIFO cost of the weight taken out, so it splits by weight. The total value
  doesn't change and the GL gets no line (inventory to inventory).

**Using remnants:**
- A remnant is issued to work orders like any batch; issue screens show its length.
- Cutting a remnant again creates a grandchild.
- **Remnant search:** by item, minimum length and warehouse.

**Optional on issue:** when issuing from a whole bar, stores can record a cut on the same screen
("leave a 660 mm remnant weighing 4.2 kg"). This posts the Cut entry first, then the issue.

## 4. Genealogy explorer and recall list

There is one graph over existing data. No new edges are stored except as-built.

| Edge | From |
|---|---|
| batch → receipt | receipt stock entries (supplier, PO, GRN, inspection) |
| batch → parent batch | `parent_batch_id` (remnants) |
| work order consumed batch | `production_issue` minus `production_return` lines |
| work order produced batch | `production_output` lines |
| assembly serial → component serial | `serial_component` |
| batch → customer | `delivery` lines of submitted sales invoices, less sales returns |

**Backward (what is in this serial or lot):** a tree going output → work order → consumed batches,
then recursively through their own work orders, down to purchase receipts. As-built rows narrow a
serial assembly to its exact component serials; without them, the tree shows the whole work order's
material.

**Forward (where this heat or lot went):** every batch made from it, followed recursively through
sub-assemblies, then to customers. The **recall list** is the set of serials and lots reached,
with:
- current location (in stock: warehouse; delivered: customer, invoice and date)
- export to CSV

**Limits:** depth up to 10 levels and 5,000 nodes per query, shown with a "truncated" flag. The
API runs it as SQL, so it isn't stitched together in the browser.

## Data changes (one migration)

- `batch.kind` (`lot` | `serial` | `remnant`, default `lot`) and `batch.length_mm`, plus an index
  on `parent_batch_id`.
- `item.serial_prefix`.
- `serial_counter(tenant_id, item_id, next_value)`.
- `serial_component` (append-only, with a reversal row).
- Stock purpose `cut`.
- The serial-only-in-one-bin rule is enforced in the stock engine under the existing per-item
  advisory lock.

## Screens

- **Items:** serial prefix field.
- **Receipts:** serial entry, multi-line paste or scan.
- **Stock balance:** shows each serial, and remnants with length.
- **Inventory → Cut bar** dialog and remnant search.
- **Work order issue:** a serial picker, and remnants with length.
- **Output:** generated serials, plus an as-built picker when components are serial-tracked.
- **Sales invoice:** a serial picker per item.
- **Genealogy page** (Manufacturing → Genealogy): search by serial, lot or heat; backward and
  forward trees; recall list with CSV export.

## Permissions

- `inventory.stock_entry.create` / `submit` cover Cut.
- `manufacturing.genealogy.read` and `.export` (new) cover the explorer and recall list.
- Quality and Production Planner roles get the new genealogy permissions.

## Risks

- **One line per serial** makes big serial documents long. Paste and scan entry and auto-expansion
  keep entry quick, and no posting rule changes.
- **Historical data:** no serial-tracked items exist today, because they are refused, so nothing
  needs migrating.
