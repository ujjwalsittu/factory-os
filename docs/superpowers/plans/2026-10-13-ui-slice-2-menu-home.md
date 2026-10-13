# UI slice 2: menu by area of work, and "My work" Home — plan (decision 068)

Slice 2 of the [design](../specs/2026-10-13-ui-menu-connections-design.md); slice 1 is merged. This plan fixes the
details the design left open, so it can be reviewed before building. No business rule, posting or permission changes.

## 1. Menu by area of work

- **Nine areas, each collapsible,** in this order: Sell, Buy, Stock, Make, Quality, Machines, Services, Accounts & GST,
  Settings, under Home (renamed "My work"). An area with no visible link is hidden; a link needs the same permission as
  today. The page the person is on keeps its area open.
- **Every existing link appears exactly once.** Mapping from today's menu (72 links, 11 sections):

| Area | Links |
|---|---|
| Sell | Quotations, Sales orders, Sales invoices, Credit/debit notes, Customers |
| Buy | Purchase orders, Incoming inspection, Purchase invoices, Supplier notes, Return claims, Landed cost, Suppliers |
| Stock | Stock entries, Stock balance, Stock ledger, Batches & serials, Remnants, Customer material, Warehouses, Items, Units & HSN/SAC, Waste register |
| Make | Work orders, Shop floor, Schedule, SMT line, Job work, Bills of materials, Genealogy |
| Quality | Inspections, NCR / MRB, CAPA, First article, Inspection plans, Gauges, Skill matrix |
| Machines | Machines, Maintenance (due and orders), Maintenance plans, Reliability and cost, Work centres, Calendars, Devices |
| Services | Machine bookings, Memberships, Test campaigns, Subscriptions, Billing runs, Projects, Timesheets, Cost rates, Rate cards |
| Accounts & GST | Accounting setup, Chart of accounts, Journals, Receipts & payments, Outstanding, Bank reconciliation, Bank charges, Day book, Account ledger, Trial balance, ITC-04, GST sandbox |
| Settings | Entities & GST, Users, Roles, Number series, GST sandbox connections, Supplier return policies, Support access, Audit log, My security |

- **Differences from the design table, and why:**
  - *Incoming inspection stays its own link under Buy.* It is a separate page from Quality → Inspections; merging the two
    pages is page work, not menu work, and is not in this slice.
  - *Account ledger and Stock ledger are added.* Both pages exist but have no menu link today: the account ledger is
    reachable only from the row of Finance links under each Finance page title, which goes in this slice, so the menu
    must carry it; the stock ledger is reachable only from other pages. The placeholder "Compliance — P1" entry is
    dropped.
- **Customers and Suppliers** are one parties page with an entry for each role: `/app/masters/parties?role=customer`
  and `?role=supplier` open it filtered; the page gains a role filter (all, customers, suppliers) and keeps its create
  form. The menu highlights the entry matching the filter.
- **Menu data:** one `NAV` definition of areas and links (same `permission` / `entityScoped` fields as today). The row
  of Finance links is removed from `AccountingShell`.
- **Phones:** the same menu in the slide-over; area headers are 44 px tall touch targets.

## 2. Favourites, recent pages, open areas

- **Stored per person and workspace** in a new table `user_preference` (migration `0051_user_preference`):
  `(user_id, tenant_id)` primary key, `data jsonb`, `updated_at`. The data is
  `{ favourites: string[≤12], recent: string[≤5], collapsed: string[] }`, validated with Zod on every write.
  Entries are menu link hrefs only, checked against the menu's own list on the server (no free text, no
  user-supplied paths), so a stored value cannot be an external URL.
- **API:** `GET /me/preferences` and `PUT /me/preferences` for the signed-in person in the active workspace. No
  permission is needed beyond being a member; a person can only read and write their own row. The tenant comes from the
  tenancy context like every other query.
- **Behaviour:**
  - a star on each menu link (and on the page header of any menu page) adds or removes a favourite;
  - favourites show as a "Favourites" group at the top of the menu, recent pages as "Recent" under it (the last five
    different menu pages, current one excluded);
  - area open/closed state is remembered;
  - links the person may no longer open (permission removed) are hidden from Favourites and Recent without deleting them;
  - writes are debounced and optimistic; if the API is unavailable the menu still works and shows the last values.
- **Erasure:** `factoryos_erase_user` deletes the person's `user_preference` rows in the same transaction (migration
  `0051` replaces the routine), and the erasure smoke checks it.

## 3. Home: "My work"

- **One endpoint,** `GET /home`, scoped to the active workspace and entity. It returns tiles; each tile has a title, a
  count, up to five rows (label, detail, link) and a "See all" link. A tile is returned only when the person has the
  permission to read what it counts, so other people's work is never counted. The page shows tiles in this order, which
  puts what needs the person first, and is "by role" because the permissions are the role.
- **Tiles in this slice** (source in brackets; each is a count query plus a top-five query, reusing existing services
  where they already compute the answer, so numbers match the pages they link to):

| Group | Tile |
|---|---|
| Needs me | Timesheets waiting for my approval; NCR dispositions waiting for approval; maintenance orders waiting for my verification; my drafts older than a day (sales and purchase documents and stock entries I created) |
| Sell & cash | Overdue receivables (bills past due date: count and open amount); quotations expiring within 7 days |
| Buy & pay | Purchase orders past their expected date and not fully received; supplier bills due within 7 days |
| Stock | Items below their reorder level; job work goods due back or overdue (the existing ITC-04 deadline count) |
| Make | Work orders released and past their planned end; job cards left running or paused |
| Quality | Open NCRs; CAPA actions past their due date; gauges due for calibration within 30 days |
| Machines | Machines in alarm or in maintenance; maintenance due and overdue (the existing due calculation); taps not reporting |

- **Not in this slice,** because the data or definition is not settled and a guess would show wrong numbers:
  sales orders due to ship (no delivery-date rule on orders), stock in quarantine waiting for inspection (already on the
  Incoming inspection page), work orders not scheduled, operations started out of sequence, skills expiring (own page).
  If a listed tile has no sound source when built, it is dropped and named in the review rather than approximated.
- **Set-up card** stays only while setup steps remain, then goes. The e-invoice card moves to Settings → Entities & GST
  in slice 4 (Connections); until then it stays on Home below the tiles.
- **Empty and loading:** a tile with a zero count shows "Nothing waiting" in one compact line; a failed tile shows a
  retry, not an empty state, and never blocks the others (each tile is computed on its own; one failure returns
  `error` for that tile only).
- **Performance:** counts use indexed columns and a per-request time limit; the endpoint returns within one round trip
  and the page shows the set-up and header immediately, then the tiles.

## 4. Build order (one PR)

1. Migration `0051_user_preference` with the erase-routine update, schema, `me/preferences` API and smoke.
2. `NAV` by area, parties role filter, Finance link row removed, favourites/recent/collapsed UI and star controls.
3. `GET /home` with the tiles that have a sound source, smoke (counts, permission scoping, tenant isolation, entity
   scoping, one failing tile does not break the rest).
4. Home page from the tiles.
5. Browser walkthrough (menu areas, favourites persist after reload and across a second browser context, recent list,
   phone menu, Home with a restricted user seeing fewer tiles) and the audit script (every link in the new menu exists
   and every page route is reachable from the menu or is a detail page).
6. Regression: browser walkthroughs, the erasure smoke, typecheck, build, tests; review, STATUS, LOG.

## 5. Decisions for the user

- **Home tile list** above (what is in and what is out). Recommendation: as listed.
- **Incoming inspection stays a separate link** until the two inspection pages are merged. Recommendation: yes.
