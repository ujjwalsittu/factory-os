# Manufacturing slice 2b — self-review

Design: [spec](../specs/2026-10-08-manufacturing-2b-design.md), [plan](../plans/2026-10-08-manufacturing-2b.md),
decision 046. A review by a fresh agent or human is still recommended.

## What was built

- **Serials as batches of one:**
  - `batch.kind = 'serial'`; serial lines must have quantity 1, and a serial can't be received while it's already in stock.
  - Receipts take typed or pasted serials, sales invoices pick a serial per line, and transfers and returns carry them unchanged.
  - COGS (cost of goods sold) uses each serial's own cost.
- **Serial manufacturing:**
  - Output numbers come from `item.serial_prefix` plus a gapless per-item counter (`serial_counter`).
  - Each output serial carries an equal share of the actual cost, with the exact remainder on the last.
- **As-built:**
  - The append-only `serial_component` table records which component serials are in each assembly.
  - Each assembly takes exactly the BOM count of each serial component; the components must have been issued to the same work order and can't already be in a live assembly.
  - Cancelling an output reverses the rows, which frees the components.
- **Remnants:**
  - The `cut` stock purpose moves weight into a child batch (`kind = 'remnant'`, `length_mm`, same heat). It recreates the consumed FIFO portions, so value moves exactly and no GL posts.
  - Remnant search; Cut from the issue dialog; lengths shown in issue screens.
- **Genealogy:**
  - The service walks backward to receipts and forward through remnants, work orders and as-built links to stock and customers.
  - Node limit 5,000, depth limit 10. Shared heats appear under every parent, marked "shown above".
  - Recall list with a CSV export; formula-like cells are neutralised.
- **Migration `0028_serials_remnants`:** additive.
- **New permissions:** `manufacturing.genealogy.read/export`, for Quality and Production Planner.

## Deliberate limits

1. One line per serial. The pasted-serial expansion keeps entry quick, but a 200-serial receipt is 200 lines.
2. When a serial assembly has as-built rows, the backward trace shows only its own component serials. Lot materials of the same work order still show for every assembly of that order.
3. Sales returns aren't linked to a specific delivery in the trace; returned quantity is shown against the earliest deliveries.
4. Cut-on-issue is two postings (the cut, then the issue), not one document.
5. No certificate attachments, labels, or customer-owned serials yet (see the spec's scope).

## Verification

- Core unit tests: 79 pass, 3 of them new.
- `smoke-serials.mjs` passes 59 checks and `smoke-genealogy.mjs` 53.
- `smoke-manufacturing.mjs` (104 checks) still passes.
- `e2e:genealogy` and `e2e:manufacturing` pass on desktop, and `e2e:genealogy` also at 390 px mobile.
- See STATUS for the full regression run.
