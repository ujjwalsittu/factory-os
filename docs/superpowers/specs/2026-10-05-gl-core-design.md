# GL core: controlled cut-over and operational posting

Status: proposed specification, ready for user review. Scope and the cut-over approach were approved in chat; implementation awaits approval of this written specification.

## Purpose and boundaries

FactoryOS becomes the books of record for each activated legal entity. An accountant can establish reconciled opening books, then trace every new stock movement or invoice to a balanced accounting voucher. Account groups and Dr/Cr presentation follow Tally conventions. Existing operational history remains intact and is not reconstructed into historical journals.

This implements slice 1d from `docs/ai/STATUS.md`, respecting decisions 008, 018, 019, 023, 024, 026, 028 and 030. It includes accounts, cut-over, manual journals, automatic postings, reversals, day book, account ledger and trial balance. Payments, receipts, bank reconciliation, Tally transport/import, tax returns, TDS/TCS, manufacturing output costing, consolidation and IRN/EWB remain their planned later slices. This is an accounting foundation, not a claim that statutory reporting is complete.

## Chosen architecture

Use one GL posting service inside existing database transactions. Pure posting builders produce decimal-string journal lines; the service validates and persists them. Existing stock, invoice and landed-cost services call it before committing their operational changes. A failed accounting check rolls back the entire operation.

An asynchronous posting queue would allow stock and accounting to disagree temporarily and complicate rollback. Separate manually booked summaries would duplicate entry work and lose document traceability. Neither is selected. Transactional posting follows the existing architecture in `docs/02-architecture.md`.

Migration creates the accounting schema, but never activates accounting, posts history or chooses a production cut-over date. Each entity's Finance user makes that choice in the UI after reviewing opening balances.

## Entity cut-over

1. Seed the default chart and configure account mappings. Accounting starts inactive; existing operations continue unchanged while it is inactive.
2. Prepare an opening worksheet with account balances and party/bill details in INR, plus original currency amounts/rates for foreign outstanding bills. Record whether an opening bill represents an existing FactoryOS invoice or an externally entered reference. An existing invoice may be linked only once and must belong to the entity and party.
3. Show a live reconciliation against company-owned stock value, unpaid submitted invoices and unbilled goods receipts. Existing payment functionality is absent, so the worksheet must explicitly state any settlements made outside FactoryOS; do not assume every old invoice is still unpaid.
4. The opening inventory control balance must equal current remaining FIFO value. Each debtor/creditor control balance must equal its opening bill/party details. GRNI must equal the declared unbilled receipt baseline. The accountant supplies the rest of the trial balance from the prior books; debit and credit totals must match without a hidden balancing plug.
5. Activation uses the current business date in Asia/Kolkata. Opening balances represent the state immediately before activation on that date, not a reconstruction of the previous midnight. Store the exact activation timestamp and a source snapshot. A future or historical date cannot be selected in this slice.
6. Acquire the same entity accounting lock used by operational submits/cancels, revalidate the reviewed snapshot and reconciliations, append one opening voucher, and activate in a single transaction. Reject a stale worksheet with a fresh reconciliation for review. Never silently replace a reviewed snapshot.
7. Once active, every new submission must have a posting date on or after the cut-over date. A previously created draft is new activity when submitted. Existing submitted documents remain historical and cannot be booked again merely by viewing or editing settings.
8. Prevent cancellation of historical submitted documents affecting opening books after activation. Explain that an accountant must record a reviewed current-date adjustment. Do not reverse a journal that does not exist or silently change stock beneath the opening balance. Cancellation before activation remains unchanged.

Activation cannot be switched off or repeated. The opening voucher cannot be cancelled after activation. Correct mistakes through current-date journals with reasons. Before activation, the worksheet is freely editable subject to its permissions.

The cut-over boundary is per entity. Azeonics and EarthNow may activate separately. Snapshot provenance and approval are audited. Selecting this approach does not authorize activation on dev or production during development.

## Accounts and storage

