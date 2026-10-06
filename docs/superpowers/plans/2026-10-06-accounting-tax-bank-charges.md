# Accounting Tax and Bank Charges Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans for the user-selected Native method. Implement tasks inline, with one fresh independent final reviewer; no implementer agents. Steps use checkbox syntax for tracking.

**Goal:** Deliver configurable TDS/TCS accounting, evidenced deduction advice and bank charges without double deduction or changing legacy settlements.

**Architecture:** A pure compliance engine consumes immutable profile and source evidence. Scoped API services recognize tax, bill effects, advance consumption and bank movements in the existing accounting transaction. Separate principal, tax and charge components preserve the original settlement API; submitted snapshots and append-only reversals preserve historical accounts.

**Tech Stack:** Existing Node24/pnpm10, TypeScript, NestJS, Next.js, Zod, Drizzle/PostgreSQL, Vitest and Playwright; decimal strings with fixed-six or rational BigInt arithmetic. No new provider, queue or bank integration.

**Spec:** [Approved accounting design](../specs/2026-10-06-accounting-tax-bank-charges-design.md), approved2026-10-06. Decision040 accepted. This written plan awaits review; Native/default-branch method is already selected.

## Global Constraints

- Active books are required. Tax activation is a separate deliberate Finance action on the current Asia/Kolkata business date. Never activate shared entities or replay historical invoices.
- Preserve migrations0011–0018 byte-for-byte; generate additive migrations after0018 with descriptive names.
- Every automatic profile needs verified primary-source rates, thresholds, base/GST treatment, timing, exceptions, precedence and certificate compatibility. Unverified templates remain draft and cannot enable or post.
- Current2025 Act section393/table/item and394 plus Forms140/144/143/131 are distinct from historical aliases/forms. Initial exports are accounting review data, never filing-ready serializers.
- Same PAN aggregates across party masters within entity/tax year. Missing PAN and unknown pre-activation history require reviewed evidence. No live PAN validation.
- Money uses decimal strings and exact arithmetic; rounding is profile-defined, with explicit mapped residuals, never balance plugs.
- Legacy settlement `amount` is principal cash excluding charges; preserve `amount>0`. Tax-only advice is a separate document. New tax/charge events are INR only; preserve legacy foreign settlement behavior.
- Original purchase/sales GST amounts, matching and FIFO stay intact. TCS is separate from GST grand total and sales revenue; total payable includes it.
- Accounting lock precedes source/item locks; source, tax, GL, bill effects, counters and audit commit atomically. Submitted evidence is immutable; corrections are appended.
- Finance controls configuration, openings, certificates, exceptions and protected corrections; Accountant handles routine approved flows, Auditor reads/exports, Stores has no new accounting mutations.
- Bank reconciliation, payroll, foreign tax/charges, treaty/gross-up automation, statutory filing and NIC provider work remain separate slices.
- API tests default to4000/3000 and accept `API`/`WEB_ORIGIN`; browser tests accept `WEB_URL`. Use isolated entities, pace signup fixtures serially and stop the local mock worker before database race fixtures.

## Review Focus

1. Duplicate parties with one PAN must share the threshold and certificate capacity, including simultaneous payments (Tasks2/4/11).
2. A partially consumed advance followed by an invoice, payment or cancellation must neither deduct twice nor release consumed evidence (Tasks5/6/9/11).
3. Profile, source balance or certificate changes after preview must refuse stale submission without partial ledger writes (Tasks4/5/11).
4. A remitted source correction or reversal after account remapping must use original evidence and preserve deposit/counter dependencies (Tasks5/9/11).
5. A receipt fee or documented GST charge must reconcile gross bill clearing and exact bank net without treating tax as unapplied cash or creating unsupported ITC (Tasks6/7/10).

---

## File and interface map

New pure files in `packages/compliance-in/src`: `withholding-types.ts` owns decimal-string profile/evidence/calculation contracts; `withholding.ts` owns calculation; `withholding-profiles.ts` owns verified catalog and source metadata. Export through existing `index.ts`. No NestJS/database imports here.

