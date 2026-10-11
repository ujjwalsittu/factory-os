# Phase 3b studio memberships — review and evidence (decision 056)

[Design](../specs/2026-10-11-maas-memberships-design.md). Builds on Phase 3a (decision 055). Migration
`0037_maas_memberships`.

## What changed

- **Core:** `maasMembershipSplit` divides billable minutes into covered and overage; `maasTermEnd` gives the last day
  of a term. 2 more unit tests.
- **DB:**
  - `maas_plan`: whole hours, a 1–60 month term, a fee and a service item.
  - `maas_membership`: hours and fee copied from the plan, active or cancelled, and the fee invoice.
  - `maas_membership_draw`: append-only through a trigger. A reversal is a negative row; a unique `reversal_of` stops
    a draw from being reversed twice.
  - `maas_booking.billed_at`.
  - New permission `services.membership.read|create|update` and the `MM` series.
- **API:**
  - **Plans:** create (a service item is required, codes are unique) and stop offering.
  - **Memberships:**
    - Creating one raises the fee as a draft invoice through `createDraftInvoice` in the same transaction. A free plan
      raises no invoice.
    - Overlapping terms for a customer are refused under a per-customer lock.
    - A membership can be cancelled only while no hours are drawn.
  - **Billing a booking** (`/bill`; `/invoice` is kept as an alias):
    - An active membership covering the booking's start date gives the member rate and draws hours first.
    - Any excess is invoiced at the member rate. Draws, invoice and `billed_at` are written in one transaction, which
      re-checks the booking, its usage and the membership's remaining hours under a row lock.
    - A booking counts as billed while it has hours drawn or a live invoice. An overage-only draft that is deleted
      frees the booking, as in 3a.
  - **Unbill:** allowed once any invoice is deleted or cancelled. It writes reversals and clears `billed_at`.
  - Usage is frozen while a booking is billed.
- **Web:**
  - Services → **Memberships**: the list, a Plans card, and a membership page with the hours drawn and Cancel.
  - The **booking billing card** shows the membership cover and the overage, with "Bill to membership" or "Create
    invoice", and "Reverse billing".

## Review

One adversarial pass over the diff. One finding fixed:

- **Fixed:** the booking's "Amount before GST" read as if it would be invoiced even when the membership covered it.
  With a membership it is now labelled "Value of the hours".
- **Checked:**
  - Remaining hours always stay a multiple of 6 minutes (whole-hour pools, 6–60-minute steps), so overage hours are
    exact.
  - Draws are tied to the booking and membership, and both are entity-checked before writing.
  - The overlap check and the number allocation run under the same transaction as the fee invoice.
  - A cancelled or expired membership neither covers hours nor gives member rates.
  - The 3a flow (no membership) is unchanged: smoke and browser walkthrough pass as before.
- **Noticed, not changed:**
  - The plan fee invoice of a cancelled membership is left to selling: delete the draft, or issue a credit note if it
    was submitted. The cancel dialog says so.
  - Plans can't be reactivated once no longer offered; create a new one.

## Evidence

| Check | Result |
|---|---|
| `maas.test.ts` | 8 PASS |
| `smoke-maas-memberships.mjs` (new) | 76 request checks PASS |
| `smoke-maas.mjs` / `smoke-scheduling.mjs` / `smoke-selling.sh` | 93 / 58 / PASS |
| `e2e:maas-memberships` (new, desktop + 390 px) | PASS |
| `e2e:maas` / `e2e:selling` / `e2e:scheduling` | PASS |
| `pnpm typecheck` / `pnpm build` / `turbo run test --force` | 19 / 12 / 11 tasks PASS |
| `pnpm lint` | 0 configured tasks |
| `git diff --check`, drizzle drift | clean, none |