- `account_group`: tenant/entity scope, stable seed key, editable name, parent, root classification (asset, liability, equity, income or expense). Seed familiar Tally names such as Current Assets, Stock-in-Hand, Sundry Debtors, Sundry Creditors, Duties & Taxes, Bank Accounts, Cash-in-Hand, Sales Accounts, Direct Expenses and Indirect Expenses.
- `account`: tenant/entity scope, code, name, group, active flag and optional control role. Group accounts cannot receive entries. Prevent hierarchy cycles and account/group moves that would change the classification of posted balances. Referenced accounts can be deactivated, not deleted; mapping validation prevents deactivating required controls.
- `accounting_settings`: inactive/active state, activation date/time, immutable opening reference and versioned account mappings. Seed mappings for inventory, GRNI, debtors, creditors, sales, service purchases, production cost, COGS, stock adjustments, scrap expense, purchase-price variance, FX gain/loss, landed-cost clearing, GST input/output, RCM payable and RCM credit pending.
- `opening_worksheet` and details: editable reviewed balances, bill references, baseline receipt allocations and source snapshot. Store baseline quantities/costs separately from current remaining stock so later invoices can clear pre-cut-over GRNI even if those goods have already been consumed.
- `journal_voucher` and draft lines: document lifecycle, posting date, narration, numbering, source identity, creator/submission/cancellation audit fields. Source types distinguish manual journal, opening, stock entry, purchase invoice, sales invoice and landed cost. Preserve source document number and party/reference snapshots.
- `gl_entry`: append-only debit/credit rows with tenant/entity, voucher, account, posting date, party, bill reference, optional GST registration, source currency/rate, and reversal linkage. A posted entry has exactly one positive side; zero rows are omitted. Database constraints and the posting service enforce these rules.
- `receipt_invoice_allocation`: immutable evidence of the received quantity/base cost cleared by a purchase invoice, including opening-baseline allocations; cancellation appends reversal allocation records. Serialize allocations with existing PO-line locks.

Every stored monetary calculation uses `Dec` and PostgreSQL numeric, with strings at API boundaries. Store INR journal amounts at six fractional digits to preserve FIFO reconciliation. Tax/document amounts retain their existing two-decimal precision. Reports may display two decimals but must aggregate stored amounts first; export exposes exact underlying precision. No JavaScript floating-point money arithmetic.

Document-currency amounts and exchange-rate snapshots support traceability; all GL balancing is in INR. Use existing per-document INR rates and tax results. Do not recalculate tax from current HSN/master data when posting or reversing.

## Posting rules

### Stock

| Event | Debit | Credit | Source of value |
| --- | --- | --- | --- |
| Company-owned PO goods receipt | Inventory | GRNI | Actual receipt value at the PO exchange rate |
| Other company-owned receipt | Inventory | Stock adjustment clearing | Stored receipt value; explicit source narration required |
| Company-owned production issue | Production cost | Inventory | Actual FIFO consumption value |
| Company-owned sales delivery | COGS | Inventory | Actual FIFO consumption value |
| Company-owned scrap | Scrap expense | Inventory | Actual FIFO consumption value |
| Positive/negative stock adjustment | Inventory/stock adjustment expense | Stock adjustment clearing/inventory | Actual posted signed stock value |
| Transfer, inspection transfer, customer material receipt/issue/return/scrap | No GL | No GL | No company-wide valuation change |

For sales invoices, the generated delivery posts cost once and the sales invoice posts revenue/tax once. No second inventory or COGS posting in the invoice builder. Trace both vouchers from the sales invoice. Zero-valued movements require no monetary voucher but retain explicit posting disposition so missing accounting is distinguishable from intentional no-posting.

### Sales invoice

Debit the customer's Sundry Debtors control by the INR-converted invoice total; credit Sales by the INR-converted taxable value and the relevant output CGST/SGST/IGST/cess controls by stored tax amounts converted at the document rate. Exports under LUT have no output GST. Preserve the invoice's currency, rate, party and GSTIN snapshot. Any conversion rounding residual is explicit and deterministic; never change customer tax or grand-total figures to make a journal balance.

### Purchase invoice

For matched goods lines, debit GRNI for the original base receipt cost of the quantity being billed. Allocate against eligible submitted receipt lines in posting-date/source order, excluding quantities already allocated. Landed-cost additions never increase the amount cleared from GRNI. Pre-cut-over allocations use the reviewed opening receipt baseline.

