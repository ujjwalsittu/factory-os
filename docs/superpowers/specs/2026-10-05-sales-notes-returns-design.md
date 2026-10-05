# Customer credit/debit notes and sales returns

Status: approved by the user on 2026-10-05. Implementation plan is awaiting review.

## Goal and sequence

Continue the roadmap on the repository's actual default branch. First deliver customer
credit/debit notes and physical sales returns, preserving the current invoice, stock,
GL and settlement implementation. Next design supplier notes/returns, then NIC
sandbox e-invoicing/e-way bills. Each slice must be verified before the next begins.

For Azeonics this corrects the value of goods already shipped; for EarthNow it adjusts
service invoices without inventing stock movements. Success means the customer sees
the correct outstanding balance while stock and the append-only books reconcile.

Accepted decisions 018, 022–024 and 029–036 remain binding. This document proposes
new behavior; it does not amend the accepted decision register until approved.
No shared entity is automatically activated, and no historical ledger is rewritten.

## Recommended approach and alternatives

Use dedicated, invoice-linked notes with explicit return evidence and typed bill
applications. This handles paid invoices and partial returns without confusing a
tax adjustment with cancellation of the original invoice.

Reusing invoice cancellation would undo the entire dispatch and fail for partially
paid or partially returned invoices. Using generic journals plus stock receipts would
lose invoice-line ceilings, tax snapshots and traceable original cost. Both are
rejected for this slice. Supplier returns are separate because they also touch
purchase matching, ITC, GRNI and import landed-cost evidence.

## Scope and boundaries

- One note references one submitted, active-era sales invoice in the same tenant/entity.
  Customer, GST registration and currency are inherited and cannot be changed.
- Credit notes: quantity-based goods/service credits or value-only reductions.
  Physical return is explicit and only available for stock items actually dispatched.
- Debit notes: value-only additions to the original supply, without another delivery.
  Ship additional goods using an invoice, not a debit note.
- INR and existing foreign-currency supplies are supported, including LUT exports.
  Notes use the original invoice exchange rate and tax snapshots; allocations consume
  each bill/credit at its own recorded carrying value.
- The first slice includes automatic credit application to the original open invoice,
  an unapplied-credit balance and later same-customer/same-currency application.
- Exclude customer bank refunds, supplier workflows, standalone/unlinked notes,
  opening/historical invoices, cross-party/cross-currency applications, replacement
  shipments, tax filing and live IRN/EWB calls. Paid invoices can receive credits;
  these remain customer credits until used, without moving cash.
- New notes require active accounting and source GL evidence. Inactive/historical
  invoices remain readable; the UI explains why a note cannot yet be submitted.

## Document and tax behavior

Lifecycle: draft → submitted → cancelled, using existing reason/audit conventions.
No number is allocated while drafting. Submission allocates the next per-GSTIN/FY
number atomically. Credit series retains accepted `AZ/CN/26-27/0001`; proposed debit
series is `AZ/DN/26-27/0001`, with the existing forward-only setup and 16-character limit.

The form starts from an invoice and retains original line IDs, HSN/SAC, tax rates,
place of supply, supply type, GSTIN/address and LUT evidence. It has a mandatory reason,
date and explicit tax treatment: GST-adjusting or commercial-only. Commercial credits
reduce revenue/receivable without reducing output GST. Debit adjustments use original
tax context; neither form fetches current master tax rates for a past supply.

For GST credits, enforce the statutory date ceiling (30 November following the supply
FY) and require Finance to confirm that the relevant annual return has not already
been filed and that the reduction is eligible. The existing application has no filing
state with which to prove this automatically; store that declaration and its actor as
evidence. A commercial note is available when a tax reduction is not claimed.
GST notes for a registration whose e-invoicing applicability has begun are blocked
until the IRN workflow is available; never issue an apparently complete statutory note
with a missing required IRN. Current FY 2026–27 precedes accepted applicability.

