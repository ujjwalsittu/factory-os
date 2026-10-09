# Manufacturing slice 2d — inspection, FAI, NCR and calibration (design)

Status: **awaiting user review**. User choices recorded 2026-10-09 as decision 048. Builds on:
- 1b incoming inspection (`quality_inspection`);
- 2a work orders;
- 2b serials and genealogy;
- 2c job work.

docs/03 §8 is the requirement.

## Scope

In:
- **Inspection plans:** characteristics with nominal, tolerance and method, per item revision, for three stages:
  - incoming (on purchase receipts and job work returns);
  - in-process (on a routing operation);
  - final (on output).
- **Inspection records** against a plan: measured values, pass or fail per characteristic, gauge used, inspector.
- **Gates:**
  - **Final inspection:** items flagged for it go to Quarantine on output and move to stock only when passed.
  - **FAI:** a lot or serial that needs an FAI can't be invoiced until the FAI is approved.
  - **In-process:** recorded, never blocking.
- **FAI per AS9102:** Form 1 (part number accountability), Form 2 (product accountability: material, special processes, functional tests) and Form 3 (characteristic accountability, from the plan).
  - **Triggers:** first build of an item revision, a revision change, a process change (flagged by hand), or 2 years since the last approved FAI.
- **NCR and MRB:**
  - Nonconformances are raised from a failed inspection, or by hand against a lot or serial; the quantity goes on hold in an MRB warehouse.
  - **Dispositions**, each posting its own transaction:
    - use-as-is (release);
    - rework and repair (a linked rework work order);
    - scrap (a scrap entry into the waste register, value to GL);
    - return to vendor (a supplier return claim).
- **Certificates and attachments** (MTC, CoC, CoA, FAI PDFs, CMM data, NCR photos):
  - stored in **S3-compatible object storage, Cloudflare R2**;
  - attached to batches, inspections, FAIs and NCRs;
  - compiled into a certificate pack per delivered lot or serial.
- **Calibration register:**
  - gauges and instruments with interval, due date and certificate;
  - an overdue or failed gauge can't be used on an inspection record.

Out (later):
- **CAPA** (8D, 5-Why, effectiveness checks).
- **Operator skill matrix.**
- **Statistical process control** charts.
- **Sampling plans by AQL table.** Plans state a fixed sample size or 100%.

## 1. Inspection plans

- **Scope:** `inspection_plan` per item and revision, with stage `incoming | in_process | final`. In-process plans also name a routing sequence. Plans are revisioned like BOMs: draft → active → obsolete, and records freeze the plan revision they used.
- **Characteristic** (`inspection_characteristic`):
  - balloon number, description, type (dimension, visual, functional, document);
  - nominal, lower and upper tolerance, unit;
  - method or gauge type, and the "key characteristic" flag;
  - sample size: N, or all.
- **Item flags:** `requires_final_inspection`, plus the existing `requires_incoming_inspection`. `requires_fai` defaults on for finished goods and sub-assemblies.

## 2. Inspection records and gates

- **Records:**
  - `inspection_record`, linked to the source: a receipt line, a job work receipt line, a work-order operation, or a work-order output line;
  - `inspection_result`: one row per characteristic and sample, with the measured value or pass/fail, the gauge and its calibration status at the time.
  - Result is pass when every characteristic passes. Partial results split the quantity into accepted and rejected.
- **Incoming:** the existing 1b quarantine flow takes an optional plan. Job work receipts of inspected items now go to Quarantine (the 2c limit).
- **Final:**
  - output of a flagged item posts into the work order's Quarantine warehouse;
  - passing moves the accepted quantity to the target warehouse with a system transfer, as 1b inspections do;
  - a fail raises an NCR for the rejected quantity.
- **In-process:** recorded against the operation; a fail raises an NCR but doesn't block.
- **Value:** quarantine holds stock at its FIFO value, so no GL is needed for the move.

## 3. FAI (AS9102)

- **Records:** `fai` per item revision, and per serial or lot of the first article. Status: draft → submitted → approved, or rejected.
- **Forms:**
  - **Form 1:** part, revision and drawing from the item, plus sub-assembly FAI references.
  - **Form 2:** materials (heats from genealogy), special processes (from job work orders and their certificates) and functional tests.
  - **Form 3:** the final inspection plan's characteristics and the measured results of that serial or lot.
- **Requirement:** an FAI is required when the item has `requires_fai` and any of these is true:
  - no approved FAI for this revision;
  - the last approved one is more than 2 years old;
  - a "process change" flag is raised on the item revision.
- **Gate:** a sales invoice line for a lot or serial of an item that needs an FAI is refused until an FAI covering that revision is approved. The refusal names the FAI to complete.
- **Approval:** maker-checker; the approver can't be the preparer.
- **Print:** AS9102 Forms 1–3 as a PDF-ready layout.

