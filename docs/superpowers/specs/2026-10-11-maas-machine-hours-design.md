# Phase 3a — machine-hour MaaS: rate cards, bookings, usage, invoice (decision 055)

First slice of [Phase 3 — Services](../../09-roadmap.md) and flow 1 of [04 · Services](../../04-services.md): "customer
books M-03 for 6 h → arrives → usage recorded → invoice at rate card (min-billing rules)". It lays the base that test
campaigns, memberships, EarthNow subscriptions and IoT metering reuse later.

User choices, 2026-10-11:

1. **Next slice:** MaaS machine hours, before CAPA/skill matrix or EarthNow subscriptions.
2. **Clashes:** a **confirmed** booking reserves the machine. The scheduler plans production around it like downtime,
   and a booking can't be confirmed over pinned or running production. **Tentative** bookings show on the Gantt but
   don't block.
3. **Billing:** **actual** time, rounded up per the rate card, with a **minimum** charge per booking.
4. **Rate card:** per-hour rate per machine with validity dates, a **standard** and a **member** rate.

## Scope

In: rate cards, bookings with their life cycle, usage recording (timer and manual), a draft tax invoice from a
completed booking, bookings on the production Gantt, a Services section in the app.

Out (later Phase 3 slices): test campaigns and customer custody, memberships with credits, projects, subscriptions,
billing runs over many bookings, IoT spindle-hour metering, customer portal, per-day or per-pass units, people and
non-machine resources.

## Data model (migration `0036_maas`)

- **`party.maas_member`** (boolean, default false): the customer gets member rates.
- **`maas_rate_card`** (entity-scoped):
  - `machine_id`, plus `service_item_id`, a service item with its SAC code that becomes the invoice line;
  - `standard_rate` and optional `member_rate` per hour (`numeric`);
  - `minimum_minutes`, `rounding_minutes` and `valid_from`, with an optional `valid_to`.
  - Rounding is one of 6, 12, 15, 30 or 60 minutes, so the billed hours are exact decimals (0.1–1 h steps). The
    minimum is a multiple of the rounding.
  - One rate card per machine at any date: the API refuses overlapping validity.
- **`maas_booking`** (entity-scoped):
  - `number` (series `MB`), `customer_id`, `machine_id`, `starts_at`, `ends_at`;
  - `status`: tentative → confirmed → in use → completed, or cancelled;
  - `purpose`, `machine_block_id` (the reservation while confirmed or in use) and `sales_invoice_id`;
  - timer fields `started_at` and `stopped_at`.
- **`maas_usage`**: one row per recorded span or correction.
  - Fields: `booking_id`, `minutes` (may be negative for a correction), `source` (`timer` or `manual`), `note`,
    `recorded_by`, `recorded_at`.
  - Append-only: corrections are new rows.

## Behaviour

- **Rate cards** (Services → Rate cards): create, end (set `valid_to`) and list per machine.
  - The rate applied is the card valid on the booking's start date.
  - Member customers get the member rate when one is set, otherwise the standard rate.
- **Bookings** (Services → Bookings):
  - **Create:** machine, customer and a time span in the future. Created as **tentative**.
  - **Confirm** creates a `machine_block` of kind `booking` for the span. Refused when the span overlaps another
    confirmed booking, maintenance or breakdown on that machine, or a pinned or running production bar. Unpinned
    production bars may overlap: the schedule is flagged out of date and the next Reschedule moves them.
  - **Start** (in use) records the timer start. It may begin before the reserved start; the reservation is not moved.
  - **Stop** records the elapsed whole minutes as a `timer` usage row and completes the booking. The reservation's
    end is trimmed to the stop time when it stops early, which frees the machine.
  - **Record usage** (manual): minutes with a note, for a booking that was completed without the timer, or a
    correction (negative minutes with a note).
  - **Cancel** from tentative or confirmed removes the reservation. Its reason is required and kept.
  - **Move or resize** from tentative or confirmed: the same checks as confirm.
- **Billing:**
  - From a completed booking: billable minutes = max(minimum, actual rounded up to the rounding step). Quantity is
    in hours; the rate comes from the card.
  - **Create invoice** makes a **draft sales invoice** through the existing sales invoice path (same validation,
    GST and place of supply) and links it to the booking. The booking shows the computed figures.
  - While that invoice is a draft or submitted, the booking can't be billed again. Deleting the draft or cancelling
    the invoice frees the booking.
  - Submission, e-invoice, receipts and credit notes are the existing selling flows.
- **Production:**
  - The scheduler already treats `machine_block` as unavailable time, so confirmed bookings need no engine change.
  - The schedule is flagged out of date when a booking is confirmed, moved, trimmed or cancelled after the run.
  - The Gantt draws confirmed bookings as reserved time named with the customer and booking number, and tentative
    bookings as a dashed outline. Bookings are not dragged on the Gantt; they change from the booking page.
  - Machine downtime editing keeps refusing `booking` blocks ("Bookings are changed from the booking").

## API

`/services/rate-cards` (GET, POST, POST `:id/end`) and `/services/bookings`:

- GET list with filters, POST, GET `:id`, PUT `:id`;
- POST `:id/confirm`, `:id/start`, `:id/stop`, `:id/usage`, `:id/cancel` and `:id/invoice`.

The schedule view gains `bookings` (tentative ones in range).

## Permissions

New ones:

- `services.rate_card.read|update`;
- `services.booking.read|create|update` (create, move, confirm, cancel);
- `services.usage.create` (start, stop, manual usage; the catalog's fixed actions have no `record`);
- `services.billing.create` (create the invoice; also needs `selling.sales_invoice.create`).

Role templates:

- A new **Services coordinator** gets all of `services.*`, `masters.party.read`, `masters.item.read` and
  `selling.sales_invoice.read|create`.
- **Operator** gets `services.booking.read` and `services.usage.create`.
- **Production Planner** gets `services.booking.read`.

## Screens

- **Services** (the "P3" placeholder in the nav becomes live):
  - **Bookings:** a list by day and machine, filtered by status, plus a new-booking dialog.
  - **Booking page:** status, span, customer, actions per status, the usage table, billing figures and the invoice
    link.
  - **Rate cards.**
- **Elsewhere:** a "Studio member (member rates)" switch on the customer, and bookings on the Schedule Gantt with
  the phone list.

## Tasks

1. Claim in STATUS, this design and decision 055 to main (docs-only PR).
2. Core: pure billing arithmetic (`maasBillableMinutes`, hours as an exact decimal, rate choice) with unit tests.
3. Migration `0036_maas`, permissions, role templates, number series `MB`.
4. API:
   - rate cards;
   - bookings with the life cycle and clash checks;
   - usage;
   - invoice through the sales invoice path;
   - the schedule's out-of-date flag and `bookings` in the view.

   Smoke `smoke-maas.mjs`.
5. Web: Services pages, customer member switch, Gantt bookings; e2e `maas.mjs` (desktop and 390 px).
6. Regression:
   - scheduling, manufacturing, selling and invoicing smokes;
   - scheduling and selling browsers.

   Then the root checks, review, STATUS/LOG and PR.
