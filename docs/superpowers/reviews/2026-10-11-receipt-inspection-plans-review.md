# Inspection plans on purchase-receipt inspections — review and evidence (decision 052)

[Design](../specs/2026-10-11-receipt-inspection-plans-design.md). Closes follow-up 1 of the
[2d review](2026-10-09-manufacturing-2d-review.md). No migration.

## What changed

- **API** (`quality.service.ts`, `quality.controller.ts`, `buying.controller.ts`, `stock-posting.service.ts`):
  - `POST /quality/inspections/receipt` opens a draft incoming record against the item's active plan for part of a
    company-owned receipt line in quarantine. The receipt line is locked, so concurrent opens and quick inspections
    cannot over-claim it.
  - Pending = received − submitted − open drafts; the pending list shows the plan revision and the quantity in progress.
  - The quick form is refused for company-owned lines of planned items.
  - Submitting a receipt record moves accepted stock to stores, raises the NCR for rejects (MRB), and writes the 1b
    `quality_inspection` row (own QI number, record link). That row cannot be cancelled; the NCR corrects it.
  - Drafts of receipt records can be withdrawn; cancelling the receipt withdraws them.
  - The inspection detail names the receipt and supplier.
- **Web:** "Inspect to plan" with a plan badge and in-progress quantity on Incoming inspection; the inspection page
  shows the receipt and a Withdraw action for drafts; plan-based rows link to their results instead of Cancel.

## Review

One adversarial pass over the diff. No Critical or Important finding.

- Checked: lock order (receipt line, then record), customer-owned lines never reaching quality transfers (they carry
  no owner), a plan made obsolete after a draft opened (the draft keeps its frozen plan; the line falls back to the
  quick form for the rest), and return to vendor finding the lot's purchase invoice through the batch.
- **Noticed, out of scope:** the "receipt has been inspected" cancel guard in `stock-posting.service.ts` sits inside
  the purchase-order branch, so a receipt without a PO is not guarded by it (stock reversal fails anyway once
  inspected stock has left quarantine). Recorded under Noticed in STATUS.
- **Test fix:** the buying walkthrough's last mobile step waited for `text=Inspections`, which since 2d first matches
  the hidden sidebar link; it now waits for the page content.

## Evidence

| Check | Result |
|---|---|
| `smoke-receipt-inspection-plans.mjs` (new) | 81 request checks PASS |
| `smoke-quality.mjs` / `smoke-fai.mjs` | 112 / 52 PASS |
| `smoke-buying.sh` / `smoke-customer-material.sh` | PASS |
| `e2e:receipt-inspection-plans` (new, desktop + 390 px) | PASS |
| `e2e:buying` / `e2e:quality` | PASS |
| `pnpm typecheck` / `pnpm build` / `turbo run test --force` | 19 / 12 / 11 tasks PASS |
| `pnpm lint` | 0 configured tasks |
| `git diff --check` | clean |
