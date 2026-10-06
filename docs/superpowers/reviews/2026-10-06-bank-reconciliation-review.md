# Bank reconciliation final independent review

Independent review complete: four Important findings fixed in one test-backed correction pass (`be194f8`), no Critical findings. A source-refresh browser regression was additionally reproduced and fixed in `93c454d`. Final affected verification passes. Two Minor follow-ups are explicitly deferred below. No second independent review was performed, as required by the approved execution method.

## Scope

Baseline `a8a41fa`; reviewed implementation `ab553045ab5a39abb8461de6100d3695cfadb4e5`.
Requirements: accepted decision 041, [design](../specs/2026-10-06-bank-reconciliation-design.md) and [nine-task plan](../plans/2026-10-06-bank-reconciliation.md).
One fresh independent read-only reviewer received the complete range, requirements, verification evidence and all five focus areas. Implementation remains inline on the user-authorized default branch. No per-task implementers or reviewers; one test-backed Critical/Important correction pass, no second review.

## Mandatory focus

1. Legitimate repeated same-day/reference/amount transactions and reordered/overlapping CSV files must neither disappear nor be counted twice — Tasks1/4.
2. Quiet periods, overdrafts, reversed source order and transactions straddling book/bank dates must retain correct coverage/sign/as-of balances — Tasks1/7.
3. Custom nested bank ledgers, inactive historical accounts and duplicate opening links must not select another ledger or replay old GL — Tasks2/3/5.
4. Concurrent residual use, source cancellation or repeated exception clicks must have one atomic outcome with no partial ledger/evidence — Tasks5/6/9.
5. Files larger than JSON's default body limit, malformed UTF-8/quotes, formula text and late previews after account/entity changes must remain safe and usable within the declared limits — Tasks1/4/8.

## Observed final verification

- Root build: 11 tasks; typecheck: 17 tasks; 126 uncached unit tests (65 core, 18 auth, 33 compliance, 10 provider). Lint: 0 configured tasks, not an executed lint suite.
- Before review, nineteen serial API/contract/legacy suites passed: strict bank inputs; baseline40, imports46, matches56, adjustments46, reports55, guards43, barrier29 sequential checks plus 10 racing responses, invariance45; accounting31, baseline34, review8 named regressions, operations55, opening/FX13, imports48, concurrency21, lock-order; settlements93; bank charges55.
- Five races each observed two distinct PostgreSQL waiting backend PIDs before releasing the accounting lock: identical import, competing residual, identical exception, match before cancellation, cancellation before match.
- Populated invariance fixture: 16 GL rows, 6 vouchers, 2 bills, 3 bill effects, 3 stock entries, 1 bin, 1 FIFO layer and 2 consumptions. Match/unmatch/refused cancellation preserve all scoped rows; authorized fee adds exactly one voucher/two GL rows and preserves bill/stock/FIFO rows.
- Before review, four production browser suites passed: bank reconciliation, accounting, settlements, bank charges. Bank browser exercises linked older opening evidence, repeated/overlapping imports, formula-safe export, partial and Finance net matching, delayed amount/account/entity responses, linked exceptions and explicit draft replacement, roles, frozen historical print and 390px viewport.
- Schema fixtures after both API and browser runs confirm original 0011–0019 migration hashes and every saved original book activation state unchanged. Isolated test entities are separate from the saved original books.

API logs are retained in `.superpowers/sdd/2026-10-06-bank-reconciliation/final-logs/`; root logs in `/tmp/bank-task9-{build,typecheck,units,lint}.log`. These are execution evidence, not independent-review findings.

## Findings and dispositions

The reviewer independently inspected the complete range and used built-service in-memory reproductions. The existing full verification did not cover these counterexamples.

