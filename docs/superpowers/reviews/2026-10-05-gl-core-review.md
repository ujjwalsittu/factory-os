# GL foundation review and verification

The independent review covered `fd7b36d..e0cb517`, including the approved design, plan, migrations, transactional postings and web screens. It found no Critical issues and seven Important issues. Each Important finding was reproduced before the fix; the final verification results are recorded in STATUS.md.

## Material fixes

- Refuse receipt cancellation while any receipt line has a positive net immutable invoice allocation. Reversed allocations restore cancellation eligibility.
- Keep mapped accounts in their required root classification, even before their first posting.
- Bound acquisition-cost rate increments to the representable on-hand share. Store and post the precision residual as rounding, separate from actual consumed cost; apply the same arithmetic to landed charges.
- Conserve receipt base cost across partial invoices and reversals. The final allocation exhausts the remaining actual receipt or frozen opening-baseline cost. Proportions round once, avoiding intermediate division/multiplication loss.
- Record actual receipt-versus-PO valuation differences in purchase-price variance, rather than using a substantive rounding plug. Preserve the existing PO price/FX split.
- Acquire the entity accounting lock before locking a stock document. A real PostgreSQL barrier test confirms cancellation holds no document lock while waiting for its entity lock.
- Disclose inactive books in reports, print/export metadata and source documents. Distinguish historical sources, intentional no-value dispositions and missing expected postings; scoped report readers need no setup permission for activation status.
- An additional fractional-quantity reproduction exposed tax shares lost during intermediate multiplication. Allocate non-creditable invoice/customs tax and landed charges with the same exact proportional helper, preserving the final residual.

## Rulings and their costs

1. Use the existing isolated cloud checkout and a manual execution ledger because cloud skill scripts are not local executable paths. Cost if wrong: bookkeeping only.
2. Verify the transactional writer through activation APIs implemented in the following task. Cost if wrong: later defect isolation.
3. Use `gl_account`/`glAccount` because authentication already owns `account`. Cost if wrong: naming only.
4. Retain the existing landed-cost lifecycle and movement guards, with a focused service for non-creditable acquisition tax; share bounded valuation arithmetic for the review fixes. Cost if wrong: two valuation paths to maintain.
5. Round acquisition increments down where six-place rates cannot represent the on-hand cost; store/post the remainder as rounding. Cost if wrong: very low unit-cost charges stay in rounding until finer rate precision exists.
6. Preserve accepted receipt-rate overrides and classify their discrepancy as purchase-price variance. Cost if wrong: classification differs from the PO-only formula for overridden receipts.
7. Linked manual clearing journals remain traceable adjustments, without a settlement ceiling. The approved design leaves source balances unchanged and defers payments. Cost if wrong: an accountant can manually over-clear an accrual; future AR/AP allocation must enforce its own limits.

## Deferred UI minors

- Source-page reversal links currently say “submitted”; voucher details still retain `reversalOf` and original/reversal navigation.
- Manual reversal details expose a cancellation button whose transition the API rejects; duplicate monetary reversal remains impossible.

## Boundaries

Accounting stays inactive until deliberate, reconciled per-entity Finance cut-over. Only new local test entities were activated during development. No historical journals are reconstructed. Current cumulative stock/GL balances reconcile; historical date comparisons remain limited by the existing stock reversal dating behavior. AR/AP payments/receipts, credit/debit notes and IRN/EWB remain later slices. Review and local tests do not establish deployed application health. The repository has no package lint tasks.

## Final verification

Root `pnpm typecheck` (16 tasks), `pnpm build --concurrency=2` (11 tasks) and uncached `pnpm test --force` (48 tests) pass. `pnpm lint` executes zero tasks. All six accounting API suites (202 assertions) and six legacy API suites (252 assertions) pass; eight additional review regressions and the real PostgreSQL lock barrier pass. Targeted operational/import/baseline suites were repeated after the final proportional arithmetic fix. All five production standalone browser walkthroughs—accounting, selling, buying, imports and base—pass; the base script logs its existing HTTP 400 console resource error and exits successfully.
