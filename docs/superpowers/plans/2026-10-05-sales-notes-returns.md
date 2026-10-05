# Customer Notes and Sales Returns Implementation Plan

**Goal:** Deliver invoice-linked credit/debit notes, original-cost returns and customer-credit application.
**Architecture:** Dedicated note lifecycle orchestrates existing stock/GL/bill services in one transaction. New immutable return evidence preserves historical dispatch cost; typed applications extend existing receipt-advance allocation without replacing its API.
**Tech stack:** TypeScript, NestJS, Zod, Drizzle/PostgreSQL, Dec, Next.js, shared UI and Playwright.
**Spec:** [Approved design](../specs/2026-10-05-sales-notes-returns-design.md).
**Execution:** Native, already selected by the user. Written plan confirmed; execute the approved customer slice.
**Agent tooling note:** Use executing-plans for Native execution where available. The tasks/interfaces below are provider-neutral; no particular assistant or tooling is required.

## Global constraints

- Work on default branch `claude/zealous-allen-35g1vm`; fetch first and preserve others' commits. Claim before product code, commit logically, push only verified working slices. No force-push or hook bypass.
- Preserve shared `0011_settlements.sql`; generate additive descriptive migration0012, with no Native-schema interchange. Node22+, pinned pnpm10.28.0; no dependency upgrades.
- One original submitted active-era invoice, same tenant/entity/customer/GSTIN/currency; inactive/historical note submission refused. No automatic entity activation.
- Credit `AZ/CN/26-27/0001`, debit `AZ/DN/26-27/0001`, per GSTIN/FY, forward-only and at most16 characters. Number allocated on submit only.
- Exact decimal strings; statutory component totals at existing two-place tax precision and GL/stock carrying values at six places. Final exhaustion consumes recorded residuals.
- Original tax/currency/cost/account evidence; no historical ledger rewrite or blanket inactive-account bypass.
- Accounting lock before document/item locks; immutable effects/reversals; preview reserves nothing. Future/backdated/dependency dates checked on submit.
- Customer-only slice: no supplier returns, refunds, unlinked/historical notes, cross-currency/cross-party applications, replacement shipments or live IRN/EWB. GST notes blocked after IRN applicability until provider workflow exists.
- Smoke/e2e defaults API4000/web3000; accept API, WEB_ORIGIN, WEB_URL. Local fixtures only. Wait12 seconds between fixture suites; preserve failures and process exit codes.

## Review focus

1. Value-only credit followed by physical-return credit must not spend original value twice; enforce independent financial and returned-quantity ceilings (Tasks2/4).
2. A delivery's consumed FIFO layer can later change rate; returns use the recorded delivery value and final cost residual (Task3).
3. Old allocation drafts/rows must still work after introducing a nullable receipt source and a note source (Tasks1/4).
4. Duplicate display numbers across GSTINs or customer bills must never match note applications by text reference (Task4).
5. Cancel fails after returned stock is used; invoice balance, bill effects, GL and note status must all remain unchanged (Task5).

## File and interface map

- `packages/db/src/schema/sales-notes.ts`: new header/line/return evidence tables; export from schema/index. Existing settlements schema adds optional note source; inventory schema adds internal `sales_return` purpose.
- `packages/core/src/sales-notes.ts`: rounded tax-share and original return-cost functions; export from index and test in sales-notes.test.ts.
- `apps/api/src/modules/sales-notes/{sales-notes.contracts,sales-note.service,sales-note-preview.service,sales-note-posting.service,sales-return.service,sales-notes.controller}.ts`: boundaries, lifecycle, preview, GL/effects, stock and HTTP respectively.
- Existing stock-posting/operational-postings expose internal exact-cost return support, without opening public arbitrary-cost receipts. Existing accounting/bill and settlement services retain authoritative balances/application arithmetic.
- `apps/web/src/lib/sales-notes.ts` and components `sales-note-{form,list,print}.tsx`: DTOs, editor, list, statutory print; new `/app/selling/notes` pages. Modify existing invoice action, shell/command navigation and settlement allocation controls only where needed.
- API tests: `smoke-sales-notes-{schema,lifecycle,returns,allocations,concurrency}.mjs`, using accounting-test-helpers. Browser: `apps/web/e2e/sales-notes.mjs`.

