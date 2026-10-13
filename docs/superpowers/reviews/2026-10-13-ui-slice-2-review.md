# UI slice 2: menu by area of work, and "My work" Home (review and evidence, decision 068)

[Plan](../plans/2026-10-13-ui-slice-2-menu-home.md), built on [slice 1](2026-10-13-ui-slice-1-review.md). Migration
`0051_user_preference`. No business rule, posting or permission changed.

## What changed

- **Menu by area.** Nine collapsible areas (Sell, Buy, Stock, Make, Quality, Machines, Services, Accounts & GST,
  Settings) under "My work". All 73 links appear once; an area with nothing visible to the person is hidden. Account
  ledger and Stock ledger now have links, the placeholder "Compliance — P1" entry is gone, and the row of Finance links
  under every Finance page title is gone. The menu data is one file (`nav-data.ts`); the command palette groups by the
  same areas.
- **Customers and Suppliers** are one parties page opened with `?role=customer` or `?role=supplier`; the role filter
  lives in the address, the heading follows it, and the menu highlights the matching entry.
- **Favourites, recent pages, closed areas.** A star on each menu link adds it to "Favourites" at the top; "Recent" shows
  the last five other menu pages; areas fold and stay folded. Saved per person and workspace in `user_preference`
  (`GET`/`PUT /me/preferences`), so they follow the person to another browser; a copy in the browser makes the menu open in
  the right shape before the server answers. Changes show at once and are saved together a moment later; if saving fails
  the menu keeps working. The erase routine deletes the rows.
- **My work (Home).** `GET /home` returns up to 18 tiles for the active entity (needs me, sell and cash, buy and pay, stock,
  make, quality, machines), each with a count, up to five rows and a link; a tile is returned only when the person can read
  what it counts. Home shows a card for each tile with something waiting and lists the rest as "All clear", so it is not a
  wall of zeros. The set-up card stays while steps remain; the development roadmap is already gone (slice 1).
- **Audit.** The audit script now also checks every menu link opens a page and every page that is not a record page sits
  under a menu path (0 broken, 0 outside, 73 links).

## Where the build differs from the plan

- **The server checks the shape of a stored link, not the menu list.** It accepts `/app` plus up to three lowercase
  segments, optionally the parties role filter, never an external or script address; the menu lists live in the web app, so
  the browser filters stored links to ones it knows and the person's permissions. The smoke checks external, script, dotted
  and over-long paths are refused.
- **"My drafts" covers six document types** (sales invoice, sales order, quotation, purchase order, purchase invoice,
  stock entry), the ones with a list page in the menu; credit/debit notes and landed cost vouchers are not included.
- **Supplier bills due** includes overdue ones ("due within 7 days or overdue"), since an overdue bill is also due.
- **Customer and supplier bill tiles bring bills up to date first** (the same step the Outstanding page runs, under the same
  lock), so the numbers match that page; with books not yet active they are zero.
- **Items below reorder level** counts own stock in the active entity only; an item with a level and no stock at all counts
  as zero on hand. Items are shared by the workspace, so a new entity with no stock shows every item that has a level.
- **Not built, as planned:** sales orders due to ship, stock waiting for inspection, work orders not scheduled,
  operations out of sequence, skills expiring.

## Found while building

- A save of the menu's preferences could be overwritten by a slower load of the older copy, losing a page visit or an
  area fold made in the first moments after a page loaded. The load now keeps a change that is waiting to be saved, and a
  change made before the saved choices are known is held back rather than saved over them.
- Two parts of the menu each kept their own pending save, so an older set could be sent after a newer one. There is now
  one pending save per workspace and it always sends what the page holds when it fires.

## Evidence

- **Preferences smoke** (new, 41 checks): saved and read back, duplicates dropped, limits, external and script addresses
  refused, per workspace, a person with almost no permissions, signed out and outsider refused, erasure removes the rows.
- **Home smoke** (new, 52 checks): every tile computed without error; counts and rows for reorder level, expiring
  quotations, old drafts (not other people's), late purchase orders, maintenance due and gauges due; permission scoping
  (a clerk sees three tiles); second entity and second workspace; no active entity; a locked table makes one tile report
  an error while the rest arrive. Tiles for timesheets, NCR dispositions, maintenance verification, job work, work
  orders, job cards, NCRs, CAPA, machines, taps and the two bill tiles are checked for no error and for zero on an empty
  workspace, **not yet for non-zero values**.
- **Browser walkthrough `e2e:menu-home`** (new, desktop and 390 px, run twice): Home tile with count and link, areas, no
  Finance row, fold and favourites surviving a reload and following the person to a second browser, recent pages,
  Customers and Suppliers, a stores clerk seeing only the Stock and Settings areas and one tile, the phone menu.
- **UI audit:** 194 page views, 0 overflow, 0 console errors, 0 failed calls; 73 menu links, none broken.
- **Regression:** all browser walkthroughs pass (the 31 from slice 1 plus date field and menu/Home), including e-mail
  delivery run with its own servers. Six needed their menu clicks updated and are the only test changes: the entry named
  "Home" is now "My work"; "Customers & suppliers" is now "Customers" or "Suppliers"; "Due and orders" is now
  "Maintenance"; "Machines" is now an area, so the walkthrough opens the Machines link; a button search for "Add time" now
  matches the exact name, because the new star button's name "Add Timesheets to favourites" also contains it.
  API smokes: user erasure 34 (the erase routine was replaced), ITC-04 33 (its deadline logic moved to a shared function),
  maintenance 92. Root typecheck 20, build 12, tests 15.
