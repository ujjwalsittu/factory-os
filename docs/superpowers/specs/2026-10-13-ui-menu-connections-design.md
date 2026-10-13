# UI, menu, Home and connections — design (decision 068)

Input: the [UI audit](../reviews/2026-10-13-ui-audit.md). The user's choices on 2026-10-13:
- **Menu:** by area of work, collapsible, with favourites and recent pages.
- **Home:** "my work, by role", from live data.
- **Connections:** all of them. Finance/accounts connected to every module, links between records, external
  integrations, and hand-offs between modules.
- **Delivery:** in slices, each its own PR to try on dev.

Nothing in the business rules changes. Ledgers, postings and permissions stay as they are; this is about finding,
seeing and moving between what already exists.

## Slice 1 — one page pattern, phone and format fixes

- **Page header:** title, one-line description (plain words, no implementation detail), actions always at the right;
  on phones the actions wrap under the title. Every "New …", "Raise …", "Certify" button moves into the header.
- **Empty states:** one component in two sizes: full (illustrated, for an empty page) and compact (one line with an
  icon, inside an empty table or card). The ~49 plain sentences in tables become the compact size.
- **Draft forms:** one header for every create/edit document page: a breadcrumb back to the list, the title (the
  document number in monospace only once one exists), status badge, and Save draft / Submit at the right.
- **Tables on phones:** every table scrolls sideways inside its card; button rows wrap. This fixes the 10 pages that
  scroll sideways today; the audit script becomes a regression check (no page may overflow at 390 px).
- **Dates:** a date field that shows and accepts DD-MM-YYYY (India), with a calendar picker, and stores ISO dates as
  today. It replaces native date inputs, which show the browser's mm/dd/yyyy.
- **Small fixes:** the sidebar background runs the full page height; narrow selects (GST %) fit their text; stale
  developer text goes (Home roadmap, "from Phase 1"); Finance page descriptions in plain words.
- **Code:** the 14 one-line components are formatted as normal code when touched (no behaviour change).

## Slice 2 — menu by area of work, and Home

**Menu areas** (each collapsible; a person sees only what their role allows; an area with nothing visible is hidden):

| Area | Pages |
|---|---|
| Home | My work |
| Sell | Quotations, Sales orders, Sales invoices, Credit/debit notes, Customers |
| Buy | Purchase orders, Purchase invoices, Supplier notes, Return claims, Landed cost, Suppliers |
| Stock | Stock entries, Stock balance, Stock ledger, Batches & serials, Remnants, Customer material, Warehouses, Items, Units & HSN/SAC, Waste register |
| Make | Work orders, Shop floor, Schedule, SMT line, Job work, Bills of materials, Genealogy |
| Quality | Inspections (incoming and in-process together), NCR / MRB, CAPA, First article, Inspection plans, Gauges, Skill matrix |
| Machines | Machines, Maintenance (due and orders), Maintenance plans, Reliability and cost, Work centres, Calendars, Devices |
| Services | Machine bookings, Memberships, Test campaigns, Subscriptions, Billing runs, Projects, Timesheets, Cost rates, Rate cards |
| Accounts & GST | Accounting setup, Receipts & payments, Outstanding, Journals, Bank reconciliation, Bank charges, Day book, Account ledger, Trial balance, Chart of accounts, ITC-04, GST sandbox |
| Settings | Entities & GST, Users, Roles, My security, Number series, Connections, Supplier return policies, Support access, Audit log |

- **Favourites and recent:** a star on each menu link and page header pins it to a "Favourites" group at the top;
  the last five pages visited show under "Recent". Saved per person on the server (one small `user_preference` row,
  JSON), so they follow the person across devices. Open/closed areas are remembered too.
- The row of Finance links under every Finance page title goes; the menu covers it.
- "Customers" and "Suppliers" are the same parties list filtered by role (one page, two entry points).

