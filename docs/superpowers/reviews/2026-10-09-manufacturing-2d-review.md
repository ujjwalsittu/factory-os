# Manufacturing slice 2d — self-review

Design: [spec](../specs/2026-10-09-manufacturing-2d-design.md), [plan](../plans/2026-10-09-manufacturing-2d.md),
decision 048. Migration `0030_quality`. A review by a fresh agent or human is still recommended.

## What was built

- **File storage and attachments:**
  - A storage service with an `s3` driver (Cloudflare R2 through the S3 API, presigned downloads valid 5 minutes) and a `local` driver for dev and tests. The API refuses the local driver when `NODE_ENV=production`.
  - `POST /api/attachments` takes the raw file body (25 MB cap; PDF, images, CSV/TXT, XML, XLSX, ZIP), checks the owner's entity, stores the SHA-256 and writes the object.
  - Attachments are append-only: a wrong file is withdrawn with a reason, enforced by a database trigger.
  - Kinds: MTC, CoC, CoA, FAI, CMM data, photo, calibration and other. Owners: batch, inspection record, 1b purchase-receipt inspection, FAI, NCR, gauge, calibration event, job work receipt.
- **Inspection plans:**
  - Per item, stage (incoming, in-process with an operation, final) and revision.
  - Ballooned characteristics: dimension, visual, functional test or document, with nominal and limits, unit, method, key flag and sample size.
  - Draft → active → obsolete. Activating a revision obsoletes the previous one. Records keep the revision they used.
- **Calibration register:**
  - Gauges with interval, due date and status.
  - Calibration events are append-only (database trigger). A pass or adjustment sets the next due date.
  - A fail blocks the gauge and lists the inspections that used it since its last good calibration.
  - Measurements refuse a gauge that is overdue, failed or out of service.
- **Inspection records and gates:**
  - **Final:** output of an item flagged `requires_final_inspection` posts into the Quarantine warehouse (`QUA`, created on first use), and a final inspection opens.
  - **Incoming:** job work returns of items needing incoming inspection go to Quarantine with an incoming record (the 2c limit).
  - **In-process:** started from the work order's Inspections card for one of its operations. A failure raises an NCR and doesn't stop the order.
  - **Measurements:** stored per characteristic and sample; the latest reading counts. Measurements are append-only (database trigger).
  - **Submit:** accepted plus rejected must equal the lot. Accepted quantity moves to the target warehouse with a system transfer. Rejected quantity moves to MRB on an NCR.
  - **Cancelling a record:** allowed only while nothing downstream depends on it. Cancelling the output or the job work receipt releases the hold.
- **NCR and MRB:**
  - Raised from a failed inspection, or by hand from any of our warehouses. The quantity moves to MRB (`MRB`, created on first use) at unchanged value.
  - Dispositions are split by quantity, proposed, and approved under a separate permission. Each line posts its own transaction:
    - **Use as is:** transfer back to the source warehouse, with a concession reference.
    - **Rework / repair:** a released rework work order with no BOM (`rework_of_ncr_id` set) that issues the pieces from MRB. Its output is inspected again.
    - **Scrap:** a scrap stock entry into the waste register.
    - **Return to vendor:** a draft supplier return claim on the purchase invoice that billed the lot.
  - Open → dispositioned → closed. Cancel is possible only for hand-raised NCRs, and returns the stock.
- **FAI (AS9102):**
  - **Form 1:** part, revision, drawing, organisation, lot or serial, and sub-assemblies from the active BOM with their FAIs.
  - **Form 2:** materials and heats with suppliers and receipts from genealogy, special processes from job work, and functional tests.
  - **Form 3:** ballooned characteristics with results from the linked final inspection.
  - Draft forms show live data; submit freezes them.
  - Maker-checker: the preparer can't approve their own FAI, and a rejection needs a reason.
  - **Invoice gate:** a sales invoice for an item flagged `requires_fai` is refused until an FAI is approved for its current revision, or after a process change (`fai_process_change`). Approving an FAI clears the process-change flag.
- **Certificate pack:** `GET /quality/certificate-pack/:batchId` lists, or zips with a manifest, the files along the lot's backward genealogy:
  - heats' MTCs;
  - purchase and job work receipt certificates, including the receipts of job work orders on the work orders that made the lots;
  - inspection reports;
  - FAIs.
- **Screens:**
  - A Quality section in the sidebar (Inspections, NCR / MRB, First article, Inspection plans, Gauges) replaces the P2 placeholder.
  - Item master quality flags.
  - Inspection plan editor; inspection queue and measurement screen (390 px friendly).
  - NCR list and detail with disposition and approval dialogs.
  - Gauge register with calibration history and certificates.
  - FAI list and printable Forms 1–3.
  - Attachments panels on records.
  - A "Certificate pack" button on the genealogy page.
  - Work order page: its inspections, in-process checks and, for rework orders, a link to the NCR.

## Deviations from the written design

1. **Table names:** results are `inspection_measurement`, because `inspection_result` is already an enum type. There is no `fai_item` table: Form 1 sub-assemblies come from the active BOM and are frozen into the FAI's forms on submit.
2. **`requires_fai` defaults off for new items too.** The spec said on for finished goods and sub-assemblies. The flag blocks invoicing, so each item opts in explicitly in the item master. If the default should be on, it's a small change.
3. **A failed Form 3 can't be submitted.** The spec didn't say this. A first article with a nonconforming characteristic needs a new FAI on a conforming article, as AS9102 expects.
4. **Item PATCH fix outside the slice:** Zod 4 applies `.default()` values inside `.partial()`. Every item edit sent `tracking: 'none'` and was refused for batch and serial items, and omitted flags were reset to their defaults. The API now updates only the fields the caller sent. Without this fix, the item master couldn't set the new flags on tracked items.

## Deliberate limits

1. The 1b purchase-receipt inspection (`quality_inspection`) doesn't use plans yet. It keeps its accept/reject flow. `inspection_record_id` exists on it for the link.
2. NCRs on work in progress (an in-process failure without separate stock) record their dispositions only. No stock moves, and the cost stays in WIP until close, as with job-card scrap in 2a.
3. The work order output dialog doesn't say that the output will wait in Quarantine. The work order's Inspections card and the inspection queue show it afterwards.
4. There's no batch or serial detail page, so batch attachments (for example MTCs) are added through the API or appear in the certificate pack from genealogy. A batch page is a follow-up.
5. The sales invoice's FAI refusal is the API message ("needs an approved first article inspection (first build)"), without a link to the FAI.
6. Raising NCRs from a failed calibration's suspect list is manual, as designed.
7. **R2 isn't configured on dev yet.** Until the bucket and credentials are set in Coolify, the API refuses uploads with a clear message. Everything else works without storage.

## Verification

- Core unit tests: 94 pass (quality helpers: limits, gauge block, due dates, FAI requirement, outcome).
- `smoke-attachments.mjs`: storage, owner checks, size and type limits, hash, append-only withdraw.
- `smoke-quality.mjs`: 106 checks. Plans, gauges, final and incoming gates, partial results, all five dispositions, rework re-inspection, cancellation rules.
- `smoke-fai.mjs`: 52 checks. Forms 1–3, maker-checker, invoice gate, process change, certificate pack zip.
- `e2e:quality` passes on desktop and at 390 px, with no horizontal page scroll. It covers the item flag, plan, gauge calibration, Quarantine hold, partial final inspection, NCR scrap and close, the work order's inspections and an in-process check, FAI forms with an attachment and the Form 3 refusal, and the certificate pack zip.
- Root typecheck, build and tests pass. Full API regression: see STATUS.
