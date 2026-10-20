# UI slice 5 — Connections page and hand-offs — review (decision 068)

The last slice of the [UI design](../specs/2026-10-13-ui-menu-connections-design.md#slice-4--connections-page-and-hand-offs),
built to the [plan](../plans/2026-10-20-ui-slice-5-connections-handoffs.md). No migration and no new permission.

## What was built

- **Settings → Connections** (`/app/settings/connections`, `GET /connections` under `settings.integration.read`).
  - One card per connection: GST e-invoice and e-way bill, e-mail, file storage, edge agents and machine taps, label
    printers, support access, and Tally.
  - Each card has a status (Working, Needs a look, Off, Not set up), a one-line summary, the last activity, and either
    a link to the page that sets it up or who sets it up when it is a server setting.
  - What counts as "needs a look":
    - an edge agent or tap silent for 15 minutes;
    - failed e-mails or print jobs in the last 7 days;
    - the e-mail worker not running;
    - a Tally import waiting for review.
  - **Test storage** (`POST /connections/storage/test`, `settings.integration.manage`) writes a small file under the
    workspace's prefix, reads it back and deletes it, and is audited. `StorageService` gained `remove()` for it.
- **Hand-offs**, each shown only with the permission to take it:
  - Home rows carry an action:
    - items below reorder level → "Create purchase order", prefilled with the item and the shortfall;
    - overdue customer bills → "Record receipt" for that customer;
    - supplier bills due → "Record payment" for that supplier;
    - open NCRs → "Raise CAPA", which opens the NCR with the dialog up.
  - An item page below its reorder level → "Create purchase order". The shortfall is computed on the server in
    `numeric`.
  - Sales and purchase invoices with an open balance (books active) → "Record receipt" or "Record payment".
  - A submitted receipt with lines waiting in quarantine → "Inspect".
  - The purchase order form takes `?item=&qty=`. The receipt and payment form takes `?party=`. `GET /items/:id` now
    also returns the unit code, as the item list does.
- **Already there, not rebuilt:**
  - a failed inspection raises its NCR;
  - a work order has "Issue material";
  - a sales order has "Create invoice";
  - a machine in alarm has "Report breakdown";
  - due maintenance has "Open order".

## Verification

- **`smoke-connections.mjs`**, 9 checks:
  - a fresh workspace;
  - GST after adding a registration;
  - an edge agent that never reported, then reports, then goes silent;
  - a Tally import waiting for review;
  - the storage test and its audit entry;
  - signed out is refused;
  - read-only can't run the test;
  - no permission is refused;
  - another workspace sees only its own.
- **`smoke-home.mjs`**, 55 checks. New:
  - the reorder row's action and its shortfall;
  - the item overview's shortfall;
  - the unit code on `GET /items/:id`;
  - no action for a person without `buying.purchase_order.create`.
- **`e2e/connections.mjs`**, desktop and 390 px:
  - the cards and the storage test;
  - Home → "Create purchase order" opens with the item and quantity;
  - the item page offers it;
  - "Record receipt" opens with the customer chosen;
  - no sideways scroll.
- **`pnpm typecheck` and `pnpm build`** pass.
- **Regression** (local, after the merge, against the built API and web):
  - 14 of 14 API smokes and 11 of 11 browser walkthroughs passed.
  - The UI audit passed: 200 page views of 100 pages.
  - Two problems were found and fixed in the follow-up:
    - the walkthrough read the preselected customer before the list had loaded;
    - the add-new guard needed the purchase order page's single-item prefill fetch allowed by name.

## Not in this slice

- Live GST filing status: only sandbox connections exist, and the card says so.
- "Short of material" on Home for work orders: the work order page already offers "Issue material".
