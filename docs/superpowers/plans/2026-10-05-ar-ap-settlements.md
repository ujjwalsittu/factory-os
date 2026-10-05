# AR/AP Settlements Implementation Plan

> **For any agent or human:** execute the tasks in order; each step is a checkbox (`- [ ]`). Tools that support sub-agents may run tasks that way, but it is not required (AGENTS.md L12).

**Goal:** Record customer receipts and supplier payments with immutable bill allocations, exact INR/FX postings, and reconciled outstanding balances.

**Architecture:** A shared bill service derives balances from immutable effects and bridges approved opening bills, operational invoices and manual trade journals. Settlement and later-allocation services use that service and the existing transaction-aware GL writer; selling credit checks and accounting reports consume the same balances.

**Tech Stack:** Existing TypeScript, NestJS, Zod, Drizzle/PostgreSQL 16, `Dec`, Next.js, TanStack Query, `@factoryos/ui`, Vitest and Playwright; no new production dependencies.

**Spec:** `docs/superpowers/specs/2026-10-05-ar-ap-settlements-design.md` (written-spec approval: user “continue”).

## Global Constraints

- Settlements require active accounting and a posting date on or after its cut-over.
- Bill effects and allocations are append-only signed rows.
- No money uses JavaScript floats.
- GL, bill effects, allocation evidence, document status and audit commit or roll back together.
- Reversal date is the current Asia/Calcutta business date, consistent with GL.
- Submitted documents are not editable.
- A supplier payment does not prove that RCM tax was paid to the government. Existing pending RCM credit stays pending.
- The user approved core settlements with TDS/TCS deferred to the dedicated compliance phase.
- No shared-entity activation, historical GL reconstruction, cross-currency allocation, automatic write-offs or bank reconciliation.
- Acquire the existing entity accounting lock before document/item/PO locks. Use the existing isolated checkout; do not create a worktree.
- Preserve stock, acquisition-cost and historical-source cancellation guards. Preserve decision 032's approver override.
- Keep product commits local until the complete slice passes validation: every push to the shared branch redeploys both applications.
- Use Node 24 and pinned pnpm 10.28.0; prepend `/workspace/.factoryos-tools/node_modules/.bin` to PATH. Local API/web use 4001/3001 and ignored `.env`.

## Review Focus

1. Duplicate invoice references must not misdirect allocations; Task 2 tests stable identities and ambiguous journal-reference fallback.
2. A historical foreign invoice's `originalAmount` is its full amount, not its outstanding residual; Task 2 tests USD 100 with INR 3,200 historically settled at rate 80 becomes USD 60 / INR 4,800.
3. Mapping changes must not move old balances or reverse into new accounts; Tasks 3–5 test stored control accounts and reversal snapshots.
4. A stale browser preview or two operators can over-consume a bill/advance; Tasks 4–5 test transaction-time reload, competing submissions, and stale rejection.
5. Unapplied money can reduce net credit exposure while overdue bills remain unpaid; Task 6 tests gross/net/overdue separation and permission-safe operational summaries.

## Files and shared interfaces

Create `packages/core/src/settlements.ts` and `settlements.test.ts`, exported from core/index.ts. Create `packages/db/src/schema/settlements.ts`, exported from schema/index.ts, and generate the next numbered migration in `packages/db/drizzle/` (current last migration 0010). Add tables named `trade_bill`, `trade_bill_effect`, `party_settlement`, `settlement_allocation_document`, `settlement_allocation_effect`, and `trade_subledger_state`. Use existing document status enum and scoped numeric(24,6) conventions.

Create API files under `apps/api/src/modules/accounting/`: `bill.service.ts`, `bill-initialization.service.ts`, `settlement.service.ts`, `settlement-allocation.service.ts`, `settlements.controller.ts`, `outstanding-reports.controller.ts`. `bill.service.ts` owns shared API/domain types below; avoid service cycles by injecting the bill service into operational/journal/settlement services, never the reverse. Initialization consumes source data and bill-service writes; the bill service must not depend on initialization. Controllers/services explicitly ensure initialization before active settlement/report operations.

Modify existing accounting/controller, opening.service, operational-postings, selling.controller, buying.controller, app.module, permissions catalog/roles, and the web accounting journal/operational forms only at relevant integration points. Add API suites `smoke-settlements.mjs`, `smoke-settlements-upgrade.mjs`, `smoke-settlements-concurrency.mjs` using `accounting-test-helpers.mjs`.

Shared types (money/date values are strings):