New scoped schema in `packages/db/src/schema/withholding.ts`, exported by `schema/index.ts`; additive components in existing `schema/settlements.ts`. Keep charge documents in new `schema/bank-charges.ts`. Existing package root exports schema automatically.

New API directory `apps/api/src/modules/withholding`: `types.ts` owns transaction/domain contracts; `policy.service.ts` configuration/identity/openings/certificates; `assessment.service.ts` source resolution/preview; `recognition.service.ts` tax GL/bill/effects; `advice.service.ts` customer/supplier documentary advice; `remittance.service.ts` deposits; `correction.service.ts` dependency-aware corrections; `withholding.controller.ts` Zod/permissions/routes. New accounting `bank-charge.service.ts` and `bank-charges.controller.ts` own charge posting. Register services/controllers in existing `apps/api/src/app.module.ts` without circular constructor injection.

Integration stays in existing `accounting/operational-postings.ts`, `accounting/settlement.service.ts`, `accounting/settlements.controller.ts`, `accounting/bill.service.ts`, `accounting/gl-posting.service.ts`, `accounting/chart.ts`, `buying.controller.ts`, `selling.controller.ts`, `sales-notes/sales-note.service.ts` and `supplier-returns/note.service.ts`. Do not restructure existing modules.

New web components: `withholding-settings.tsx`, `withholding-register.tsx`, `withholding-advice-form.tsx`, `withholding-remittance-form.tsx`, `bank-charge-form.tsx`; route wrappers listed in Task10. Extend existing settlement/invoice components and source links, app shell and command palette.

**Shared contracts established in Tasks2–3:** `Money` is a decimal string; `TaxProfileRevision` captures category/citations/effective dates, applicability, base/rate/threshold/rounding/precedence/account/source evidence. `TaxSourceEvidence` captures submitted source type/id/line, obligation identity, party/taxpayer, posting/earlier-event date, INR currency/rate/components, original controls and reviewed history. `TaxCounterState` holds signed opening/events/consumed base/certificate usage and latest date. `TaxCalculation` contains eligible/previously-consumed/new taxable base, tax, rounding, explanation and profile/certificate revisions. `TaxSnapshot` contains those objects plus source/counter revision digest; `TaxPreview` adds GL/bill preview and `previewHash`. `RecognizedTax` returns assessment/event IDs, amount, immutable snapshot and resulting bill effects. All six contracts live in the pure types file except API-only `TaxSnapshot`, `TaxPreview`, `RecognizedTax`, defined in API `types.ts`. Use existing tenancy context and transaction types; never client-supplied authoritative computed tax.

**Task test convention:** each named new API script below uses `accounting-test-helpers.mjs`, asserts HTTP refusals and compares actual DB GL/bill/counter rows. `rebuild-api` below means `pnpm --filter @factoryos/api... build`, then restart the owned local API with existing ignored environment and port/origin overrides; no shared deployment restart. Run each RED script against the current API, then each GREEN script against rebuilt API. Refusal cases must verify unchanged rows, not only response status. Commands run from repository root except explicit package commands. Each task's last step commits only its listed changes with a neutral imperative subject.

### Task1: Verified statutory profile catalog and activation gate

**Files:** Create `docs/compliance/withholding-profile-evidence.md`, `packages/compliance-in/src/withholding-profiles.ts`, `packages/compliance-in/src/withholding-profiles.test.ts`; modify `packages/compliance-in/src/index.ts`.

**Interfaces:** Produces `verifiedProfileCatalog(): readonly VerifiedProfileDefinition[]`, with effective dates, current citation/legacy alias, source URL/version/SHA256/paragraph and boundary vectors. `VerifiedProfileDefinition` owns every legal predicate required to enable its profile; Task2 embeds it into `TaxProfileRevision`. A draft entry is not returned as verified.