Credit the supplier's Sundry Creditors control for the INR supplier liability. Debit eligible forward-charge tax to the corresponding input GST controls. For service/non-stock purchases, ineligible forward-charge tax debits non-creditable tax expense. For stock purchases it is an acquisition cost: allocate it over the matched receipts, capitalize the remaining-stock share and expense the consumed share through the existing landed-cost valuation mechanism, with recorded layer changes and cancellation guards. Do not expense recoverable tax or capitalize tax twice. Service/non-stock taxable purchases debit the configured purchase expense account. A goods invoice without linked receipts/PO cannot establish inventory value; refuse its submission when accounting is active, with guidance to link a receipt or use a non-stock expense item.

For matched goods, split the difference between receipt cost and billed taxable INR into purchase-price variance and FX variance. Using billed quantity Q, original PO rate P, invoice unit rate I, PO exchange rate R and invoice exchange rate S: price variance = Q × (I − P) × R; FX variance = Q × I × (S − R). Positive differences debit expense, negative differences credit expense. Apply existing decimal precision and an explicit residual line where document rounding differs. This preserves decision 026: invoice FX never revalues inventory. Service purchases have no receipt-rate baseline and therefore no artificial receipt FX variance.

For reverse charge, supplier liability excludes GST as already specified by the tax engine. Credit separate RCM payable controls and debit RCM credit pending if eligible, otherwise non-creditable tax expense. For ineligible RCM on stock purchases, use the same evidenced acquisition-cost allocation instead of immediately expensing the on-hand share. Pending RCM credit is not shown as available input credit. Settlement and movement to eligible input credit await the payments/compliance slice. Import-goods purchase invoices do not create customs IGST again; customs tax comes from the Bill of Entry/landed-cost voucher.

### Landed cost

Debit Inventory for the on-hand allocated share and Production cost for the already-issued variance, following decision 028. Credit landed-cost clearing for the total charge amount. Debit eligible customs IGST/cess to input tax controls and credit customs-tax clearing for the declared amounts. The voucher records cost/tax accruals; do not invent payments or credit a supplier without a payable document. Clearing accounts visibly remain in the trial balance until a future payable/payment or an explicitly linked manual journal clears them. Linked manual journals must not duplicate inventory/tax capitalization.

The current landed-cost schema must be checked during implementation for an explicit customs ITC eligibility flag. If absent, add it to the voucher boundary and UI; require the preparer to choose eligibility, rather than assume every customs amount is recoverable. Ineligible customs tax joins acquisition costs and is allocated between remaining inventory and the consumed share, using the same valuation evidence and guards as other landed charges.

### Manual journals

An authorized accountant creates a draft with date, narration and at least two valid debit/credit lines; submits only if total debits equal credits and all accounts belong to the active entity. A party is mandatory on debtor/creditor controls and a bill reference or explicit on-account reference is required. Inventory control cannot be changed through ordinary manual journals because it would break FIFO reconciliation; stock corrections use stock documents. Ordinary manual journals also cannot alter GRNI; corrections require a reviewed receipt/invoice workflow so journal balances and receipt allocations remain reconciled.

Manual journals can record balance-sheet and expense adjustments but are not a substitute for sales/purchase invoices where operational or GST documents are required. Accountants can link a manual voucher to a clearing source for traceability. Submission does not change the operational source's balances or statuses.

## Cancellation, concurrency and failure behavior

- Posted vouchers and GL entries cannot be edited or deleted. Source cancellation swaps the original debit/credit rows using recorded amounts/accounts, even if mappings or exchange rates changed afterward. Store a unique reversal-of reference and cancellation reason.
- Reversal posting date is the current Asia/Kolkata business date. Reversing an active-era source may retain the existing operational stock cancellation dating behavior; report stock-vs-GL comparisons as current cumulative balances until period/date-aware stock reversals are implemented. Do not present historic stock/GL date reconciliation as guaranteed in this slice.
- Preserve every existing stock cancellation guard, including decision 028. A failed stock reversal means no accounting reversal commits. A failed GL reversal means no source cancellation commits. Invoice cancellation must reverse any associated non-creditable acquisition-cost adjustment and obey its layer-movement guards. Refuse cancellation of a clearing source while an unreversed linked clearing journal remains; reverse that journal first.
- Lock accounting activation/mappings and lifecycle transitions consistently by entity, then existing document/item/PO locks. All submit/cancel paths acquire the entity accounting lock before item locks, preventing activation/posting races and mixed lock-order deadlocks.
- Unique tenant/entity/source/purpose constraints prevent duplicate automatic vouchers and duplicate reversals. A repeated request cannot create another ledger effect. A document with submitted status and no GL disposition after active-era submission is an invariant violation, not silently repaired on a GET.
- Mapping changes apply to future posts; existing entries remain unchanged. Reject missing mappings, cross-entity accounts, invalid amounts, dates before cut-over and stale opening snapshots with actionable validation errors.
- Every write and transition records an audit event in the same transaction. Direct operational permissions authorize the corresponding system-generated accounting voucher; users do not need manual journal permission merely to submit an allowed stock document.