```ts
type TradeSide = 'receivable' | 'payable';
type Direction = 'receipt' | 'payment';
type BillBalance = {
  id: string; partyId: string; side: TradeSide; accountId: string;
  reference: string; sourceType: string; sourceId: string;
  currency: string; recognitionDate: string; dueDate: string | null;
  openAmount: string; carryingInr: string; msmeCategory: string | null;
};
type AllocationInput = { billId: string; amount: string };
type SettlementInput = {
  direction: Direction; partyId: string; postingDate: string;
  currency: string; exchangeRate: string; accountId: string; amount: string;
  bankReference: string; narration: string; allocations: AllocationInput[];
};
type LaterAllocationInput = {
  settlementId: string; postingDate: string; reason: string;
  allocations: AllocationInput[];
};
type PartyPosition = {
  grossOpenInr: string; onAccountInr: string; netInr: string;
  overdueInr: string; overdueCount: number;
};
```

`Tx`, `TenantRequestContext`, `SourceRef`, `AccountingLine` and `PostingPlan` remain their existing types. Define new exported `SettlementPreview = { amount: string; allocated: string; unapplied: string; cashInr: string; carryingInr: string; forexInr: string; roundingInr: string; lines: AccountingLine[] }` in settlement.service.ts. Signed `forexInr` is an expense debit when positive, an income credit when negative. Use existing `GlPostingService.postIn/reverseIn` and `lockAccounting`; do not add a second DB client.

## Task 1: Exact settlement arithmetic

**Files:** core/src/settlements.ts, settlements.test.ts, index.ts.

**Interfaces:** `consumeCarryingValue(openAmount: string, carryingInr: string, allocatedAmount: string): string`; `settlementDifference(direction: Direction, cashInr: string, carryingInr: string): string`. The latter returns positive FX expense and negative FX gain. Use existing `allocateProportion` for partial amounts; final exhaustion returns the exact remaining carrying value.

- [ ] Write Vitest assertions: `consumeCarryingValue('100','8000','40') === '3200.000000'`; allocating the last 60 against 4,800 exhausts exactly; fractional six-place residual is consumed on the final allocation; zero/negative/over-allocation rejects. Receipt 3,320 vs 3,200 gives `-120.000000`; payment gives `120.000000`; lower receipt/payment rates invert signs.
- [ ] Run `pnpm --filter @factoryos/core test` and observe the new test fail from missing exports.
- [ ] Implement these pure functions and exports, using six-place strings and no floats. Preserve distinction between exchange differences and arithmetic rounding.
- [ ] Rerun core tests and typecheck; verify all named cases pass.
- [ ] Commit locally: `Add exact settlement carrying value arithmetic`.

## Task 2: Bill storage, upgrade and opening initialization

**Files:** new schema/settlements.ts and migration; bill.service.ts, bill-initialization.service.ts; schema/index.ts; app.module.ts; smoke-settlements-upgrade.mjs.

**Interfaces:** `BillService.balanceIn(tx: Tx, ctx: TenantRequestContext, entityId: string, billId: string, asOf?: string): Promise<BillBalance>`; `positionIn(tx, ctx, entityId, partyId: string, side: TradeSide, asOf: string): Promise<PartyPosition>`; `assertReconciledIn(tx, ctx, entityId): Promise<void>`; `BillInitializationService.ensureIn(tx, ctx, entityId): Promise<void>`. Bill service exposes `recordSourceIn(tx, ctx, entityId, source: SourceRef, effects: BillSourceEffect[]): Promise<void>` with `BillSourceEffect = { billId?: string; partyId: string; side: TradeSide; accountId: string; reference: string; currency: string; recognitionDate: string; postingDate: string; dueDate: string | null; amount: string; carryingInr: string; msmeCategory: string | null; originKey: string }`; signed negative effects reduce existing bills. `originKey` is a stable source-line key, never a display reference.

