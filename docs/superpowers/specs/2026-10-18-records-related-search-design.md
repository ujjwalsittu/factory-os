# Item and party pages, Related and Accounting panels, record search — design (decision 070)

Slice 4 of the UI, menu and connections work ([decision 068](2026-10-13-ui-menu-connections-design.md), where it was
slice 3 of the original list; slices 1 to 3 are merged). The scope was approved in 068: record pages for items and
parties, a "Related" panel and an "Accounting" panel on documents, and record search in "Search or jump to…". This
document fixes the details the 068 text left open. No posting, permission or business rule changes; everything here
reads existing data, so there is **no migration**.

## 1. Item page and party page

- **Item page** `/app/masters/items/[id]`; the Items list opens it (the edit form stays a button on the page).
  Sections, each shown only when the person may read what it lists, each at most 10 rows with "See all" where a list
  page exists:
  - details and the edit form;
  - **stock** by warehouse and batch (own stock in the active entity; customer-owned shown separately) and the reorder level;
  - **bills of materials** where it is the product, and where it is used;
  - **open orders:** purchase orders and sales orders with quantity still to receive or ship;
  - **work orders** for it, and **recent movements** (the last 10 stock ledger rows);
  - **quality:** inspection plan, open NCRs;
  - **maintenance:** where it is used as a spare;
  - for an asset: the purchase invoice lines it appears on (no register yet).
- **Party page** `/app/masters/parties/[id]`: details, GST and addresses; then by role:
  - **customer:** quotations, sales orders, invoices, credit/debit notes, receipts, and what is outstanding;
  - **supplier:** purchase orders, receipts, invoices, supplier notes, return claims, payments, job work, and what is outstanding;
  - **ledger** (statement of the party's account) when books are active.
  Lists show number, date, status and amount, newest first, 10 rows, each row a link.
- One API read per page (`GET /items/:id/overview`, `GET /parties/:id/overview`) that returns only the sections the person
  may read, so a person without, say, selling access never sees sales rows; counts are computed in the same request.
  Entity scope: items are workspace-wide, so stock and orders are for the active entity; the page says which entity.
  With "All entities" selected the activity sections ask for an entity (same prompt as other entity pages), the details still show.

## 2. Related panel on documents

A card on each document page, "Related", showing the chain both ways with each link opening the record:

| Document | Up | Down |
|---|---|---|
| Quotation | – | sales orders, invoices |
| Sales order | quotation | invoices, work orders |
| Sales invoice | sales order, quotation | receipts, credit/debit notes, accounting vouchers |
| Purchase order | – | receipts, inspections, purchase invoices |
| Receipt (stock entry) | purchase order | inspections, purchase invoice lines |
| Purchase invoice | purchase order | payments, supplier notes, return claims |
| Work order | sales order | stock entries (issue, output), job cards, job work, inspections, output batches |
| Maintenance order | plan, machine | spares issues |
| Job work order | work order | challans, receipts, processing-charge invoice |

- One endpoint `GET /related/:type/:id` driven by a table of links (the foreign keys that already exist: quotation →
  sales order → invoice, `stock_entry.purchase_order_id`, `stock_entry.work_order_id`, `purchase_invoice.purchase_order_id`,
  the note and claim `original_invoice_id`, `job_work_order.work_order_id`, quality records' `work_order_id`, receipt
  allocations for payments). Each target type is included only if the person may read it. At most 10 per type.
- A link whose target cannot be read by the person is left out, never shown as a bare number.

## 3. Accounting panel on documents

- The existing `AccountingSourceLinks` (stock entries, purchase and sales invoices, landed cost) becomes the Accounting
  panel on **every document that posts**: also credit/debit notes (sales and supplier), receipts and payments,
  work-order close, maintenance orders (spares), supplier return claims, and bank charges. For each: its journal
  vouchers with their entries (account, debit, credit), each voucher linking to the journal page, and the journal page
  linking back to the document (it already records its source).
- When the books are not active the panel says so and links to Accounting setup; before cut-over it says the document is
  historical; a document that should have posted and has not is shown as an error (the existing states).
- The server side is the existing `GET /accounts/source-status`, extended with the new source types and their read
  permissions; no new posting code.

## 4. Record search

- "Search or jump to…" (the command palette) gains a **Records** group beside **Pages**, filled by
  `GET /search?q=` after two typed characters, debounced, at most 20 results across: document numbers (quotations, sales
  orders and invoices, purchase orders and invoices, stock entries, work orders, NCRs, inspections, job work orders,
  maintenance orders, vouchers), items (code, name, drawing no.), parties (name, code, GSTIN), batches and serials,
  machines (code, name).
- Scoped to the workspace and the active entity, each type permission-checked (a person who cannot read sales does not
  get sales numbers), case-insensitive "contains", ranked by exact code or number first, then recency. Results show type,
  number or name, a short detail line and open the record. The palette keeps its keyboard behaviour (↑ ↓ Enter Esc),
  shows "Searching…" and "No records" states, and a failed search never blocks the page results.
- No full-text index in this slice: queries use the existing indexes on number and code columns with a result limit; if a
  type is slow on a large workspace it is dropped from the search and named in the review, not approximated.

## 5. Testing

- **API smoke (new):** the overview and related reads (sections present for a person with access, absent without; entity
  scoping; second workspace sees nothing), the search (each type found, permission filtering, limit, ranking), the extended
  source-status for the new document types with books active and inactive.
- **Browser walkthrough (new, desktop and 390 px):** open an item and a party from their lists; follow Related links through a
  purchase chain and a sales chain; the Accounting panel with books active and not; search finds a document, an item, a party
  and a batch and opens them; a restricted person sees fewer sections and results.
- **Regression:** all earlier walkthroughs, the UI audit (the new pages included, 0 overflow, 0 errors), typecheck, build, tests.

## 6. Build order (one PR)

1. API: `GET /items/:id/overview`, `GET /parties/:id/overview`, `GET /related/:type/:id`, `GET /search`, and the extended
   source-status; permission scoping shared in one helper; smoke.
2. Item and party pages.
3. Related panel and Accounting panel on every document page.
4. Record search in the palette.
5. Walkthrough, audit, regression, review, STATUS, LOG; then the PR.

## 7. Decisions

Recorded as decision 070: the pages and panels above as listed, search by contains with no new index, no migration. The
Connections page and hand-offs follow as the last slice.

## 8. CI on the self-hosted runner

The user added a self-hosted GitHub runner (2026-10-18) and asked that, from now on, CI that is blocked on GitHub for billing
runs on it instead. The workflows use `ubuntu-latest` today and were running; when a run is blocked for billing the
workflow's `runs-on` is switched to `self-hosted` in the same PR, with the reason in the commit message. Recorded in MEMORY.