Ceilings are recomputed on submit under locks: total live credited quantity cannot
exceed original quantity; physical returned quantity cannot exceed dispatched quantity;
total credited taxable value cannot exceed original value plus submitted debit
adjustments. Credit tax components cannot exceed original components plus posted
debit tax adjustments. Debit notes must be positive and explicitly approved by submit
permission, with no artificial upper ceiling. Return quantity need not equal credited
quantity for a value-only or service credit; a physical return credit must identify
the corresponding quantities. No live note may reference a cancelled invoice.

Calculate money using Dec. Round statutory totals at the existing tax precision;
allocate original rounded components proportionally and take the exact residual on
final exhaustion. UI tax and ledger previews are server results, never local math.

## Stock return and cost

Returned stock is company-owned and carries the original item/batch/heat. Destination
is a scoped active warehouse selected by the user; recommend quarantine for goods
requiring inspection. Do not convert customer-owned material into company stock.
Returns do not reopen the original sales order's invoiced quantity; replacement sales
remain new invoices. The original invoice and dispatch stay immutable.

Map each returned invoice line to its original system-generated delivery ledger row.
Restore cost from that row's recorded issued value, not mutable FIFO layer rates.
Partial return cost is proportional to original issued quantity/value, tracking prior
live returns; the last return consumes the exact remaining issued cost. For example,
ten dispatched units with recorded cost INR 600 return four units at INR 240, with
INR 360 reserved for the remaining six, even if today's purchase rate has changed.

Create new inbound FIFO layers dated at the return, not a mutation of old consumption.
Persist immutable per-return quantity/cost evidence and original ledger references.
Use existing bounded six-place layer arithmetic; post any representational residual
to explicit rounding with evidence, and preserve stock-ledger/bin/GL reconciliation.
Stock GL debits Inventory and credits the original dispatch expense account. A
nonphysical credit or service note makes no stock posting.

Backdating remains refused when it precedes the item's latest movement. Cancelling a
physical return is refused if its stock layer has subsequently been consumed or
landed-cost-adjusted. Otherwise exact recorded quantity/value reversals are appended.

## Financial recognition and bill application

Credit recognition debits original revenue/output-tax accounts as appropriate and
credits the original debtor control. It creates an identifiable negative receivable
credit item, rather than silently reducing or recreating the invoice's original bill.
Debit recognition debits the original debtor control and credits original revenue/tax;
it creates its own positive receivable bill with the note date/due date.

Within the credit submission transaction, apply the lesser of note credit and original
invoice's open amount. Consume invoice and credit carrying values with existing
`consumeCarryingValue` arithmetic; any carrying difference posts to configured FX.
Same-account/equal-carry applications record a no-value disposition plus paired
immutable bill effects. Example: invoice 100, receipt 70, credit 40 → invoice open 0,
customer credit 10; retain the receipt unchanged. A fully paid invoice becomes a
customer credit for the whole note, without a negative invoice balance.

Extend typed later-allocation sources to admit a submitted note credit as well as a
receipt advance. Preserve existing settlementId APIs/drafts; add a mutually exclusive
credit-note source. Applications require one tenant/entity/customer/currency, positive
amounts, no duplicate target bills and no overapplication. Outstanding, ageing and
selling credit exposure include debit bills and net unapplied credits. Existing
six-place invoice balance endpoints remain unchanged and derive the adjusted balance.

Note recognition and typed applications write their own bill effects and are excluded
from generic GL synchronization to prevent duplicate effects. Existing GL-derived
invoice and journal effects remain unchanged. Every note/application records source
IDs, recorded accounts/values and reversal links. Reversals negate exact effects,
including both sides of an application and any FX journal.

Account remaps must not reroute corrections into unrelated controls. Validated note
corrections can use original inactive historical accounts with source evidence; manual
journals and inactive cash/bank guards remain strict. This narrowly scoped behavior
must be explicitly covered by tests, not enabled by a general validation bypass.

## Storage, transaction and cancellation

