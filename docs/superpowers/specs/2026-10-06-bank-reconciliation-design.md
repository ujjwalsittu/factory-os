# Configurable bank statement reconciliation

Status: Written specification and Native implementation plan approved2026-10-06; decision041 Accepted. Tasks1–6 implemented and verified. Tasks7–9 remain: approved reports/reopening, UI, concurrency/populated invariance and independent final review.

## Purpose and assumptions

The user authorized bank reconciliation after bank charges, asked for configurable workflows, and requested continued work on the default branch. Accountant needs to import bank statements and explain each movement; Finance needs a reproducible reconciliation with original evidence and controlled reopening. Success means statements match actual posted bank movements, outstanding items remain visible, and a reconciliation never silently changes GL, customer/supplier bills or inventory.

Approved first input is UTF-8 CSV with saved per-bank column mappings. CSV is the first supported format; the optional format preference did not supersede the written-spec approval. Account profiles represent INR bank accounts explicitly confirmed by Finance. Foreign customer/supplier settlements whose actual bank GL is INR remain matchable; foreign-denominated bank statements require a later currency design. No bank feed, credentials, account connection, PDF/OCR, OFX or Excel dependency is included.

## Approaches considered

1. **Reviewed imports and explicit matching — recommended.** Add immutable statement evidence and separate match events against existing bank GL entry IDs. Suggest exact candidates, require confirmation, and review exceptions through existing accounting documents. Supports different CSV layouts without automatically changing books.
2. **Automatic bank feed and automatic posting.** Less manual importing, but requires provider access, authentication, transaction identity contracts and additional approval/security design. Deferred.
3. **Bank clearance dates directly on GL rows.** Smaller screen, but loses original statement evidence, partial/group matches, duplicate import controls and append-only corrections. Rejected for this proposed slice.

## Accounting boundaries

Existing `gl_entry` has immutable IDs and exact six-decimal INR debit/credit amounts. Its voucher supplies the source, date and reversal relationship. Use bank-group ancestry, not just the default bank role, to identify eligible ledgers. A Finance-configured profile binds one bank account to one tenant/entity, an account identifier shown only masked, currency INR and immutable mapping revisions. Each GL account has one profile identity; mapping revisions do not create a second reconciliation pool. Existing historical entries remain usable if a configured account is later inactive; new adjustments still require an active valid account.

Bank money received is positive (`GL debit−credit`); money paid is negative. CSV credit/debit labels are configured and previewed using this same perspective. Receipt principal90000 with fee100 matches the actual89900 bank debit; payment principal117000 with fee50 matches117050 bank credit. A zero bank movement produces no candidate. Matching source principal, total voucher value or charge expense instead of the bank GL line is prohibited.

All original bank GL entries and reversal entries remain visible, including cancelled original vouchers; accounting cancellation never deletes the original movement. Opening-balance voucher lines are represented by the reconciliation baseline and cannot also be matched as ordinary bank transactions.

## Finance baseline and older outstanding items

Reconciliation begins at a Finance-reviewed baseline date on or after accounting cut-over. Capture book closing balance B0 from actual bank GL through that date, bank statement balance S0, documentary reference and individual older uncleared movements O0. Positive O0 is a deposit not yet credited; negative O0 is a payment/cheque not yet debited. Require exact `B0−sum(O0)=S0` before activation. An unexplained bank-only opening difference must be corrected through existing authorized accounting documents and reviewed again; it cannot become a plug amount.

Each opening outstanding item retains original date, reference, signed amount, reason and source evidence. If its original FactoryOS bank GL entry exists, link it and enforce uniqueness, sign and amount; otherwise mark it as imported pre-cut-over evidence. Neither case adds GL. All bank GL movements through the baseline are represented by its book closing plus these outstanding items; ordinary candidate discovery starts after the baseline date. This avoids matching the opening balance or an older movement twice. Review exposes the full pre-baseline bank ledger and explains this boundary.

Recheck book balance, account identity and evidence hash under the accounting lock at activation. Subsequent pre-baseline bank GL postings would invalidate it: block those postings until Finance explicitly resets the baseline after reversing all dependent matches and reconciliation closures. Reset is an append-only revision, never silent recomputation. No automatic shared-book activation or baseline activation occurs during upgrade.

## CSV import and identity

A saved mapping specifies delimiter, header/skip rows, ascending/descending source order, column names, date format, decimal/group separators, reference/description, optional bank transaction ID, either signed amount with explicit polarity or separate debit/credit, and optional running balance. Support explicit ISO, day-first or month-first formats; never guess ambiguous dates, signs or numeric separators. Amounts remain decimal strings; reject excess precision, exponent notation, conflicting debit/credit, zero transaction amounts and unmapped footer rows. A mapping may explicitly identify balance-only rows; disclose them in preview. Balance fields may be negative for overdrafts.

