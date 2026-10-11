# Phase 3c test campaigns — review and evidence (decision 057)

[Design](../specs/2026-10-11-test-campaigns-design.md). Builds on Phase 3a (decision 055). Migration
`0038_test_campaigns`.

## What changed

- **DB:**
  - `test_campaign`: customer, customer reference, title, scope, service item, quoted lump sum, status
    (draft → active → reported → closed, or cancelled), report summary and sign-off, invoice.
  - `test_campaign_step`: sequence, name, requirement, measured value, result (pending, pass, fail, n/a) and notes.
  - `test_campaign_extra`: description, quantity and rate, invoiced with the lump sum.
  - `custody_item`: the customer's payload held in custody (not stock), with inward challan, condition on receipt
    and on return, and the return challan number.
  - `maas_booking.campaign_id`. New permissions `services.campaign.read|create|update|approve`, the `TC` and `RDC`
    series and the `test_campaign` attachment owner.
- **API (`CampaignsController`):**
  - Create and edit in draft; accept needs at least one step.
  - Steps, results, custody receipt and return (allocating an RDC number), extras.
  - Approve (quality) needs a summary and no pending steps and moves the campaign to reported.
  - Invoice raises one draft tax invoice (quoted amount plus chargeable extras, customer reference as the PO number)
    through `createDraftInvoice`.
  - Close needs a live invoice, nothing left in custody and no open bookings; cancel is for draft or active
    campaigns with no custody, invoice or open bookings.
  - Machine bookings can belong to a campaign: the customer must match and stays fixed, and such bookings are billed
    with the campaign, not on their own.
- **Web:** Services → **Test campaigns** (list and New campaign), the campaign page (steps and results, custody,
  bookings, extras, attachments, approve, invoice, close/cancel) and a printable **test report**.
- **Roles:** the Services coordinator gets campaign read/create/update and attachment read/create; Quality gets
  campaign read and approve.

## Review

One adversarial pass over the diff. One finding fixed:

- **Fixed:** a campaign could close or be cancelled while one of its chamber bookings was still tentative,
  confirmed or in use. Close and cancel now refuse while any campaign booking is open; the smoke and browser
  walkthrough cover it.
- **Checked:**
  - Every write locks the campaign row and checks the status; custody, steps and extras are entity-checked.
  - The invoice is raised once: a second request is refused while a live invoice exists, and a deleted draft frees
    the campaign to invoice again.
  - Campaign bookings cannot be billed alone, cannot change customer and show the campaign number.
  - The 3a and 3b flows are unchanged: their smokes and browser walkthroughs pass as before.
- **Noticed, not changed:** the report is printed from the browser; a signed PDF snapshot is not stored.

## Evidence

| Check | Result |
|---|---|
| `smoke-test-campaigns.mjs` (new) | 74 request checks PASS |
| `smoke-maas.mjs` / `smoke-maas-memberships.mjs` / quality / `smoke-selling.sh` | 93 / 76 / 112 / PASS |
| `e2e:test-campaigns` (new, desktop + 390 px) | PASS |
| `e2e:maas` / `e2e:maas-memberships` / `e2e:quality` / `e2e:selling` | PASS |
| `pnpm typecheck` / `pnpm build` / `turbo run test --force` | 19 / 12 / 11 tasks PASS |
| `pnpm lint` | 0 configured tasks |
| `git diff --check`, drizzle drift | clean, none |
