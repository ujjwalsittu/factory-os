# Accounting tax foundation and bank charges review

Date:2026-10-06. Baseline:39ff085. Method: Native inline implementation with one fresh read-only independent final reviewer. The approved eleven-task plan remains partially implemented; this review covers the available deliverable, not unavailable tax automation.

## Reviewed scope

Empty verified statutory catalog and draft aliases; exact pure arithmetic and component engine; additive0019 scoped evidence/auth; Finance configuration, PAN identity, openings and certificate evidence; standalone/inline INR bank fees, documentary GST, exact reversals, receipt/payment component display and bank-charge register/editor. Numerical source recognition, documentary advice, earlier-event/advance posting hooks, TCS invoice totals, remittances/corrections and remaining tax UI are pending.

## Findings and fix pass

No Critical findings. Four Important findings accepted and reproduced in isolated fixtures:

| Finding | RED evidence | Resolution | Final verification |
|---|---|---|---|
| Single-event threshold incorrectly swept prior small untaxed sources | Prior20000 plus single35000 returned taxable55000/tax550 instead of35000/350 | Only cumulative crossing sweeps backlog; retain prior20000 until later crossing |33 compliance tests and96 uncached root tests PASS |
| Custom unmapped bank ledger accepted as input GST asset | Second Bank Accounts ledger with no role/history produced201 instead of400 | Reject bank/cash/inventory/trade group ancestry, in addition to mapped/current/historical controls | 55-check charge fixture PASS |
| Receipt fee equal to principal generated zero/zero bank line | Receipt100/fee100 submit returned400 from balanced-line validation | Omit zero bank movement from GL while keeping fee and principal evidence | 55-check charge fixture PASS |
| Adding bank GST invoice evidence bypassed charge duplication | Previously recorded statement reference with later invoice returned201 instead of409 | Protect both normalized charge reference in immutable input and bank invoice key under entity accounting lock | 55-check charge fixture PASS |

Supplemental implementation regressions: linked settlement cancellation without bank-charge cancellation authority reproduced200→403 and fixed atomically; positive unsupported newTax request reproduced200→400 and refused; mapped inventory input GST reproduced201→400 and refused. Production browser waits for submitted numbered receipt and tests stale standalone preview edits, linked register visibility and mobile overflow.

## Execution rulings

1. Use default-branch checkout per explicit user instruction; no worktree or implementer agents. Normal fetch/push and prior task claim prevent shared work collisions.
2. Remote skill task scripts were unavailable; maintain equivalent local briefs/ledger/logs without claiming those scripts ran.
3. Current Act393/394/395/397/402 primary text is pinned; scrap amendment is2% from2026-04-01. Complete GST-base/PAN/certificate applicability bundle remains missing after old official circular paths returned404. Enable no numerical profile; synthetic rates are tests only. Evidence: `docs/compliance/withholding-profile-evidence.md`.
4. Preserve exact rational multiplication until final profile rounding; ledger residual is six-decimal evidence. No global decimal behavior change.
5. Certificate-capacity crossing requires reviewed split rather than silently switching rates. Draft-profile certificate capture does not make it usable for automatic tax.
6. Prior-year consumed advance base is independent of current-year cumulative base, while source-consumed ceiling remains eligible source evidence.
7. Generate additive0019, order new composite unique indexes before new FKs, then append immutable evidence triggers. Once applied,0019 is immutable; old0011–0018 never changed.
8. A schema-phase shell batch initially continued after build/invariance failures; the premature ledger claim was superseded. Action union configure/correct and JSON-normalized Date comparison now pass real checks. Later verification uses fail-fast batches and inspected outputs.
9. Finance evidence-only activation requires active accounting, current date, reconciled opening hash, TAN/PAN and category/account agreement; it adds no GL or historical replay. Isolated fixtures only; no shared books activated.
10. Continue independent bank fees while numerical-profile-dependent work is blocked. `contextIn` refuses and positive requested newTax is rejected. Do not label the entire tax phase complete.
11. Caller settlement owns one combined bank movement; linked charge records the parent's voucher without independently crediting bank. Bill allocation remains principal; old cash-only/FX paths stay supported.
12. GST is expense by default. Input credit requires qualifying invoice, scoped registration, Finance approval and safe mapped asset ledger. No GST inference from statement fees.
13. Cancelling a linked fee must use parent settlement and both cancellation authorities; standalone cancellation reverses original voucher amounts/accounts. Reference remains reserved after cancellation. Replacement or later GST evidence correction is not implemented by posting another charge.
14. Both charge reference and invoice identity are checked inside the production accounting advisory lock; final duplicate scenario observes two actual PostgreSQL lock waiters rather than relying solely on simultaneous promises.
15. UI shows server principal/fee/net values, hides stale review inputs and checks permissions. Inline editor initially expenses supplied GST; reviewed invoice evidence on existing drafts is retained. Full invoice-backed GST review is available in standalone editor/API; broader tax settings/register UI is pending.
16. Root test cache bypass initially used the wrong CLI argument forwarding (Vitest rejected --force); corrected to `pnpm exec turbo run test --force`. No failed invocation counted as a passing suite. Lint has no configured tasks.

## Verification checkpoint

Final reviewed-code verification PASS:

- `pnpm build`:11 tasks; `pnpm typecheck`:17 tasks.
- `pnpm exec turbo run test --force`:96 uncached units (core38/auth15/compliance33/GSP10),9 tasks.
- `smoke-bank-charges.mjs`:55 counted HTTP checks, exact actual GL/bill amounts, Finance permission guard, custom-bank/input control guard, reference/invoice duplicates, equality fee and observed two-waiter PostgreSQL duplicate barrier with exactly one voucher.
- `smoke-settlements.mjs`:93 legacy checks, including foreign-currency/on-account FX, source/cancellation dependencies and trade reconciliation.
- `smoke-withholding-policy.mjs`:41 HTTP checks; `smoke-withholding-schema.mjs`: scoped rollback/upgrade/immutable evidence PASS.
- Production browser suites `bank-charges.mjs`, `settlements.mjs`, `accounting.mjs` PASS. Bank suite verifies standalone/inline fees, stale edit, submitted principal/net display, register links and mobile overflow. Accounting covers exact journals/export/read-only scopes/source links.
- `pnpm lint`:0 configured tasks; no lint coverage implied.
- Prior0011–0018 hashes and374 preexisting book activation states unchanged; no shared books activated.

First final policy invocation hit shared signup429 after fast sequential fixtures;12-second pacing between fresh-user suites resolved it without changing authentication configuration. All final results were inspected. Reviewed scope is ready; the entire eleven-task tax phase remains incomplete.

## Deferred scope and limitations

Automatic tax profile enablement, source tax/advice/advance hooks, TCS invoice totals, remittances/protected corrections and remaining tax UI are pending the evidence gate and implementation. No tax return serializer, live NIC call or statutory submission exists in this slice. Bank-charge cancelled references remain reserved; replacement linkage and later evidence-only GST adjustment need an explicit workflow. Bank reconciliation and foundation providers/security features remain next separate designs.
