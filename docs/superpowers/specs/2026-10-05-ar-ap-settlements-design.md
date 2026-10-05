# AR/AP settlements design

Date: 2026-10-05 (Asia/Calcutta)
Status: Written specification approved by user “continue” on 2026-10-05; implementation plan awaits review and execution-method selection.

## Purpose and agreed scope

Accounts staff must record money received from customers and paid to suppliers, identify which bills it settles, and see the actual amount still outstanding. The user approved core settlements with TDS/TCS deferred to the dedicated compliance phase. This extends the completed per-entity GL cut-over; it does not reconstruct historical activity or activate any shared entity.

Include receipts, payments, partial and multiple-bill allocation, reviewed opening bills, unapplied/on-account amounts, later allocation of those amounts, foreign-currency settlement differences, reversals, outstanding/ageing reports, customer credit-warning integration, and supplier MSME balance visibility. Use familiar Tally bill-wise concepts while retaining FactoryOS document lifecycles and permissions.

Exclude bank reconciliation, banking integrations, bank statement import, cheque clearance, TDS/TCS, customer deductions, automatic discounts/write-offs, credit/debit notes, cross-party netting, cross-currency bill allocation, GST advance-tax processing, RCM tax settlement/release, and automatic landed-cost/customs clearing. A supplier payment does not prove that RCM tax was paid to the government. Existing pending RCM credit stays pending.

## Approach

Use dedicated receipt/payment documents and a shared bill-balance service, posting through the existing GL writer in the same transaction. This gives accountants an allocation workflow and gives selling and reports one balance definition.

Alternatives considered: adding allocations only to manual journals would reduce document work but make bank/party entry and payment reversals harder to validate; storing mutable paid totals on invoices would simplify lists but weaken auditability and opening-bill support. The selected approach keeps immutable financial evidence and derives remaining balances.

## Accounting boundary and bill identity

Settlements require active accounting and a posting date on or after its cut-over. Before activation, show the existing setup gate rather than recording payments without GL effects. The opening worksheet's historical settlement declarations are opening reconciliation evidence, never new cash movements.

A bill has stable identity independent of its displayed reference. Scope it by tenant, entity, trade side, party, and source identity. Store original reference, source number, invoice/due date, currency, original-currency remaining amount, INR carrying value, and the actual trade-control account. Never match solely by a free-text invoice number.

Seed opening bills from the approved opening worksheet, linking invoice IDs where available. A linked historical invoice must not create a second bill. For a partly settled foreign invoice, its opening INR residual divided by the reviewed invoice exchange rate determines the residual document-currency amount; `originalAmount` is the original full invoice amount, not its residual. Use six-place arithmetic and verify the residual does not exceed the original. Unlinked opening bills use reviewed currency metadata; absent metadata means INR. Fully settled historic invoices have no outstanding bill.

Active-era invoices create bills from their submitted GL liability/receivable and stored document-currency totals. Upgrade initialization includes original and reversal effects for already-cancelled active-era invoices and journals, retaining their posting dates for historical reports. Record the actual debtor/creditor account used, so remapping future controls does not change old bills or where they are cleared.

Bill effects and allocations are append-only signed rows. Remaining original-currency and INR values derive from creation, adjustments, allocations, and reversals; invoice status alone does not establish remaining value. An operation must not allocate more than the current open amount or consume the same bill twice under concurrency.

## Compatibility with manual trade journals

Trade-control journals are already supported and cannot silently disappear from the subledger. During a repeatable upgrade reconciliation, classify existing submitted trade journal lines by entity, side, party, recorded account, and exact bill reference. An unambiguous matching bill receives the signed INR adjustment; unmatched references create separate INR journal bills/credits. Do not guess between duplicate references or attach an INR adjustment to a foreign bill: retain it as a separate journal-origin item, disclose it for review, and keep party-control totals reconciled. Process reversals by original line identity. Never replay GL or change an existing posted entry.

For new manual trade journal lines, require a structured bill choice: against an existing INR bill, new INR reference, or on account. Validate party, trade side, account, and remaining amount under the accounting lock. A line reducing an existing bill cannot make its balance negative. Journal-origin credit/on-account items are visible separately; this slice allocates credits created by receipt/payment documents, while journal credits remain explicit adjustments for an accountant to resolve through journals. Foreign bill adjustments require their operational settlement workflow. Preserve existing non-trade journal behavior.