- [ ] Write `profile_catalog_requires_primary_evidence`: `expect(verifiedProfileCatalog().every(p => p.sourceDigest && p.boundaryVectors.length > 0)).toBe(true)`; assert an incomplete/draft fixture is excluded, and historical/current form labels are distinct.
- [ ] Run `pnpm --filter @factoryos/compliance-in test -- withholding-profiles.test.ts`; expect missing implementation failure.
- [ ] Retrieve and pin individual resident-business withholding/scrap TCS primary provisions, applicable amendments/circulars and vectors, using the spec's already verified transition documents. Document each payer/payee predicate, threshold crossing, GST exclusions, certificate applicability and TDS/TCS precedence. Implement catalog gate; do not infer numerical profiles from transition FAQs. If primary provisions remain inaccessible, record exactly which catalog entries are blocked and continue independent synthetic-engine/manual-advice work; never describe automatic TDS/TCS as delivered without verified profiles.
- [ ] Run the same test; expect all catalog/transition assertions PASS. Inspect downloaded hashes and quoted provisions against each vector; test fixture rates remain explicitly synthetic, not statutory defaults.
- [ ] Commit `Record verified withholding profile evidence`.

### Task2: Pure calculation and settlement-component contracts

**Files:** Create `packages/compliance-in/src/withholding-types.ts`, `withholding.ts`, `withholding.test.ts`; modify `index.ts`.

**Interfaces:** Consumes Task1 catalog. Produces `calculateWithholding(profile: TaxProfileRevision, source: TaxSourceEvidence, state: TaxCounterState): TaxCalculation`; `calculateSettlementComponents(input: SettlementComponentInput): SettlementComponentResult`. Input has direction, principal, new tax, charge, currency; result has `billSettlement`, `bankMovement`, `cashUnapplied`, never invented FX. Export the shared contracts above. Profile revisions include explicit verified/draft status and source provenance.

- [ ] Write named tests `duplicate_pan_threshold`, `threshold_whole_vs_excess`, `gst_base_exclusion`, `certificate_capacity_and_expiry`, `pan_higher_rate`, `earlier_event_and_transition`, `exact_rounding`, `receipt_and_payment_components`, `new_path_refuses_fx`. In synthetic fixtures, assert receipt90000+tax10000+charge100 yields `{billSettlement:'100000.000000',bankMovement:'89900.000000'}`; payment117000+tax0+charge50 yields bank117050; advance99000+tax1000 yields gross100000. Assert prior consumed base removes only that base, draft profiles throw, and charge>receipt principal throws.
- [ ] Run `pnpm --filter @factoryos/compliance-in test -- withholding.test.ts`; expect missing exports failure.
- [ ] Implement the two pure signatures with exact rational base/rate arithmetic, profile-specific rounding and explicit rejected ambiguity/unsupported currency. Counter identity is supplied by scoped API, not recomputed from party ID. Add verified Task1 vectors alongside synthetic branch tests.
- [ ] Run `pnpm --filter @factoryos/compliance-in test`; expect old GST and all new tests PASS.
- [ ] Commit `Add exact withholding and settlement calculations`.

### Task3: Additive scoped evidence schema, permissions and upgrade

**Files:** Create DB `schema/withholding.ts`, `schema/bank-charges.ts`, API `modules/withholding/types.ts`, test `apps/api/scripts/smoke-withholding-schema.mjs`; modify DB `schema/index.ts`, `schema/settlements.ts`, auth `src/permissions.ts`, `src/roles.ts`; generate `packages/db/drizzle` migration/journal/snapshot.

**Interfaces:** Produces tables for per-entity tax configuration; immutable profile revisions/selectors; reviewed taxpayer/PAN evidence; certificates; opening register/source history; assessments; append-only recognition/base-consumption/certificate-use effects; advice; remittances/allocations; corrections/report/certificate references; bank charges. Settlement stores additive principal/tax/charge snapshots and linked advice/assessment/charge IDs, defaulting to legacy zero components. Source-purpose keys and certificate/advance consumption identities are unique within tenant/entity; scoped composite references protect related rows. API types use Tasks1–2 contracts.

