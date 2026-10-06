# NIC Sandbox Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans for the user-selected Native method. Steps use checkbox syntax for tracking. Implement tasks inline; one independent final reviewer after implementation, not implementer agents.

**Goal:** Deliver scoped mock/NIC sandbox IRN and EWB operations with immutable evidence, durable recovery and clearly separate sandbox printing.

**Architecture:** Typed provider adapters sit in `packages/gsp`; the API snapshots sources and atomically queues operations with audit. A database-leased worker performs network calls outside accounting transactions. Lookup resolves uncertain outcomes before any resend; no production endpoints or legal invoice QR changes.

**Tech Stack:** Existing Node24, pnpm10, TypeScript, NestJS, Next.js, Drizzle/PostgreSQL, Zod, fixed-point `Dec`; Node crypto for envelope encryption. Reuse Vitest and existing Playwright conventions. No Redis or general queue dependency.

**Spec:** [Approved NIC sandbox design](../specs/2026-10-06-nic-sandbox-design.md), approved 2026-10-06. Native and default-branch execution already selected.

## Authorized offline delivery

The user authorized proceeding with available offline capability on2026-10-06. Tasks1–4,6–7 implemented; Task8 offline verification complete; normal delivery recorded in the handoff. Task5 and Task8 real-provider verification remain externally blocked. [Review/rulings](../reviews/2026-10-06-nic-sandbox-review.md) tracks actual coverage, intentional bounded UI/retry deviations and four deferred Minors; the original checklist below remains the full target, not a claim that unavailable NIC/credentialed checks ran.

- [x] Typed contracts, durable deterministic mock, decimal validation and envelope encryption.
- [x] Additive0018 scoped immutable evidence, masked configuration and role catalog.
- [x] Fenced leases, original and child uncertain-outcome recovery without blind resend.
- [x] Source snapshots, authoritative issued identities and source cancellation/enqueue barriers.
- [x] EWB generation/fromIRN, transport update, extension/cancellation and shared completeness validation.
- [x] Settings/workspace/separate sandbox print; initial source preparation and uncertain-child controls.
- [x] One fresh final review; five Important findings reproduced before one correction pass.
- [x] Final offline API/browser compatibility and durable delivery record.
- [ ] Verified NIC official contract/adapter/replay vectors — blocked, no guessed implementation.
- [ ] Whitelisted credentialed NIC acceptance — blocked, no provider traffic.

## Global Constraints

- No shared entity activation, production statutory submission or taxpayer notification.
- Preserve decisions005/006/020/030/034 and existing migrations0011–0017 byte-for-byte; generate additive0018 with a descriptive name.
- `mock` and `nic_direct` sandbox only; do not accept arbitrary URLs or production connections, including direct API/database inputs.
- Sandbox IRNs/QRs never enter legal invoice/note prints. Existing applicable GST-note refusal remains until a production issuance design.
- No changes to source GL, bill effects, FIFO or shipment semantics; source-linked cancellation guards only.
- Immutable payload after a potentially sent attempt; secrets never returned, logged or included in audit. Money/quantity arithmetic uses `Dec` and decimal strings.
- Network outside DB transactions; uncertain calls require lookup. Never promise remote exactly-once.
- Separate IRN/EWB generation first; no combined generation, bulk screens, consolidated EWB, rejection, GST filing, new challans or live GSTIN lookup.
- Current queue choice is a slice-specific DB outbox; proposed decision017 remains proposed.
- Tests default to API4000/web3000 and accept `API`, `WEB_ORIGIN`, `WEB_URL`; pace isolated auth fixtures serially.

## Review Focus

1. Timeout after NIC accepted a document: recover original registration without a second generate (Tasks3/5/6).
2. Worker lease expires while its response arrives: old completion cannot overwrite newer evidence (Task3).
3. Master/credential changes between preview and send: frozen payload stays intact; credential revision changes are explicit (Tasks2/4).
4. Source cancellation competes with registration or EWB update: one consistent winner, with no orphan live operation (Tasks4/6).
5. User supplies production environment/URL or foreign-scope operation ID: reject before secrets/network access (Tasks2/5/7).

## Provider-documentation prerequisite and honest release labels

On 2026-10-06 the cloud network proxy returned `Tunnel connection failed: 403 Forbidden` for:

- https://einv-apisandbox.nic.in/
- https://einv-apisandbox.nic.in/apihelp.aspx
- https://docs.ewaybillgst.gov.in/
- https://einvoice6.gst.gov.in/content/kb/