Shared contracts in `sales-notes.contracts.ts`:
`NoteKind = 'credit' | 'debit'`; `TaxTreatment = 'gst' | 'commercial'`.
`NoteLineInput = { invoiceLineId:string; mode:'quantity'|'value'; qty?:string; taxableAmount?:string; returnQty?:string; warehouseId?:string }`.
`NoteDraftInput = { invoiceId:string; kind:NoteKind; postingDate:string; dueDate?:string; reason:string; taxTreatment:TaxTreatment; taxEligibilityConfirmed?:boolean; lines:NoteLineInput[] }`.
`NotePreview = { currency:string; exchangeRate:string; taxableValue:string; cgst:string; sgst:string; igst:string; cess:string; grandTotal:string; returnValueInr:string; applyAmount:string; remainingInvoiceAmount:string; unappliedCredit:string; lines:NoteLinePreview[]; ledgerLines:AccountingLine[]; limits:NoteLineLimit[] }`.
`NoteLinePreview` extends line input with calculated tax components and six-place return cost. `NoteLineLimit` identifies source line and remaining creditQty/taxableValue/tax components/returnQty/returnValueInr. All scoped service signatures use existing `Tx`, `TenantRequestContext` and entityId; UUID identities, never reference-text matching.

---

### Task1: Additive persistence and upgrade safety

**Files:** create sales-notes schema and schema smoke; modify inventory/settlements/schema index, permissions/roles; generated migration0012 and metadata.
**Produces:** `salesNote`, `salesNoteLine`, `salesReturnEffect` exports; nullable settlementId plus nullable creditNoteId with exactly-one-source CHECK on allocation documents. Existing rows retain settlementId unchanged.

- [x] Write schema fixture asserting upgrade preserves submitted receipt, allocation and their effects; note header/line/return scopes and cross-source FK references exist; both/neither allocation sources violate CHECK; return evidence UPDATE/DELETE refused.
- [x] Run `node --env-file=.env apps/api/scripts/smoke-sales-notes-schema.mjs`; observe missing tables/source support before migration.
- [x] Define headers with originalInvoiceId, kind/treatment, inherited snapshots, rates/totals, eligibility declaration/actor, original recognition voucher references, credit/debit billId, return stockEntryId and existing lifecycle. Lines store source line, mode/quantity/value, returnedQty and calculated components. Return effects store source ledger seq, original qty/value, returned qty/value, inbound ledger/layer and reversalOf. Enforce scoped uniqueness/checks and append-only evidence trigger, not header immutability.
- [x] Add internal sales_return enum; prevent selecting it through generic stock CRUD. Catalog `selling.sales_note.{read,create,update,submit,cancel}` using current selling/Finance role patterns; no new global role.
- [x] Run `pnpm --filter @factoryos/db db:generate --name sales_notes_returns`, build DB and apply migration to local shared DB. Confirm0011 byte-identical, existing rows unchanged, schema fixture green; typecheck affected packages.
- [x] Commit `Add scoped sales note and return evidence storage`.

### Task2: Exact calculation and eligibility preview

**Files:** core helper/test/index; note contracts/preview service/controller/app.module; lifecycle fixture preview cases.
**Consumes:** Task1 exports. **Produces:** `calculateReturnCost(input:{originalQty:string;originalValue:string;returnedQty:string;returnedValue:string;qty:string}):string`; `allocateNoteComponents(original:TaxComponents,remaining:TaxComponents,share:string,total:string,final:boolean):TaxComponents`, where TaxComponents contains taxableValue/cgst/sgst/igst/cess decimal strings. `gstCreditDeadline(invoiceDate:string):string` returns the30November date after the invoice FY. `SalesNotePreviewService.previewIn(tx,ctx,entityId,input:NoteDraftInput):Promise<NotePreview>`.