- [ ] Write `legacy_upgrade_and_scope`: assert legacy settlement rows remain readable with amount>0, component defaults zero, foreign settlement unchanged; cross-entity references and duplicate source/purpose fail; submitted evidence cannot be overwritten through normal mutation path. Capture0011–0018 hashes and inactive shared book state before upgrade.
- [ ] Run `node --env-file=.env apps/api/scripts/smoke-withholding-schema.mjs`; expect missing table failure on isolated test database.
- [ ] Implement additive schema with numeric amounts, checks and scoped keys; generate with `pnpm --filter @factoryos/db db:generate --name withholding_bank_charges`. Add `accounts.withholding.{read,create,submit,cancel,export,configure,approve,correct}` and `accounts.bank_charge.{read,create,submit,cancel,export}` catalog permissions; Finance all, Accountant routine/read/export/cancel subject to dependencies, Auditor read/export only, Stores none. Map reviewed tax payable/recoverable and charge accounts without activating/configuring existing entities.
- [ ] Build DB/auth, apply migration only to isolated fixture DB with `pnpm --filter @factoryos/db db:migrate`; rerun schema script, verify hashes and shared activation unchanged. Expect PASS.
- [ ] Commit `Add scoped withholding and charge evidence schema`.

### Task4: Finance configuration, opening reconciliation and certificates

**Files:** Create API `withholding/policy.service.ts`, `withholding/withholding.controller.ts`, `apps/api/scripts/smoke-withholding-policy.mjs`; modify `app.module.ts`, `accounting/chart.ts`.

**Interfaces:** `TaxPolicyService.contextIn(tx,ctx,entityId,source: TaxSourceEvidence): Promise<{profile:TaxProfileRevision;state:TaxCounterState}>`; `activateIn(tx,ctx,entityId,input:TaxActivationInput): Promise<TaxConfiguration>`. `TaxActivationInput` is defined in API `types.ts` and names current date and reviewed opening revision/hash; table-inferred `TaxConfiguration`. Controller owns configuration/identity/profile/certificate/opening CRUD and read APIs under `/accounts/withholding`; immutable submitted revisions and Finance-only approve/enable/activate.

- [ ] Write `finance_activation_and_openings`, `same_pan_identity`, `missing_pan_review`, `source_history_unknown`, `certificate_transition`. Assert Accountant/Stores cannot approve; Auditor cannot mutate; inactive books, stale opening, unknown source history, noncurrent activation, draft/unverified profile and mismatched opening GL all refuse. Same PAN different party masters resolve one counter. Reviewed openings add no GL rows; certificates retain actual authority/period across2026 transition.
- [ ] Run `node --env-file=.env apps/api/scripts/smoke-withholding-policy.mjs`; expect routes absent.
- [ ] Implement policy signatures and strict Zod endpoints, dated PAN/eligibility and party/item/account selectors, ambiguity refusal, opening GL reconciliation and per-source history. Freeze certificate capacity/profile sources; audit approved revisions, activation and override reasons under accounting lock. Task1 verification gate applies to enable and submit, not just UI.
- [ ] Rebuild API; rerun policy script, expect PASS and zero shared activation/historical replay.
- [ ] Commit `Add reviewed withholding configuration and activation`.

### Task5: Atomic invoice recognition and documentary advice

**Files:** Create API `withholding/assessment.service.ts`, `recognition.service.ts`, `advice.service.ts`, scripts `smoke-withholding-recognition.mjs`, `smoke-withholding-advice.mjs`; modify `accounting/operational-postings.ts`, `bill.service.ts`, `gl-posting.service.ts`, `buying.controller.ts`, `app.module.ts`, `withholding.controller.ts`.

**Interfaces:** `TaxAssessmentService.previewIn(tx,ctx,entityId,source: TaxSourceEvidence): Promise<TaxPreview>` consumes policy context and pure engine. `TaxRecognitionService.recognizeIn(tx,ctx,entityId,snapshot:TaxSnapshot,expectedHash:string): Promise<RecognizedTax>` revalidates profile/counter/source evidence. `TaxAdviceService.submitIn(tx,ctx,entityId,input:TaxAdviceInput): Promise<RecognizedTax>` validates documentary amount, exact original-bill allocations and evidence; `TaxAdviceInput` is defined in API `types.ts` and includes direction/customer-TDS or supplier-TCS, source IDs, date, INR amount, reference and allocations. Preview/submit routes derive source evidence server-side.

