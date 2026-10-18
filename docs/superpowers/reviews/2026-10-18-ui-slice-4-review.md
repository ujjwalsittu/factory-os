# UI slice 4: record pages, Related and Accounting panels, record search (review and evidence, decision 070)

[Design](../specs/2026-10-18-records-related-search-design.md), built on [slice 3](2026-10-16-ui-slice-3-review.md). No migration,
no posting change, no new permission: every read is gated by the permission that already guards the record it shows.

## What changed

- **Item page** (`/app/masters/items/[id]`) and **party page** (`/app/masters/parties/[id]`), opened from an "Open" link at
  the end of each row of the lists (the row still opens the edit form). One read each (`GET /items/:id/overview`,
  `GET /parties/:id/overview`) returns only the sections the person may read:
  - item: stock by warehouse and batch, recent movements, bills of materials as product and where used, open purchase and
    sales orders with quantity still to receive or ship, work orders, NCRs, inspection plans, use as a maintenance spare, and
    for an asset the purchase invoices it is on;
  - party: by role, quotations, sales orders, invoices, credit/debit notes; purchase orders, receipts, invoices, supplier
    notes, return claims, job work; and receipts and payments. A link goes to the Outstanding report.
  Each list is the latest ten rows, each row a link. Activity is per legal entity, so with "All entities" the page asks for one
  (the details still show).
- **Related panel** (`GET /related/:type/:id`, `RelatedPanel`) on quotations, sales orders, sales invoices, purchase orders,
  receipts, purchase invoices, work orders, maintenance orders and job work orders: the chain up and down, built from the
  foreign keys that already exist. A payment allocated to an invoice shows on the invoice (through the bills it created).
  Records the person may not read are left out.
- **Accounting panel** (`AccountingSourceLinks`, `GET /accounts/source-status`) now also on credit/debit notes, supplier notes
  and receipts/payments, besides the four document types that had it. When books are not active it links to Accounting setup.
- **Record search** in "Search or jump to…" (`GET /search?q=`): after two typed characters and a short pause, document numbers,
  items, parties, batches and serials, machines and journal vouchers, at most 20, exact matches first, scoped to the
  workspace and active entity and to what the person may read. Pages and actions still show while it searches, and a failed
  search shows only the pages.

## Where the build differs from the design

- **Accounting panel:** bank charges and work-order close variances are not added (they post under their own source types and
  have no document page that fits the panel); journal vouchers already link back to them.
- **Related:** job cards and quality inspection records are not listed (job cards have no page; inspections link through
  the receipt and are not part of the chain yet); the chain for a job work order shows its work order only.
- **Outstanding** is a link to the Outstanding report, not a sum on the party page, so that two screens never show different
  balances.
- **Search by inspection or NCR record numbers:** NCRs are searched; inspection records are not.
- **Ranking:** exact number or code first, then most recent within each type, types in a fixed order (no relevance score).
- **The panels sit at the top of a document,** beside the Accounting panel, not at the bottom.
- **The "Open" link on the Items and Customers & suppliers lists is inside the first cell,** not a new column: a new column made both lists scroll sideways at 390 px (found by the audit). The row still opens the edit form.

## Found while building

- Item and party pages asked the API before the person's legal entity was known (a person with only entity-level roles has
  no "All entities" view), got "not found" and kept it. Their reads now depend on the entity, as the other entity pages do.
- The palette compared the typed text lowercased with the text it had searched, so searches with capital letters (every
  document number) showed no records. Fixed and covered by the walkthrough.
- Changing the menu and reloading within about a second (before the debounced save lands) can show the older server copy on the new page; the pagehide save is sent with `keepalive` but the next page's read can overtake it. Noted in STATUS, not fixed here.
- A payment can be recorded against no invoice (an advance); it shows on the party page but not on any invoice chain.

## Evidence

- **Records smoke** (new, 97 request checks): item overview before and after a receipt, an asset's invoices, the party page
  by role, the purchase chain (order, receipt, invoice, payment) and the sales chain (quotation, order, invoice) both ways,
  an unallocated payment kept off an invoice, search by number, code, name, GSTIN and batch with exact match first,
  literal `%` and `_`, the two-character minimum and the 20-result limit, a person with only item and party access seeing
  no sections, chains, documents in search or the panel (and a refused panel read), and a second workspace seeing nothing.
- **Browser walkthrough `e2e:records`** (new, desktop and 390 px): items list → item page with stock by batch; parties list →
  party page → purchase order → its Related panel → the invoice with its Accounting and Related panels; the palette finds a
  document, an item, a batch and a party and opens them with the keyboard; a reader with only item and party access sees
  empty item sections and no purchase orders in the palette; no sideways scroll on the new pages.
- **UI audit:** 194 page views, 0 overflow, 0 console errors, 0 failed calls, 73 menu links none broken, add-new guard empty.
- **Regression:** 10 API smokes (records, asset items, accounting, accounting operations, supplier notes, sales note returns,
  maintenance, preferences, Home, user erasure), the buying, selling and inventory shell smokes, and 34 browser
  walkthroughs (all earlier ones plus records). One walkthrough check changed: the phone menu step of `menu-home` assumed which
  state the saved choices had left the Sell area in and failed about half the time; it now checks that tapping the header
  flips it. Root typecheck 20, build 12, tests 15.

