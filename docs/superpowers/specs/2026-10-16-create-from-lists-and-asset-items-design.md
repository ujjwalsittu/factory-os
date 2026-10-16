# Create from any list, and asset purchases — design (decision 069)

Slice 3 of the UI, menu and connections work ([decision 068](../specs/2026-10-13-ui-menu-connections-design.md)); slices
1 and 2 are merged. The user's request on 2026-10-16: wherever a form fetches a list and the record needed is not there,
offer to add it in a modal and carry on, for example a new item on an item line, "likewise" everywhere, including asset
purchases. The user's choices:

- **Assets:** asset items through the normal purchase flow (no register or depreciation yet).
- **Order:** create-from-anywhere first (this slice); item and party pages, Related and Accounting panels and record
  search follow as slice 4; the Connections page and hand-offs as slice 5.

Nothing about how documents post changes except the new asset rule below.

## 1. Add new from any list

**The rule.** A field that saves a reference to a master record offers "Add new …" when the person may create that
record. Filters, search boxes and report selectors never do: they find records, they do not save one.

**Lists covered** (each with the permission that shows the option, and what the form is pre-filled with):

| Record | Permission | Used in (not exhaustive; the build lists every use by search) | Pre-filled from |
|---|---|---|---|
| Item | `masters.item.create` | item lines on purchase orders and invoices, quotations, sales orders and invoices, stock entries, BOMs, inspection plans, job work, rate cards, memberships, subscriptions, campaigns, projects, maintenance spares | the search text as the name; type from the field (an asset line starts as an asset) |
| Customer, supplier, job worker | `masters.party.create` | every party field: purchase documents, landed cost, supplier notes and claims, sales documents, receipts and payments, customer material, bookings, projects, job work, waste | the role the field needs; the search text as the legal name |
| Warehouse | `inventory.warehouse.create` | stock entries, sales lines, inspections, NCR dispositions, job work, maintenance spares, supplier returns | type from the field where it is fixed |
| Unit of measure | `masters.uom.create` | item form, waste form | the search text as the code |
| HSN / SAC code | `masters.hsn.create` | item form | the typed digits |
| Work centre | `manufacturing.work_centre.create` | BOM operations, skills, calendars | the search text as the name |
| Ledger account | `accounts.account.create` | journal lines, receipts and payments, bank charges, bank set-up, the asset account on a purchase line | the group or type the field needs |
| Project | `services.project.create` | timesheets, bookings | the search text as the title |

Machines, BOMs and similar records that need more than a dialog stay on their own pages (the machine is added under its
work centre); a field for one of them says "None yet" with a link to the page instead of a dialog.

**How it looks and behaves.**
- **Dropdown fields** get a last choice, "＋ Add new supplier…" (the native control is kept, so phones still use their own
  picker). **The item search** gets a last row, "＋ Add “text” as a new item", always shown while typing and reachable
  with the keyboard (↓ then Enter).
- **An empty list** shows a hint under the field ("No suppliers yet. Add one.") with the same action, not a blank control.
- **The dialog** holds the same form the master's own page uses, so there is one form per record and the page and the
  dialog cannot drift. On save the new record is selected in the field, the lists refresh, and focus returns to the line
  being edited. Nothing navigates, so an open document and its draft autosave are untouched.
- **One level of nesting:** the item form needs a unit and an HSN code, and those fields offer "Add new" too, so a first
  item on a new workspace can be created from a purchase line without leaving it.
- **A duplicate code** ("code already used") shows the error on the field with a button, "Use the existing …", that
  selects the record that has the code.
- **No permission:** the option is not shown; an empty list says "Ask an administrator to add it."
- **Entity-level records** (warehouses, work centres, ledger accounts) are created in the active entity; fields that need
  one are already behind the entity prompt.
- **Phones:** the dialog is full width and scrolls; the field keeps its place.
- Everything is created through the existing create endpoints, so audit, numbering and validation are unchanged.

**A guard against drift.** A script lists every place that fetches one of these lists for a field and is not using the
shared field components; the build starts from its output and ends with it empty (list pages and filters are allowed by
name). It runs with the UI audit.

## 2. Asset purchases

