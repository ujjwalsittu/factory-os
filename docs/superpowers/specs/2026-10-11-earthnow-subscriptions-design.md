# Phase 3e — EarthNow subscriptions (decision 059)

EarthNow flow 1 in [04 · Services](../../04-services.md): "customer × solution (e.g. crop health) × AOI → monthly
or quarterly invoices; AOI changes prorated". This slice closes open decision **B12**, which asked what an EarthNow
subscription is priced on.

User choices, 2026-10-11:

1. **Next slice:** EarthNow subscriptions, before CAPA, billing runs and the skill matrix.
2. **B12 pricing:**
   - A plan is a **prepaid bundle**: a fee per period that includes N reports and M alerts.
   - Reports and alerts beyond the bundle are **overage**, charged at a per-unit rate.
   - The AOI (name and hectares) is recorded but doesn't change the price.
3. **Invoicing:**
   - The period fee is invoiced **in advance**, at the start of each period (monthly, quarterly or yearly).
   - A period's overage goes on the **next** invoice.
4. **Plan changes:**
   - **Upgrade:** applies at once. The current period gets the bigger bundle, and the next invoice charges the fee
     difference × remaining days ÷ days in the period.
   - **Downgrade:** applies from the next period start, so no credit note is needed.

## Data model (migration `0040_subscriptions`)

- **`subscription_plan`** (entity):
  - `code`, `name`, `solution` (e.g. "Crop health"), `period` (month, quarter or year);
  - `fee`, `included_reports`, `included_alerts`, `report_rate` and `alert_rate` (overage), `service_item_id`
    (SAC);
  - `is_active`.
- **`subscription`** (entity):
  - `number` (series `SUB`, `{ENTITY}/SUB/{FY}/{####}`), `customer_id`, `customer_ref` and `plan_id` (the plan in
    force now);
  - the AOI: `aoi_name`, `aoi_hectares` and `aoi_notes`;
  - `start_date`, which anchors the periods: period *k* starts *k* × the period length after it;
  - `end_date`, set when the subscription is cancelled at a period end;
  - `status`: active or cancelled, with `cancel_reason`.
- **`subscription_plan_change`** (append-only):
  - `subscription_id`, `from_plan_id`, `to_plan_id` and `effective_on`;
  - `proration_amount`, for upgrades only;
  - `sales_invoice_id`: the invoice that charged the proration. A deleted draft frees it.
- **`subscription_delivery`** (append-only):
  - `subscription_id`, `kind` (report or alert), `delivered_on`, `title` and `reference`;
  - `reversal_of`: a wrong entry is cancelled by a reversal row.
- **`subscription_invoice`**:
  - `subscription_id` and `sales_invoice_id`;
  - `fee_period_start`, the period whose fee it carries (null for a final, overage-only invoice);
  - `overage_period_start`, the period whose overage it carries;
  - amounts per line.
  - A row counts while its invoice is draft or submitted. A deleted draft frees the periods to be invoiced again.

## Behaviour

- **Plans:** created and stopped like membership plans; codes are unique per entity.
- **Subscribe:**
  - customer, plan, AOI and a start date (today or later);
  - one active subscription per customer per AOI name.
- **Periods:**
  - The fee for a period uses the plan in force at its start.
  - The bundle for a period uses the plan in force at its end, so an upgrade gives the bigger bundle at once.
  - Deliveries count in the period that contains `delivered_on`.
- **Invoice next period** (`services.billing.create` + `selling.sales_invoice.create`):
  - The next un-invoiced period whose start is today or earlier, or up to 7 days ahead.
  - One draft tax invoice through `createDraftInvoice` with these lines:
    1. the period fee, described "{plan} · {AOI} · {period start}–{period end}";
    2. overage for the previous period, if any: reports and alerts beyond the bundle × their rates;
    3. proration of upgrades not yet charged.
  - The customer reference is the PO.
  - All the rows are written in one transaction with the invoice, under a lock on the subscription.
- **Final invoice:** after a cancelled subscription's last period ends, one overage-only invoice. If there is no
  overage, there is nothing to invoice.
- **Change plan:**
  - The new plan must have the same period length.
  - **Upgrade** (higher fee): effective today.
    - proration = (new fee − old fee) × days left in the current period, counting today ÷ days in the period, rounded
      to the paisa;
    - the proration is recorded on the change and charged on the next invoice.
  - **Downgrade or equal fee:** effective from the next period start. One pending change at a time.
- **Record delivery:** a report or alert with its date and title, while the subscription is active (or within its
  last period). It is append-only, and a reversal cancels it.
- **Cancel:** at the end of the current period, with a reason. Deliveries can be recorded until then, and the final
  invoice carries the last overage.

## API

`/services/subscription-plans`: GET, POST, and POST `:id/stop`.

`/services/subscriptions`:

- GET list, which shows the next period and whether it is due.
- POST create.
- GET `:id`, with periods (fee invoice, deliveries vs bundle, overage) and changes.
- POST `:id/change-plan`, `:id/deliveries`, `deliveries/:did/reverse`, `:id/invoice` and `:id/cancel`.

## Permissions and roles

- New: `services.subscription.read|create|update`. `update` covers deliveries, plan changes and cancellation.
- Invoicing uses `services.billing.create` together with `selling.sales_invoice.create`.
- **Services coordinator:** gets all three subscription permissions.

## Screens

- **Services → Subscriptions:**
  - The list: number, customer, plan, AOI, next period and a "Due" badge. A Plans card sits on the same page.
  - The subscription page:
    - terms and AOI;
    - a periods table: dates, fee invoice, reports and alerts used vs included, overage;
    - deliveries, with "Record delivery";
    - plan history, with "Change plan";
    - "Invoice next period" and "Cancel at period end".

## Not in this slice

- Batch invoicing across subscriptions, which belongs to billing runs.
- AOI geometry and maps, and per-hectare pricing.
- Automatic delivery feeds from the EarthNow platform.
- Renewal reminders and price escalation.

## Tasks

1. Claim in STATUS, this design, decision 059 and B12 closed (docs-only PR).
2. Core period and proration helpers with unit tests; migration `0040_subscriptions`, permissions, roles and the `SUB`
   series.
3. API: plans, subscriptions, deliveries, plan changes, invoicing and cancellation. Smoke `smoke-subscriptions.mjs`.
4. Web: Subscriptions list with plans and the subscription page. e2e `subscriptions.mjs` (desktop and 390 px).
5. Regression and wrap-up:
   - MaaS, memberships, campaigns, projects and selling smokes and browsers;
   - root checks;
   - review, STATUS/LOG and the PR.