- [ ] Write `invoice_tds_once`, `advice_without_cash`, `stale_preview_rollback`, `original_control_reversal`, `cross_scope_advice`. Synthetic AP118000−TDS1000 gives117000, gross invoice/GST/stock unchanged; customer advice10000 against AR100000 yields90000 with bank unchanged. GL/bill/counter counts show exactly one effect and no matcher duplicate. Profile/certificate/source revision changed after preview refuses with all ledgers unchanged. Advice over bill balance, duplicate evidence, foreign source and scope mismatch refuse.
- [ ] Run both named scripts serially; expect absent recognition/advice routes or missing tax effects.
- [ ] Implement signatures; purchase submission first posts existing gross invoice and syncs bill identity, then adds linked Dr originalAP/CrTDS liability. Advice posts DrTDS asset/Cr originalAR; supported supplier TCS posts Dr recoverable/Cr originalAP. Register `tax_recognition`, `tax_advice`, `tax_correction` as self-recorded BillService sources and narrow original-account provenance permissions in GL service. Source tax preview/hash participates in submit; no unchecked internal path. Reverse only unprotected events atomically with source cancellation; protected dependencies route to Task9. Use constructor dependencies in one direction: policy→assessment→recognition, advice→recognition; existing operational/settlement services consume recognition, never the reverse.
- [ ] Rebuild API; rerun scripts and `node --env-file=.env apps/api/scripts/smoke-settlement-improvements.mjs`; expect exact reconciliation and PASS.
- [ ] Commit `Recognize source tax and deduction advice atomically`.

### Task6: Settlement components and earlier advance consumption

**Files:** Modify API `accounting/settlement.service.ts`, `settlements.controller.ts`, withholding assessment/recognition services and schema contract as needed; create `apps/api/scripts/smoke-withholding-settlements.mjs`.

**Interfaces:** Extend `SettlementInput` additively with linked/embedded advice, reviewed advance identity/profile/history, charges and `taxPreviewHash`; preserve old `amount`. Extend `SettlementPreview` with `principalCash`, `previousTax`, `newTax`, `billSettlement`, `bankMovement`, `charge`, separate cash/tax unapplied and linked snapshots. Recognition consumes obligation identity and append-only advance-base links; later allocation and invoice recognition use those same links.

- [ ] Write `gross_receipt_net_bank`, `invoice_then_payment`, `advance_then_partial_invoice`, `tax_only_advice_not_settlement`, `legacy_fx_unchanged`. Assert illustrative receipt posts bank89900/TDS10000/charge100/AR100000; invoice-stage1000 never appears again in payment117000; advance gross100000 records bank99000/tax1000 and two partial invoice links consume exactly its eligible base once. Tax cannot become generic unapplied cash; unidentified advance nature/unknown history, fee>principal and new FX components refuse. Existing zero-cash settlement still fails; independent advice succeeds.
- [ ] Run `node --env-file=.env apps/api/scripts/smoke-withholding-settlements.mjs`; expect legacy preview/allocation failures.
- [ ] Implement additive preview/posting/allocation contracts using Task2 component engine and Task5 recognition. Allocate billSettlement rather than bankMovement, retaining cash-only legacy algorithm when components absent. Freeze consumption/effects; cancellation refuses later consumption and reverses original amounts only. Embedded charge posting delegates Task7; this task can verify zero-charge flows before Task7 completes fee cases.
- [ ] Rebuild API; run `WITHHOLDING_ZERO_CHARGE_ONLY=1 node --env-file=.env apps/api/scripts/smoke-withholding-settlements.mjs` (the fixture implements this temporary selector and reports omitted fee cases explicitly) and `node --env-file=.env apps/api/scripts/smoke-settlements.mjs`; expect PASS. Run full component script after Task7; do not mark fee assertions passed prematurely.
- [ ] Commit `Separate settlement cash tax and advance consumption`.

### Task7: Inline and bank-only charge vouchers with documentary GST

**Files:** Create API `accounting/bank-charge.service.ts`, `bank-charges.controller.ts`, `apps/api/scripts/smoke-bank-charges.mjs`; modify `app.module.ts`, `settlement.service.ts`, `gl-posting.service.ts`, `bill.service.ts`.