**Home — "My work"** (one API that returns counts and the top rows, each with a link; every tile appears only with
the permission to see it):
- **Needs me:** approvals waiting for me (return claims, timesheets, campaign approvals, NCR dispositions,
  maintenance verification, supplier note acceptance), my drafts older than a day, job cards I left running.
- **Sell & cash:** overdue receivables (count, amount), sales orders due to ship this week, quotations expiring.
- **Buy & pay:** purchase orders late from suppliers, payables due this week (MSME due dates first).
- **Stock:** items below their reorder level (the field exists on items), stock in quarantine waiting for inspection,
  job work material due back (ITC-04 deadlines).
- **Make:** late work orders, work orders not scheduled, operations started out of sequence.
- **Quality:** inspections waiting, NCRs open, CAPA actions overdue, gauges due, skills expiring.
- **Machines:** machines down (open breakdowns), maintenance overdue and due soon, taps not reporting.
- A short "Set up" card stays only while setup steps remain, then disappears.

## Slice 3 — records, links and search; Finance connected everywhere

- **Item page** (`/app/masters/items/[id]`): details; stock by warehouse and batch; reorder level; BOMs where it is the
  product and where it is used; open purchase and sales orders; work orders; recent movements; inspection plans, NCRs;
  where it was used as a maintenance spare.
- **Party page** (`/app/masters/parties/[id]`): details and GST; for a customer, quotations, orders, invoices,
  credit/debit notes, receipts and outstanding; for a supplier, purchase orders, receipts, invoices, notes, return
  claims, payments, job work and outstanding; its ledger (when books are active).
- **"Related" panel on every document:** the chain up and down, both ways:
  - quotation → sales order → invoice → receipt and credit note;
  - purchase order → receipt → inspection → purchase invoice → payment, plus supplier notes and return claims;
  - work order → issues and output, job cards, job work, inspections, output batches;
  - maintenance order → spares issues;
  - job work → challans and receipts.

  Each link opens the record.
- **Accounting on every document:** a "Accounting" panel on each document that posts lists its journal vouchers (they
  already record their source document) with the entries, and every voucher links back to its document. When the books
  are not active yet, the panel says so and links to Accounting setup, so it is clear why nothing posted.
- **Record search** in "Search or jump to…": document numbers, items (code/name), parties (name/GSTIN), batches and
  serials, machines, alongside pages. Scoped to the workspace and entity, permission-checked, at most 20 results.

## Slice 4 — Connections page and hand-offs

- **Settings → Connections:** one page for every external connection, each with its status, last activity and a link
  to set it up:
  - GST e-invoice and e-way bill (provider per registration, sandbox state);
  - e-mail (configured, last delivery, failures);
  - file storage (configured, a write test);
  - edge agents and machine taps (last seen, not reporting);
  - label printers (last job);
  - support access (on or off);
  - Tally (not built yet; shown as such, linking to the Tally plan).
- **Hand-offs:** actions that start the next step where the need is seen, prefilled:
  - an item below its reorder level → "Create purchase order";
  - a delivered sales order → "Create invoice";
  - an overdue invoice → "Record receipt";
  - a receipt in quarantine → "Inspect";
  - a failed inspection → "Raise NCR" (if not automatic);
  - an NCR → "Raise CAPA";
  - a work order short of material → "Issue material";
  - a machine with a tap alarm → "Report breakdown" (exists);
  - maintenance due → "Open order" (exists);
  - a supplier invoice due → "Record payment".

## Testing

- Each slice adds or extends browser walkthroughs.
- The audit script runs on every slice: no console errors, no failed calls, no page wider than a 390 px phone.
- Slices 2–3 add API smokes for the Home and search endpoints, including permission scoping and tenant isolation.
- Slice 3 adds a smoke for the related/accounting panels.

## Decisions to record

The menu areas and Home tiles above, favourites saved per person on the server, and the DD-MM-YYYY date field.