- [ ] Add fresh-local-tenant API/DB fixtures for linked/unlinked opening bills, partial historical foreign settlement (USD 100, rate 80, historical INR 3,200 → USD 60 / INR 4,800), duplicate references with distinct IDs, cancelled active invoices, and existing manual journal/reversal lines. Assert exact source identities, as-of amounts, and equality to actual posted trade controls.
- [ ] Run the new upgrade suite against API 4001 and observe missing bill routes/service assertions fail.
- [ ] Define scoped tables: immutable identities/effects and signed allocation effects; editable document draft JSON separated from evidence; unique entity/source/line/effect identities, reversal uniqueness, positive draft amount checks, and required FKs. Persist source control account and reversal linkage. The initialization state records schema version and completion only after reconciliation passes.
- [ ] Generate migration via `pnpm --filter @factoryos/db db:generate`, inspect SQL, add append-only UPDATE/DELETE guards for bill/effect/allocation evidence, and apply to local PostgreSQL using the supported migration command.
- [ ] Implement deterministic initialization under entity lock: snapshot opening bills once, add existing active invoice/journal effects including reversals at recorded GL dates, and exact-reference matching only for an unambiguous compatible INR bill. Ambiguous/unmatched/foreign-reference journal lines remain separately identified INR journal items. Repeated initialization writes no duplicates and never creates/replays GL.
- [ ] Add a reconciliation mismatch fixture and two concurrent initialization attempts. Assert mismatch blocks settlement readiness with source detail, successful initialization commits once, and current/historical control mappings are included in comparison.
- [ ] Verify upgrade suite and API/db typecheck; commit locally: `Establish reconciled immutable trade bill balances`.

## Task 3: Transactional invoice and journal integration

**Files:** operational-postings.ts, opening.service.ts, accounting.controller.ts, selling.controller.ts, buying.controller.ts, bill.service.ts; new schema fields for journal draft choices if needed; upgrade suite.

**Interfaces:** `BillService.assertSourceCancellableIn(tx, ctx, entityId, sourceType: string, sourceId: string): Promise<void>`; `reverseSourceIn(tx, ctx, entityId, source: SourceRef, postingDate: string): Promise<void>`. New manual trade choice `TradeReference = { mode: 'against' | 'new' | 'on_account'; billId?: string; reference?: string }` belongs on a draft journal line only. Posted GL keeps the recorded billReference plus immutable bill effects.

- [ ] Add failing API cases for invoice submission/cancellation synchronizing bill effects; cancelled invoice as-of history; new/against/on-account INR journal choices; over-reducing a bill; duplicate reference ambiguity; unsupported foreign adjustment; accounting-inactive operational compatibility; and mapping changes preserving original bill account.
- [ ] Run upgrade/integration suite and confirm newly added cases fail before lifecycle integration.
- [ ] Integrate invoice/opening/journal events inside existing entity-first transactions. Ensure initialization precedes applying a new active source effect; first submission must not be double-counted by initialization. Reject invoice cancellation with surviving reductions/dependencies before stock/GL mutation. Preserve existing inactive behavior and historical-source guards.
- [ ] Enforce structured choices for new manual trade journal submissions. For against-ref require same party/side/recorded account and INR currency; on-account and new-ref use explicit identities. Reversal negates source effects at current business date. Keep existing non-trade journals unchanged.
- [ ] Assert a forced GL failure leaves document, bills and audit unchanged; assert changed mappings affect new bills only. Rerun accounting, buying and selling API regressions relevant to touched lifecycles.
- [ ] Commit locally: `Synchronize operational and journal trade balances`.

## Task 4: Receipt/payment lifecycle and GL posting

**Files:** settlement.service.ts, settlements.controller.ts, app.module.ts, permissions.ts/roles; smoke-settlements.mjs and concurrency suite.

**Interfaces:** `SettlementService.previewIn(tx, ctx, entityId, input: SettlementInput): Promise<SettlementPreview>`; `saveIn(tx, ctx, entityId, id: string | null, input): Promise<{ id: string }>`; `submitIn(tx, ctx, entityId, id: string): Promise<{ voucherId: string | null }>`; `cancelIn(tx, ctx, entityId, id: string, reason: string): Promise<void>`. Receipt/payment side is derived from direction. APIs: `/accounts/settlements` GET/POST, `/accounts/settlements/preview` POST, `/accounts/settlements/:id` GET/PUT, and `/:id/submit`, `/:id/cancel` POST. Read-only lookup `/accounts/bills` filters party/side/currency.