**Interfaces:** `BankChargeService.previewIn(tx,ctx,entityId,input:BankChargeInput): Promise<BankChargePreview>` and `submitIn(tx,ctx,entityId,input:BankChargeInput,source:ChargeSource): Promise<BankChargeDocument>`. `BankChargeInput`, `BankChargePreview`, `ChargeSource` and `BankChargeDocument` are defined/exported by this service; input supplies bank/expense accounts, date, base/GST components, evidence/reference, documented eligibility approval and INR currency; source discriminates linked settlement versus standalone voucher. Persist original accounts/amounts. Cancellation consumes document ID/reason and reverses evidence exactly.

- [ ] Write `receipt_fee_net`, `payment_fee_extra`, `bank_only_document`, `gst_requires_finance_evidence`, `duplicate_bank_invoice`. Fee100 on90000 receipt nets89900; fee50 on117000 payment debitsbank117050. Standalone fee has no bill/FIFO effects. Undocumented GST stays expense/no ITC; valid documented Finance approval permits mapped input tax; Accountant cannot self-approve. Reusing normalized bank invoice identity across inline/standalone charges refuses, including cancelled evidence according to explicit reversal/replacement linkage.
- [ ] Run `node --env-file=.env apps/api/scripts/smoke-bank-charges.mjs`; expect routes/components absent.
- [ ] Implement signatures and endpoints, expense account validation and exact GST split. Ensure the settlement owns one combined bank movement; linked charge contributes expense/GST lines without posting the fee to bank a second time. Standalone voucher posts its own bank movement. Register appropriate self-recorded source and audit/documentary duplicate guards; all inline effects share settlement transaction.
- [ ] Rebuild API; run charge script and full Task6 settlement script; expect balanced exact bank/party totals and unchanged stock/FIFO.
- [ ] Commit `Post evidenced bank charges and exact net settlement`.

### Task8: Separate scrap TCS collectible and invoice totals

**Files:** Modify API `selling.controller.ts`, `accounting/operational-postings.ts`, withholding assessment/recognition; DB `schema/selling.ts` only if durable tax-total columns are required (additive migration); web `src/app/app/selling/invoices/[id]/print/page.tsx`; create `apps/api/scripts/smoke-withholding-tcs.mjs`.

**Interfaces:** Invoice response/issued tax snapshot adds `tcsAmount` and `totalPayable` derived from authoritative Task5 snapshot; original `grandTotal` and GST components remain unchanged. Sales submit/cancel uses same recognition dependency contract as purchase; profile precedence selects one supported rule or refuses ambiguity.

- [ ] Write `scrap_tcs_separate`, `tds_tcs_precedence`, `tcs_snapshot_totals`. Synthetic GST invoicegrandTotal100000 plusTCS1000 yields totalPayable101000, AR101000, TCS payable1000, unchanged revenue/GST components; tax/year profile changes cannot change issued print. General sale without verified applicability has no automatically invented TCS; conflicting selectors refuse; cancellation reverses exact original TCS if unprotected.
- [ ] Run `node --env-file=.env apps/api/scripts/smoke-withholding-tcs.mjs`; expect missing collectible fields/effects.
- [ ] Implement separate collection/evidence and total-payable response/print, using primary verified profiles only for enabled automation. Add stored snapshot/columns through descriptive additive migration, not computed current rules at print time. Stock delivery and GST remain original; customer outstanding/credit checks include collectible bill effects.
- [ ] Rebuild API/web; rerun TCS script and `node --env-file=.env apps/api/scripts/smoke-sales-notes-returns.mjs`; expect exact original GST/stock and PASS.
- [ ] Commit `Expose separate TCS collectible and payable totals`.

### Task9: Remittances, protected corrections and note dependencies

**Files:** Create API `withholding/remittance.service.ts`, `correction.service.ts`, `apps/api/scripts/smoke-withholding-corrections.mjs`; modify withholding controller, purchase/sales cancellation, `sales-notes/sales-note.service.ts`, `supplier-returns/note.service.ts`, recognition service and `app.module.ts`.