- [x] Core tests: cost10/600, return4→240 and final6→360; fractional components total0.01 split across3 applications never exceed0.01 and final sum equals original; over-return/negative/duplicate line rejected. Commercial credit tax components all0.
- [x] Run `pnpm --filter @factoryos/core test`; observe missing helper failures. Implement using Dec/allocateProportion/consumeCarryingValue; no floats or independent rounding at each intermediate operation.
- [x] API preview tests: regular intra/interstate GST, services, LUTUSD, paid invoice100/receipt70/credit40 gives application30/residual10; commercial credit leaves outputGST unchanged; value credit then return cannot exceed financial ceiling. Core date tests pin invoice2026-10-05 deadline2027-11-30; the prior-activation API fixture accepts November30 and rejects December1 using explicit dates; API declaration false and IRN-applicable registration fail; commercial mode remains available where appropriate. Out-of-scope IDs404, inactive/historical sources409.
- [x] Preview loads scoped invoice/lines, original delivery/GL, live notes and returned-cost evidence; derive independent remaining ceilings. Quantity mode uses original line pricing; value mode uses entered taxable reduction/addition. Debit mode is value-only, positive, has default dueDate=postingDate unless explicitly supplied; credit dueDate absent. Reject mixed mode fields, duplicate lines, zero values and inconsistent returnQty>creditQty. Inherit all tax/currency snapshots; same note-date vs source-date rules as design.
- [x] Register preview route/providers early for fixture use; build affected packages, restart only own API session, run core tests and lifecycle preview fixture to green, then commit `Calculate original-value note and return previews`.

### Task3: Exact-cost inbound sales return

**Files:** sales-return.service, stock-posting, operational-postings, stock DTO purpose label; returns fixture.
**Consumes:** Task2 calculateReturnCost and scoped source ledger. **Produces:** `SalesReturnService.postIn(tx,ctx,entityId,noteId:string,previewLines:NoteLinePreview[]):Promise<{stockEntryId:string|null;valueInr:string}>` and `cancelIn(tx,ctx,entityId,noteId:string,reason:string):Promise<void>`.

- [x] Returns fixture dispatches10 units at recorded600, changes master/current FIFO rates, returns4→240 then6→360. Assert company ownership, original batch, chosen warehouse, new-layer date and ledger/bin/GL value; original delivery/consumption unmodified. Test service/value-only note makes no stock entry, cross-entity destination404, backdated note input400, quarantine stock not issuable.
- [x] Build the API and run the returns fixture through authenticated note orchestration. Document the original broad stock test's missing initial RED cycle; focused return defects require RED→GREEN. No temporary public posting endpoint is introduced.
- [x] Add internal exact-cost inbound path restricted to authenticated note orchestration. Generated entry purpose=sales_return, readonly original invoice reference; generic stock APIs reject creation/edit/cancel of this purpose/system-generated document. Determine direction inbound and create new layers using existing bounded layer arithmetic, persisting exact cost/residual evidence. Operational GL handling for sales_return must not also execute the generic adjustment posting: route it once through note return accounting.
- [x] Resolve original Inventory/COGS accounts from source delivery GL and use exact recorded expense account. Record explicit rounding residual instead of negative consumption or stock value mismatch. Implement exact reversal and reject layer-consumed/landed-cost-changed cases.
- [x] Run returns fixture plus inventory and selling smoke with normal rate-limit spacing; typecheck; commit `Restore sales return stock at recorded dispatch cost`.

### Task4: Atomic note recognition, submission and credit applications

**Files:** note posting/service/controller, app.module, bill sync exclusions, GL original-account validation, invoice cancellation guard, series controller; lifecycle fixture.
**Consumes:** Tasks1–3. **Produces:** `SalesNoteService.submitIn(tx,ctx,entityId,id:string):Promise<SalesNote>`; `SalesNotePostingService.recognizeIn(tx,ctx,entityId,note:SalesNote):Promise<{voucherId:string;billId:string}>`. SalesNote is exported DB inferSelect type; no wire-only fake persistence type.