After the user updated the allowed domains and the cloud restarted on 2026-10-06,
rechecks reached the public `einvoice6.gst.gov.in/content/kb/` (HTTP200), but NIC
sandbox home/API help/schema URLs still returned503 with upstream connection
timeout. `einvoice1.gst.gov.in` and `ewaybillgst.gov.in` also returned503;
`docs.ewaybillgst.gov.in` returned a CDN-generated403 Access Denied. The former
tunnel denial changed, but NIC-specific protocol access is still unresolved.
The reachable public IRP knowledge base is not a verified NIC wire contract.

These are candidate official sources, not retrieved/version-verified contracts.
Task5 must obtain accessible official documentation or authorized exported copies,
record final source URLs/version dates/checksums in `packages/gsp/docs/nic-sandbox-contract.md`,
and pin IRP/EWB schema versions, auth encryption vectors, endpoint paths, lookup
semantics and rule profiles before writing the NIC wire adapter. Do not derive
crypto or statutory deadlines from memory. This access limitation does not block
Tasks1–4,6–7 using deterministic mock canonical fixtures; it does block claiming
NIC adapter/protocol verification. Real access/whitelist/credentials are separately
required for Task8 provider acceptance. Deliver/report offline coverage independently
if either prerequisite remains unavailable; do not mark Tasks5/8 complete falsely.

## Shared interfaces and file ownership

`packages/gsp/src/contracts.ts` owns `SandboxScope` (tenant/entity/registration IDs,
GSTIN, environment literal sandbox), `DocumentSnapshot` (INV/CRN/DBN identity,
source/sample provenance, seller/buyer/line/tax/INR evidence), `TransportDraft`,
`OperationAction`, `ProviderCommand`, `ProviderEvidence` and `ProviderOutcome`.
Commands cover IRN generate/get-by-document/get-by-IRN/cancel and EWB
generate/generate-from-IRN/get/update-partB/extend/cancel. Outcome discriminants:
`confirmed` with evidence, `rejected` with sanitized provider code/issues,
`unknown`, `not_found`, `unsupported`; only lookup can return the last two.

`SandboxProvider.execute(command: ProviderCommand, access: ProviderAccess): Promise<ProviderOutcome>`
is the provider boundary. `ProviderAccess` is server-only connection/credential
revision plus secret material, never an API DTO. State, payload hashes and retry
eligibility are owned by API/domain services, not providers.

API code goes in `apps/api/src/modules/gst-sandbox/`: `contracts.ts`,
`connections.service.ts`, `source-snapshot.service.ts`, `operations.service.ts`,
`outbox.service.ts`, `source-guards.ts`, `transport.service.ts`, `controller.ts`
and `module.ts`. Provider wire/crypto/fixtures stay in `packages/gsp`.
Worker code imports provider and database packages, not NestJS internals.
UI goes in scoped components/lib and new compliance/settings routes, following
existing entity-keyed forms and shared UI tokens.

---

### Task1: Typed canonical contracts and deterministic provider

**Files:** Create `packages/gsp/src/{contracts,canonical,redaction,mock}.ts` and corresponding `.test.ts`; modify `packages/gsp/src/index.ts`, `packages/gsp/package.json`, `pnpm-lock.yaml` only for required Zod/core/Vitest dependencies.

**Interfaces:** Produce `SandboxProvider`, `validateSnapshot(snapshot): ValidationIssue[]`, `canonicalHash(value): string`, `redactEvidence(value): JsonValue`, `MockSandboxProvider`. Keep unsupported returns/lookup capabilities explicitly unsupported; do not claim all draft GSP capabilities are implemented.

- [ ] Write failing tests: `foreign_snapshot_keeps_exact_inr_components` asserts original USD100@80 → INR8000; `master_change_does_not_change_hash`; `mock_timeout_then_lookup_returns_same_irn`; `malformed_evidence_rejected`; `redaction_removes_nested_tokens_and_session_keys`. Mock success is deterministic for document identity; duplicate identity with changed hash conflicts.
- [ ] Run `pnpm --filter @factoryos/gsp test`; observe genuine missing behavior after configuring its test runner, not merely an absent script.
- [ ] Implement explicit canonical types, stable hashing/validation, deterministic mock scenarios and safe evidence redaction. Preserve request decimal strings; defer final NIC schema encoding to Task5.
- [ ] Run gsp tests/build/typecheck; ensure rejected/unknown cases cannot return fabricated confirmed evidence.
- [ ] Commit `Add canonical sandbox provider contracts and mock scenarios`.

