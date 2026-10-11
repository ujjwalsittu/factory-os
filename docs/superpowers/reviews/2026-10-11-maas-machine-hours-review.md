# Phase 3a machine-hour MaaS — review and evidence (decision 055)

[Design](../specs/2026-10-11-maas-machine-hours-design.md). First slice of Phase 3 (Services). Migration
`0036_maas`.

## What changed

- **Core** (`packages/core/src/maas.ts`, 6 unit tests):
  - Billable minutes are actual usage rounded up to the step (6, 12, 15, 30 or 60), never below the minimum.
  - Hours are exact two-place decimals.
  - The member rate applies when one is set; the terms are validated.
- **DB** (`0036_maas`):
  - `maas_rate_card`, `maas_booking`, `maas_usage` and `party.maas_member`.
  - Checks on rounding, minimum, rates and validity.
  - Usage is append-only through a trigger; a correction is a new row.
- **Permissions:**
  - `services.rate_card.read|update`, `services.booking.read|create|update`, `services.usage.create` and
    `services.billing.create`.
  - A **Services coordinator** role.
  - Operators get booking read and usage; Production Planners get booking read.
  - Booking number series `MB`.
- **API** (`services/maas.controller.ts`):
  - Rate cards: no overlapping validity per machine, a service item required, ending a card.
  - Bookings: create, change, confirm, start, stop, usage and cancel.
  - **Confirm** writes a `booking` machine block under the scheduler's per-entity lock. It is refused over another
    reservation, maintenance or breakdown, or pinned or running production.
  - **Stop** records whole elapsed minutes. When it comes early it trims the reservation, or releases it entirely if
    the reserved time hadn't started.
  - **Invoice:**
    - Builds a draft sales invoice through `SellingController.createDraftInvoice`: the same validation, GST and place
      of supply as the form.
    - The link is written inside the invoice's transaction, which re-checks status, the existing invoice and usage.
    - One live invoice per booking; deleting the draft or cancelling the invoice frees it.
- **Schedule view:**
  - Adds `bookings` in range.
  - Is flagged out of date when a non-tentative booking changed after the run.
  - Invoicing doesn't count as a change.
- **Web:**
  - **Services section:** Machine bookings (list and booking page) and Rate cards.
  - **Customer form:** a "Studio member" switch.
  - **Gantt:** confirmed bookings are drawn as reserved time ("Reserved: Booking … · customer") and tentative ones as
    a dashed outline.
  - **Phone list:** shows bookings per machine.

## Review

One adversarial pass over the diff. One finding fixed:

- **Fixed:** linking the invoice bumped the booking's `updatedAt`, which flagged the production schedule as out of
  date for a billing action. The link no longer bumps it, and the smoke asserts this.
- **Checked:**
  - Tenant and entity scoping on every lookup (customer by tenant; machine, rate card and booking by entity). Another
    tenant gets 404 or an empty list.
  - The confirm and move clash checks share the scheduler's advisory lock, so they can't race a Reschedule or a Gantt
    move.
  - Booking blocks stay non-editable from Calendars, as before.
  - Corrections can't take usage below zero.
  - Usage is frozen while an invoice holds the booking.
- **Noticed, not changed:**
  - Cancelling a tentative booking after a run also flags the schedule out of date (it changes nothing). This is
    harmless; a reschedule clears it.
  - The rate card is chosen by the booking's start date in IST, the business day used across the app.

## Automated review (CodeRabbit) round

- **Fixed:**
  - `maas_usage`'s tenant FK was `ON DELETE cascade`, but the append-only trigger rejects every delete, so the cascade
    could never complete. It is now `no action`, like the other append-only ledgers (`trade_bill`). The migration
    hasn't been deployed, so `0036_maas` was corrected in place.
  - The phone schedule list labels completed bookings "Completed booking" instead of "Reserved".
  - The rate-card and booking dialogs key their item and customer caches by tenant.
  - The usage field is numeric. The API already refuses zero and fractional minutes.
  - The walkthrough's single-invoice check waits for the page to load before counting buttons.

## Evidence

| Check | Result |
|---|---|
| `maas.test.ts` (new) | 6 PASS |
| `smoke-maas.mjs` (new) | 93 request checks PASS |
| `smoke-scheduling.mjs` / `smoke-schedule-no-time.mjs` / `smoke-manufacturing.mjs` | 58 / 32 / 104 PASS |
| `smoke-selling.sh` / `smoke-fai.mjs` / `smoke-sales-notes-permissions.mjs` | PASS / 52 / PASS |
| `e2e:maas` (new, desktop + 390 px) | PASS |
| `e2e:scheduling` / `e2e:selling` / `e2e:manufacturing` / `e2e:schedule-no-time` | PASS |
| `pnpm typecheck` / `pnpm build` / `turbo run test --force` | 19 / 12 / 11 tasks PASS |
| `pnpm lint` | 0 configured tasks |
| `git diff --check` | clean |