**Interfaces:** `TaxRemittanceService.submitIn(tx,ctx,entityId,input:TaxRemittanceInput): Promise<TaxRemittance>` validates TAN/Act/year/category/period/reference/date, exact event allocations and bank. `TaxCorrectionService.previewIn(tx,ctx,entityId,input:TaxCorrectionInput): Promise<TaxPreview>` and `submitIn(tx,ctx,entityId,input:TaxCorrectionInput,expectedHash:string): Promise<RecognizedTax>` consume original evidence plus Finance reason/docs, date and signed correction components. `assertSourceCancellableIn(tx,ctx,entityId,sourceType,sourceId): Promise<void>` exposes protected-tax dependencies to existing source cancellation. `TaxRemittanceInput` and `TaxCorrectionInput` are defined in API `types.ts`. Table-inferred remittance return; correction input is explicit original event/adjustment, never overwrite.

- [ ] Write `remittance_not_supplier_payment`, `remitted_cancel_refused`, `note_adjustment_explicit`, `original_inactive_accounts`, `backdated_counter_refused`, `certified_reported_protected`. Deposit settles original liability/bank without party effect. Remitted/certified/reported/consumed events refuse source destruction. Finance correction appends linked entries/reason without deleting remittance allocations; unsupported tax adjustment is refused before note source/stock mutation. New event before latest affected counter date refuses. After remapping/inactivation, permitted reversal uses original account IDs only.
- [ ] Run `node --env-file=.env apps/api/scripts/smoke-withholding-corrections.mjs`; expect missing deposit/correction/barrier behavior.
- [ ] Implement signatures, normalized duplicate challan/reference keys, exact remaining liability allocations, report/certificate reference recording, signed counter/certificate reversals and dependency links. Notes/returns preview separate supported tax adjustments; never implicitly reclaim remitted tax. Preserve earlier-event evidence: no historical retax/reopening or unreviewed backdated recalculation. Correction support stays within captured original INR event, not treaty/FX automation.
- [ ] Rebuild API; rerun correction script plus `node --env-file=.env apps/api/scripts/smoke-supplier-notes-tax-guards.mjs` and `node --env-file=.env apps/api/scripts/smoke-sales-notes-lifecycle.mjs`; expect all protected refusals atomic and balances reconciled.
- [ ] Commit `Track remittances and protected tax corrections`.

### Task10: Scoped Finance settings and Accountant workflows

**Files:** Create web components named in file map; routes `src/app/app/settings/withholding/page.tsx`, `src/app/app/accounts/withholding/page.tsx`, `src/app/app/accounts/withholding/advice/new/page.tsx`, `src/app/app/accounts/withholding/remittances/new/page.tsx`, `src/app/app/accounts/bank-charges/page.tsx`, `src/app/app/accounts/bank-charges/new/page.tsx`; create `apps/web/e2e/withholding.mjs`, `apps/web/e2e/bank-charges.mjs`. Modify `settlement-form.tsx`, `settlement-list.tsx`, `purchase-invoice-form.tsx`, `invoice-balance.tsx`, `accounting-source-links.tsx`, `app-shell.tsx`, `command-palette.tsx`, existing sales invoice detail/print routes and `apps/web/package.json`.

**Interfaces:** Components use Tasks4–9 APIs, server snapshots and permissions; no client tax engine. Settings covers identities/profile revisions/default selectors, certificates, opening source history and reviewed activation. Register includes event/deposit/correction/report references and explicit accounting-review CSV export/print; controller export permission and scope enforce read access. Forms show source gross/prior tax/new tax/principal/fee/bank/remaining; protected correction preparation stays Finance-only.

- [ ] Write production browser assertions `finance_setup_approval`, `accountant_receipt_preview`, `auditor_evidence_only`, `scope_navigation_refresh`, `mobile_and_snapshot_print`. Assert90000/10000/100/89900 displayed distinctly; tax advice saves independently; unsupported foreign components show refusal; changed preview requires refresh; Auditor/Stores cannot mutate by UI or direct API; issued TCS total/citations persist after profile edit. Draft sources clearly show unavailable automation, exports say accounting review data.
- [ ] Build production web and run `pnpm --filter @factoryos/web e2e:withholding` / `e2e:bank-charges` after adding script declarations; expect missing controls/flows.
- [ ] Implement the focused forms/routes with existing UI tokens/components and source links, explicit documentary review and confirmations. Show activation reconciliation differences, certificate utilization, blocked source history and tax dependencies in plain business terms. Invalidate scoped balances/registers after submit/cancel and entity switching; avoid stale draft preview submission.
- [ ] Rebuild production web; run both browsers plus existing settlement/invoice-balance/selling browsers serially using configured port overrides. Expect PASS including mobile and frozen print.
- [ ] Commit `Add withholding and bank-charge accounting screens`.