### Task2: Scoped durable evidence, encrypted connections and roles

**Files:** Create `packages/db/src/schema/gst-sandbox.ts`, generated `0018_gst_sandbox_operations.sql` and snapshot; export schema. Create `packages/gsp/src/credential-envelope.ts`/tests, API `connections.service.ts`/contracts/controller/module. Modify API config/app module/env example and permission/role catalogs.

**Interfaces:** Produce tables `gstSandboxConnection`, `gstSandboxCredentialRevision`, `gstSandboxSnapshot`, `gstSandboxOperation`, `gstSandboxAttempt`, `gstSandboxEvent`; `sealCredential(value,keyVersion): EncryptedEnvelope`, `openCredential(envelope,keyring): ProviderSecrets`; `getAccessIn(tx,scope,connectionId): ProviderAccess`. Composite scoped FKs protect sources/connections/results. Operation current-state projection may update; snapshot/attempt/result events are append-only. Unique generation identity includes registration/environment/document type/number/FY; provider changes do not bypass it.

- [ ] Write `smoke-gst-sandbox-schema.mjs` and crypto/permission tests: duplicate identity conflicts, foreign-scope references fail, append-only evidence refuses mutation, no credentials readback/audit; key rotation decrypts old evidence without auth-secret reuse. Tampered authentication tags and missing keys refuse decryption. Connection production/URL injection yields400 before network.
- [ ] Run focused tests and observe missing schema/resources failures.
- [ ] Implement Finance-only configuration and masked metadata endpoints `/compliance/sandbox/connections`; mock needs no secret key, NIC connection activation does. Declare `GSP_CREDENTIAL_KEY_V1` as a base64 32-byte secure environment requirement, never generate a production key in tracked files. Declare separate read/export/manage/prepare/send/reconcile/cancel/transport/update/extend/detach permissions; Finance owns cancellation/detach and valuation confirmation, Accountant prepares/sends/reconciles, Stores transport/PartB only.
- [ ] Generate migration with `pnpm --filter @factoryos/db db:generate --name gst_sandbox_operations`; build DB then `node --env-file=.env packages/db/dist/migrate.js` on isolated fixtures only. Run schema/crypto/auth tests and verify old migration byte identity.
- [ ] Commit `Add scoped sandbox evidence and encrypted connections`.

### Task3: Atomic enqueue, leases and unknown recovery

**Files:** API `operations.service.ts`, `outbox.service.ts`, `source-guards.ts`; shared database lease functions in `packages/db/src/gst-sandbox-outbox.ts` exported from its index; create `packages/gsp/src/operation-policy.ts`/tests and `apps/worker/src/{config,sandbox-worker,index}.ts`; modify worker package and env example. Test `smoke-gst-sandbox-races.mjs`/`smoke-gst-sandbox-recovery.mjs`.

**Interfaces:** `enqueueIn(tx,ctx,prepared): OperationView`; `claimOperation(db,workerId,now): LeasedOperation|null`; `completeOperation(db,leaseToken,outcome): boolean`; `recoverExpiredLease(db,now): number`. The claim/complete/recover functions live in the shared database module; API outbox service delegates to them and the worker imports them directly. A lease token/attempt sequence fences stale completion. `reconcile(operationId)` creates a linked lookup attempt, never calls generate directly.

- [ ] Write failures for real PG barriers: two workers claim once, two click requests reuse one operation, stale response cannot overwrite reconciliation, expired sending goes unknown, timeout-after-success recovers one IRN and generate call count remains1. Unknown-not-found remains blocked until provider-documented authoritative absence/retry policy permits resend; unsupported/mismatched lookup never unblocks it.
- [ ] Run race/recovery fixtures and gsp policy tests before implementation.
- [ ] Implement bounded polling/outbox claim with `FOR UPDATE SKIP LOCKED`, 60s lease, 20s attempt timeout and 5s polling; process one operation at a time initially. Confirmed safe retry delays30/120/600s, max3, honoring larger provider Retry-After. Graceful shutdown stops new claims; interrupted sent requests recover as unknown. All DB transactions end before network execution.
- [ ] Add worker `start` script, explicit database/key config and readiness output with no secrets. Run two worker processes against isolated fixtures, kill one during sending and verify recovery and fencing. Require environment/provider check immediately before execution.
- [ ] Commit `Queue sandbox operations with leased recovery and fencing`.

