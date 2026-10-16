# UI slice 3: add new from any list, and asset purchases (review and evidence, decision 069)

[Design](../specs/2026-10-16-create-from-lists-and-asset-items-design.md), built on [slice 2](2026-10-13-ui-slice-2-review.md).
Migration `0052_asset_items`. No existing posting or permission rule changed; one new permission-free rule (assets are
bought, not sold) and one new posting path (asset lines).

## What changed

- **Add new from any list.** A field that saves a reference to a master record now ends in "＋ Add new supplier…" (and the
  same for customers, job workers, items, warehouses, units, work centres, ledgers and projects) when the person may
  create that record. The choice opens the same form as the master's own page; on save the new record is selected, the
  lists refresh and the page, its draft and its autosave are untouched. The item search ends in "＋ Add “text” as a new
  item" (↓ then Enter). The item form offers a new unit from its unit field and a new HSN/SAC code under its code field, so a
  first item on an empty workspace can be created from a purchase line. A duplicate code shows "Use the existing …".
  Without the permission the option is not shown. The forms live in one file (`master-dialogs.tsx`) used by both the master
  pages and the popups; the dropdown is `LookupSelect`.
- **A guard script.** `guard:add-new` lists every file that fetches one of the nine master lists and does not use the shared
  field for that list. List pages, report filters and machine pickers are allowed by name with a reason
  (`add-new-allow.json`). It runs at the start of the UI audit and ends empty.
- **Asset items.** A new item type, Asset: never stocked, tracking forced to none, cannot become (or stop being) an asset,
  hidden from sales pickers (`?sellable=true`). Stock entries, BOMs and job work refuse it because it is not a stock item;
  sales documents refuse it with "asset disposal is not built yet"; returns of asset purchases are refused the same way.
- **Asset purchases.** A purchase invoice line for an asset carries an Asset ledger (an active asset ledger of the entity),
  shown under the item with its own "Add new asset ledger". With none chosen, the new **Fixed assets** mapping is used. The
  posting debits that ledger with the taxable value; when the invoice is not eligible for input credit the tax is added to
  the asset's cost instead of the non-creditable-tax expense. Cancelling reverses it as for any purchase.
- **First use.** On submit the chart step runs first (it only adds what is missing: the Fixed assets ledger and mapping on
  books that were activated before this release), then the check. If the mapping is still missing (removed, and the ledger
  code taken by another ledger) and the line names no ledger, the submit is refused and nothing posts. With books not
  active nothing posts, as for every document. No migration touches any books.
- **Carried from slice 2.** Menu favourites and their saved copy are keyed by person as well as workspace and pending saves
  are sent and awaited at sign-out; restored choices are cleaned against the menu; the parties role filter keeps other address
  parameters; the Home tile time limit clears its timer.

## Where the build differs from the design

- **HSN/SAC is a typed code on the item form,** not a dropdown, so the add action is "Add 74071010 to the HSN/SAC list"
  under the field (shown only when the code is not in the list and the person may add codes).
- **Timesheets and bookings do not offer a new project.** The timesheet list is active projects only, and a new project
  starts as a draft, so adding one there could not be used. Projects are offered from campaigns and by the New project button.
- **Machine pickers do not offer a new machine.** Calendars, SMT, work orders, devices, rate cards and bookings choose a
  machine, which is added under its work centre; they are allowed by name in the guard. The "None yet" link the design
  mentions is not added.
- **The empty-list hint** ("No suppliers yet. Add one.") is on the main flows (purchase order supplier, sales customer, the
  unit field of the item form); every other dropdown has the Add new choice but no separate hint.
- **The ledger edit form stays on the Chart page;** only creating a ledger uses the shared dialog.
- **An asset on a stock entry is refused when the entry is submitted,** not when the draft is saved (the stock pickers
  never offer assets; only a direct API call can add one).
- **The guard checks per file and per list,** not per field: a file that has one shared field for a list and one plain
  dropdown for the same list passes. The rollout was done field by field from the grep output.
- **The asset ledger field is hidden** when the person cannot read ledgers or the books have none; the API then uses the
  mapping.

## Found while building

- A form opened from a field inside another form would submit the outer form (React events bubble through portals). The
  dialog's submit now stops there, and popups are rendered at the end of the page so forms are never nested in the DOM.
- A new workspace has no supplier, so the purchase order's supplier select was an empty control; the hint and Add new now
  cover it.

## Evidence

- **Asset smoke** (new, 69 request checks with the accounting helper's): item type rules, sellable list, refusals (stock entry,
  BOM, sales invoice, quotation), wrong ledger refused, mapping debit with input GST, the line's ledger wins, non-creditable tax
  into cost, cancel reverses, first use adds ledger and mapping, refusal with nothing posted then success with a named
  ledger, no voucher when books are not active.
- **Browser walkthrough `e2e:create-from-lists`** (new, desktop and 390 px): purchase order on an empty workspace with a
  supplier added from the field, an item added from the line with a new unit and a new HSN code inside it, the duplicate
  code recovery; customer on a sales invoice, warehouse on a stock entry, ledger on a journal, work centre on a BOM;
  an asset purchase with a new asset ledger posted to that ledger; a person without create permission sees no option and no
  add row; no sideways scroll.
- **UI audit:** 194 page views, 0 overflow, 0 console errors, 0 failed calls, 73 menu links none broken, guard empty.
- **Regression:** 17 API smokes (asset, accounting ×5, supplier notes and returns, sales notes returns, maintenance,
  user erasure, preferences, Home, manufacturing, projects, ITC-04), the buying, selling and inventory shell smokes, and 33
  browser walkthroughs (all earlier ones plus create-from-lists and user erasure). Root typecheck 20, build 12, tests 15.

## Not built (recorded)

Asset register with tags and capitalisation date, depreciation (straight-line, written-down value; Companies Act and
Income-tax), asset disposal and sale, customs duty and freight on imported assets, an assets report, returns of asset
purchases to a supplier.
