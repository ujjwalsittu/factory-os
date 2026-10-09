# Manufacturing slice 2c — job work and ITC-04 (design)

Status: **awaiting user review**. User choices recorded 2026-10-09 as decision 047. Builds on 2a
(decision 044: work orders, actual costing, WIP ledger) and 2b (decision 046: serials, remnants,
genealogy). Inward job work (customer material) already exists (decisions 024/025) and is
unchanged here.

## Scope

In:
- **Outsourced operations on a work order.** A routing step such as heat treatment, anodising, NDT
  or plating is marked outsourced. Parts go out to a job worker mid-route and come back, then the
  route continues.
- **Standalone subcontract orders.** We send our material to a job worker and receive either the
  same item processed, or a different item (a conversion, using a BOM).
- **Delivery challans** (CGST Rule 55) for everything sent, with a print layout and a manual e-way
  bill number field.
- **Processing charges.** The job worker's service invoice is recorded as a purchase invoice
  against the job-work order. Its taxable value is added to cost.
- **ITC-04.** A return built from challans and receipts for the period, exported, with deadline
  alerts.

Out (later slices or separate work):
- Filing ITC-04 through a GSP: the provider isn't live.
- Generating e-way bills: the NIC adapter is blocked (see STATUS).
- Material a job worker sends directly to our customer, or to a second job worker (ITC-04 table 5B
  and onward movements). We record only what comes back to us.
- Waste the job worker sells.
- Raising the deemed-supply tax invoice automatically. The system alerts and lists; Accounts
  raises the invoice.
- Inspection on return. Returned material goes to Quarantine only when the item already needs
  incoming inspection. The full inspection, FAI and NCR flow is the next slice.

## 1. Job worker and "At vendor" warehouse

- **Job worker:** any supplier marked as a job worker.
- **Warehouse:** the first challan to a job worker creates its warehouse automatically, if missing:
  - code `JW-<supplier code>`, name `At <supplier name>`;
  - type `at_job_worker` (the enum value already exists);
  - not available for issue.
- **Material at the job worker:**
  - stays ours, is valued at FIFO, and shows in stock balance and the stock ledger under that
    warehouse;
  - can't be issued, sold or transferred from the warehouse by hand. Only job-work receipts move it
    out.

## 2. Job-work order

One document type, `job_work_order`, with two kinds.

| | Operation (`operation`) | Conversion (`conversion`) |
|---|---|---|
| Created from | A released work order whose frozen routing has an outsourced operation | Buying → Job work, by hand |
| Sends | Pieces of the work order (WIP, not stock) | Our stock items, by batch/heat |
| Gets back | The same pieces | A target item (same or different), batch named by the user or from the order number |
| Cost goes to | The work order's WIP ledger | The returned batch's FIFO value |

- **Fields:** number from series `JW` per entity and FY, supplier, kind, expected return date,
  remarks.
- **Status:** `draft` → `open` (first challan) → `closed` (everything returned, or short-closed with
  a reason) or `cancelled` (only while nothing has been sent).

### 2.1 Outsourced operations (kind `operation`)

- **Routing:**
  - `bom_operation` and `work_order_operation` get `outsourced boolean` and an optional default
    `supplier_id`;
  - outsourced operations have no work centre and no job cards;
  - the BOM editor shows an "Outsourced to" field instead of the work centre.