### Task4: Frozen outward snapshots and source cancellation guards

**Files:** API `source-snapshot.service.ts`, `source-guards.ts`, operation routes; modify `selling.controller.ts`, sales-note service and supplier-return movement cancellation only for guards. Test `smoke-gst-sandbox-sources.mjs`.

**Interfaces:** `prepareSourceIn(tx,ctx,source: {kind:'sales_invoice'|'sales_note'|'purchase_return'|'sample';id?:string},input): PreparedSnapshot`; `assertSourceCancelableIn(tx,scope,source): void`; `detachExercise(ctx,operationId,reason): OperationView`. Preview returns revision/hash/issues and permission-scoped evidence; enqueue revalidates hash/status under entity accounting lock.

- [ ] Write failing tests: party edits after enqueue retain names/GST/PIN/payload; foreign components use original rates; commercial/supplier notes cannot masquerade as our outward GST note; source cancellation vs enqueue has one consistent winner; sample creates no bill/GL/FIFO effects. Already-confirmed exercise needs provider cancellation or audited Finance detachment before source reversal.
- [ ] Run source fixture; verify initial missing-route/guard failures.
- [ ] Map source snapshots from exact stored totals and explicit missing-field inputs. Snapshot from live masters once, visibly identify captured evidence; no claim that historical source master data was already immutable. Sample mode uses complete Finance-reviewed synthetic snapshot with explicit provenance. Keep applicable GST-note guard; no new real submission bypass. Detachment does not cancel NIC or erase history, and is refused for queued/sending/unknown operations.
- [ ] Run source fixture plus selling/customer-note/supplier cancellation regressions; compare all source financial/stock ledgers before/after sandbox actions.
- [ ] Commit `Snapshot sandbox sources and guard concurrent cancellation`.

### Task5: Verified NIC sandbox protocol adapter

**Files:** `packages/gsp/docs/nic-sandbox-contract.md`; create `src/nic/{auth,crypto,irp,ewaybill,transport,response}.ts`, fixtures and focused tests; API provider factory.

**Interfaces:** `NicSandboxProvider implements SandboxProvider`; fixed sandbox endpoint selection, schema serializers and documented response/error translation. IRP/EWB auth/session caches are isolated by registration/capability/credential revision; tokens/session keys encrypted, bounded by provider expiry.

- [ ] Obtain/version-pin the official documentation prerequisite above. Record schema/auth/endpoint/lookup/cancellation/extension constraints and public signing-key provenance. If unavailable, record blocker and continue independent mock/UI tests without writing guessed protocol code.
- [ ] Write failing official-vector tests for request encryption, authentication, decimal encoding, malformed signatures, documented duplicate errors, token refresh once, status lookup and production-host rejection. Sanitized HTTP replay fixtures contain no real credentials/taxpayer data.
- [ ] Implement strict allowlisted TLS transport, bounded response/body sizes, timeouts and response schemas; no TLS bypass. Map transport ambiguity to unknown, not rejected. Quarantine malformed/signed evidence and store redacted diagnostic status. Missing authoritative document lookup remains unsupported/blocked.
- [ ] Run gsp protocol/vector tests using local HTTP replay transport; verify no fixture sends real traffic. Persist versioned rule profiles; no unverified deadline/threshold becomes a legal production default.
- [ ] Commit `Implement verified NIC sandbox adapters and protocol fixtures` only when official-contract verification is complete.

### Task6: EWB lifecycle and explicit transport evidence

**Files:** API `transport.service.ts` and contracts/routes; canonical EWB mapping; `smoke-gst-sandbox-ewb.mjs`.

**Interfaces:** `prepareTransportIn(tx,ctx,snapshotId,draft: TransportDraft): PreparedSnapshot`; enqueue EWB generate/fromIRN/get/updatePartB/extend/cancel through Task3. Updates have separate caller idempotency keys/payload hashes and original EWB identity; serialized per EWB so competing updates cannot reorder blindly.