## API and permissions

Follow existing entity gates, request context, Zod validation, scoped queries and database transactions. Add account master, accounting setup and report permissions to the catalog; reuse `accounts.voucher.*` for manual journals. Finance/Accounts roles receive appropriate read/create/submit permissions, Finance approval controls activation, and Stores/Sales retain only their existing operational rights. Never grant broad accounting permissions just to support generated postings.

Provide entity-scoped endpoints for groups/accounts, settings/mappings, opening worksheet/reconciliation/activation, journal list/detail/draft/submit/cancel, day book, ledger and trial balance. Report filters include date range, account, party and source as applicable. Export uses its own permission. All cross-entity references are validated server-side, even when request IDs are valid UUIDs.

Inactive entities can configure masters/opening books but cannot submit manual journals. Operational documents disclose accounting inactive; no automatic activation or journal occurs. Read-only viewers can inspect authorized reports but cannot change mappings or opening balances.

## Web experience

Add an Accounts section with Setup, Chart of accounts, Journals, Day book, Account ledger and Trial balance. Keep terminology familiar: Dr/Cr, ledger, voucher and narration. Use shared UI components and decimal-string formatting, responsive layouts and explicit empty/error states.

Setup shows reconciliation differences, excluded/historical documents, settlement declarations and the exact cut-over preview before activation. Activation requires deliberate submission with approval permission and displays its irreversible boundary. It is not part of onboarding defaults.

Journal entry supports keyboard movement, F7 to open a new journal in the Accounts workspace, Ctrl+Enter/Ctrl+A to save, and a clear unbalanced total. Submitted sources show links to their vouchers; journals show source and reversal links. Reports drill from trial balance to ledger to voucher, with entity/date preserved. Printing/export must identify entity, date range and INR precision. Mobile tables remain usable without page-level horizontal overflow.

## Verification and acceptance

1. Pure builder tests cover every posting rule, negative variances, six-decimal FIFO, document currency conversion, forward/RCM/customs tax, non-creditable taxes and zero-value exclusions. Sum of debits equals credits exactly.
2. Database/API smoke covers scoped permissions, chart validation, unbalanced journal rejection, activation stale-snapshot rejection, opening reconciliations, no historical replay, pre-cut-over cancellation refusal, post-cut-over draft submission and atomic rollback.
3. Exercise receipt → inspection → partial invoice across multiple receipts, including baseline receipts, and prevent over-allocation. Verify GRNI, debtor/creditor bill totals and inventory against source data.
4. Exercise sales submission with delivery, cancellation, changed mappings and repeated requests; assert exactly one COGS effect, exact reversal values and restored current stock/GL balance.
5. Exercise imports and landed cost before/after issue; check price versus FX variance, no duplicate customs tax, pending RCM credit and existing cancellation guards.
6. Race activation with source posting and concurrent partial invoices; neither stale openings nor duplicate allocations may commit.
7. Browser walkthrough covers chart, opening setup, activation, operational voucher drill-down, manual journal save/submit/cancel, trial balance, ledger, permissions and mobile behavior. Existing buying/selling walkthroughs run for inactive and representative activated entities.
8. Run build, typecheck, unit tests and relevant API/browser suites. Report that the current root lint command executes no tasks without treating that command as lint coverage. Update STATUS/LOG/MEMORY and commit/push only validated changes.

## Review boundary

Approval of this document permits writing the implementation plan. The plan will enumerate schema/service/UI work and verification, and the user selects execution before product code changes. No migration, dependency change, accounting activation or historical data mutation has been made while drafting this specification.
