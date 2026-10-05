# Supplier notes, return claims and purchase returns

Date: 2026-10-05 (Asia/Kolkata)
Status: Approved by the user on 2026-10-05; implementation plan awaiting review.
Execution preference: Native, on the default branch, as previously selected.

## Intent and approved scope

Let Buying, Stores and Finance record supplier-issued credit/debit notes and our
own return claims, including goods dispatched before supplier acceptance. Preserve
the existing purchase matching, FIFO, immutable accounting and payment workflows.
Success means every financial adjustment, physical return and unresolved claim is
traceable without duplicating stock, changing old postings or hiding a loss.

The user approved supplier-issued notes first, inclusion of our own claims,
dispatch before acceptance with separate pending-return carrying value, partial
acceptance, explicit rejection resolution, dependency-aware cancellation, and
four configurable entity policies. Claims alone change neither AP nor ITC.
Shared entities stay inactive until Finance activates their books. No live tax
provider integration, migration rewrite or shared-data activation is authorized.

## Approach

Use separate linked claim, physical movement, supplier note and credit-application
documents. Their transactions share the existing entity accounting lock and source
identities. This supports supplier acceptance after dispatch and multiple partial
responses without treating our claim as a supplier tax document.

Requiring acceptance before every dispatch would simplify pending-value accounting
but restrict actual returns; offer that as a policy instead. Generic journals plus
ordinary stock issues would lose claim identity, ceilings and duplicate protection;
do not use that approach. Reuse decimal, GL, bill, FIFO and audit services through
focused adapters rather than changing the customer-note workflow.

## Entity policies

Finance alone edits settings, with before/after audit evidence. Defaults:

| Policy | Options | Default |
| --- | --- | --- |
| Dispatch approval | Pending acceptance allowed / supplier acceptance required | Pending allowed |
| Claim approval | Every claim / amount above configured INR threshold | Every claim |
| Credit application | Automatic to original invoice / manual allocation | Automatic |
| Rejected balance action | Keep open / request goods back / propose write-off | Keep open |

Thresholds are nonnegative decimal INR strings; convert foreign claims at the
original invoice rate. Above-threshold means strictly greater; zero-value claims
still need approval under the every-claim policy. Settings changes do not rewrite
posted documents. Snapshot policies at claim submission or note posting; changing
a submitted claim's financial/dispatch instructions requires a new approval under
the current policy. Finance-approved write-off is required under every configuration.
Accounting locks serialize policy changes with affected posting operations.
Valuation, tax eligibility, scoped identities and exact reversals are mandatory.

## Sources and document identity

First slice requires a submitted active-era purchase invoice with original GL
evidence, one supplier, currency and entity. Historical or ambiguous sources refuse
posting with an actionable message; no historical replay. Claims reference invoice
lines; stock returns additionally reference original receipt allocations and batch.
Unbilled-receipt returns, cross-party and cross-currency netting are outside this slice.

Supplier notes store supplier number/date, kind, original invoice, reason, tax
treatment and component amounts. Credit reduces AP; debit increases AP. Supplier
numbers are not our outward CN/DN series: allocate a separate internal voucher
number and detect case-insensitive supplier-note duplicates by supplier, kind and
supplier financial year. Internal claims and return challans have separate numbers.
Capture seller/supplier, buyer GST/address, currency/rate and source snapshots.

## Claims and physical lifecycle

Draft claims are editable; submitted claims preserve the requested quantities and
values. Approval, dispatch, supplier response and resolution are separate audited
events; derive requested, dispatched, partially accepted, resolved and rejected
labels from remaining quantities/amounts rather than a single mutable state flag.
Supplier notes may be recorded without a claim, or linked to a claim's accepted
portion. Never equate a response with physical movement.

Stores may dispatch only approved, unreturned company-owned stock of the original
item/batch from a scoped warehouse. Quarantine/MRB returns are allowed through this
dedicated return purpose without enabling ordinary issues from those warehouses.
Check warehouse quantity, original invoiced/receipt-linked return ceilings, and
existing FIFO rules under locks. Consumed or unavailable stock cannot be returned.

Keep chronological FIFO per entity/item/batch (decisions018/022), including current
recorded landed/acquisition costs. Receipt linkage supplies provenance and ceilings;
it must not silently cherry-pick a newer cost layer against FIFO. Persist exact
consumed layer IDs, quantities, rates and ledger values. Dispatch debits pending
supplier returns and credits the actual inventory account; no AP/ITC posting.
Zero-cost goods still generate real quantity evidence and a no-value disposition.

For example, dispatch of goods carrying INR600 for a requested INR700 claim moves
INR600 to pending returns. A later supplier note resolves the accepted portion,
with the difference shown explicitly. Split carrying value proportionally for
partial resolutions; the final portion takes the exact remaining residual.

Rejected claims remain visible. Requesting goods back creates no receipt until
Stores confirms arrival; receipt uses the remaining recorded pending carrying
value, original item/batch and an explicit destination, with a new inbound layer.
A Finance-approved write-off debits return variance/loss and credits pending
returns. Never automatically write off, fabricate goods arrival or cancel a real
dispatch because the supplier rejected a financial claim.

## Supplier note recognition and tax

Use original currency and exchange rate, original AP account and per-component
tax evidence. Foreign credit balances retain carrying INR; later allocation
recognizes actual FX differences separately. No arbitrary client account override.
An inactive original account is usable only through verified correction evidence.