- [ ] Write failing scenarios: service-only refuses; sales goods map source quantity/value; purchase-return carrying320 cannot silently become statutory value; Finance valuation confirmation is required where undetermined; changed vehicle after confirmed update is a new action, repeated click is not. Cancellation vs update and lease recovery retain one coherent history. Mismatched EWB lookup leaves unknown.
- [ ] Run EWB fixture before routes/mapping.
- [ ] Implement explicit dispatch/ship-to, movement reason, distance/mode/transporter and mode-specific fields. Validate using versioned documented profiles; require provider confirmation for validity/extension. Confirmed IRN reference required for fromIRN; samples and source-linked records remain distinct. Refuse unsupported challan/customer-owned source types.
- [ ] Run EWB and recovery fixtures with deterministic mock; Task5 replay validation when available. Assert no additional stock movement/GL.
- [ ] Commit `Add sandbox e-way bill transport and lifecycle evidence`.

### Task7: Settings, operations workspace and sandbox print

**Files:** `apps/web/src/lib/gst-sandbox.ts`; components `gst-sandbox-connections.tsx`, `gst-sandbox-form.tsx`, `gst-sandbox-detail.tsx`, `gst-sandbox-print.tsx`; routes `/app/settings/gst-integrations`, `/app/compliance/sandbox`, `/new`, `/[id]`, `/[id]/print`; sidebar/palette/source shortcuts. Tests `apps/web/e2e/gst-sandbox.mjs` and `gst-sandbox-readonly.mjs`.

**Interfaces:** Typed read/write APIs from earlier tasks; every form keyed by tenant/entity, server preview hash captured with request snapshot; serialized mutations and scoped invalidation. UI never receives ProviderAccess or ciphertext.

- [ ] Write browsers that fail on absent workspace: Accountant previews/enqueues, Finance saves masked connection/cancels/detaches, Stores edits transport/PartB without IRN/secret access, Auditor reads/exports only. Unknown disables blind retry; cross-scope navigation cannot reuse preview. Mobile and watermarked print retain snapshots after master edits. Legal invoice/note print has no sandbox IRN/QR.
- [ ] Run against production web and observe missing route/actions.
- [ ] Implement shared-token components, clear provider/environment labels and redacted operation timeline. Render provider QR via a narrowly scoped QR encoder dependency only when valid evidence exists; print says `SANDBOX — NOT A VALID TAX INVOICE`. Display signature verification status; mock is explicitly simulated, never verified NIC evidence.
- [ ] Build production web, copy standalone static assets, restart only own process, probe health and run both browsers with overrides. Do not expose loopback links to user.
- [ ] Commit `Add sandbox compliance workspace and watermarked printing`.

### Task8: Final verification, one independent review and delivery

**Files:** All focused scripts; durable review `docs/superpowers/reviews/2026-10-06-nic-sandbox-review.md`; STATUS/MEMORY/LOG/spec/plan.

**Interfaces:** Complete operation lifecycle and explicit offline/protocol/live verification labels.

- [ ] Run root build/typecheck/tests/lint; preserve exits/counts. Serial API fixtures: schema, sources, EWB, recovery/races and existing selling/accounting/customer/supplier/stock regressions. Run production sandbox browsers plus affected existing source/print browsers. No concurrent shared-IP signup fixtures.
- [ ] Check real sandbox eligibility/access/whitelisted IP and secure credentials. If available, run controlled synthetic generation→lookup→cancel IRN and EWB generate/update/extend/cancel with explicit safe fixture identities; record sanitized provider acknowledgements. Report unsupported/provider-refused actions separately. If unavailable, record external blocker and complete only independent offline work; never claim real provider acceptance.
- [ ] Request one fresh independent final review with approved spec/plan, base-to-head range and five Review Focus cases. Native implementer stays inline. Reproduce Important defects before one fix pass; preserve RED/GREEN and all rulings; rerun affected checks.
- [ ] Verify old migrations unchanged, no secrets, `git diff --check`, source-ledger invariance and inactive shared books. Update durable handoff with actual coverage/blockers. Accounting design is next, followed by foundation slices; do not silently expand this plan.
- [ ] Commit verified delivery and normally push to default branch, confirming clean status/remote HEAD. Preserve blocked provider work explicitly if access remains unavailable.

## Self-review

All approved sections map to Tasks1–8. Review Focus cases are pinned to named
fixtures. Shared provider/outbox/source interfaces are defined once above; worker
does not depend on API internals. Scope preserves applicable-note refusal,
separate sandbox evidence, unchanged source books and no production activity.
Official documentation/network and credentialed provider verification are explicit
prerequisites with independent offline progress, not invented passing checks.
Native is preserved; the user authorized available offline implementation. Remaining provider gates and bounded offline deviations are recorded above.
