# Supplier Notes and Purchase Returns Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking. The user selected Native: use executing-plans, then one independent final reviewer.

**Goal:** Deliver configurable supplier-issued notes, own return claims and physical purchase returns without duplicating stock, AP or ITC.

**Architecture:** Separate claim approval, physical movement, supplier recognition and resolution services share scoped source evidence and the accounting-first lock. Original purchase allocations stay intact; append-only return evidence and exact credit applications account for subsequent corrections.

**Tech Stack:** Existing TypeScript, NestJS, Drizzle/PostgreSQL, Dec, Next.js, Zod and Playwright; no new product dependencies.

**Spec:** `docs/superpowers/specs/2026-10-05-supplier-notes-returns-design.md` (approved 2026-10-05).

## Global Constraints

- Native on the default branch; fetch first, respect other claims, commit/push the STATUS claim alone before product code. Keep incomplete product commits local until the slice passes verification.
- Active-era submitted invoice sources only; no shared entity activation, historical replay or live provider calls.
- Preserve migrations0011–0013 and existing receipt allocations; generate descriptive additive migrations.
- Money/quantity decimal strings, INR GL at six decimals, original foreign recognition rate, FIFO per entity/item/batch.
- Accounting lock precedes policy/document/item locks; append-only signed reversals and transaction-wide rollback.
- Defaults: pending dispatch allowed, every-claim Finance approval, automatic original-invoice credit application, rejected balance kept open. All write-offs require Finance approval.
- No AP/ITC on claim submission; actual dispatch debits pending returns and credits inventory.
- No unbilled returns, refunds, cross-currency/party netting, stock revaluation for value-only notes, customs ITC changes or RCM settlement.
- Scripts default API4000/web3000 and accept API, WEB_ORIGIN, WEB_URL overrides; report zero-task lint honestly.

## Review Focus

1. Acceptance before dispatch must not leave pending value or recognize supplier credit twice (Tasks4/5).
2. Two invoice lines referencing the same PO/item must not share a return ceiling accidentally (Tasks1/3).
3. Policy changes while approving/dispatching must use one serialized policy snapshot (Task2).
4. A source bill paid while automatic credit applies must leave exact residual supplier credit (Task4).
5. Returned goods with zero carrying cost must retain real quantity and resolution evidence (Tasks3/5).

## Shared interfaces and files

Create `apps/api/src/modules/supplier-returns/` with `contracts.ts`,
`policy.service.ts`, `claim.service.ts`, `movement.service.ts`, `preview.service.ts`,
`note-posting.service.ts`, `credit-application.service.ts`, `note.service.ts`,
`resolution.service.ts` and `supplier-returns.controller.ts`; register in
`apps/api/src/app.module.ts`. Each method takes `tx: Tx`, `ctx:
TenantRequestContext`, `entityId: string` before its domain arguments; only outer
command services open transactions. Controllers return decimal strings and scoped IDs.

contracts.ts also exports `ClaimDto` (persisted header/lines, policy snapshot,
approval and derived quantity/value balances), `SupplierNoteDto` (persisted
header/lines, recognition and allocation balances), `ResolutionDto` (persisted
resolution and reversal evidence), and `AllocationDto` (existing allocation
document shape plus supplierNoteId). IDs/dates are strings, states are literal
unions and numeric values are decimal strings; derive table field types from
the schema rather than duplicate them.

Task1 exports `SupplierPolicy`, `ClaimInput`, `SupplierNoteInput`, `DispatchInput`,
`ResolutionInput`, `SupplierNotePreview` and `MovementResult` from contracts.ts.
Preview includes financial/tax components, source bill, acceptance allocations,
pending carrying to clear, variance and remaining ceilings. MovementResult includes
stockEntryId, exact qty/value and immutable evidence IDs. Inputs contain source IDs,
positive decimal quantities/amounts, dates/reasons and explicit tax eligibility;
never account IDs or client-derived costs. Resolutions are discriminated unions:
`write_off`, `receive_back`, `acceptance_reversal`.

Create core helpers in `packages/core/src/supplier-returns.ts` and export from
`packages/core/src/index.ts`. Create API fixture helper
`apps/api/scripts/supplier-returns-test-helpers.mjs`; use unique isolated tenants,
reviewed opening fixtures and existing auth helpers, not shared entity activation.

### Task 1: Add scoped evidence and compatibility schema

