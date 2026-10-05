# Compatible settlement improvements: review and verification

## Scope and integration ruling

The user selected the shared implementation as the base. Product changes start from
`de88801` through claim `fa7e5ab`; the independent review covered `fa7e5ab..b41d8a2`.
Cache correction is `c042b96`. Concurrent CI/handoff commit `75808d7` was preserved by merge.
The shared `0011_settlements.sql`, schema and permission catalog are unchanged.
The alternate implementation remains on `native-ar-ap-settlements-20261005` at `21c285d`.
Its migration 0011 must never be applied to a shared-version database, or vice versa.

## Changes

- Seed the full set of pending invoice identities before matching legacy journal references.
  Duplicate historical supplier references remain ambiguous instead of attaching a journal
  to whichever invoice happens to synchronize first.
- Scoped sales/purchase balance endpoints use their existing operational read permissions.
  Invoice forms show exact remaining currency and INR carrying balances, with inactive-books
  disclosure. Partial payment, reversal, cancellation and foreign opening values are covered.
- Validated settlement/allocation postings may clear an inactive historical debtor/creditor
  account with party and bill evidence. Ordinary manual journals and inactive bank/FX accounts
  retain their existing guards.
- Invoice balances refresh on settlement submission, cancellation and remount. The regression
  navigates away after a payment and returns to the invoice before cancelling it.

## Independent review and fix

One independent review found one Important issue: the 30-second query cache could display
100 after a payment reduced the invoice to 60. No Critical or Minor findings were reported.
The browser regression reproduced that failure; invalidation plus always-refetch-on-mount
fixed it, and the production browser test passed. One fix pass; no repeated review.
The reviewer confirmed unchanged migrations, permission/entity scoping and narrow historical
control handling; fixture results were independently executed by the implementer.

## Verification

Local PostgreSQL 16, Node 24.19.0, pnpm 10.28.0; API 4001/web 3001 with explicit overrides.
Build: 11 tasks; typecheck: 16 tasks; unit tests: 55, all passing.
Lint runs zero tasks and provides no lint coverage.
Focused API cases: duplicate references 16, balances 28, historical controls 32, all passing.
Settlement regression: 93 checks, including exact foreign opening invoice balances.
Six accounting suites: 202 checks; review regressions: 8; real PostgreSQL lock-order barrier passed.
Buying/selling/imports suites passed (60/48/39 checks).
All five production browser walkthroughs passed: invoice balances, settlements, accounting,
selling and buying. The API suites report 526 checks in total, plus the lock-order barrier.

## Retained limits

The original shared review remains authoritative for its other deviations and deferred scope:
[shared review](2026-10-05-ar-ap-settlements-review.md). Its missing invoice-balance item is now
resolved. This bounded review does not certify every original deviation against the alternate
implementation. Structured journal selectors and separate rounding remain outside this change.

Previously initialized append-only bill effects are not rewritten. The matching fix applies
pending synchronization; existing misclassifications, if found, require Finance-reviewed
adjustments. No deployed-data audit or shared-entity activation was performed.
A separate local database protects both migration histories; the ignored root environment now
uses the shared database, with the original local configuration securely preserved outside Git.

## PR #1 integration

The user requested conflict resolution and merge of PR #1, whose head is the retained
alternate implementation at `21c285d`, targeting the shared branch. Merge `da8a0eb`
records that history with the `ours` strategy: its complete tree is identical to
`17a594c`. This intentionally retains the user's chosen shared implementation and
already-ported compatible improvements; it does not install the alternate migration
or accidentally resurrect replaced controllers, permissions or UI contracts.
The original Native backup branch remains unchanged at `21c285d`.

GitHub GraphQL and REST PR APIs returned Forbidden in this environment. PR identity,
OPEN state, source and target were confirmed through the public PR page and Git refs.
The merge is performed through a normal push to the target, without bypassing hooks
or branch protections. Final PR state must be confirmed after that push.

Merged-tree verification passed: build (11 cached tasks), typecheck (16 cached tasks),
55 freshly run unit tests, 93 settlement checks, 16 duplicate-reference checks,
32 historical-control checks and production invoice-balance browser regression.
Lint still has zero configured tasks. API and web health endpoints returned OK.
