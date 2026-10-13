# Clean-up round and user erasure — design (decision 067)

Requested by the user on 2026-10-13: clear the items under "Noticed" in STATUS before the UI, menu and design pass.
The erasure approach was chosen by the user the same day (anonymise on request).

## 1. Stock purpose labels

`PURPOSE_LABELS` (web) gains every stock purpose in the database enum: production issue, return and output, cut,
job work out and in, purchase return and purchase return receipt. The type becomes `Record<StockPurpose, string>`
so a purpose added later fails the typecheck instead of showing a blank.

## 2. Receipt cancel: inspected check for every receipt

Cancelling a receipt is refused once any of its lines has a submitted incoming inspection (`quality_inspection`) or a
submitted plan inspection record (`inspection_record`, decision 052), whether or not the receipt is against a purchase
order. Today the check runs only for purchase-order receipts. Smoke: a receipt without a PO, inspected, cannot be
cancelled; cancelling the inspection first allows it.

## 3. User erasure (DPDP Act 2023) — anonymise on request

A full delete is impossible: vouchers, stock entries, job cards, audit entries and more reference the user who made
them, and ledgers are append-only. Erasure therefore removes the person's identity and every way to sign in, and
keeps their records under "Erased user".

- **Who:** a tenant **Owner** (new permission `settings.user.delete`; owners only, not administrators). Not oneself,
  and not the last owner. Only a person whose memberships are all in this tenant can be erased; a person who also
  belongs to another tenant is only removed from this one (the other tenant decides for itself).
- **What happens, in one transaction:**
  - `user`: name becomes "Erased user", email becomes `erased-<id>@erased.invalid`, image cleared, email unverified,
    new column `erased_at` set. Sign-in, sign-up as that row, invitations and password reset refuse an erased user.
  - Removed: sessions, accounts (password and SSO links), verification rows, two-factor secrets, pending invitations
    to the old email, memberships and role grants.
  - Passkeys: removed through the existing credential guard. The guard gains one more allowed path: a delete inside
    an erasure (a transaction setting naming this user, checked against `erased_at` set in the same transaction),
    recorded as a passkey `removed` event. Expired passkey ceremonies are pruned like actions.
  - An audit entry `user.erase` with the user id only (no name or email) and the reason.
- **Kept, by law:** records the person made stay attached to their id and show "Erased user". The hash-chained audit
  log is append-only (Companies Act audit trail); personal data already inside earlier audit entries is retained under
  that legal obligation and is not rewritten. Documents such as invoices keep the names printed on them.
- **UI:** Settings → Users: "Erase person…" for owners, with a typed confirmation of the email and a reason.

## 4. ITC-04 follow-ups

The GST portal (tutorial.gst.gov.in, www.gst.gov.in) still drops connections from this environment, so the
offline-tool template cannot be downloaded; the CSV match stays blocked and is recorded as a blocker. Rule 138
(e-way bill) for job work is rechecked from CBIC sources if reachable; any change is evidence-only unless the rule
requires the number.

## 5. Supplier-returns race smoke

Reproduce `smoke-supplier-returns-races.mjs` repeatedly, capture the failing status and response, and fix the root
cause (code or test) rather than loosening the assertion.

## 6. Bank reconciliation minors (from the 2026-10-06 review)

- **M1:** bound transaction rows (10,000) and total physical records (including disclosed balance rows) separately,
  so a full 10,000-transaction statement with balance rows is accepted.
- **M2:** new approvals freeze the bank ledger name and a masked account identity into the snapshot; the frozen print
  shows them, with a fallback for older snapshots. Renaming the ledger later does not change a frozen print.

## Out of scope

The UI, menu and design pass (next round, its own design).