GST-adjusting notes reverse/increase original eligible input components with
bounded printed-component residuals. Commercial adjustments leave ITC unchanged.
Require Finance's documented eligibility confirmation and supplier statutory
reference; do not claim GSTR-2B/IMS verification before that integration exists.
A supplier debit does not automatically make additional ITC eligible. Commercial
debits cannot enlarge a GST credit ceiling. Original non-creditable tax remains
a cost component, never becomes eligible ITC through a note.

Imported supplier notes adjust supplier consideration, not Bill-of-Entry customs
ITC. Customs and RCM tax liability/settlement changes are separate workflows;
refuse GST-adjusting note submission for these unsupported paths, permit commercial
supplier adjustments, and disclose the reason before submission.

For linked dispatched quantities, credit recognition clears pending carrying value,
posts eligible tax adjustment, reduces AP and sends the explicit consideration/cost
difference to purchase-return variance. A note without dispatched goods changes
purchase adjustment/variance (or the original service purchase account), not stock.
Do not silently revalue FIFO for a value-only discount. Additional stock acquisition
cost revaluation is outside this slice; show that limitation in the preview.
Debit notes create additional payable consideration using the matching adjustment
accounts and explicitly eligible tax. Recognition never reposts physical dispatch.

Track independent financial, GST-component, claim acceptance and physical quantity
ceilings. Previously dispatched and accepted amounts cannot be spent again. A
financially accepted portion can precede its dispatch when policy requires acceptance;
until physical movement it posts a financial adjustment, and subsequent dispatch
clears pending value through an explicit return-variance disposition rather than
recognizing the supplier note again. Server preview exposes this sequence.

## AP application and payments

Recognize each supplier note as its own exact bill identity. Credit is available
even when the original invoice has been fully paid. Automatic application uses
only the original invoice's remaining positive balance; residual remains supplier
credit. Manual policy leaves the full credit available for Finance allocation.
Later allocation uses exact bill UUIDs, same supplier/currency/AP account, positive
bounded amounts and each bill's recorded carrying value. Equal carrying may use
no-value disposition; FX posts separately. Existing supplier payments and allocation
contracts remain compatible; additive source typing must not reinterpret old rows.
Refund receipts, cross-party netting, TDS/TCS and RCM settlement remain separate.

## Purchase matching and cancellation

Keep original PO received/billed counters and immutable receipt-invoice allocation
evidence intact. Record returned and credited quantity as separate evidence, expose
gross received/billed and net retained in the workspace, and do not free quantity
for duplicate invoicing or automatically reopen a PO. Replacement purchases use
new explicit purchasing documents.

Each submit/cancel locks accounting before documents/items, revalidates source,
settings, ceilings, availability and all dependencies, then appends GL/bill/stock
and claim evidence atomically. Any failure leaves all ledgers and statuses unchanged.
Draft deletion only; posted corrections use exact signed reversal evidence.

Block original invoice/receipt cancellation while live claims, dispatches or notes
depend on them. Reverse later credit applications before cancelling their source
note. Payments dependent on debit notes must be reversed first. A debit cannot be
cancelled if later credits used its ceiling. Reversing supplier acceptance restores
claim/pending balances but does not pretend goods came back. Dispatched goods
return through a receipt unless cancelling a mistaken movement is safe under the
existing consumption/landed-cost guards. No claim cancellation can erase dispatched
or resolved quantities. Write-off and received-back resolution reversals likewise
check subsequent stock and financial dependencies.

## Architecture, access and UI

Add scoped claims/lines, supplier notes/lines, entity policy settings and append-only
return/acceptance/resolution evidence through descriptive additive migrations.
Use composite scoped FKs/checks and exactly-one-source credit allocation typing.
Focused services own preview, claim approval, stock dispatch/receipt, note posting,
AP application and resolution; controllers validate strict Zod boundaries.

Buying gains Return claims and Supplier notes with invoice shortcuts. Show original
values, remaining ceilings, policy/approval state, supplier response, pending carrying
value and unresolved difference. Server previews precede mutation; scoped refresh
keeps invoice/outstanding/stock views current. Submitted documents link source,
stock, GL and allocations. Claims print as claims, never supplier tax credit notes.
Supplier-note print reproduces recorded supplier references and tax treatment.

Separate prepare/read, Finance approve/submit/allocate/resolve/cancel, Stores
dispatch/receive and Finance settings permissions. Default roles follow these
responsibilities, with tenant-defined role assignments supported. Rejections use
field errors for invalid input, scoped404 for inaccessible sources and409 for live
state/dependency conflicts. Failed actions never report success or retry silently.

## Verification and delivery

Verify partial/final residuals, claim policy thresholds, GST/commercial ceilings,
original account snapshots, zero-value and foreign carrying values with unit tests.
API integration covers pending dispatch, acceptance before/after dispatch, multiple
partial responses, rejection/write-off/received-back, landed costs, mixed FIFO layers,
quarantine, unavailable stock, paid invoices, manual/automatic allocation, duplicate
supplier numbers, permissions/tenancy, policy edits and exact cancellation rollback.
Real lock-barrier tests cover competing last returns, acceptance, credit application
and cancellation. Browser checks cover all three roles, settings, partial lifecycle,
printing, mobile layout, rejection and foreign notes. Run existing buying/imports,
inventory, accounting, settlement and customer-note regressions plus root build,
typecheck and unit tests; disclose the repository's zero-task lint coverage.

After written-spec approval record the accepted business decision and write a
reviewable implementation plan. Execute Native only after plan approval, claim
before product code, review once and fix verified findings, then update handoff
files and normally push the complete verified slice to the default branch.
NIC sandbox remains the following separate phase.
