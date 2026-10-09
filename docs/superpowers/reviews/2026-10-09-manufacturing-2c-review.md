# Manufacturing slice 2c — self-review

Design: [spec](../specs/2026-10-09-manufacturing-2c-design.md), [plan](../plans/2026-10-09-manufacturing-2c.md),
decision 047, [statutory evidence](../../compliance/itc04-evidence.md). A review by a fresh agent or human is
still recommended.

## What was built

- **Statutory evidence** (task 1), from primary CBIC sources:
  - Sec 143 time limits, the tool exemption (capital goods only) and the Commissioner's extension cap.
  - Rule 45(3) periods: half-yearly above ₹5 crore of previous-year turnover, else annual; due on the 25th.
  - Rule 55 challan fields, including the **16-character** number limit.
- **Job workers and "At vendor" warehouses:**
  - Suppliers can be marked as job workers.
  - Each gets a `JW-<code>` warehouse of type `at_job_worker` on first use, not available for issue.
  - Only job work moves stock in or out of it.
- **Subcontract (conversion) orders:**
  - Target item and quantity, with materials from the active BOM or listed by hand.
  - **Send:** the challan posts a `job_work_out` transfer. The challan value is what the next FIFO issue would cost.
  - **Receive:** a `job_work_in` entry consumes the material at the vendor (FIFO), then creates the returned goods.
    - Their value is the consumed value, split exactly by quantity.
    - Same-item processing keeps the heat number.
    - Loss and scrap stay in the cost.
  - Receipts discharge challan lines oldest first, recorded in append-only consumption rows.
  - Genealogy follows job work.
- **Outsourced operations:**
  - BOM operations can be outsourced to a job worker: no work centre and no job cards.
  - From the work order, Send pieces on a challan, valued at WIP ÷ pieces in progress. No stock or GL moves.
  - Receive good and rejected pieces.
  - Output can't pass the good pieces returned for any outsourced operation.
- **Processing charge:**
  - A purchase-invoice service line can charge a job work receipt of the same job worker.
  - **Operation orders:** a `job_work` WIP row; the GL debits WIP.
  - **Conversion orders:** the acquisition-cost service raises the returned batch's FIFO value; the GL splits it between inventory and production.
  - The cost effects happen with books inactive too.
  - Cancelling the invoice reverses both.
  - One live invoice per receipt.
- **ITC-04:**
  - Table 4 and Table 5A for each GSTIN and period, with the frequency set per FY.
  - CSV export in the form's field order.
  - Deadline list with amber (30 days) and red states.
  - Extension within the legal cap.
  - Deemed-supply marking with the invoice number, which lets an order close.
  - A home count of goods due back.
- **Screens:**
  - Job work list and order view.
  - Rule 55 challan print.
  - BOM editor outsourced choice.
  - Work order send and receive.
  - Purchase-invoice receipt picker.
  - ITC-04 page.
  - Master flags.
- **Migration `0029_job_work`:** additive, plus one change: `work_centre_id` becomes nullable on BOM and work-order operations, with a check that it is set unless the operation is outsourced.

## Deviations from the written design

1. **Permission keys:** `compliance.job_work_return.*` instead of `compliance.itc04.*`, because the catalog doesn't allow digits. `update` covers both extensions and deemed supply.
2. **ITC-04 frequency:** an `itc04_setting` row per entity and FY rather than a column on the entity, because it depends on the previous year's turnover. An explicit period ("2026-27 H1" or "2026-27") decides its own frequency; the setting only sets the default and is shown when it differs.
3. **E-way bill:** a warning on interstate challans, not a hard block. The current rule 138 text couldn't be reached (see the evidence file).
4. **Scrap returned:** recorded as a quantity on the consumption row and reported in ITC-04. It isn't posted to the waste register.

## Deliberate limits

1. The CSV follows the form's fields, not the GST portal's offline-tool template; the page says so. Matching the template is a follow-up once it can be downloaded.
2. Tables 5B and 5C (goods sent on to another job worker, or supplied from the job worker's premises) are not produced.
3. Work-order pieces at a job worker don't appear in stock balance. WIP isn't stock in 2a's model; they show on the work order and the job work order instead.
4. Returned goods go to the warehouse the user picks. Routing items that need incoming inspection to Quarantine arrives with the inspection slice.
5. Rejected pieces at the job worker are informational, like job-card scrap in 2a: their cost stays in WIP and goes to variance on close.
6. The challan value of work-order pieces is a snapshot of WIP at the time of sending, for the challan and ITC-04 only.

## Verification

- Core unit tests: 88 pass, 9 of them new (deadlines, periods, oldest-first allocation).
- `smoke-job-work.mjs`: 101 checks. It covers conversion, same-item heat treatment, a capital-goods tool, outsourced operations with the output gate, cancellation rules, processing charges with books active, and the stock value with books inactive.
- `smoke-itc04.mjs`: 33 checks. It covers deadline states relative to today, the extension cap, deemed supply, Table 4 and 5A per period, annual frequency, and the CSV.
- `smoke-manufacturing`, `smoke-serials`, `smoke-genealogy`, `smoke-inventory` and `smoke-buying` still pass.
- `e2e:job-work` passes on desktop and at 390 px mobile.
- Root typecheck (19 tasks), build (12) and tests (11 tasks) all pass.
- The full API regression result is recorded in STATUS.