The upgrade must be idempotent, perform per-entity reconciliation under the entity accounting lock, and complete before settlement writes are enabled for that entity. Compare net bill/on-account INR values with posted GL entries on current and historical trade controls. On an inconsistency, report the specific source and block settlement submission rather than fabricate a balancing adjustment. Existing operational workflows remain available; their bill effects must be synchronized transactionally once the upgrade is installed.

## Receipts and payments

A draft records direction, party, date, currency, exchange rate, cash/bank account, gross amount, bank/reference text, narration, and optional bill allocations. One document handles one party, trade side, and settlement currency. Selected bills must use that currency. INR settlement rate is exactly 1; a foreign-currency amount requires a positive INR rate. The cash/bank account must be an active entity account in the cash/bank group hierarchy, excluding trade, tax, inventory and clearing controls. This release records its INR GL value; it does not claim a reconciled foreign-currency bank subledger.

The amount allocated plus the unapplied amount equals the receipt/payment amount in settlement currency. Overpayments become an explicit on-account balance; they never make an invoice negative. Staff select bills explicitly. An optional oldest-due suggestion only fills the draft and must be reviewed before submission.

Receipt: debit cash/bank at receipt-date INR value; credit each bill's recorded debtor account at the allocated INR carrying value; credit the current debtor account for unapplied money at its receipt-date carrying value. Payment: credit cash/bank at payment-date INR value; debit each bill's recorded creditor account at allocated carrying value; debit the current creditor account for unapplied money. Post the difference to the configured FX gain/loss account, with any arithmetic residual separately evidenced as rounding. Inventory and GST are unchanged.

For an allocation, consume the proportional share of the bill's remaining INR carrying value using exact fixed-point proportion arithmetic. The final allocation consumes the full remaining INR value. Currency-rate differences go to FX, not rounding. Example: receive USD 40 against a USD 100 bill carried at INR 8,000, at INR 83/USD: bank debit 3,320, debtor credit 3,200, FX gain credit 120. The bill retains USD 60 / INR 4,800. Paying the equivalent supplier bill records an FX loss debit 120.

Bank fees are separate accounting journals in this slice. The entered payment/receipt amount is the gross cash/bank movement; the UI must not imply support for a net payment plus automatic deductions.

## Later allocation of on-account money

A submitted receipt/payment with unapplied money exposes an allocation action. It creates an independently numbered allocation document with date, reason, source settlement, and selected bills. Its currency, direction and party are inherited. Allocate only available source money against open bills of the same currency and trade side. The source cash/bank movement is not posted again.

Reclassify the source's recorded on-account carrying value to each bill's recorded control account and carrying value. Differences go to FX; same-account equal-value reclassifications need allocation evidence but no artificial monetary journal. Use an explicit no-value disposition when the posting has no nonzero net lines. Final exhaustion consumes the remaining source INR value. An allocation document can be reversed independently, restoring the original on-account balance and bill balances.

On-account money is shown separately from gross unpaid invoices. Customer credit exposure is net party receivable after receipts/adjustments, floored at zero for the limit comparison. Overdue warnings remain based on the actual unpaid overdue bills: unapplied money does not silently clear an overdue bill. Reports display gross bills, unapplied credits/advances, and net position distinctly.

## Storage and service boundaries

Add scoped settlement documents, allocation documents, bill identities, immutable bill effects, and immutable settlement allocation evidence, with Drizzle migrations and database immutability guards. Store the original posting's account IDs, currency amounts, INR shares, source relationships and reversal links. Unique source-effect and reversal constraints prevent duplicate initialization, posting or cancellation. No money uses JavaScript floats.

Keep responsibilities separate: bill service owns identity, initialization and balances; settlement service owns draft/lifecycle and posting plans; allocation service owns consuming/releasing on-account funds; existing GL writer owns balanced journals/dispositions; report service derives outstanding, ageing and reconciliation. Operational invoice and manual journal lifecycle hooks invoke bill service inside their existing transactions.

The GL remains the accounting book of record. Reconciliation reports show exact INR party-control GL net versus bill/on-account net, including historical mapped controls and journal-origin items. They expose discrepancies instead of hiding them through netting or mutable invoice paid totals.

## Lifecycle, cancellation and errors

Use draft → submitted → cancelled, explicit save, server-calculated preview, numbered submission, audited reason for cancellation, and existing entity-first lock order. Submit acquires `accounting:<entityId>` before document locks, reloads all source balances and validates references. GL, bill effects, allocation evidence, document status and audit commit or roll back together. Repeated submissions/cancellations must not produce duplicate effects.