Limit the first release to5MiB UTF-8 files and10000 transaction rows; handle quoted fields, multiline descriptions and BOM. Keep bounded raw file/row evidence private to the scoped statement permissions; audit records hashes/counts, not full bank descriptions. No new external storage is required. Imports are staged for preview and then submitted atomically with a checked revision/hash. All row errors must be resolved before submission; no silent partial import.

Each batch records file SHA-256, mapping revision, statement start/end dates, opening/closing balances, original ordinal and canonical row values. Verify opening plus signed movements equals closing and every supplied running balance in declared chronological order. Dates must fit the stated interval and follow the active baseline. A batch must identify a complete statement interval, not an unexplained partial extract.

Exact same file for the same account returns its existing submitted batch. A supplied bank transaction ID is unique within the account; conflicting date/amount identity refuses. Without a stable transaction ID, identical signatures within one file preserve occurrence ordinals so legitimate repeated transactions are not collapsed. Overlapping files with possible duplicate signatures require explicit Finance resolution: link an existing canonical movement or assert a distinct occurrence with a documentary reason. Ambiguity is not automatically skipped or posted. Submitted canonical movements are immutable, and file/batch membership never counts one movement twice in balances.

Contiguous statement intervals must reconcile their shared closing/opening balances. Overlap must have consistent bank balances and resolved canonical identities; conflicting overlap refuses. Missing intervals, ambiguous duplicates and incomplete coverage prevent final approval. A submitted import can be reversed only after dependent matches and closed reconciliations are explicitly reversed/reopened. Reversal retains its original evidence and prevents a repeated file from silently reviving invalidated rows.

## Suggestions, confirmation and allocations

Show remaining statement rows and remaining bank GL/opening items side by side. Exact amount plus an explicit bank/source reference ranks first; amount with configurable date distance ranks next. Date window is configurable0–30days, default7; reference normalization only trims whitespace and folds case. Multiple candidates remain ambiguous. There is no automatic match, posting or fuzzy reference rewrite.

One confirmation may allocate a statement row across several book items, combine several rows against one item, or partially allocate both. Store explicit positive-capacity allocation edges between statement and book items in append-only ordinary match groups/events. A normal group uses one sign, and sums on both sides must match exactly with no tolerance or rounding write-off. Never allocate more than either side's remaining capacity. Partial matches leave the exact remaining amount visible.

A separate Finance-confirmed net group handles a bank splitting a movement into gross receipt and fee while the source booked one net bank line. For example statement+90000 and−100 can match book+89900. Require nonzero exact net equality, complete allocation of every chosen statement row, source linkage and a documentary explanation; display gross incoming/outgoing totals separately. Only the book bank line is consumed, never the linked expense line. Do not use a generic residual write-off or zero-net group to hide unrelated movements. Ordinary Accountant matching cannot submit a mixed-sign group. Net groups store two signed side vectors rather than inventing positive edges from a fee debit into a receipt credit; reverse the complete group atomically, never one mixed-sign constituent.

Preview returns a hash of account/baseline, input IDs, signed values, current residuals, source state and revision. Submit recalculates everything under the existing entity accounting lock. Stale preview, wrong scope, non-bank account, inconsistent sign, over-allocation and closed period refuse with no partial evidence. UI changing an entity/account/selection discards its preview; late responses cannot restore it.

## Reports, dates and approval

Match evidence stores the bank transaction date separately from GL posting date. For an as-of report, an allocation clears a book amount only when both the book date and bank date are on/before the report date. A bank row linked to a later book entry remains a bank-only timing item until that book date; a book movement linked to a later bank row remains outstanding until the bank date. Imported older items use their original book date. For ordinary allocations, apply that rule per edge. A Finance net group becomes effective as one unit only after every constituent bank and book date is on/before the report date; before then its dated bank rows remain bank-only timing items and its dated book residuals remain outstanding. This keeps cross-day gross/fee groups balanced without inventing an allocation direction. Current reports use current evidence; approved reports preserve their original frozen revision.

For complete coverage through an as-of date, report:

- B: actual book balance including baseline and all bank GL through that date.
- U: signed uncleared book/opening amounts, including partial residuals and later-cleared movements.
- E: signed unmatched bank amounts, including matches to future-dated book entries.
- S: verified bank statement closing balance derived from baseline and unique canonical movements.
- Difference: `S−(B−U+E)`.

Example: book100000, uncleared payment−1000 and no bank-only items gives statement101000. Book100000 plus an unbooked bank fee−100 gives statement99900 and a−100 bank-only exception. The formula must keep these opposite signs distinct.

A zero difference alone does not mean reconciled. Finance approval requires complete validated statement coverage, no unresolved bank-only item or duplicate/conflict, zero difference, current preview hash and a reviewed list of remaining genuine uncleared book items. Approval covers the next contiguous interval after the prior approved baseline/period. Missing sources/coverage are shown as incomplete, never zero.