**What an asset is here.** A new item type, **Asset**: plant, machinery, equipment, tools of long life, furniture, IT.
It is never stocked (like a service): no warehouse, batch or serial, and it cannot be added to stock entries, BOMs,
job work or sales documents. Selling or scrapping an asset is not built here; the sales pickers do not offer assets and
the API refuses an asset on a sales document ("Asset disposal is not built yet").

**How a purchase posts.**
- A purchase order and invoice for an asset item work like a service line (no receipt step).
- On the invoice, an asset line has an **Asset account**: a ledger account in the entity's chart, pre-selected from a new
  mapping, **Fixed assets** ("Fixed assets", group Fixed Assets, an asset account). The field offers "Add new" like every
  other list. It is on the invoice line, not on the item, because items are shared by the workspace while each entity has
  its own chart.
- The posting debits the line's asset account (not purchases or inventory) with the taxable value; the party's payable
  and input GST post as for any purchase. **When the invoice is not eligible for input credit, the tax is added to the
  asset's cost** (non-refundable tax is part of the cost of an asset) instead of the non-creditable-tax expense.
- On submit the order is: first the chart step (it adds the Fixed assets ledger and mapping if they are missing, and
  never changes anything else), then the check. With no account on the line and still no Fixed assets mapping (the
  mapping was removed and the ledger code is taken by another ledger), submitting is refused with the reason, pointing to
  Accounting setup; nothing posts partially. With books not active, nothing posts, as for every document.
- **Existing entities with active books** get the Fixed assets account and mapping the first time an asset invoice is
  submitted there, through the same idempotent chart step the maintenance spares use (it only adds what is missing); no
  migration touches any books, and no books are activated.

**Not in this slice** (recorded as next steps): an asset register with tags, capitalisation date and depreciation
(straight-line and written-down value, Companies Act and Income-tax), asset disposal and sale, customs duty and freight
on imported assets, and an assets report. Until then, the asset lines are on their purchase invoices, and the Items list can be filtered by the Asset type.

## 3. Carried from slice 2

The one open review thread on the merged slice 2 and three small notes are fixed first, in this slice:
- menu favourites and their saved copy are keyed by the signed-in user as well as the workspace, and pending saves are
  sent and awaited at sign-out, so a second person on a shared computer never sees or overwrites the first person's menu;
- restored saved menu choices are cleaned against the menu before use;
- changing the Customers/Suppliers role filter keeps other address parameters (such as `new`);
- the Home tile time limit clears its timer when the tile finishes.

## 4. Testing

- **API smoke (new):** the asset type (never stocked, refused on stock entries and sales documents); purchase order to
  invoice for an asset line; posting debits the line's account, then the mapping; refusal with neither; the tax added
  to cost when credit is not eligible, and the usual input credit when it is; books not active posts nothing; the
  migration's account and mapping on an entity that already had active books; the existing buying, accounting and
  supplier-return smokes unchanged.
- **Browser walkthrough (new, desktop and 390 px):** on a new workspace, a purchase order with no supplier and no items:
  add a supplier from the field, add an item from the line (creating a unit and HSN code inside it), and finish the order;
  a sales invoice customer; a stock entry warehouse; a BOM work centre; a journal ledger account; an asset purchase with a
  new asset account; the duplicate-code path; a person without create permission sees no option; the draft and its
  autosave survive a dialog; the keyboard path on the item search.
- **Regression:** all earlier walkthroughs, the UI audit (with the new guard script), typecheck, build, tests.

## 5. Build order (one PR)

1. The carried fixes (section 3), with the preferences smoke and menu walkthrough re-run.
2. The shared forms extracted from the master pages, the dialog and the two field components, used first by the master
   pages themselves.
3. Rollout to every list in section 1, driven by the guard script, with permissions.
4. Asset items: migration `0052_asset_items` (the item type and the invoice line's account column), API, purchase line account, web.
5. Smoke, walkthrough, regression, review, STATUS, LOG; then the PR.

## 6. Decisions

Recorded as decision 069: add-new from any reference list as above (not in filters), the Asset item type with the
account on the purchase line and no register or depreciation yet, and the delivery order (create-from-anywhere, then
records, then Connections).
