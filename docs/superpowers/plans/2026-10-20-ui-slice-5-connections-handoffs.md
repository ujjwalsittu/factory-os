# UI slice 5 — Connections page and hand-offs (plan)

Builds the last section of the [UI design](../specs/2026-10-13-ui-menu-connections-design.md#slice-4--connections-page-and-hand-offs)
(decision 068). Nothing in the business rules changes: this is about seeing what is connected and moving to the next
step. No migration. No new permission: `settings.integration.read` and `settings.integration.manage` already exist for
"Integrations (GSP, Tally, IoT)".

## What already exists (not rebuilt)

- A failed inspection raises its NCR automatically on submit.
- An NCR page has "Raise CAPA"; a work order page has "Issue material"; a sales order page has "Create invoice"; a
  purchase order has "Receive" and "Create invoice"; a machine with a tap alarm has "Report breakdown"; due
  maintenance has "Open order".

## T1 · API: `GET /connections`

One read under `settings.integration.read`, scoped to the workspace and entity. Each section has a status
(`ok`, `attention`, `off`, `not set up`), a one-line summary, the last activity time, and the page that sets it up.

| Section | Source | Status |
|---|---|---|
| GST e-invoice and e-way bill | `gst_sandbox_connection` per registration of the entity | sandbox only, per registration |
| E-mail | `EMAIL_MODE`, worker heartbeat, this workspace's deliveries in the last 7 days | last accepted, failures |
| File storage | the storage service's configured driver | configured or not |
| Edge agents and taps | `iot_edge`, `iot_device` last seen | not reporting for 15 minutes is attention |
| Label printers | `label_printer`, last `print_job` | last job, failed jobs |
| Support access | the workspace's policy | on or off |
| Tally | last `tally_import` of the entity | last import, its status |

`POST /connections/storage/test` under `settings.integration.manage`: writes, reads back and deletes a small object
under the workspace's prefix, and returns ok or the error message. Audited.

## T2 · Web: Settings → Connections

`/app/settings/connections`: one card per section with a status badge, the summary, the last activity and a "Set
up" or "Open" link; the storage card has "Test storage". Menu entry under Settings (the design lists it). Phone width
fits.

## T3 · Hand-offs where the need is seen

Home rows get an optional action, shown only with the permission for it:

- Items below reorder level → "Create purchase order" (`/app/buying/orders/new?item=…`; the PO form adds the item line).
- Overdue receivables → "Record receipt" (`/app/accounts/settlements/new?direction=receipt&party=…`).
- Payables due → "Record payment" (`/app/accounts/settlements/new?direction=payment&party=…`).
- Open NCRs → "Raise CAPA" (opens the NCR, where the dialog is).

On record pages:

- Item page below its reorder level → "Create purchase order".
- Sales invoice with an amount outstanding past its due date → "Record receipt".
- Purchase invoice with an amount outstanding → "Record payment".
- Stock receipt with lines in quarantine waiting for inspection → "Inspect" (the inspections page).

The settlement form takes `party` (and preselects it); the PO form takes `item`.

## T4 · Checks and PR

- `smoke-connections.mjs`: sections and statuses on a fresh workspace, the storage test, permission (403 without
  `settings.integration.read`), isolation between workspaces.
- Home smoke extended for actions and their permissions.
- A walkthrough: Connections page (desktop and 390 px), and two hand-offs end to end (reorder → PO prefilled, overdue
  invoice → receipt prefilled).
- UI audit, regression, review document, STATUS and LOG, PR.
