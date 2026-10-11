# Phase 3b — studio memberships (decision 056)

Flow 3 of [04 · Services](../../04-services.md): "annual plan (e.g. 100 machine-hours) → usage draws down credits →
overage invoiced". This builds on [Phase 3a](2026-10-11-maas-machine-hours-design.md) (decision 055).

User choices, 2026-10-11:

1. **Next slice:** studio memberships, before test campaigns, CAPA/skill matrix and EarthNow subscriptions.
2. **Plan content:** **one pool of machine-hours**, usable on any machine with a rate card.
3. **Billing:** the **plan fee is invoiced upfront** when the membership is created. **Overage is invoiced per
   booking**, at the member rate, through the 3a path.
4. **Unused hours expire** at the end of the term; a renewal is a new membership with a fresh pool.

## Data model (migration `0037_maas_memberships`)

- **`maas_plan`** (entity):
  - `code`, `name` and `included_minutes` (whole hours, so a multiple of 60);
  - `term_months`, `fee`, plus `service_item_id` for the fee invoice line (SAC);
  - `is_active`.
- **`maas_membership`** (entity):
  - `number` (series `MM`), `customer_id` and `plan_id`;
  - `starts_on` and `ends_on` (start + term − 1 day);
  - `included_minutes` and `fee` copied from the plan;
  - `status` (`active`, `cancelled`), `cancel_reason`;
  - `sales_invoice_id`, the fee invoice.
  - One customer can't hold two memberships whose terms overlap.
- **`maas_membership_draw`**: append-only through a trigger.
  - Fields: `membership_id`, `booking_id`, `minutes`, `reversal_of` and `created_by`.
  - A reversal is a negative row pointing at the draw it undoes.
- **`maas_booking.billed_at`**: set when a booking is billed, whether it was covered by hours, invoiced, or both.

## Behaviour

- **Plans** (Services → Memberships → Plans): create and deactivate.
- **Create a membership:**
  - Inputs: customer, plan and start date.
  - Creates a **draft fee invoice** (plan service item, quantity 1, the fee) through the sales invoice path in the same
    transaction, and links it.
  - Overlapping terms for the same customer are refused.
- **Member rate:** a customer counts as a member on a booking's start date (IST) if the "Studio member" flag is set
  **or** they hold an active membership covering that date.
- **Billing a completed booking** ("Bill", replacing "Create invoice"):
  - The billable minutes are computed as in 3a.
  - If an active membership covers the booking's start date, it draws min(remaining, billable) minutes.
  - Any excess is invoiced as a draft at the member rate, with quantity in hours. Remaining minutes are always a
    multiple of 6, so the excess hours are exact.
  - A booking that is fully covered gets no invoice.
  - The draw, any invoice and `billed_at` are written in one transaction.
  - A booking is billed once. Its usage is frozen after billing.
- **Undo billing** ("Reverse billing", with a reason):
  - Allowed when the booking's overage invoice is not draft or submitted, so the user first deletes the draft or
    cancels the invoice.
  - Writes reversal draws, clears `billed_at` and frees the booking to be billed again.
- **Cancel a membership** (with a reason): only while it has no draws, net of reversals. The fee invoice is handled in
  selling: delete the draft, or issue a credit note if it was submitted.
- **Expiry:** a membership covers only bookings starting within its term. Hours not used by then are simply not
  available to later bookings.

## API

- `/services/plans`: GET, POST, and POST `:id/deactivate`.
- `/services/memberships`: GET list, POST, GET `:id` (with draws, used and remaining) and POST `:id/cancel`.
- `/services/bookings/:id/bill` replaces `/invoice` (kept as an alias returning the same result) and
  `/services/bookings/:id/unbill`.
- The booking detail gains `membership` (number, remaining) and a billing preview (`coveredMinutes`, `overageMinutes`,
  overage `amount`).

## Permissions

- New: `services.membership.read|create|update` (plans and memberships; `update` covers cancel and deactivate).
- Billing and undo use `services.billing.create`, plus `selling.sales_invoice.create` when an invoice is raised.
- The Services coordinator gets all of these.

## Screens

- **Services → Memberships:**
  - list: customer, plan, term, hours used/remaining, status, fee invoice;
  - membership page: details, draws with booking links, Cancel;
  - a Plans card with "New plan".
- **Booking page billing card:** shows the membership cover and overage, with "Bill" and "Reverse billing".

## Tasks

1. Claim in STATUS, this design and decision 056 to main (docs-only PR).
2. Core:
   - `maasMembershipSplit(billable, remaining)`, which returns covered and overage minutes, with tests;
   - term end-date arithmetic.
3. Migration `0037_maas_memberships`, permissions, the `MM` series.
4. API:
   - plans and memberships;
   - bill and unbill;
   - member rate from memberships.

   Extend `smoke-maas.mjs` or add `smoke-maas-memberships.mjs`.
5. Web: Memberships pages and the booking billing card; extend `e2e:maas` or add `e2e:maas-memberships` (desktop and
   390 px).
6. Regression: MaaS, selling and scheduling smokes and browsers, root checks, review, STATUS/LOG, PR.
