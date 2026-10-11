# Batch and serial page — review and evidence (decision 053)

[Design](../specs/2026-10-11-batch-page-design.md). Closes follow-up 4 of the
[2d review](2026-10-09-manufacturing-2d-review.md). No migration, no new permissions.

## What changed

- **API** (`inventory.controller.ts`):
  - `GET /batches/search?q=` finds tenant batches by batch/serial no., heat no. or item code (case-insensitive,
    `%`/`_` escaped), newest first, at most 100, with the quantity in the active entity.
  - `GET /batches/:id` returns the details, stock by warehouse in the entity (with owner), and the inspections
    (2d records and 1b receipt inspections not already linked to a record), NCRs and FAIs of the batch. Each quality
    list is `null` without its read permission. Another tenant's batch is not found.
- **Web:**
  - Inventory → Batches & serials (`inventory.batch.read`) with a search field.
  - The batch page: read-only details, stock, movements (stock ledger filtered to the batch, with
    `inventory.report.read`), quality links, the attachments panel (owner `batch`, MTC by default), the certificate
    pack and a genealogy link.
  - Batch numbers in the stock balance and a "Batch page" button on the genealogy page link to it. The certificate
    pack download moved to `lib/quality.ts` and is shared.

## Review

One adversarial pass over the diff. No Critical or Important finding.

- Checked: tenant scoping on both endpoints (a foreign batch id returns 404 and never appears in search), wildcard
  escaping, the entity filter on stock, 1b rows already recorded against a 2d record not listed twice, quality lists
  hidden without their permission, and no editable inputs on the page (the walkthrough asserts it).
- At 390 px the movements table scrolls inside its card; the page itself does not scroll sideways.
- **Test note:** the walkthrough scopes the "Genealogy" link to the page content, since the sidebar has a link with
  the same name.

## Evidence

| Check | Result |
|---|---|
| `smoke-batch-page.mjs` (new) | 10 checks PASS |
| `smoke-inventory.sh` / `smoke-genealogy.mjs` / `smoke-serials.mjs` | PASS / 53 / 59 PASS |
| `smoke-quality.mjs` | 112 PASS |
| `e2e:batch-page` (new, desktop + 390 px) | PASS |
| `e2e:quality` / `e2e:inventory` / `e2e:genealogy` | PASS |
| `pnpm typecheck` / `pnpm build` / `turbo run test --force` | 19 / 12 / 11 tasks PASS |
| `pnpm lint` | 0 configured tasks |
| `git diff --check` | clean |