- [ ] Write failing API cases for receipt/payment full/partial/multiple bills; USD FX example; overpayment 120 against 100 creates 20 on account; wrong currency/party/entity/account; missing/inactive cash/bank or FX controls; INR rate other than 1; duplicate bill IDs; future/pre-cut-over/bill-recognition dates; zero amount; and permission denial.
- [ ] Run new suite and observe missing settlement lifecycle failures.
- [ ] Register `accounts.settlement` read/create/update/submit/cancel/export and scoped role grants. Implement Zod boundaries, scoped lookup, explicit draft updates, server preview and numbered submission using separate `customer_receipt`/`supplier_payment` entity/FY number-series types.
- [ ] Build exact lines from carrying-value shares, source control accounts and current advance control mapping. Cash/bank uses gross document amount converted once; FX uses signed pure helper; any precision residual uses explicit rounding evidence. Store immutable allocation/share evidence and GL/source relationships, post/audit atomically. Do not touch inventory, GST or pending RCM.
- [ ] Add real PostgreSQL races: two drafts competing for a USD 100 bill with 70 each; exactly one commits and the other receives insufficient-open validation. Retry submit/cancel creates no duplicate GL/effects. Fail submission inside writer and assert complete rollback.
- [ ] Cancel using recorded lines/accounts/shares and current business date; inline allocations reverse with settlement. Assert unchanged results after altering rate/mapping masters and retention of historical as-of balances.
- [ ] Verify suites and typecheck/build touched packages; commit locally: `Post customer receipts and supplier payments atomically`.

## Task 5: Later allocation and dependency reversals

**Files:** settlement-allocation.service.ts, settlements.controller.ts, bill.service.ts; settlement and concurrency suites.

**Interfaces:** `SettlementAllocationService.previewIn(tx, ctx, entityId, input: LaterAllocationInput): Promise<SettlementPreview>`; `createIn(tx, ctx, entityId, input): Promise<{ id: string }>`; `submitIn(tx, ctx, entityId, id: string): Promise<{ voucherId: string | null }>`; `cancelIn(tx, ctx, entityId, id: string, reason: string): Promise<void>`. APIs `/accounts/settlement-allocations` GET/POST, `/preview` POST, `/:id` GET, `/:id/submit` and `/:id/cancel` POST; no draft update needed initially, rejected drafts may be recreated. Number-series type `settlement_allocation`.

- [ ] Add failing tests: apply 40 then final 60 from a USD 100 advance carried at INR 8,300 against a USD 100 bill carried at INR 8,000; total advance consumption 8,300, bill consumption 8,000, FX difference 300 with no repeated bank movement. Same-rate/same-account allocation records no-value disposition and still settles bill.
- [ ] Add date/party/currency/source-status and over-consumption denials; concurrent 70/70 claims against a 100 advance; settlement and invoice cancellation blocked by surviving allocation IDs; reversal reopens both bill and advance exactly after mappings change.
- [ ] Run settlement/concurrency suites and confirm new cases fail.
- [ ] Implement later allocation with inherited source metadata, current balance reload, original source/bill carrying shares, cross-control reclassification, unique no-value disposition where applicable, immutable evidence, same-Tx audit, and separate lifecycle permissions via accounts.settlement.
- [ ] Implement cancellation dependency checks and exact reversing effects. Add tests proving later allocation cancellation leaves original bank GL untouched, permits subsequent source cancellation, and cannot double-release funds on retries.
- [ ] Verify settlement/concurrency suites and commit locally: `Allocate on-account settlements with exact reversals`.

## Task 6: Outstanding, ageing, credit and MSME integration

**Files:** outstanding-reports.controller.ts, bill.service.ts, selling.controller.ts, buying.controller.ts; settlement suite.

**Interfaces:** `BillService.listIn(tx, ctx, entityId, filters: { side?: TradeSide; partyId?: string; currency?: string; asOf: string; overdue?: boolean; msme?: boolean }): Promise<BillBalance[]>`. Reports `/accounts/outstanding`, `/accounts/outstanding/export`, `/accounts/trade-reconciliation`; use report.read/export. Operational bill summary routes under their existing invoice APIs require corresponding selling/buying read permissions.

- [ ] Add assertions: receipt reduces net customer exposure and decision-032 warning while unapplied receipt leaves an overdue bill overdue; full allocation removes overdue count; reversal restores warnings; net credit limit exposure floors at zero; partial MSME payment reduces residual but retains stored due date/category; unknown opening due/category remains unclassified.
- [ ] Add as-of tests before/after allocation and current-date reversal, gross/unapplied/net distinction, ageing boundaries 0/1/30/31/60/61/90/91 overdue days, currency filters, journal-origin items, remapped controls, and report-only/export permission separation.
- [ ] Run new cases and confirm failures before report/credit replacement.
- [ ] Implement exact aggregation and reconciliation, business-date ageing, separate advance/journal-credit rows, and stored invoice metadata. Replace selling's sum-of-all-submitted-invoices calculation with `positionIn` while preserving override behavior. Inactive entities retain existing operational credit fallback and disclose accounting status; do not initialize them implicitly.
- [ ] Ensure credit-status and invoice summaries reveal only permitted balances, never bank account movements/voucher details; export checks separate permission. Explain MSME invoice-date limitation in API report metadata/UI copy.
- [ ] Verify settlement tests and existing selling/buying regressions; commit locally: `Report remaining trade balances and credit exposure`.