**Files:** create `packages/db/src/schema/supplier-returns.ts`, contracts.ts and
`apps/api/scripts/smoke-supplier-returns-schema.mjs`; modify `packages/db/src/schema/index.ts`,
`packages/db/src/schema/settlements.ts`, `packages/db/src/schema/inventory.ts`,
`packages/auth/src/permissions.ts`; generate the next descriptive migration.

**Interfaces:** export policy/claim/note/line tables and immutable return,
acceptance and resolution effect tables. Supplier credit allocation adds nullable
supplierNoteId to existing source typing, exactly one of settlement/customer
credit/supplier credit. Original invoice line, receipt allocation and receipt-line
IDs must be retained together in physical evidence.

- [ ] Write schema test asserting legacy settlement/customer allocations remain valid; zero/two sources fail; cross-entity FKs fail; evidence UPDATE/DELETE fail; duplicate supplier/kind/FY note reference fails; two same-item invoice lines retain distinct ceilings.
- [ ] Run `node --env-file=.env apps/api/scripts/smoke-supplier-returns-schema.mjs`; observe missing tables/columns before implementation.
- [ ] Implement tables, composite scoped indexes/FKs, append-only triggers, internal stock purposes `purchase_return`/`purchase_return_receipt`, and `buying.return_claim.*`, `buying.supplier_note.*`, `buying.return_policy.update` permissions with Finance/Stores/Buying role assignments.
- [ ] Generate with `pnpm --filter @factoryos/db db:generate --name supplier_notes_returns`, apply through supported migration script to isolated/local integration DB; run schema test and db/auth typechecks. Confirm unique indexes precede composite FKs and old rows unchanged.
- [ ] Commit `Add supplier return and note evidence schema`.

### Task 2: Implement policy snapshots and approved claims

**Files:** policy.service.ts, claim.service.ts, contracts.ts, controller/module
registration; create `packages/core/src/supplier-returns.test.ts` and
`apps/api/scripts/smoke-supplier-returns-policies.mjs`.

**Interfaces:** `policy.getIn(...): Promise<SupplierPolicy>`,
`policy.updateIn(..., input): Promise<SupplierPolicy>`;
`claim.submitIn(..., claimId): Promise<ClaimDto>`,
`claim.approveIn(..., claimId, reason): Promise<ClaimDto>`.
Core `requiresClaimApproval(policy, requestedAmount, exchangeRate): boolean`.
Claim CRUD uses strict ClaimInput; GET/PUT `/buying/return-policy`, CRUD
`/buying/return-claims`, POST `/:id/submit` and `/:id/approve`.

- [ ] Write core assertions: every-claim policy approves zero; threshold100 compares original-rate INR100 equal=false,100.01=true. API asserts defaults, Finance-only edits, draft permission boundaries, immutable submitted amounts, no claim GL/bill/stock rows and audit before/after.
- [ ] Run `pnpm --filter @factoryos/core test` and policy fixture; observe genuine missing helper/route failures.
- [ ] Implement default policy, accounting-locked edits, source validation, claim numbering, snapshot policy at submit and reapproval after instruction changes. Add isolated PG barrier assertion that concurrent stricter policy edit/dispatch never mixes snapshots.
- [ ] Run core and policy fixture, API typecheck; verify failures leave rows unchanged.
- [ ] Commit `Add configurable supplier return claim approvals`.

### Task 3: Post physical returns at actual FIFO carrying value

**Files:** movement.service.ts; modify `apps/api/src/modules/stock-posting.service.ts`
and scoped inventory purpose guards; create `smoke-supplier-returns-stock.mjs`.

**Interfaces:** `movement.previewDispatchIn(..., claimId, input: DispatchInput)`
returns server-computed qty/cost/ceilings;
`movement.dispatchIn(..., claimId, input): Promise<MovementResult>`.
POST `/buying/return-claims/:id/dispatch-preview` and `/dispatch`.

- [ ] Write fixture: receipt10@60 plus applicable landed20/unit gives carrying80; return4 posts pending320/inventory-320. A newer receipt does not bypass chronological FIFO; original batch/warehouse/allocated quantity ceiling enforced. Return quarantine/MRB allowed; ordinary issue still refused. Zero-cost return produces quantity evidence/no-value disposition. Two same-item invoice lines cannot spend each other's capacity.
- [ ] Run stock fixture and observe missing route/evidence failure.
- [ ] Implement accounting-first scoped locks, approved policy check, existing FIFO consumption with exact layer evidence, dedicated pending-return GL/no-value posting and internal-purpose protection. Keep original PO counters and receiptInvoiceAllocation untouched; expose separate net-retained quantities.
- [ ] Run stock/schema/policy fixtures plus existing inventory43/import39 scripts using configured port overrides; inspect exact GL/FIFO reconciliation and all-row rollback for unavailable stock/backdates.
- [ ] Commit `Post purchase returns with pending carrying value`.

