# Phase 3e EarthNow subscriptions — review and evidence (decision 059)

[Design](../specs/2026-10-11-earthnow-subscriptions-design.md). Closes open decision B12. Migration
`0040_subscriptions`.

## What changed

- **Core:**
  - `subscriptionPeriodStart`, `subscriptionPeriodEnd` and `subscriptionPeriodIndex` anchor periods on the start date
    and clamp month ends.
  - `subscriptionProration` charges the fee difference for the days left, with the effective day counted.
  - `subscriptionOverage` counts the units beyond the bundle.
  - 4 unit tests.
- **DB:**
  - `subscription_plan`: period, fee, reports and alerts included, overage rates, service item.
  - `subscription`: series `SUB`; customer, AOI name, hectares and notes; start date, end date once cancelled.
  - `subscription_plan_change`: plan history, with an upgrade's proration and the invoice that charged it.
  - `subscription_delivery`: append-only through a trigger; a reversal row cancels an entry.
  - `subscription_invoice`: one row per item an invoice carried (a period's fee, an ended period's overage, a
    proration). A row counts while its invoice is live.
  - New permission `services.subscription.read|create|update`.
- **API (`SubscriptionsController`):**
  - **Plans:** create and stop offering.
  - **Subscribe:** one active subscription per customer and AOI. The start can be up to a year back, for a
    subscription agreed before it is entered.
  - **Invoice:** one draft tax invoice per call through `createDraftInvoice`, carrying:
    - the next period's fee, from 7 days before it starts;
    - the overage of every ended period not yet billed;
    - upgrade prorations not yet charged.
  - The lines are recomputed under the subscription lock and must match, so concurrent invoices or deliveries can't
    double-bill.
  - **Free plans** have no fee line; their periods count as invoiced.
  - **Change plan:**
    - Plans must have the same billing period, and one change can be pending at a time.
    - An upgrade applies today. The current period gets the bigger bundle, and the fee difference is prorated for the
      days left. On a period's first day before its fee is invoiced, the new fee is invoiced whole instead.
    - A downgrade starts with the next period.
  - **Deliveries:**
    - dated from the start to today, never after the end;
    - fixed once their period's overage is invoiced;
    - a reversal is refused then too.
  - **Cancel:** at the end of the current or last invoiced period. Before the start with nothing invoiced, it takes
    effect at once.
- **Web:**
  - Services → **Subscriptions**: the list with a Due badge, plus the Plans card.
  - The **subscription page:**
    - terms and AOI;
    - periods with reports and alerts used vs the bundle, fee and overage invoices;
    - deliveries with Reverse;
    - plan changes;
    - Invoice next period / Invoice overage, Change plan and Cancel at period end.

## Review

One adversarial pass over the diff. Two findings fixed while building:

- **Fixed:** one invoice row per invoice couldn't record overage for more than one ended period, so a back-dated
  subscription's first invoice would have lost one. Rows are now one per item, and migration `0040` was regenerated
  before it reached main.
- **Fixed:** a free plan's periods never got a fee row, so "next period" stuck on the first one. Free periods now
  count as invoiced once they could be.
- **Checked:**
  - A same-day upgrade on an un-invoiced period isn't double-charged: its fee uses the new plan, with no proration.
  - Overage of a period is invoiced once, and its deliveries freeze then.
  - A deleted draft frees its fee, overage and proration to be invoiced again.
  - Plan history is entity-scoped through the subscription.
  - Another tenant gets 404.
- **Noticed, not changed:**
  - The list computes each subscription's state one by one. That is fine at hundreds; billing runs should batch it.
  - Renewal reminders, price escalation, AOI maps and feeds from the EarthNow platform are later slices.

## Evidence

| Check | Result |
|---|---|
| `subscriptions.test.ts` (core) | 4 PASS |
| `smoke-subscriptions.mjs` (new) | 81 request checks PASS |
| `e2e:subscriptions` (new, desktop + 390 px) | PASS |
| `smoke-projects` / `smoke-maas-memberships` / `smoke-maas` / `smoke-test-campaigns` / `smoke-selling.sh` | 141 / 76 / 93 / 74 / PASS |
| `e2e:maas-memberships` / `e2e:projects` / `e2e:test-campaigns` / `e2e:selling` | PASS |
| `pnpm typecheck` / `pnpm build` / `turbo run test --force` | 19 / 12 / 11 tasks PASS |
| `pnpm lint` | 0 configured tasks |
| `git diff --check`, drizzle drift | clean, none |
