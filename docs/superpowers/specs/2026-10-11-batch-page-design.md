# Batch and serial page — design (decision 053)

Follow-up 4 from the [2d review](../reviews/2026-10-09-manufacturing-2d-review.md): there is no page for a lot,
serial or remnant, so batch attachments (mill certificates) can only be added through the API. User choices,
2026-10-11: build the batch/serial page first; it is **view plus attachments only** — the lot's own details stay as
received.

## What it shows

**Inventory → Batches & serials** (`/app/inventory/batches`, `inventory.batch.read`): search by batch, serial or heat
number, or item code; newest first, at most 100 rows; kind (lot, serial, remnant), item and quantity in this entity.

**Batch page** (`/app/inventory/batches/[id]`):

- **Details:** item, kind, batch/serial no., heat no., supplier batch no. and supplier, manufactured/expiry dates,
  remnant length and the parent it was cut from. Read-only.
- **Stock by warehouse** in this entity, with the owner for customer material.
- **Movements:** the existing stock ledger filtered to this batch (needs `inventory.report.read`).
- **Quality** (each part only with its read permission): inspections (2d records and 1b receipt inspections), NCRs
  and first-article inspections of this batch, each linking to its page.
- **Attachments:** the existing attachments panel with owner `batch` (add, download, remove with the attachment
  permissions), and the certificate pack download (`quality.attachment.read`).
- **Genealogy:** a link to the genealogy page for this batch (`manufacturing.genealogy.read`).

Batch numbers in the stock balance and on the genealogy page link to the batch page.

## API

- `GET /batches/search?q=` — tenant batches matching the text (batch no., heat no., item code), with item, kind and
  the quantity in the active entity. `inventory.batch.read`.
- `GET /batches/:id` — details, stock by warehouse in the entity, and quality references the caller may read.
  `inventory.batch.read`; 404 for another tenant's batch.

No migration; no new permissions (existing `inventory.batch.read`, `inventory.report.read`, quality and attachment
permissions).

## Tasks

1. Claim in STATUS, this design and decision 053 to main (docs-only PR).
2. API endpoints with a smoke (`smoke-batch-page.mjs`).
3. Web list and page, nav entry, links from stock balance and genealogy; e2e `batch-page.mjs` desktop and 390 px.
4. Regression (inventory, genealogy, quality smokes; quality and inventory browsers), root checks, review,
   STATUS/LOG, PR.