### Task 4: Recognize supplier notes and usable AP credit atomically

**Files:** preview.service.ts, note-posting.service.ts, credit-application.service.ts,
note.service.ts; modify `apps/api/src/modules/accounting/bill.service.ts`,
`settlements.controller.ts`, `buying.controller.ts` dependency guards and
`gl-posting.service.ts` only for typed original-account corrections;
create `smoke-supplier-notes.mjs` and `smoke-supplier-notes-fx.mjs`.

**Interfaces:** `preview.calculateIn(..., input: SupplierNoteInput): Promise<SupplierNotePreview>`;
`note.submitIn(..., noteId): Promise<SupplierNoteDto>`;
`application.applyIn(..., noteId, {postingDate, allocations:[{billId,amount}]}): Promise<AllocationDto>`.
CRUD `/buying/supplier-notes`, POST `/preview`, `/:id/submit`, and existing
`/accounts/settlement-allocations` union with supplierNoteId. Recognition and automatic
source application occur in the same transaction; no intermediate submitted exposure.

- [ ] Write fixture assertions for credit/debit sign, service/value-only/physical distinctions, partial accepted carrying residuals, GST versus commercial components, original inactive accounts, duplicate references and source eligibility. Imported/RCM GST notes refuse; commercial permitted; noncreditable tax never posts input ITC. Paid invoice credit remains available; manual policy leaves full credit; automatic policy consumes only remaining payable.
- [ ] Write FX assertion: source USD100@80 paid70, supplier credit40 applies30/2400 and leaves10/800; apply remaining10 to USD bill@83 and assert FX gain30 (AP830 cleared against credit800). Partial4/final6 consume exact320/480 carrying, gains12/18; cancellations reverse exact rows.
- [ ] Run note/FX fixtures before routes; observe missing behavior failures.
- [ ] Implement bounded original printed components, original-account evidence, linked acceptance without stock reposting, explicit pending/return variance and bill identities. Financial acceptance preceding dispatch posts adjustment; later movement compensates that adjustment while clearing its own pending carrying, without a second AP/ITC effect.
- [ ] Add real accounting-lock barrier for simultaneous original-bill payment and auto-credit; assert either order leaves exact AP and remaining credit, never overapplication. Test acceptance-before-dispatch net pending zero and exactly one note GL/bill effect.
- [ ] Run note/FX/policy/stock fixtures and existing settlement/customer-note compatibility tests; API typecheck and reconciliation.
- [ ] Commit `Recognize supplier notes and allocate residual credit`.

### Task 5: Resolve rejections and reverse dependent documents safely

**Files:** resolution.service.ts, claim/note/movement services; source cancellation
guards in buying.controller.ts and stock-posting.service.ts; create
`smoke-supplier-returns-resolutions.mjs` and `smoke-supplier-returns-races.mjs`.

**Interfaces:** `resolution.postIn(..., claimId, input: ResolutionInput): Promise<ResolutionDto>`;
`resolution.cancelIn(..., resolutionId, reason): Promise<void>`;
`note.cancelIn(..., noteId, reason): Promise<void>`;
`movement.cancelIn(..., movementId, reason): Promise<void>`.
POST claim `/:id/resolutions`, resolution `/:id/cancel`, note `/:id/cancel` and
movement `/:id/cancel`; claim cancel refuses dispatched/resolved dependencies.

- [ ] Write rejection fixture: dispatch4/carrying320, accept2/carrying160, reject2 leaves160 pending; write-off needs Finance and exact160 loss; receive-back instead adds2/160 original-batch FIFO and clears pending. Zero-value receive-back still restores quantity. Default request-back never creates stock before receipt confirmation.
- [ ] Write cancellation assertions for later applications, paid debit, debit-supported ceiling, source receipt/invoice guards, write-off reversal and received-back consumed/landed-cost guards. Snapshot all GL/bill/stock/claim effects on failure. Acceptance reversal restores pending while retaining real dispatch.
- [ ] Run fixtures before implementing resolution; observe explicit missing route/incorrect-state failures.
- [ ] Implement signed immutable reversals, exact recorded account/cost recovery, partial/final resolution residuals and safe mistaken-movement cancellation. Preserve existing lock order and backdating guards; errors leave document and ledgers unchanged.
- [ ] Run resolution/race fixtures with PG barriers for last return, last acceptance, last credit spend and cancellation; assert single incompatible winner. Run accounting lock-order regression and all earlier supplier fixtures.
- [ ] Commit `Resolve supplier returns and guard exact reversals`.