- **Sending:** from the work order, "Send to job worker" on that operation. It opens a challan for
  N pieces (at most what's in progress and not already out). The challan value per piece is the
  current WIP value ÷ pieces still in progress. This is for the challan and ITC-04 only; no stock
  or GL moves.
- **Receiving:**
  - "Receive from job worker" records good pieces, plus process loss or pieces rejected at the job
    worker;
  - loss stays in the work order's cost, so actual costing absorbs it;
  - rejected pieces lower what can still be produced, the same way a job-card scrap quantity does
    in 2a.
- **Output gate:** for every outsourced operation, a work order's total output can't exceed the
  good pieces returned. The output dialog says which operation is holding pieces.
- **Serials:** for serial work orders the challan lists the WIP pieces only. Serials are generated
  on output (2b), after the parts come back, so there's nothing to track per serial on the way out.

### 2.2 Standalone subcontract orders (kind `conversion`)

- **Order lines:**
  - the target item and quantity;
  - the materials to send, copied from the target item's active BOM if one exists, else entered by
    hand.
- **Send:**
  - the challan is a stock transfer (new purpose `job_work_out`) from a stores warehouse into the
    "At vendor" warehouse;
  - batches, heats and serials keep their identity;
  - FIFO layers don't change, as with any transfer.
- **Receive:**
  - a stock entry with new purpose `job_work_in`, which:
    1. consumes the sent material out of the "At vendor" warehouse (FIFO, per batch);
    2. creates the target batch in the chosen warehouse with a new FIFO layer valued at exactly the
       consumed cost. This is the same exact-value pattern as 2b's cut;
  - the receipt says how much of each challan line it consumes (default: oldest challan first),
    because ITC-04 table 5A needs the original challan number for every return;
  - same-item processing (heat treating a bar) keeps the batch number and heat. It still goes
    through consume-and-recreate, so the processing charge can attach to the new layer;
  - process loss is entered as quantity consumed without a matching return; its value stays in the
    returned batch;
  - returned scrap can optionally be received into a scrap warehouse at zero value. It's reported
    in ITC-04 but doesn't change the cost.
- **Genealogy:** a new edge links the sent batches to the returned batch, so traces pass through
  job work (2b explorer).

## 3. Delivery challan

- **What it is:** the challan is the job-work send document, numbered `JWC` per GSTIN and FY
  (gapless, existing number-series engine).
- **Print (Rule 55):**
  - our and the job worker's name, address and GSTIN;
  - date and number;
  - HSN, description, quantity and unit, taxable value;
  - place of supply;
  - "Goods sent for job work under Section 143 — not a supply";
  - signature block.
- **Interstate:** the e-way bill number is required when the job worker is in another state,
  whatever the value. The user types it in; the challan can't be submitted interstate without it.
- **Cancel:** allowed only while nothing has been received against the challan. It reverses the
  stock transfer exactly.

## 4. Processing charge (purchase invoice)

- **Linking:** a purchase invoice line for a service item (SAC 9988) can be linked to a job-work
  receipt. GST and ITC work as for any purchase invoice.
- **When books are active:**
  - **operation:** the line's taxable value debits WIP instead of purchases. A new WIP ledger row of
    kind `job_work` goes on the work order, so the cost reaches the output;
  - **conversion:** the value is applied to the returned batch's FIFO layer through the existing
    acquisition-cost service. The part still in stock raises inventory; the part already consumed
    goes to production cost, as landed cost does today.
- **When books are inactive:** the FIFO and WIP effects still happen. Only the GL is skipped, as
  with every operational posting (decision 034).
- **Cancelling the invoice** reverses both effects exactly. The ledgers are append-only reversal
  rows.

## 5. ITC-04

- **Period:**
  - each entity sets its filing frequency: half-yearly (annual aggregate turnover above ₹5 crore)
    or annual;
  - due dates are 25 October and 25 April (half-yearly), or 25 April (annual).
- **Return, built per GSTIN:**
  - **Table 4 (goods sent):** challans dated in the period;
  - **Table 5A (goods received back):** receipts dated in the period, each with its original
    challan number and date, plus quantities lost or returned as waste.
- **Screen and exports:** Compliance → ITC-04, with period picker, the two tables and totals.
  Export as CSV in the layout of the GST portal's ITC-04 offline tool.
- **Deadline alerts:**
  - each open challan line shows the date it must be back by: 1 year for inputs, 3 years for
    capital goods (Sec 143(1)(a)/(b));
  - items flagged as moulds, dies, jigs, fixtures or tools are exempt from the time limit;
  - lines turn amber 30 days before the deadline and red after it;
  - after the deadline the screen states that the goods are treated as supplied on the original
    challan date (Sec 143(3)/(4)). An Accounts user can mark the line "deemed supply invoiced",
    with the invoice number;
  - the home dashboard shows a count of lines due within 30 days.
- **Statutory checks (at build time):** the turnover threshold, the due dates, the time limits and
  the offline-tool column layout are checked against the CGST Act, the Rules and the GST portal
  before the export ships. If any can't be checked from primary sources, it's written down as a
  blocker, not guessed. This follows the evidence rule already used for TDS/TCS.

## Data changes (one migration, `--name job_work`)

- **New tables:**
  - `job_work_order` and `job_work_order_line` (conversion targets and materials);
  - `job_work_challan` and `job_work_challan_line`: item, batch, qty, value, `due_by`, deemed-supply
    flag and invoice number;
  - `job_work_receipt` and `job_work_receipt_line`: received item, batch, qty, loss, scrap;
  - `job_work_consumption`: receipt line → challan line, with qty (for table 5A and the
    open-quantity balance).

  They have `tenant_id` and `entity_id`. Receipts and consumption rows are append-only, and
  cancellation writes reversal rows.
- **Changes to existing tables:**
  - `party.is_job_worker`, `item.job_work_exempt_tool`, and `legal_entity.itc04_frequency`;
  - `bom_operation` and `work_order_operation`: `outsourced` and `supplier_id`. `work_centre_id`
    becomes nullable, with a check that it's present unless the operation is outsourced;
  - stock purposes `job_work_out` and `job_work_in`;
  - WIP cost kind `job_work`;
  - `purchase_invoice_line.job_work_receipt_id`.
- **Migration number:** probably 0029. If the passkeys branch merges its migration first, this
  slice regenerates after merging `main`.

## Screens

- **Buying → Job work:**
  - list of job-work orders, with open quantity at each job worker;
  - order form (conversion);
  - order view with challans, receipts, invoices and the cost added;
  - challan print.
- **Work order view:**
  - outsourced operations show "With <vendor>: N pieces" and Send/Receive buttons;
  - the output dialog explains the output gate.
- **BOM editor:** an Outsourced toggle and supplier on each operation.
- **Purchase invoice form:** a service line can pick a job-work receipt of the same supplier.
- **Compliance → ITC-04:**
  - period picker, Table 4 and Table 5A, export;
  - deadline list with amber and red flags.
- **Masters:**
  - "Job worker" checkbox on suppliers;
  - "Mould / die / jig / fixture / tool" checkbox on items.
- **Mobile:** send and receive work at 390 px, so the stores desk can use a phone.

## Permissions

- **New permissions:**
  - `manufacturing.job_work.read`, `create`, `submit`, `cancel`;
  - `compliance.itc04.read`, `export`, `mark_deemed`.
- **Roles:**
  - Production Planner and Stores: job work;
  - Accounts: ITC-04 and deemed supply;
  - Quality: read.

## Risks

1. **Statutory facts** (threshold, due dates, time limits, offline-tool layout) must be checked at
   build time. Mitigation: the evidence step in §5; no guessed defaults.
2. **WIP pieces aren't stock**, so "At vendor" stock balance shows only conversion material.
   Outsourced work-order pieces show on the job-work order and the work order instead. This
   follows from 2a's model, where issued material leaves stock for WIP.
3. **Changing an existing column:** `work_centre_id` becomes nullable. Existing rows all have a
   value, and the new check keeps them valid.
4. **Migration number collision** with the passkeys branch (see STATUS "Noticed").