### Task11: Real races, compatibility, independent review and delivery

**Files:** Create `apps/api/scripts/smoke-withholding-barriers.mjs`, `docs/superpowers/reviews/2026-10-06-accounting-tax-bank-charges-review.md`; update plan checkboxes and `docs/ai/{STATUS,MEMORY,LOG}.md`.

**Interfaces:** PostgreSQL barrier fixture hooks use separate real transactions and controlled lock acquisition, not Promise scheduling alone. One fresh independent reviewer assesses full final diff/spec/plan, then records rulings; this is the explicitly authorized final review delegation, not implementation delegation.

- [ ] Write barriers `same_pan_threshold_race`, `duplicate_invoice_payment`, `advance_consumption_race`, `certificate_cap_race`, `preview_policy_race`, `cancel_remittance_race`; assert one valid serialized outcome, no duplicate base/certificate/bill/GL effects and no partial source/stock writes. Capture original0011–0018 hashes and shared activation; explicitly test two party masters one PAN, partial advances and payment/invoice interleavings.
- [ ] Run `node --env-file=.env apps/api/scripts/smoke-withholding-barriers.mjs`; investigate any failure using systematic diagnosis, reproduce before changing code. Run all new scripts serially against final build; no skipped fee/TCS assertion silently counted as passed.
- [ ] Run `pnpm build`, `pnpm typecheck`, `pnpm exec turbo run test --force`, `pnpm lint`; report actual executed tests/lint task count. Run existing `smoke-accounting*.mjs` (excluding helpers), `smoke-settlements.mjs`, `smoke-settlement-improvements.mjs`, sales/supplier notes tax/FX/stock/reversal suites and buying/selling/import smoke scripts. Run production accounting/settlement/selling/buying/import/customer-note/supplier-note browsers. Old migrations/shared inactive books remain unchanged; enabled profiles all have primary vectors. Record exact commands/results and blockers, never reuse cached counts as fresh evidence.
- [ ] Request one fresh final independent review with baseline commit `b21e8b4` plus approved spec/plan. Reproduce Important findings with failing tests before one fix pass; rerun affected checks and record every ruling/deferred minor in review. Any unresolved Important means not complete.
- [ ] Update handoff with verified delivered scope, exact remaining statutory/NIC blockers and next separate bank-reconciliation design. Commit `Complete verified tax and bank-charge accounting`; normal push, verify remote SHA and clean working tree. Do not claim complete automatic rules when only synthetic/manual paths were verified.

## Planning self-review and execution entry

Coverage: statutory/current/historical profiles→Tasks1–2; scoped additive upgrade→3; Finance activation/openings/PAN/certificates→4; atomic sources/advice/original accounts→5; advances/principal/allocation→6; documentary charges→7; TCS/print→8; correction/remittance/chronology/notes→9; roles/exports/mobile/cache→10; races/legacy/source invariance/review→11. All five Review Focus failures have named tests. Bank reconciliation/foundation remain explicitly subsequent designs.

Type review: pure types have no database dependencies; API-only snapshot/preview types are defined before services. Policy→assessment→recognition dependency direction avoids a settlement/operational constructor cycle. Embedded advice/charge share caller transaction; only standalone documents own bank movements. Task6 fee tests close in Task7, not an invented passed milestone. No implementation bodies or statutory rates are prescribed without evidence.

After user review, claim product execution alone in STATUS with owner/start and commit/push before Task1 product files. Keep Native/default branch preference; do not ask execution method again. Execute tasks in order with RED/GREEN evidence and checkpoints; record precise blockers without broadening scope.
