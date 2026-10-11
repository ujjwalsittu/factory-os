# Phase 3f — billing runs (decision 060)

From [04 · Services](../../04-services.md): "**Billing run**: usage + milestones + subscriptions → draft invoices per
entity, reviewed, submitted". Each service already has its own Bill or Invoice button:

- bookings (decisions 055 and 056);
- test campaigns (decision 057);
- project milestones (decision 058);
- subscriptions (decision 059).

A billing run does all of them at once, for every customer.

User choices, 2026-10-11:

1. **Next slice:** billing runs, before CAPA, the skill matrix and IoT metering.
2. **Grouping:** one draft invoice per customer.
   - A tax invoice carries one customer PO number, so the run groups by customer **and** customer reference (PO).
   - Bookings have no reference, so they join the customer's group that has none.
3. **Output:** the run creates draft invoices and lists them for review. Finance submits them one by one or with
   **Submit all** from the run. Drafts can still be edited or deleted before that.
4. **Scope:** all four sources:
   - **Subscriptions:** the period fee due, overage of ended periods, and upgrade prorations.
   - **Completed bookings:** membership hours are drawn first, and only the excess is invoiced.
   - **Achieved milestones:** retention is recorded as today.
   - **Reported test campaigns** that are not on a project.

## How it works

- **Billables:** each source module exposes the same two steps its own button already uses.
  - **Prepare** gives the invoice lines, the customer and its reference.
  - **Settle** runs inside the invoice transaction. It re-checks the source under its lock and records the link: the
    booking's invoice and membership draws, the campaign's invoice, the milestone's invoice and retention, the
    subscription's invoice rows.
  - The single-item buttons keep working unchanged, now through the same prepare and settle.
- **Preview** (`GET /services/billing-runs/preview?asOf=`) lists everything due on the date, grouped by customer and
  reference, with amounts before GST. Nothing is written.
- **Run** (`POST /services/billing-runs`, with `asOf` = invoice date, today or earlier, and optional source kinds and
  customers):
  - The run gets a number and a row.
  - Each group becomes one draft invoice, in its own transaction:
    - all its lines, in source order;
    - remarks "Billing run {number}";
    - each item settled in a fixed order (source kind, then id) so concurrent runs can't deadlock.
  - A group whose items changed since the preview fails alone. Its error is recorded on the run, and the other groups
    go ahead.
  - Bookings fully covered by membership hours have no invoice line. They are settled (hours drawn) and listed as
    "covered by membership".
- **Review:** the run page lists its invoices with their status, the customers that failed and why, and links to
  each invoice.
- **Submit all** (`POST /services/billing-runs/:id/submit`) submits each draft still in the run through the normal
  invoice submit, which applies the credit-limit, LUT and date checks. An invoice that is refused, for example over
  its credit limit, stays a draft with the reason shown. Nothing is overridden in bulk.

## Data model (migration `0042_billing_runs`)

- **`billing_run`** (entity):
  - `number` (series `BR`, `{ENTITY}/BR/{FY}/{####}`), `as_of`, `kinds` and `created_by`;
  - counts and failures (JSON: customer, reference, message).
- **`billing_run_invoice`**:
  - `run_id`, `sales_invoice_id`, `customer_id`, `customer_ref` and `items` (JSON: source kind, id, label, amount);
  - `submit_error`: why Submit all left this one a draft.

## Permissions

- New: `services.billing_run.read|create`.
- Creating a run also needs `services.billing.create` and `selling.sales_invoice.create`. Submit all needs
  `selling.sales_invoice.submit`.
- **Services coordinator:** gets `services.billing_run.*`.
- **Accountant:** can already submit invoices, so it also reads runs.

## Screens

- **Services → Billing runs:**
  - the list of runs (number, date, invoices, total, failures);
  - **New run**: pick the date and sources, see the preview grouped by customer with totals, then "Create drafts";
  - the **run page**: invoices with status, total and items; failures; Submit all.

## Not in this slice

- Scheduled automatic runs.
- E-invoice (IRN) generation in bulk.
- Emailing invoices.
- Projects' T&M billing.

## Tasks

1. Claim in STATUS, this design and decision 060 to main (docs-only PR).
2. Refactor the four sources into prepare and settle, with their existing smokes unchanged and passing.
3. Migration `0042_billing_runs`, permissions and the `BR` series. API: preview, run, list, get and submit-all. Smoke
   `smoke-billing-runs.mjs`.
4. Web: billing runs list, new-run preview and run page. e2e `billing-runs.mjs` (desktop and 390 px).
5. Regression and wrap-up:
   - MaaS, memberships, campaigns, projects, subscriptions and selling smokes and browsers;
   - root checks;
   - review, STATUS/LOG and the PR.