## Task 7: Accountant UI and operational balance summaries

**Files:** create web/lib/settlements.ts, components/settlement-list.tsx, settlement-form.tsx, settlement-allocation-form.tsx, outstanding-reports.tsx; create app/app/accounts/settlements/page.tsx, app/app/accounts/settlements/new/page.tsx, app/app/accounts/settlements/[id]/page.tsx and app/app/accounts/outstanding/page.tsx; modify accounting-journal-form.tsx, accounting.ts, selling-form.tsx, purchase-invoice-form.tsx, app-shell.tsx, command-palette.tsx; add e2e/settlements.mjs.

**Interfaces:** Mirror backend `SettlementInput`, `LaterAllocationInput`, `BillBalance` and `SettlementPreview` in web/lib/settlements.ts. Use existing API client/query/session/entity hooks. Lists filter direction; allocation action lives on submitted settlement detail. Journal draft types include TradeReference.

- [ ] Read relevant installed Next.js guide per apps/web/AGENTS.md before code. Add browser cases for create/save/preview/submit, gross/allocated/unapplied totals, partial allocation, later allocation, FX preview, cancellation dependencies, invoice links, read-only roles, entity switch, print/export, and updated credit warning.
- [ ] Run `WEB_URL=http://localhost:3001 CHROMIUM_PATH=/usr/bin/chromium node e2e/settlements.mjs` from apps/web and confirm missing-route/control failures.
- [ ] Implement lists/forms/picker using `@factoryos/ui` and server arithmetic; optional oldest-due suggestion changes draft only. Explicitly save before submit; invalidate stale preview after changes, prevent out-of-order preview overwrites, disable invalid/pending actions, and reload balances after server conflict. Keep submit-only reviewer behavior consistent with existing permissions.
- [ ] Add structured journal bill selectors only for trade lines, operational remaining-balance summaries, permission-gated voucher/reversal links, outstanding/ageing views with as-of and currency/party filters, gross/unapplied/net labels, exact-precision print/export and MSME limitation disclosure.
- [ ] Build production web, copy standalone static assets as documented, restart only own API/web processes after build, and use readiness requests before rerunning browser suite. Confirm mobile/read-only/entity-switch states as part of the same walkthrough.
- [ ] Verify web typecheck and browser suite; commit locally: `Add receipt payment and outstanding balance workflows`.

## Task 8: Whole-slice review, regression and delivery

**Files:** all touched slice files; docs/ai/STATUS.md, MEMORY.md, LOG.md; create docs/superpowers/reviews/2026-10-05-ar-ap-settlements-review.md.

- [ ] Run root `pnpm typecheck`, `pnpm build --concurrency=2`, `pnpm test --force` and `pnpm lint`; record exact outcomes including zero-task lint limitation.
- [ ] Restart built API/web with existing local configuration and copied standalone assets; check readiness. Run three settlement API suites plus existing six accounting suites and buying/selling/imports regressions; allow existing auth bucket to reset between fixture suites rather than weakening authentication limits.
- [ ] Run production settlement browser walkthrough plus existing accounting, selling and buying walkthroughs; retain process exit status and failure evidence. Fix only regressions caused by this slice, add defect tests, and rerun affected checks.
- [ ] Execute the selected method's required whole-branch independent review against spec/plan, focusing on migration/upgrade, carrying values, cross-control remaps, journal compatibility, real concurrency and permissions. Resolve material findings; document any accepted minor limitations without claiming unimplemented behavior.
- [ ] Update handoff with completed tasks, migration numbers, exact test results and remaining compliance exclusions. Verify no secrets or accidental files are staged; mark only completed plan checkboxes.
- [ ] Commit final fixes/handoff locally; fetch remote, preserve any new remote work and resolve conflicts with relevant verification. Push the complete verified slice normally to `claude/zealous-allen-35g1vm`, confirm remote head and clean tracked tree. Do not activate a shared entity.

## Plan review and execution handoff

All spec sections map to Tasks 1–8; the five Review Focus conditions have explicit tests in their owning tasks. No implementation has started.

Recommended execution: **Native**. These tasks share transaction and balance interfaces; keeping implementation in one session avoids repeated context transfer, followed by a fresh whole-branch reviewer for accounting integrity. The alternative is **Subagent-driven**, with a fresh implementer and independent reviewer for each task before proceeding, plus final branch review. User review of this plan and selection of execution method precede implementation.