Cancel a receipt/payment only after reversing every surviving later allocation against it. Its original inline allocations reverse with it. Cancel an allocation by negating recorded currency/INR effects and recorded GL entries; do not use current rates or mappings. Reversal date is the current Asia/Calcutta business date, consistent with GL. Submitted documents are not editable.

Refuse cancellation of an invoice with surviving settlement allocations or bill-reducing adjustments; identify the dependent documents and require reversal first. Retain all existing stock/acquisition-cost cancellation guards and the restriction on opening-era source cancellation. Journal cancellation must similarly respect dependent allocations where applicable.

Allocation date cannot precede its source settlement or the selected bill's recognition date; settlement date cannot precede a selected active bill's recognition date. Opening bills are recognized at cut-over. Reject dates in the future, dates before cut-over, zero/negative gross amounts, duplicate bills, inactive accounts, missing FX mapping, stale balances, invalid party/currency combinations, and cross-tenant/entity IDs with actionable validation errors. Do not auto-activate accounting, remap accounts, silently truncate allocations, or auto-write off differences.

## API, access and UI

Provide scoped list/detail/create/update/preview/submit/cancel endpoints for receipts/payments and later allocations; bill lookup by party/side/currency; outstanding/ageing/reconciliation endpoints; permission-controlled exports. Register `accounts.settlement` actions read/create/update/submit/cancel/export. Later allocation uses the same settlement permissions. Existing `accounts.report.read/export` governs balance reports. Accounts roles receive appropriate settlement permissions; operational-only roles keep their existing rights.

Selling credit-status uses the shared balance service without exposing cash/bank movements, accounting narrations, or unrestricted vouchers. Sales order/invoice warnings preserve decision 032's approver override. Supplier invoice screens use existing buying read permissions to show their own remaining amount; full accounts reports require accounting report permission.

Add Accounts receipts/payments lists and forms, a bill picker with currency, due date, open amount and entered allocation, gross/unapplied totals, server-calculated INR/FX preview, and links to posted/reversal vouchers subject to voucher permission. Submitted documents show surviving allocations and available on-account amount, with a separate allocation form and exact cancellation dependency messages. Use `@factoryos/ui`, entity gates, existing keyboard patterns, loading/empty/error states, and exact-precision print/export. Clearly mark accounting-inactive entities.

Outstanding reports filter side, party, currency, as-of date and overdue/MSME. Show original open currency, INR carrying value, due date, age, journal-origin items, and separate on-account totals. Historical as-of views use immutable effect posting dates, not current document status. Ageing buckets are not due, 1–30, 31–60, 61–90, and over 90 days overdue.

MSME reporting uses purchase invoices' existing stored category/due date and shows only their remaining balance. It identifies that current due dates derive from supplier invoice dates; this is balance visibility, not a claim of acceptance-date statutory compliance or a complete MSME-1/43B(h) calculation. Unlinked opening supplier bills without due/category metadata are visibly unclassified rather than assigned invented dates.

## Verification and acceptance

- Unit tests exercise partial/final carrying-value allocation, exact residual exhaustion, receipt/payment FX signs, on-account reallocation, and recorded-value reversal with six-place amounts.
- PostgreSQL/API tests cover active/inactive boundaries; opening historical and unlinked bills; partial historical foreign settlements; active domestic/foreign bills; mixed-control remaps; existing manual journals and reversals; retry-safe initialization; cash/bank validation; permissions and cross-entity denial; multiple/partial allocations; unapplied money and later allocation; zero-value reclassification; cancellation dependencies; changed rates/mappings; rollback on posting failure; and no pending-RCM release.
- Concurrent requests compete for the same bill and same unapplied source. At most available balances commit; entity-first locking and atomic audit/GL evidence are verified against real PostgreSQL.
- Reconcile bill/on-account net with GL trade controls after invoice, payment, allocation, adjustment and reversal; validate as-of balances, actual credit-warning reductions, overdue counts and MSME residuals.
- Browser walkthrough creates receipts/payments, previews FX, allocates remaining money later, exercises validation/reversal dependencies, verifies selling warning changes, report permissions, print/export, and entity switching.
- Run repository typecheck, build, relevant unit/API/browser suites and available lint tasks. Report a zero-task lint result accurately. Retain existing buying, selling and accounting regression coverage. Do not activate a shared entity or push partial product code to the automatically deployed branch.

## Review handoff

This specification fixes the scope boundary at core trade settlements. Approval of this written file permits writing the implementation plan. The written plan must then be reviewed and its execution method selected before product implementation starts.