### Task 6: Deliver Buying workspace, policies and print

**Files:** create `apps/web/src/lib/supplier-returns.ts`, components
`supplier-return-claim-form.tsx`, `supplier-return-claim-list.tsx`,
`supplier-note-form.tsx`, `supplier-note-list.tsx`, `supplier-return-print.tsx`,
`supplier-return-policy-form.tsx`; route pages under
`apps/web/src/app/app/buying/return-claims/{page.tsx,new/page.tsx,[id]/page.tsx,[id]/print/page.tsx}`,
`buying/supplier-notes/` with the same route pattern and
`apps/web/src/app/app/settings/supplier-returns/page.tsx`.
Modify `apps/web/src/components/purchase-invoice-form.tsx`,
`apps/web/src/components/app-shell.tsx` and
`apps/web/src/components/command-palette.tsx`;
create `apps/web/e2e/supplier-returns.mjs` and `supplier-notes.mjs`.

**Interfaces:** DTOs mirror server contracts; query keys include entity and IDs;
never compute payable/tax/carrying client-side. Preview response snapshot must
match form input before mutation. Role-specific actions call Tasks2–5 endpoints.

- [ ] Write browser assertions: Buying prepares claim, Finance approves/configures, Stores dispatches/receives; read-only sees persisted totals without edit; manual/auto credit setting changes real allocation; partial acceptance/rejection timeline displays unresolved160; acceptance-first then dispatch shows zero pending. Print says claim, includes supplier note reference when applicable, mobile actions remain usable.
- [ ] Run against production web and observe absent route/action failures.
- [ ] Implement token-based UI components, scoped invoice shortcuts, serial mutations, server preview, rejection-safe drafts, role gates and A4 browser print/PDF. Policy page explains fixed valuation/tax constraints and audited changes. Refresh affected stock/invoice/AP/claim queries after mutation and navigation.
- [ ] Build web, copy standalone static assets and restart only this session's web process; probe `/api/health`, then run both browsers with documented overrides. Verify seller/supplier snapshots survive master edits and no supplier notification is sent automatically.
- [ ] Commit `Add supplier notes and purchase return workspace`.

### Task 7: Review, verification and durable delivery

**Files:** create `docs/superpowers/reviews/2026-10-05-supplier-notes-returns-review.md`;
update this plan, spec delivery status, README artifact references and docs/ai handoff files.

- [ ] Run root `pnpm build`, `pnpm typecheck`, `pnpm test`, `pnpm lint`; preserve exits and actual executed counts. Run all supplier fixtures serially with isolated tenants and all relevant existing accounting/settlement/buying/imports/inventory/customer-note API regressions. Use auth pacing as needed, not overlapping shared-IP suites.
- [ ] Refresh own API/web after builds and run production supplier browsers plus existing buying/imports/accounting/settlements/customer-note browsers. Verify no shared activation, old migration byte changes or altered allocation rows.
- [ ] Request one fresh independent final review under requesting-code-review, supplying approved spec/plan, base-to-head range, five Review Focus cases and prior rulings; no implementer agents under Native. Reproduce actionable findings before fixing, retain RED/GREEN evidence and rulings; rerun affected checks after fixes.
- [ ] Run `git diff --check`, verify no secrets, update Done/Next/MEMORY/LOG and review artifact with actual coverage/limitations. Next separate phase: NIC sandbox design.
- [ ] Commit verified delivery, push normally to the default branch, confirm clean status and remote HEAD. Do not force-push, bypass hooks or claim lint coverage from zero tasks.

## Plan self-review

Each approved spec section maps to Tasks1–6; Task7 owns release evidence and handoff.
All five Review Focus cases have explicit fixture assertions. Public methods use
the common Tx/context/entity prefix; preview/movement DTOs are defined before use.
Physical dispatch and financial acceptance are separate events in both orders;
the tests require pending-value conservation and no duplicate AP/ITC. No task
requires changing shared books, rewriting history or contacting suppliers.

Status: Written plan awaits user review. Preserve Native execution; approval of
the spec does not authorize starting product implementation before plan review.