- [x] Lifecycle tests assert complete draft→submit for credit/debit; ownGSTIN/FY numbers gapless, ≤16 chars; duplicate submits409. Credit100/70/40 example reconciles GL/subledger with original invoice0/customer credit10. Debit25 creates note bill25 and no stock, settles through existing receipt API. ForeignUSD100@80, paid70, credit40@original80: remaining invoice0/creditUSD10 carryingINR800. Changing display references cannot change applied bill identity.
- [x] Run lifecycle fixture against unimplemented submission; observe404/unsupported behavior, not auth/fixture failure.
- [x] Implement scoped CRUD/read/eligible-lines/preview/submit routes at `/sales-notes`; readonly totals server-derived. Lock accounting→note→source invoice→item locks; rerun preview/reconciliation inside transaction. Allocate GSTIN/FY CN/DN series via existing allocator; never consume numbers on rejected submit.
- [x] Recognition uses source revenue/tax/control accounts and original rate; create debit bill(kind=bill) or credit item(kind=journal_credit). Exclude `sales_note` and `sales_note_application` sources from generic GL→effect sync and write uniquely keyed note effects directly. Do not overload ordinary invoice sources or match billReference text.
- [x] Implement the credit-application interface defined below before enabling submission; recognized credit is not presented as completed automatic application until paired effects exist. Atomic return/recognition/application/audit is required for the endpoint.
- [x] Narrow original-account validation verifies supplied original source voucher under tenant/entity; only accounts actually on that voucher are eligible for note correction. Tests cover remapped inactive recorded control/revenue and reject arbitrary inactive account/bank. Live notes block source invoice cancellation even if no invoice balance remains.
- [x] Complete the application steps below, then verify the whole submission transaction before committing this deliverable.

#### Credit application steps and legacy receipt compatibility

**Files:** settlement.service/controller, bill.service, note application service; settlement DTOs; allocations/concurrency fixtures.
**Consumes:** Task1 source columns, Task4 bill recognition. **Produces:** `CreditApplicationService.applyIn(tx,ctx,entityId,input:{creditNoteId:string;postingDate:string;allocations:readonly {billId:string;amount:string}[];sourceId:string;automatic:boolean}):Promise<{voucherId:string|null;appliedAmount:string}>` and `reverseIn(tx,ctx,entityId,sourceId:string,reason:string):Promise<void>`.

Implement recognition, then applications, then enable complete submission. These are one task and one reviewed deliverable; do not push a partially working submit route.

- [x] Tests assert automatic application original open bill only; residual credit can apply to another same-customer/currency invoice; old settlementId-only draft allocation still submits unchanged. Reject both source IDs, neither, other tenant/customer/currency, duplicate targets, future target, overdraft and spent credit. Read-only operational role cannot allocate.
- [x] Foreign test creditUSD10/INR800 applied to billUSD10/INR830 gives note credit0, target0 and FXloss30; final partial applications consume exact carrying remainder. Same account/value produces no GL voucher but paired immutable effects/disposition.
- [x] Run allocations fixture to confirm new source rejected while legacy source still works. Factor only the existing shared allocation arithmetic needed for source resolution; retain receipt API and supplier behavior. Note sources resolve submitted note UUID/bill identity, not partySettlement rows.
- [x] Extend Zod source union and list/read DTOs compatibly; paired application effects consume negative credit magnitude and positive target; historical controls use recorded accounts. Existing outstanding/credit exposure includes new note credit/debit kinds without extra balance columns.
- [x] Wire Task4 automatic application in same transaction. Run lifecycle+allocations, old93 settlement checks, operational invoice-balance scopes and duplicate-reference regressions; commit `Submit customer notes and apply credits atomically`.

### Task5: Reversals, stock dependencies and real races

**Files:** note service/controller, credit application service, bill dependency labels, selling source guard; returns/concurrency fixtures.
**Produces:** `SalesNoteService.cancelIn(tx,ctx,entityId,id:string,reason:string):Promise<void>`; all source/application cancellation messages name scoped dependent documents.

- [x] Test note credit cancellation reverses automatic application→recognition→stock atomically; cancelled note releases ceilings and number stays reserved. Debit with receipt and credit with later allocation refuse cancellation until dependency reversals. Source invoice with live note always refuses cancellation.
- [x] Issue returned stock, snapshot note/bills/ledger/GL, attempt cancel409, assert every snapshot unchanged. Add landed-cost-adjusted return guard; role/date/scoping guards unchanged.
- [x] Use real concurrent clients/PG barrier: two credits attempting last available value, two physical returns attempting last qty, duplicate submit, concurrent note cancel/payment and shared residual-credit spend. Exactly one incompatible operation succeeds; rollback creates no number gaps/effect duplicates; GL/subledger/stock reconcile.
- [x] Run failing tests; implement guards/exact recorded reversals without deleting effects or restoring at current rates. Preserve existing accounting lock ordering; never weaken locks to get tests green.
- [x] Run returns/concurrency/lifecycle plus existing accounting-lock-order and accounting-concurrency tests. Commit `Guard note reversals and concurrent return ceilings`.

