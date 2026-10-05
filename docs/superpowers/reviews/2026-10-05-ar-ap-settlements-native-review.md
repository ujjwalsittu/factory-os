# AR/AP settlements — Native implementation review

This record covers the Native implementation based on `7ecd6e2`, through
`c5f7fe6` and final review fixes in `1203e1f`. The approved specification and plan are
`docs/superpowers/specs/2026-10-05-ar-ap-settlements-design.md` and
`docs/superpowers/plans/2026-10-05-ar-ap-settlements.md`.

## Integration boundary

The shared branch independently advanced to `de88801` during execution. That
implementation has a different, already published `0011_settlements.sql` schema
and its own [review record](https://github.com/ujjwalsittu/factory-os/blob/de888019d6f6afa343ef84e8f482960ec0524a56/docs/superpowers/reviews/2026-10-05-ar-ap-settlements-review.md). This Native branch uses
`0011_jittery_katie_power.sql`; the migration histories are incompatible.
Do not merge or deploy these schemas interchangeably. The Native implementation
is preserved on `native-ar-ap-settlements-20261005`. Shared integration requires
the user's choice between keeping the remote implementation and incorporating
compatible improvements, or integrating the fuller Native design with a tested
data migration. No shared entity was activated.

## Independent review

A fresh-context, read-only reviewer assessed `7ecd6e2..c5f7fe6` against the
approved specification, all five Review Focus conditions, and execution rulings.
The initially requested review model was unavailable due to capacity; the next
available model performed the review. No Critical findings were identified.

1. **Important: interleaved duplicate-reference upgrade.** A legacy journal
   submitted between two invoices sharing a reference was attached to the first
   invoice before initialization discovered the second. A real PostgreSQL
   upgrade fixture reproduced two bills instead of the required three. The
   initializer now seeds nonmanual source identities before classifying legacy
   journals. Both invoices remain 100 and the journal remains a separate −50
   credit. Regression: `smoke-settlements-upgrade.mjs`, RED→GREEN.
2. **Important: operational error disclosure.** Entity-wide reconciliation
   errors exposed unrelated supplier balances to sales-only readers. The
   restricted-role API regression reproduced the disclosure. Detailed
   differences now require `accounts.report.read`; operational invoice and
   credit-status callers receive a readiness error without unrelated financial
   data. Finance retains actionable differences. Regression:
   `smoke-settlements-reports.mjs`, RED→GREEN.
3. **Regraded Important: stale cancelled invoice summary.** The reviewer graded
   this Minor; a cancelled invoice displaying a remaining financial balance was
   regraded by user effect. The production purchase cancellation test reproduced
   the stale 100 balance. Both purchase and sales cancellation now invalidate the
   scoped balance query. The production browser observes 0 after both
   cancellations without reloading. Regression: `e2e/settlements.mjs`, RED→GREEN.

The reviewer declined to judge the separately implemented remote branch,
deployed-schema compatibility, integration strategy, and explicitly excluded
compliance functionality. These remain outside this branch review. No second
review was dispatched; final fixes are verified through regression tests.

## Verification

- Root typecheck: 16 successful tasks; production build: 11 successful tasks.
- Uncached unit suite: 63 tests (core 39, authentication 8, compliance 16).
- Lint executes zero tasks; no package lint scripts are configured.
- Production settlements browser: receipts/payments, structured journal bill
  choice, foreign previews, on-account allocation/reversal, cancellation
  dependencies, outstanding export, print, read-only access, entity switch,
  inactive gate, mobile containment, and active invoice cancellation balances.
- Final API regression rerun: settlement suites 31/26/48/28/45/69 checks (247);
  six accounting suites 202 checks; eight accounting review regressions and a
  real PostgreSQL entity-first lock-order barrier; buying 60, selling 48 and
  imports 39. Every suite exited successfully. Production accounting,
  selling and buying browser reruns all exited successfully after the fixes.

## Scope retained

Exact six-place carrying-value allocations, distinct FX and rounding evidence,
immutable bill/allocation effects, transaction-time balance validation and
entity-first locks, recorded historical control-account clearing and reversals,
gross/on-account/net/overdue separation, opening-bill upgrades, and remaining
invoice/MSME balances are implemented. TDS/TCS, bank reconciliation, credit/debit
notes, cross-party/currency netting, RCM tax settlement and a foreign-currency
bank subledger remain deferred. MSME dates retain the existing invoice-derived
basis; statutory acceptance-date compliance is not implemented.

## Rulings

The exhaustive execution rulings, including costs if wrong, are retained below
before the plan workspace is cleaned up.

- Ruling: Skill shell helpers are not available on this machine; maintain equivalent task briefs, BASE and test evidence directly in this plan-owned ledger — cloud skill sources are remotely served — cost if wrong: bookkeeping requires explicit maintenance.

- Ruling: Opening unlinked foreign originalAmount is already the open foreign amount by existing validation; linked originalAmount is full invoice amount — residual is always remaining INR/rate — cost if wrong: rounding below six-place boundary may need evidenced adjustment.

- Task 3: Ruling: Centralize transactional invoice bill synchronization at existing GL writer, manual-journal submission and opening activation boundaries — covers every source and reversal without duplicating hooks in large operational controllers — cost if wrong: future direct GL inserts must explicitly synchronize; scanning historical vouchers is slower than incremental effects.

- Task 7: Ruling: Record each submitted manual draft line ledgerEntryId and resolve bill choices by that identity — supports multiple journal lines with identical references instead of rejecting ordinary split adjustments — cost if wrong: old drafts retain tuple fallback until first submission; unambiguous legacy matching remains disclosed.

- Task 7: Ruling: Permit validated settlement writers to clear recorded inactive historical trade controls only — remapping/deactivation must not strand old bills; inactive bank/FX and ordinary manual posts still reject — cost if wrong: future settlement source builders must retain bill/account validation before invoking the writer.

- Ruling: Remote skill package does not expose referenced code-reviewer.md (both requested resource paths failed); use requesting-code-review supplied description/requirements/base/head template and explicit severity/final assessment contract — cost if wrong: reviewer template detail may be missing.

- Final: Ruling: Requested frontier reviewer returned capacity error; dispatch next available explicit review model with fresh context — preserves independent review instead of replacing it with self-review — cost if wrong: less capable reviewer may miss subtle defects.

- Final: Ruling: Remote branch advanced to de88801 with independently implemented incompatible settlement migration0011; preserve this completed Native implementation on separate branch and hold shared-schema integration for user choice — prevents overwriting deployed schema/data — cost if wrong: duplication and later merge/data migration work remain.

- Final: Ruling: Re-grade stale cancelled-invoice balance from Minor to Important — a cancelled invoice displaying a nonzero remaining amount misstates a new financial summary — cost if wrong: unnecessary cache-invalidation regression work.

- Final: Ruling: Reviewer declines remote integration/deployed compatibility and excluded compliance — shared schema integration remains explicitly blocked pending user choice; approved exclusions remain deferred — cost if wrong: separate integration/migration validation remains outstanding.

- Task 7: Ruling: Reuse existing selling approver/credit-warning browser coverage alongside active-net/overdue API cases instead of duplicating the entire selling flow in the new settlement browser — the credit response contract is unchanged — cost if wrong: active-mode warning rendering could escape browser coverage.

- Final: Ruling: Save Native review separately from the remote implementation review — preserve both independent implementation records for integration — cost if wrong: readers must distinguish two branches and review files.

## Deferred minors

None from this review; the stale balance finding was regraded and fixed. The two previously documented GL UI minors remain outside this slice.