Approved period snapshots freeze balances, coverage, selected evidence, outstanding list, matches and reviewer. There is no new global accounting-period lock in this slice. Protect the specific bank reconciliation interval: block match changes, import reversals, baseline resets, bank-entry cancellation and backdated bank postings that would invalidate an approved snapshot. Finance reopens with a reason, retains the prior report and then reviews a replacement revision. Source and reconciliation mutations share the same accounting lock.

## Bank-only exceptions and source cancellation

An unmatched statement fee offers the existing bank-charge preview/editor with bank/date/reference evidence prefilled. Creation requires bank-charge create/submit permissions; ITC still requires the existing Finance documentary approval. Post a real charge voucher first, then explicitly match its actual bank GL. The statement link is unique across adjustment attempts, so repeat clicks or stale edits cannot create another charge. Both the statement identity and the existing charge-reference/invoice guards apply. No existing fee is posted twice merely because an invoice arrives later.

Interest or other unrecorded entries use an existing authorized manual journal, with statement provenance and exact bank movement. Trade, inventory, tax and operational dependencies retain their existing validation; reconciliation does not grant posting permissions or bypass source workflows. The first release creates no new automatic interest, tax remittance or customer/supplier adjustment flow.

Any attempted voucher/source reversal checks active allocations to its bank entry IDs before GL is written. Matched or approved source cancellation refuses and identifies the match/period to undo. Finance reopens a closed period when necessary, the authorized user reverses the match with a reason, then existing source cancellation can append its normal reversal. Matching/unmatching alone never posts or reverses GL, bills, stock or FIFO.

## Schema, services and permissions

Add a new migration after0019; never modify applied migrations. Scoped records cover bank profile and mapping revisions, baseline/opening items, statement import/batch membership and canonical movements, duplicate-review decisions, match groups/allocation effects/reversals, adjustment provenance and reconciliation period/report/reopen events. Mutable drafts are distinct from frozen submitted evidence. Use composite scope FKs where possible, immutable document/event triggers, unique file/bank transaction IDs, single reversal identities and capacity validation inside the accounting lock.

CSV parsing/normalization and signed reconciliation arithmetic are pure modules. Import service owns file/mapping/duplicate evidence; matching service owns candidate residuals and allocations; reconciliation service owns baseline, period reports and Finance approval. GL posting/reversal consults a narrow reconciliation dependency guard in the same transaction. Existing settlement and bank-charge services do not depend on import/UI services; no circular service dependency.

Register `accounts.bank_reconciliation.{read,create,submit,cancel,export,configure,approve}`. Accountant imports, confirms ordinary matches, exports and reverses unclosed matches; Finance additionally configures, approves baselines/duplicate decisions/net groups/closes/reopens. Auditor reads/exports; Stores has no reconciliation mutations. Current Administrator/read-only conventions remain. Adjustment posting always also requires the original voucher/bank-charge permissions. Every API and query enforces tenant/entity/account scope.

## User interface and verification

Accounts → Bank reconciliation contains account selection/settings, baseline review, statement import/mapping preview, match workspace, exception queue and dated report/history. Show mapping interpretation, duplicate decisions, source links, partial residuals, bank/book dates, gross/net components and reviewer before confirmation. Preserve original CSV descriptions without exposing them in notifications/logs. Exports escape spreadsheet formula prefixes. Mobile uses stacked statement/book panels and scoped previews; desktop supports selection/filtering and exact totals.

Verification must include parsing/sign/date/precision errors, repeated identical real rows, reordered/overlapping exports, stable-ID conflicts, multiple banks/entities, baseline outstanding signs and stale baseline activation, one-to-one/group/partial/net matches, future book/bank dates, approved report reopening, original/reversal candidates and stale previews. Actual two-waiter PostgreSQL barriers cover over-allocation, duplicate import/adjustment clicks and match-versus-source-cancellation in both orders. Match/unmatch must leave GL/bill/stock/FIFO counts and values unchanged; only authorized exception source creation changes GL exactly once. Prior0011–0019 hashes and preexisting activation states remain unchanged. Production browsers exercise CSV mapping, duplicate review, partial matching, exact report, permissions/source links and mobile state.

## Review checkpoint

Self-review checks: signed equation and date boundary examples consistent; initial balances do not replay old GL; duplicate ambiguity never guesses row identity; real net bank movement is authoritative; ordinary and Finance net matching are distinct; approved snapshots protected at the bank GL mutation boundary; import/match alone have no posting effect; permissions and currency/input limits explicit. No placeholder, numerical tax profile or live provider dependency.

Written spec and implementation plan approved2026-10-06; implementation is underway. Existing Native/default-branch preference carries forward; do not ask the execution method again. Bank feeds/Excel/foreign bank currencies, global period locks, later GST charge corrections and numerical TDS/TCS remain separate work.