- **I1, Important — raw-file-only replay identity.** Import staging lines 32–33 and the original schema index returned an earlier header-only interval for identical bytes. Real HTTP regression reproduced identical IDs for consecutive quiet intervals. Replay now binds raw SHA plus mapping, dates and exact balances; additive 0021 replaces only the replay index, retaining original 0020. Exact replay and reversed-claim protection remain. Consecutive quiet intervals and corrected-draft metadata passed after the fix (53 HTTP checks).
- **I2, Important — accepted input exceeds JSON transport.** Ten thousand short duplicate reasons exceeded 1 MiB; real HTTP regression observed 413 before semantic validation. Import submission now has a bounded 128 MiB parser for worst-case escaped 2,000-character reasons, matching has 2 MiB, baseline evidence 256 MiB for two reasons per opening item. All other routes retain 1 MiB. An approximately 41 MB escaped-reason payload with 10,000 decisions reaches semantic validation (400 for deliberately nonexistent IDs), while unrelated journals and oversized match requests return 413. The real 10,000-link submission also succeeds atomically and retries idempotently.
- **I3, Important — equal-value fee mistaken for duplicate identity.** Real API fixture reproduced 409 for a distinct second same-day fee before matching the first. Removed amount-only refusal; original statement/source reference, existing active provenance and original charge uniqueness still protect duplicates. Existing differing requested-reference duplicate regression and separate equal-value fee test both passed (49 HTTP checks).
- **I4, Important — quadratic duplicate response/DOM.** A 1,000-row real API regression exceeded the linear response bound, confirming repeated candidate arrays. Review now indexes canonical candidates by signature and returns shared pools plus per-ordinal pool references. One shared native completion list is rendered per pool; row inputs preserve explicit individual choices. Maximum 10,000-row overlap passed: 3,297,727-byte review, all 10,000 candidates preserved, duplicate reuse 409, complete one-to-one submission 201 and exact replay 201; canonical movements remain 10,000 (23 HTTP checks).

**Deferred M1:** The 10,000-record guard currently includes explicitly ignored balance rows. Keep the existing conservative resource bound in this correction pass; follow-up must separately bound total physical records and transaction rows. Cost: a statement with 10,000 transactions plus disclosed balance records is currently refused; use a transaction-only bank export or smaller valid statement interval.

**Deferred M2:** Frozen print omits the human bank ledger name/masked identity. The period identity and evidence hash remain scoped and immutable, but the paper output is less recognizable. Follow-up should freeze identity in new approvals and provide a compatible fallback for old snapshots, then verify renames/reopening cannot change historical identity. Cost: exported print requires the originating bank workspace or period/profile identifier to identify the bank.

## Correction-pass regression checks

Root build (11 tasks), typecheck (17 tasks plus final API typecheck),126 uncached units and lint (zero configured tasks) passed. Thirteen serial affected API/schema runs passed: imports53, adjustments49, maximum10,000-row duplicate review23, large escaped-reason transport23, matches56, reports55, guards43, baseline40, strict inputs, barriers29+10, populated invariance45, legacy bank charges55 and schema. Logs: `/tmp/bank-review-final/` and `/tmp/bank-review-{build,typecheck,api-typecheck,units,lint}.log`.

The first correction-pass browser run passed duplicate selection but failed when returning from a posted charge and requesting a linked journal. A background matching-state refresh changed the fingerprint and correctly discarded the early request. A deterministic held-refresh regression observed the exception-review button incorrectly enabled before the current book revision arrived (RED). The button now waits for that refresh. The complete production bank browser passed (GREEN), including explicit pool choices, held refresh, source creation, journal abandonment/replacement, stale amount/account/entity responses, roles, frozen print and mobile. The legacy bank-charge production browser also passed. Failed runs are not counted as passes.

After this final UI change, root build (11 tasks), typecheck (17 tasks), all 126 uncached units and lint (zero configured tasks) passed again. Final browser logs: `/tmp/bank-review-browser-green.log`, `/tmp/bank-review-charges-browser-green.log`; root logs: `/tmp/bank-review-final-{build,typecheck,units,lint}.log`. The final schema run used the original saved activation/hash baseline, confirming all original book states and 0011–0019 migration hashes unchanged after both browsers. Original 0020 SQL also remains unchanged; the replay-index correction is additive 0021. Log: `/tmp/bank-review-original-schema.log`.

All nine tasks are delivered through product commit `93c454d06b9f4e3ddfcf5c926f2d17777e57abef`. Normal default-branch pushes succeeded. No unresolved Critical/Important finding remains; the two Minor deviations below remain visible in the handoff.

## Preserved rulings and limits

The [checkpoint](2026-10-06-bank-reconciliation-checkpoint.md) records execution rulings: default checkout/claim rather than worktree; equivalent manual bookkeeping for unavailable subsidiary skill resources; immutable adjustment provenance with one reasoned release; original activation comparison by saved original IDs; prior-day cutover only in newly empty isolated fixtures; source-proved mixed-sign net receipts while outgoing payment/fee lines use ordinary same-sign edges; explicit abandoned/released source replacement.

This phase supports reviewed INR CSV statements and local accounting evidence. It adds no live banking connection, foreign-currency bank reconciliation, verified NIC issuance, statutory TDS/TCS automation or foundation authentication/RLS work. No deployment or shared-book activation is performed.