Add a descriptive migration after shared 0011; do not rename, replace or replay it.
New scoped note header/line tables hold original invoice/line references, kind,
tax treatment, statutory snapshots, currency/rate, totals, reason and lifecycle.
An append-only return evidence table records source delivery row, qty, value, inbound
row/layer and reversal references. Reuse trade_bill/effect and compatible allocation
documents rather than inventing another balance store. Preserve old allocation rows
and populate new optional source columns through an additive migration.

Submission lock order is accounting entity → note → source invoice → existing item
locks in deterministic order. Revalidate source, dates, ceilings, GL/subledger
reconciliation, permissions and stock evidence inside the transaction. Numbering,
stock, GL, paired effects, lifecycle and audit either all commit or all roll back.
Preview does not reserve quantities or numbers. Concurrent submissions cannot exceed
invoice value/quantity ceilings or spend the same customer credit twice.

Prevent source-invoice cancellation while any live note references it. Prevent note
cancellation until later credit applications/debit settlements are reversed. On credit
cancellation reverse its automatic original-invoice application, then recognition,
then any return movement, as one atomic operation. Restore released ceilings. A
return that cannot be reversed leaves all financial and document state untouched.
Dates use current Asia/Kolkata reversal rules and cannot precede recorded dependencies.

## API, permission and UI boundaries

Dedicated scoped sales-note service/controller: list/read/create/update/delete draft,
preview, submit, cancel and invoice-derived eligible-line data. Zod validates every
boundary; responses use decimal strings and scoped UUID source identities.
Read/create/update/submit/cancel permissions are registered in the existing catalog.
Follow existing selling role assignments and Finance accounting access; no new global
role or implicit privilege escalation. Invoice read alone never permits note submit.
Application actions require existing accounting allocation privileges and note visibility.

Sales navigation gains Credit/debit notes; invoice actions offer Create credit/debit
note. The form shows immutable original values, prior credits/returns and remaining
ceilings, separates financial adjustment from physical return, and previews GST,
stock cost, invoice application and residual customer credit before submit.
Submitted documents link invoice, return movement, GL and later applications.
A4 print includes note type, own number/date, original invoice reference, tax treatment,
reason, statutory snapshots, currency and LUT declaration where relevant. Commercial
notes are explicitly labeled so they cannot be mistaken for GST tax adjustments.

Invalidate exact scoped invoice balances, notes, stock, open bills, outstanding and
credit queries after lifecycle/application actions. Refetch on remount where freshness
matters; preserve existing draft autosave and cancellation-reason behavior.

## Verification and next-phase readiness

- Core: original rounded tax residuals, partial/final return cost, carrying allocation,
  foreign-rate differences and exact reversal arithmetic.
- PostgreSQL: migration from shared0011 with existing settlements; scope/permission
  isolation; partial/paid/unpaid invoice credits; debit settlement; commercial vs GST;
  service vs physical return; cumulative ceilings; same/different historical accounts;
  LUT foreign notes; inactive/historical refusals; dependent cancellations; no duplicate
  sync; reconciliation; transaction rollback; racing notes/applications.
- Stock: original cost despite changed rates, multiple FIFO consumptions, batch/owner
  isolation, quarantine returns, later issue/landed-cost cancellation guards and rounding.
- Browser: invoice → draft note → preview → submit → balances/print → apply residual
  credit → reverse dependency → cancel; debit path; mobile; no stale balance on navigation.
- Existing selling/buying/import/accounting/settlement regressions, build/typecheck/unit
  checks; report that lint currently has zero configured tasks.

After approval, write a dependency-ordered implementation plan and execute Native per
the user's existing preference, followed by one independent review and fix pass.
Supplier-return design follows this slice's verified delivery. NIC sandbox design
then covers provider credentials per GSTIN, applicability, idempotent requests, signed
response storage, statutory printing, cancellation/retry and EWB dispatch details.
Provider access and tax eligibility remain explicit business inputs, not assumptions.
