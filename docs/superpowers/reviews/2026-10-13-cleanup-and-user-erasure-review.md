# Clean-up round and user erasure — review and evidence (decision 067)

[Design](../specs/2026-10-13-cleanup-and-user-erasure-design.md). Migrations `0049_eway_bill_reason`,
`0050_user_erasure`.

## What changed

- **Stock purpose labels.** `StockPurpose` (web) now lists every database purpose and `PURPOSE_LABELS` is a
  `Record<StockPurpose, string>`, so production, cut, job-work, purchase-return and maintenance entries show a label
  and a new purpose fails the typecheck instead of showing blank.
- **Receipt cancel.** The "has been inspected" refusal now runs for every receipt, with or without a purchase order,
  and covers plan inspections (`inspection_record`) as well as incoming inspections. Before, a receipt without a
  purchase order was refused only because the stock reversal went negative, with a confusing message (reproduced:
  400 "Cancelling would make stock negative…"; now 409 "This receipt has been inspected…").
- **Supplier-returns race smoke.** Root cause: when the supplier note commits first, its credit reduces the bill and
  the competing payment is refused as an over-allocation (400 "GOODS-001 has only 400.00 INR open"). The smoke only
  allowed 200 or 409. The application is correct; the smoke now accepts exactly that refusal (status and message).
  Reproduced 1 in 6 runs before; 3 of 3 passes after, and 6 of 6 in the investigation loop until the failing case
  was captured.
- **Rule 138 (e-way bill) for job work.** Rechecked against CBIC's consolidated CGST Rules (amended up to
  30 October 2018): interstate job work needs an e-way bill at any value. User's choice: an interstate challan is
  submitted with the number or a reason (`job_worker_generates` or `exempt`); the job worker's number is recorded
  later, once, audited (`POST /manufacturing/job-work/challans/:id/eway-bill`). The check runs after line validation so
  line errors come first. Both send forms use a shared `EwayBillFields`; the challan list shows the reason and a
  "Record e-way bill…" action.
- **Bank reconciliation M1.** Transactions (10,000) and physical CSV records (20,000, including disclosed balance
  rows) are bounded separately; a full 10,000-transaction statement with balance rows is accepted (core test).
- **Bank reconciliation M2.** Approvals freeze `{ledgerCode, ledgerName, maskedIdentifier}` into the period snapshot;
  the frozen print shows them; older approvals show today's details marked as not frozen. Renaming the ledger after
  approval leaves the frozen identity unchanged (smoke).
- **User erasure (DPDP Act 2023).** Partial erasure by anonymisation, owners only (`settings.erasure.manage`, not given
  to administrators), for one of four fixed reasons, with the email typed to confirm. One database routine
  (`factoryos_erase_user`) records a `user_erasure` row, anonymises the user, removes sessions, password and SSO links,
  passkeys and their proofs, factors and the membership, and anonymises this workspace's invitations only. The passkey
  and SSO guards accept these deletes only with an erasure row for that user made in the same transaction
  (`txid_current()`) and the user already marked erased. Audit holds the user id, erasure id and reason code only.
  Settings → Users has "Erase…" for owners. Retained data, legal basis and period are tabled in the design.

## Review feedback on the design (CodeRabbit, claim PR #50) — all taken

- Invitation cleanup is scoped to the erasing workspace; other workspaces' invitations are untouched (smoke).
- Passkey deletion is bound to a same-transaction erasure row, not a setting alone; a borrowed erasure id is refused
  (smoke).
- Reasons are fixed codes; no free text reaches the audit trail (smoke checks the audit entry has no `@`).
- The design calls it partial erasure and lists each retained item with its legal basis and period.

## Evidence

- New smoke `smoke-user-erasure.mjs`: 34 request checks plus database assertions (refusals, anonymisation, removed
  credentials and membership, guard-path removal event, scoped invitations, audit content, old session and sign-in
  refused, borrowed erasure id refused).
- New browser walkthrough `e2e:user-erasure` (desktop and 390 px); job-work, inventory and bank-reconciliation
  walkthroughs pass.
- Smokes: receipt inspection plans 89 (with the new non-PO checks), job work 105, bank reports 58, bank imports 53,
  large review 23, bank inputs and schema, ITC-04 33, quality 112, supplier-returns races 51 (×3), buying, inventory and
  customer-material shell suites, passkey schema 17 + upgrade, passkey actions 13, passkey native 22, SSO actions 11,
  SSO review guards 3, email invitations.
- Core: bank statement 18 tests (one new). Root typecheck 20, build 12, tests 14.

## Not fixed here (recorded under "Noticed")

- `smoke-support-access-schema` asserts migration 0035 is the last in the journal; stale since 0036 (fails on main).
- `smoke-support-access-lifecycle` "consent not started within 600 seconds" inserts `approved_at` and `start_by` from two
  `clock_timestamp()` calls, so the window check is always exceeded by microseconds (fails on main).
- `smoke-sso-schema` needs `.superpowers/sdd/2026-10-07-sso/upgrade-baseline.json`, which is not in the repository.
- `PasskeyStore.pruneActions` exists but nothing schedules it; expired ceremonies are not pruned either.
- ITC-04 offline-tool template: the GST portal still refuses connections from this environment.
