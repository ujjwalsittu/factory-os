# Phase 3c — test campaigns (decision 057)

Flow 2 of [04 · Services](../../04-services.md): "service order 'TVAC qualification, 5 days' → chamber booking →
customer payload received under inward challan (custody, not stock) → test logs attached → test report (signed) →
invoice → payload returned with outward challan". It builds on Phase 3a bookings (decision 055) and is half of the
Phase 3 exit ("a TVAC campaign … billed end-to-end").

User choices, 2026-10-11:

1. **Next slice:** test campaigns, before EarthNow subscriptions (still blocked on open decision B12) and CAPA/skill
   matrix.
2. **Pricing:** a **quoted lump sum** for the agreed scope, **plus extras** added as lines. Invoiced once on
   completion.
3. **Customer payload:** a **custody register**, outside stock and valuation, with inward and outward challan
   numbers, serial numbers and condition.
4. **Test report:** **results per test step**, files attached (sensor logs, photos), **signed off by a quality
   approver**, and printable.

## Data model (migration `0038_test_campaigns`)

- **`test_campaign`** (entity):
  - `number` (series `TC`), `customer_id`, `title` and `scope`;
  - `service_item_id` (SAC for the test service) and `quoted_amount`;
  - `customer_ref`, the customer's PO or quotation reference;
  - `status`: draft → active → reported → closed, or cancelled; with `cancel_reason`;
  - `report_approved_by`, `report_approved_at` and `report_summary`;
  - `sales_invoice_id` and `closed_at`.
- **`test_campaign_step`**:
  - `campaign_id`, `seq`, `name` and `requirement`;
  - `result`: pending, pass, fail or not applicable;
  - `measured` (free text, e.g. "1.2e-6 mbar"), `notes`, `recorded_by` and `recorded_at`.
- **`test_campaign_extra`**: `campaign_id`, `description`, `qty`, `rate` and `service_item_id`; billed with the
  campaign.
- **`custody_item`**:
  - `campaign_id`, `description`, `serial_no` and `qty` (count);
  - received: `inward_challan_no` (the customer's), `received_condition`, `received_at` and `received_by`;
  - returned: `returned_at`, `returned_by`, `return_condition` and `outward_challan_no` (our series `RDC`, allocated
    on return).
- **`maas_booking.campaign_id`**: a chamber booked for a campaign. It is billed with the campaign, never by the hour.
- **Attachments** gain owner type `test_campaign`, used for sensor logs, photos and the signed report.

## Behaviour

- **Create** (draft): customer, title, scope, service item and quoted amount. The test steps are added and edited
  while the campaign is draft or active.
- **Accept** (draft → active): needs at least one step.
- **While active:**
  - **Book the chamber:** creates a booking linked to the campaign. The 3a life cycle still applies (confirm reserves
    the machine), but its billing is refused: "billed with campaign TC-…".
  - **Receive payload:** custody items with the customer's inward challan number, serial number and condition.
    Condition photos are attachments.
  - **Record results** per step, attach logs and add extras.
- **Approve report** (active → reported, `services.campaign.approve`):
  - Every step needs a result (not pending), and the approver adds a summary.
  - It records the approver and time. Results and steps are frozen afterwards.
  - The printable report shows the campaign, payload (serials), steps with requirement, result and value,
    attachments and sign-off.
- **Return payload:** any time once received. It allocates an outward challan number and records the return
  condition.
- **Invoice** (reported only, once):
  - A draft tax invoice through the sales invoice path, with one line per item: the quoted amount on the service
    item, then each extra.
  - The same rule as bookings applies: deleting the draft or cancelling the invoice frees the campaign to invoice
    again.
- **Close** (reported → closed): needs the invoice (draft or submitted) and every custody item returned.
- **Cancel** (draft or active, with a reason): needs nothing still in custody (return it first) and no live invoice.
  Linked bookings are left to be cancelled from their own pages.

## API

`/services/campaigns`:

- GET list, POST, GET `:id`, PUT `:id`;
- POST `:id/accept`, `:id/approve`, `:id/invoice`, `:id/close`, `:id/cancel`;
- steps: POST `:id/steps`, PUT `steps/:stepId`, POST `steps/:stepId/result`;
- custody: POST `:id/custody`, POST `custody/:itemId/return`;
- extras: POST `:id/extras`, DELETE `extras/:extraId`.

Booking create accepts an optional `campaignId`.

## Permissions

- New: `services.campaign.read|create|update|approve`. `update` covers steps, results, custody and extras; `approve`
  covers the report sign-off.
- Invoicing uses `services.billing.create` with `selling.sales_invoice.create`.
- **Services coordinator:** gets `services.campaign.read|create|update` and `quality.attachment.read|create`.
- **Quality:** gets `services.campaign.read|approve`.

## Screens

- **Services → Test campaigns:**
  - **List:** number, customer, title, status, payload in custody.
  - **Campaign page:** header actions per status; the scope and price; test steps with inline results; payload
    custody (receive/return); chamber bookings ("Book chamber"); extras; files; and a report summary with "Approve
    report".
  - **Print view:** `/app/services/campaigns/[id]/report`.

## Tasks

1. Claim in STATUS, this design and decision 057 to main (docs-only PR).
2. Migration `0038_test_campaigns`, permissions, roles, `TC` and `RDC` series, attachment owner type.
3. API: campaigns, steps, custody, extras, approve, invoice, close and cancel; campaign bookings are refused hourly
   billing. Smoke `smoke-test-campaigns.mjs`.
4. Web: list, campaign page, report print view, Book chamber; e2e `test-campaigns.mjs` (desktop and 390 px).
5. Regression: MaaS, memberships, selling and quality smokes and browsers, root checks, review, STATUS/LOG, PR.