### Task6: Operational notes UI, applications and print

**Files:** note DTO/forms/list/print and `/app/selling/notes/{page,new/page,[id]/page,[id]/print/page}.tsx`; selling-form actions, app-shell/command palette, settlement-form controls, invoice-balance invalidation; browser fixture.
**Consumes:** Tasks2–5 endpoints/DTOs and typed application source union.

- [x] Browser test starts from submitted invoice, creates return credit, verifies server tax/cost/application preview, submits, checks source/current balances and print. Receipt70/invoice100/credit40 shows residual10; apply10 to another invoice, reverse dependency and cancel note. Add debit/service/commercial/LUT cases, mobile and read-only roles.
- [x] Run production browser fixture; confirm absent route/actions are the failure. Build dedicated form with existing shared UI, original readonly invoice context, financial mode vs physical return inputs, ceilings, reason/eligibility declaration and server previews. Permission-gate mutations; no autosave races or local tax calculation.
- [x] Applications distinguish Receipt advance vs Credit note, preserving existing draft receipt layouts. Submitted links show source invoice, own credit/debit bill, return/GL/applications. Stock actions cannot bypass note lifecycle.
- [x] Print A4 statutory snapshots, original invoice reference, note/date/reason/tax fields/currency/LUT; explicit commercial-note label. Preserve original invoice print unchanged.
- [x] Invalidate scoped note/source-invoice/bills/outstanding/stock/credit queries after mutations; mount refresh remains current. Browser navigation back after note/application/cancel must show exact new balance without reload.
- [x] Build production web, copy standalone static assets, restart only own server, verify health/readiness. Run note and existing selling/settlement browsers. Commit `Add customer note return and application screens`.

### Task7: Full verification, one review and resumable delivery

**Files:** review artifact and docs/ai/{STATUS,MEMORY,LOG}; approved decisions only if implementation reveals a new business decision requiring user input.

- [x] Self-check spec coverage against Tasks1–6: GST deadlines/declaration/IRN gate, financial/stock ceilings, original-account corrections, foreign residuals, legacy allocations, exact reversal and role/query scoping. No unimplemented branch silently labeled supported.
- [x] Run `pnpm build --concurrency=2`, `pnpm typecheck --concurrency=2`, `pnpm test --concurrency=2 --force`, `pnpm lint`. All configured checks pass; report lint0 tasks honestly.
- [x] Run all five new API fixtures, existing settlement93, six accounting suites+review/lock/concurrency, selling/buying/import/inventory regressions; run note, invoice-balance, selling, buying, accounting and settlement production browsers. Space fresh fixtures12 seconds; record commands, exit codes and counts.
- [x] One independent whole-change review checks schema0011 preservation, source scopes, original-cost evidence, typed allocation compatibility, exact FX/reversals and race/rollback behavior. Fix Important/Critical findings with reproduced regression tests, one fix pass; record accepted rulings/deferred issues. No repeated reviews without new cause.
- [x] Confirm latest remote, reconcile concurrent commits without losing work, run affected checks if integration changes code. Update handoff and review artifact, commit/push normally; clean tracked tree and remote HEAD confirmed. No deployed-data activation or provider credential use.
- [x] Mark customer notes/returns Done only with evidence. Next: supplier-return written design, then NIC sandbox/e-way bill design, per separate approved phase boundaries.

## Self-review and execution handoff

All design sections map to the tasks above. Task4 integrates recognition and credit application
in one coherent deliverable before a default-branch product push.
New helpers have exact signatures and use existing Dec primitives; no duplicate money
store or replacement settlement protocol. The five review-focus cases have tests in
their owning tasks. Implementation method remains Native; the written plan is approved. Optional task tooling must not override AGENTS.md.

## Execution result

Completed on the explicitly requested default branch. One independent whole-change review found two Important defects; both were reproduced and fixed in one pass. Final evidence, process limitations, all rulings and next boundaries are in [the review](../reviews/2026-10-05-sales-notes-returns-review.md).