## 4. NCR and MRB

- **Records:** `ncr` with source (inspection, or manual), item, batch or serial, quantity, description, and photos (attachments).
- **On raise:** the quantity moves to the MRB warehouse (system transfer, value unchanged).
- **Disposition:** one or more lines, quantities summing to the NCR quantity; each line posts a transaction:

| Disposition | Transaction |
|---|---|
| Use-as-is | Transfer back to the source warehouse, with a concession reference |
| Rework / repair | A rework work order (BOM-less, the item itself as input and output) linked to the NCR; its result goes through inspection again |
| Scrap | A scrap stock entry into the waste register (decision 025); value goes to the scrap/production loss GL role |
| Return to vendor | A supplier return claim (decision 038) for the purchased lot |

- **Status:** open → dispositioned → closed. Closing needs every disposition line posted.
- **Approval:** MRB members approve dispositions, with a separate permission.

## 5. Certificates and attachments (Cloudflare R2)

- **Storage:**
  - a storage service with an `S3Storage` driver, using the AWS SDK S3 client against R2's S3 API;
  - a `local` driver for development and tests only, refused when `NODE_ENV=production`.
- **Configuration:** new env vars in `.env.example`: `STORAGE_DRIVER`, `S3_ENDPOINT`, `S3_REGION` (`auto` for R2), `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`. The secrets live in Coolify only.
- **Data:** `attachment` holds tenant, entity, owner type and id, kind (MTC, CoC, CoA, FAI, CMM, photo, calibration, other), file name, content type, size, SHA-256, object key, uploaded by and at. Attachments are append-only; removal is a soft "withdrawn" with a reason.
- **Upload and download:**
  - uploads stream through the API, which checks permission, size (25 MB cap) and content type (PDF, images, CSV/TXT, common CMM exports), computes the hash and writes the object;
  - downloads use short-lived presigned URLs (5 minutes), after a permission check.
- **Certificate pack:** for a delivered lot or serial, the API zips the attachments found along its genealogy (heats' MTCs, job work CoCs, FAI, final inspection) into one download.

## 6. Calibration register

- **Gauges:** `gauge` with code, description, type, location, interval (days), last calibrated, due date, status (in service, overdue, out of service, failed).
- **Events:** `calibration_event`, append-only: date, result (pass / adjusted / fail), agency, certificate attachment, next due date.
- **Blocking:** an inspection result can't use a gauge that is overdue, failed or out of service.
- **Failed calibration:** lists the inspection records that used the gauge since its last pass, for review. Raising an NCR from that list is a manual action.

## Data changes (one migration, `--name quality`)

New tables:
- `inspection_plan`, `inspection_characteristic`;
- `inspection_record`, `inspection_result`;
- `fai`, `fai_item`;
- `ncr`, `ncr_disposition`;
- `attachment`;
- `gauge`, `calibration_event`.

Changes to existing tables:
- `item`: `requires_final_inspection`, `requires_fai`, `fai_process_change`;
- `work_order`: `rework_of_ncr_id`;
- the existing `quality_inspection` gets an optional `inspection_record_id`.

Results, calibration events and attachments are append-only.

## Screens

- **Quality nav** (replaces the "P2" placeholder): Inspection plans, Inspections (queue), FAI, NCR, Gauges.
- **Item master:** quality flags. **Batch / serial views:** attachments and a "certificate pack" download.
- **Work order:** final-inspection status of outputs; rework orders show their NCR.
- **Sales invoice:** FAI refusal message with a link to the FAI.
- **Mobile:** recording measurements at 390 px, so inspectors can use a tablet at the CMM.

## Permissions

`quality.inspection` already exists. New:
- `quality.plan` (read/create/update/submit);
- `quality.fai` (read/create/submit/approve);
- `quality.ncr` (read/create/submit/approve/cancel);
- `quality.gauge` (read/create/update);
- `quality.attachment` (read/create/cancel).

The Quality role gets all of these. Stores and Production get read, plus NCR create.

## Risks

1. **R2 credentials and bucket** must be created by the user in Cloudflare and stored in Coolify before attachments work on dev. Until then, the API refuses uploads with a clear message (the local driver is dev-only).
2. **New dependency:** `@aws-sdk/client-s3` and `@aws-sdk/s3-request-presigner` in the API (deploy watch paths unchanged; the API already deploys on `apps/api/**`).
3. **The FAI gate changes sales invoicing** for items flagged `requires_fai`. Existing items default to off, so nothing currently invoiced is blocked until a user turns the flag on.
4. **Migration number:** probably 0030 (the passkeys branch must renumber again; see STATUS).
