# Audited Support Access Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give a known platform operator tenant-approved, temporary read-only access to one member's permitted business data in one legal entity, with both identities in durable evidence.

**Architecture:** Keep the native operator session and authorize a separate application grant; never create a target session. A locked control transaction validates consent and authority, a separate bounded PostgreSQL read-only transaction materializes cataloged data, and required evidence commits before any data leaves the API. A dedicated web workspace owns its context, cache and cancellation.

**Tech Stack:** TypeScript, NestJS, Better Auth 1.7.7 with the accepted SSO/passkey integration, Drizzle/PostgreSQL 16, Next.js, TanStack Query, existing `@factoryos/ui`, Node assertion fixtures and Playwright.

**Spec:** [Approved written design](../specs/2026-10-09-support-access-design.md), accepted decision049. User APPROVED the written spec on2026-10-09. This nine-task plan awaits written review.

**Execution method:** Native inline, already selected. Implement all tasks in this session using the preserved method, then one fresh independent whole-branch review and author correction pass. No per-task agents or repeat method selection. The generic skill header does not override that preference.

## Global Constraints

- `SUPPORT_ACCESS_ENABLED=false`; typed tenant policy also defaults disabled. No emergency bypass, target credentials/cookies, native admin plugin, business mutations, exports/attachments or PostgreSQL RLS.
- Default/deployment maximum1800 seconds; tenant maximum integer300–1800; request duration300..tenant maximum. Approval starts within600 seconds, exactly once; no renewal or broader scope. Deadline uses database time after waits and cannot exceed the native actor session expiry captured at start.
- Approval, enablement and start require locally verified email, verified enabled local TOTP, completed native sign-in age `[0,300s)` and actual native password confirmation. Preserve native password/TOTP/backup/trusted-device/SSO/passkey semantics. Pending challenges refuse; missing password/MFA requires normal enrollment/sign-in.
- Current platform levels `superadmin|support` may operate; existing `@PlatformAdmin` remains SuperAdmin-only. Approver differs from operator; target is an active tenant member with no platform-admin record. No target owner/admin shortcut.
- Effective panels = consent ceiling ∩ current target entity-scoped permissions ∩ fixed five-area catalog. Reject `x-entity-id` on tenant consent/policy controls; custom control authority must be tenant-wide.
- Relevant tenant/member/role/entity/platform/password/email/verified-factor changes invalidate consent irreversibly through transactional revisions. Approver logout alone does not revoke consent; deletion of the bound operator session does. Unrelated session cleanup, session renewal, names/descriptions and failed-factor counters do not.
- Read pool is separate: max2, connection wait2000ms. Control lock/statement work is bounded to5000ms; apply a5000ms transaction deadline as well so multiple statements cannot accumulate unlimited work. No second ordinary-pool connection for data.
- Use authoritative native `getSession` with `disableCookieCache:true,disableRefresh:true`. Support header is an untrusted grant selector accepted only on workspace GETs; reject it before native auth dispatch and public shortcuts elsewhere. Exact configured web Origin; workspace GET fallback requires same-origin Fetch Metadata AND exact allowed Referer origin. Never trust Host/forwarded origin as configuration.
- Control requests keep ordinary real-actor context. Read audits use subject `actor_user_id`, operator `impersonator_user_id`; ordinary audit serialization and null impersonator remain unchanged. No passwords, native tokens/challenges, private versions or response bodies in DTOs/evidence.
- Existing shared `.env`, DB histories, book activations, published SQL and other owners remain protected. Generate migration numbers from freshly merged main; do not reserve one. No automatic shared migration, live enrollment/provider configuration or deployment.
- Node24.19/pnpm10.28; cloud PATH `/workspace/.factoryos-tools/node_modules/.bin`. Fixtures default API4000/web3000 and honor `API`, `WEB_ORIGIN`, `WEB_URL`; owned runtimes run sequentially. No dependency/framework upgrade is required.

## Review Focus

1. Disable→restore of an operator, member or permission must never revive old consent, even without an intervening workspace request: Task2 epochs and Task9 restoration barriers.
2. Native password/factor reset during password confirmation must refuse approval/start while ordinary recovery still succeeds: Task3 real native proof and Task9 reset barrier.
3. An ordinary GET can write books; support selection on native/public/normal/export endpoints must refuse before dispatch: Tasks5/6 purity and transport tests.
4. Pool/audit waits can cross expiry; neither cached timestamps nor a rolled-back audit may release data: Tasks6/9 real separate-PID and deadline tests.
5. An account switch or held response can show the previous subject's data; invalidate and abort before render, preserve native identity/storage: Task8 production browser races.

---

## File boundaries and shared contracts

Create `packages/auth/src/support-access.ts` for the dependency-free safe-read catalog and wire types, exported from `packages/auth/src/index.ts`. API-only Zod validation and private proof/transaction types live in `apps/api/src/modules/support-access/support-access.types.ts`; no web import from API internals.

Create `packages/db/src/schema/support-access.ts` (four additive tables), export from `packages/db/src/schema/index.ts`. Generate SQL/snapshot/journal in `packages/db/drizzle/` under name `support_access`; after merging prerequisites choose the actual next journal index. Narrow trigger/check/append-only SQL belongs in that new migration; published migrations stay byte-identical.

New API directory `apps/api/src/modules/support-access/`: `support-access.config.ts` (deployment policy), `support-access.store.ts` (SQL transitions/authority), `support-access.proof.ts` (native proof), `support-access.controller.ts` (tenant/operator controls), `support-access.transport.ts` (pre-dispatch origin/header boundary), `support-access.read-pool.ts` (dedicated read-only pool), `support-access.read.ts` (locked execution), `support-access.audit.ts` (two-identity adapter), `support-access.workspace.controller.ts` (two fixed GET routes), `support-access.present.ts` (safe table/detail mapping). Register through `apps/api/src/app.module.ts`; pre-dispatch middleware through `apps/api/src/main.ts` before `/api/auth/{*path}`.

Extract only supported SELECT helpers into `apps/api/src/modules/readers/inventory.read.ts`, `sales-invoices.read.ts`, `purchase-invoices.read.ts`, `work-orders.read.ts`, `accounting-reports.read.ts`. Existing inventory/selling/buying/manufacturing work-orders/accounting reports controllers delegate their matching ordinary reads without changing ordinary DTOs or permissions. No broad module refactor.

New web files: `apps/web/src/lib/support-access.ts` (explicit support transport), `apps/web/src/components/support-access-controls.tsx` (safe policy/approval/history), `support-access-provider.tsx` (isolated context/cache), `support-access-panels.tsx` (read-only tables/detail); routes `apps/web/src/app/app/settings/support-access/page.tsx`, `apps/web/src/app/support/page.tsx`, `apps/web/src/app/support/workspace/[grantId]/page.tsx` and a dedicated support layout. Modify `apps/web/src/components/app-shell.tsx` only for links, not native workspace authority/storage.

Wire contracts are defined in Task1; all later tasks consume these exact names:

```ts
type SupportArea = 'inventory'|'sales-invoices'|'purchase-invoices'|'work-orders'|'accounting';
type SupportState = 'approved'|'active'|'expired'|'invalidated'|'stopped'|'revoked';
type SupportPolicy = {enabled:boolean;maxDurationSeconds:number;allowedAreas:SupportArea[]};
type SupportPolicyInput = SupportPolicy & {password?:string}; // required when enabling
type SupportApprovalInput = {operatorEmail:string;targetMembershipId:string;entityId:string;areas:SupportArea[];durationSeconds:number;reason:string;password:string};
type SupportIdentity = {id:string;name:string;email:string};
type SupportGrantSummary = {id:string;tenantId:string;tenantName:string;entityId:string;entityName:string;operator:SupportIdentity;subject:SupportIdentity;approver:SupportIdentity;areas:SupportArea[];reason:string;durationSeconds:number;approvedAt:string;startBy:string;startedAt:string|null;expiresAt:string|null;state:SupportState};
type SupportEventKind = 'approved'|'started'|'stopped'|'revoked'|'expired'|'invalidated'|'read'|'denied'|'policy-changed';
type SupportHistoryEntry = {id:string;grantId:string|null;kind:SupportEventKind;occurredAt:string;actorUserId:string|null;subjectUserId:string|null;operatorUserId:string|null;area:SupportArea|null;reasonCode:string|null};
type SupportGrantPage = {grants:SupportGrantSummary[];events:SupportHistoryEntry[];nextCursor:string|null};
type SupportWorkspaceContext = {grant:SupportGrantSummary;actor:SupportIdentity;actorSessionId:string;effectiveAreas:SupportArea[];serverNow:string;expiresAt:string};
type SupportCell = string|boolean|null; // money/quantity remain decimal strings
type SupportTable = {columns:{key:string;label:string}[];rows:Record<string,SupportCell>[];nextCursor:string|null};
type SupportDetail = {fields:{label:string;value:SupportCell}[];tables:{label:string;table:SupportTable}[]};
type SupportPanelResult = {kind:'table';table:SupportTable}|{kind:'detail';detail:SupportDetail};
type SupportListQuery = {limit:number;cursor?:string;status?:string};
type SupportQuery =
 | {area:'inventory';panel:'balance'|'ledger';limit:number;cursor?:string;itemId?:string;warehouseId?:string;batchId?:string;owner?:string;from?:string;to?:string}
 | {area:'sales-invoices'|'purchase-invoices'|'work-orders';panel:'list'|'detail';limit:number;cursor?:string;id?:string;status?:string}
 | {area:'accounting';panel:'status'|'trial-balance'|'ledger'|'day-book';limit:number;cursor?:string;accountId?:string;partyId?:string;from?:string;to?:string};
```

Schemas require UUID document/filter IDs, ISO dates and ordered date ranges; page size default100, integer1–500. Query unions are strict per panel: inventory ledger requires itemId, document detail requires id, accounting ledger requires accountId; inappropriate fields, unknown/duplicate parameters, arbitrary area/path/SQL fail400. `owner` is `company|customers|UUID`; status uses each existing document enum. Reasons trim3–500 characters; passwords never retained beyond proof invocation. Cursors are bounded base64url encodings of deterministic sort position, max512 characters, parsed/validated without granting scope. History/inbox queries only `{limit,cursor}`; request body schemas are strict. Private DTO projection never spreads a database row.

API-private Task1 types:

```ts
type SupportTx = Parameters<Parameters<Database['transaction']>[0]>[0];
type SupportExecutor = Pick<Database,'select'|'execute'>;
type SupportScope = {tenantId:string;entityId:string;membershipId:string;subjectUserId:string;permissions:ReadonlySet<string>};
type SupportProof = {userId:string;sessionId:string;securityEpoch:string;passwordVersion:string}; // server-only, no serialization
type SupportReadAuthority = {grant:SupportGrantSummary;scope:SupportScope;actorSessionId:string};
type SupportEvidence = {kind:SupportEventKind;area:SupportArea|null;reasonCode:string|null};
type SupportConfig = {enabled:boolean;maxDurationSeconds:1800;origins:string[]};
type SupportReadPool = {run<T>(fn:(tx:SupportExecutor)=>Promise<T>):Promise<T>;close():Promise<void>};
```

`SupportScope` is deliberately not `RequestContext`; it cannot carry owner/platform shortcuts. Proof is returned only by the server proof service and consumed immediately in the same request, never as a client nonce/boolean. Every store method rechecks captured proof under authority locks. Errors expose only `{code:'SUPPORT_UNAVAILABLE'|'SUPPORT_REAUTHENTICATE'|'SUPPORT_ENDED'|'SUPPORT_INVALID_INPUT'}`; unknown/foreign grants are generic404.

## Prerequisite gate before product work

- [x] Written spec approved2026-10-09; decision049 Accepted; Native inline method retained.
- [ ] User reviews this written plan. Record approval without another scope/method question.
- [ ] Fetch main explicitly and verify the passkey completion reconciled beyond a607949 against published0030_quality (current planning base mainc6cbe0d; original reviewed SQL bytes preserved, journal/snapshots coherent and affected verification repeated), both accepted auth integrations, this spec/plan/decision and immutable published journal are present. Known GraphQL403 is not grounds for identical API retries; use [passkeys PR handoff](https://github.com/ujjwalsittu/factory-os/pull/new/passkeys-implementation-20261008) with actual green CI. No software claim before prerequisites reach main.
- [ ] Commit/push a STATUS-only named-owner/start-time support-access claim on its own branch from latest main; merge its separate small green-CI PR before Task1 under [AGENTS.md](../../../AGENTS.md). Preserve merged manufacturing2d/0030_quality and the accounting owner. This planning entry is not that merged product claim.
- [ ] Start the implementation branch from freshly fetched main, using the existing isolated cloud checkout. Read installed framework docs before changing web/auth integration; capture a fresh migration/book/activation/auth/audit baseline from a protected read-only source and create an owned logical copy for migration tests. Never migrate the shared source or infer all saved activations are inactive.

## Verification conventions

Run a dependency build before RED/GREEN Node fixtures: `pnpm --filter @factoryos/api... build`; RED must fail for the named missing behavior, not missing compiled dependencies or database connectivity. Node suites use `node --env-file-if-exists=.env apps/api/scripts/<suite>.mjs` from repository root and own their disposable databases/processes. Stop/drop only resources each suite created, in `finally`.

Task2 creates `apps/api/scripts/support-access-test-helpers.mjs` with `startSupportFixture(overrides?:NodeJS.ProcessEnv):Promise<SupportFixture>`. `SupportFixture` has `db:Database`, `url:string`, `auth:Auth`, `config:AppConfig`, `request(path:string,options:{method?:string;body?:object;cookies?:Map<string,string>;headers?:Record<string,string>}):Promise<{status:number;data:unknown;headers:Headers}>`, `localUser(email:string):Promise<{id:string;cookies:Map<string,string>;ctx:RequestContext}>`, and `close():Promise<void>`. Task3 extends it with `completedUser(email:string,mode:'totp'|'backup'|'trusted'|'sso'|'passkey'):Promise<{id:string;cookies:Map<string,string>;ctx:RequestContext}>`, using actual signed native paths and reusable accepted SSO/passkey cryptographic helpers. It mounts real Nest/native handlers through the production transport middleware; no successful authentication/authorization response is mocked. Use separate native pending cases. Test snippets below are representative assertions in the named test, with its seeded objects/response variables; the adjacent case matrix is also required.

### Task1: Disabled deployment policy, wire contract and permissions

**Files:** Create shared/private types and `support-access.config.ts` above; create `packages/auth/src/support-access.test.ts`, `apps/api/scripts/smoke-support-access-config.mjs`; modify `packages/auth/src/{index,permissions,roles}.ts`, `apps/api/src/config.ts`, `.env.example`.

**Interfaces:** Produce `SUPPORT_READ_CATALOG:Readonly<Record<SupportArea,string>>`, `loadSupportConfig(env:NodeJS.ProcessEnv,webOrigin:string):SupportConfig`, `parseSupportQuery(area:SupportArea,query:unknown):SupportQuery`, `parseSupportApproval(input:unknown):SupportApprovalInput`, `parseSupportPolicy(input:unknown):SupportPolicyInput`, `parseSupportList(input:unknown):SupportListQuery`. `AppConfig.supportAccess:SupportConfig`. Shared types export from `@factoryos/auth`.

- [ ] **Write failing tests** `support_catalog_and_control_scope`: exactly the five spec permissions; settings.support_access read/configure/approve/cancel are valid; Owner/Administrator receive all, read-only role rules receive read only. Config defaults false and cap1800; strict origin/body/query parsing and299/1801 duration rejection.
  ```js
  assert.equal(loadSupportConfig({},'http://localhost:3000').enabled,false);
  assert.equal(Object.keys(SUPPORT_READ_CATALOG).length,5);
  assert.throws(()=>parseSupportQuery('inventory',{panel:'ledger',itemId,sql:'select 1'}));
  assert.throws(()=>parseSupportApproval({...input,durationSeconds:299}));
  ```
- [ ] **Run RED:** `pnpm --filter @factoryos/auth test`; then dependency build and `node --env-file-if-exists=.env apps/api/scripts/smoke-support-access-config.mjs`. Expect missing new catalog/config/parser behavior.
- [ ] **Implement** the exact interfaces and shared types. Register `settings.support_access.*`; retain existing permission evaluation, Administrator rules and SuperAdmin restrictions. Use only canonical WEB_ORIGIN for support transport in this release; unrelated extra trusted origins do not silently expand it. Normalize configured URL to origin and reject configuration containing credentials/non-root path/query/fragment.
- [ ] **Run GREEN:** the same two commands and `pnpm typecheck`; expect auth tests/config fixture PASS and no type errors.
- [ ] **Commit** `Define disabled support access and safe read contracts`; checkpoint/push.

### Task2: Durable consent, authority epochs and source-compatible migration

**Files:** Create schema/store and `support-access-test-helpers.mjs`, `smoke-support-access-schema.mjs`; modify schema index and generated new `support_access` SQL/snapshot/journal only. No native schema rewrite.

**Interfaces:** Add `type SupportGrantRecord = typeof supportAccessGrant.$inferSelect` to API-private types after creating this task's schema. Store produces `withAuthority<T>(actor:RequestContext,grantId:string,fn:(tx:SupportTx,authority:SupportReadAuthority)=>Promise<T>):Promise<T>`, `currentScope(tx:SupportTx,membershipId:string,tenantId:string,entityId:string):Promise<SupportScope>`, `summary(tx:SupportTx,row:SupportGrantRecord):Promise<SupportGrantSummary>`, `appendEvent(tx:SupportTx,actor:RequestContext,grantId:string|null,scope:SupportScope|null,evidence:SupportEvidence):Promise<void>`. Native proof snapshots in Task3 use `captureProofVersion(actor:RequestContext):Promise<SupportProof>` and `checkProof(tx:SupportTx,proof:SupportProof):Promise<void>`; these are server-only store interfaces callable by the proof service, never routes or browser exports.

- [ ] **Write failing tests** `schema_preserves_native_mutations_and_irreversible_epochs`: populated pre-migration source upgrade, four empty additive tables/no privileged grant, immutable scope/event constraints, disabled missing policy and valid cap/area constraints. Relevant update/delete bumps occur in the original source transaction; rollback restores epoch; change→restore increments twice. Exercise native password/email/factor/platform changes; member status/identity/ownership, role/assignment, entity eligibility and tenant status. Unrelated metadata/session renewal/factor failure counters do not bump. Native cleanup still works, historical references survive deletion.
  ```js
  assert.equal(after.roleAuthorityRevision, before.roleAuthorityRevision + 2n);
  assert.equal(afterRollback.securityEpoch,before.securityEpoch);
  assert.deepEqual(afterUpgrade.originalSqlHashes,beforeUpgrade.originalSqlHashes);
  assert.equal(afterUpgrade.nativeCredentialHash,beforeUpgrade.nativeCredentialHash);
  ```
- [ ] **Run RED:** dependency build then `node --env-file-if-exists=.env apps/api/scripts/smoke-support-access-schema.mjs`; expect missing additive tables/trigger invariants.
- [ ] **Implement** four tables and interfaces. Grant columns capture all fixed identities/scope, approval/start deadlines, approver/operator/subject epochs, policy/tenant revisions, proof HMAC and one-way terminal fields; constraints reject impossible transitions. Revisions use exact bigint/string conversion. No restrictive native identity/session FKs. Policy lazily creates its disabled row only in control/source-authority work, never business readers. Seed required participant epochs before proof snapshot; missing identity refuses. `summary` derives terminal expiry/version mismatch without waiting for a worker; private fields are omitted.
- [ ] **Implement source triggers** comparing only approved authority fields. Source security/platform changes increment user epoch; source tenancy/entity/role changes increment tenant authority revision. Compare OLD and NEW and collect both old/new tenant IDs for moved rows. Order affected user epoch locks lexically, tenant policy locks lexically, then grant locks lexically; all support control methods follow this order. Support checks never take locks on native/source rows after these locks: use current committed SELECTs and version comparison, avoiding source-row→epoch inversion. Multi-row transitions collect/sort affected keys with statement transition tables where applicable. Session DELETE invalidates only grants bound to that ID, with terminal evidence once; no renewal/unrelated-session invalidation. Keep original native transaction semantics; source rollback rolls back invalidation. Set bounded waits in support control work, not global native auth settings.
- [ ] **Run GREEN:** schema fixture, `pnpm --filter @factoryos/db db:generate --name support_access` consistency check and typecheck. First generation creates the additive migration; subsequent check reports no changes. Original journal prefix/SQL hashes/native success paths remain equal.
- [ ] **Commit** `Persist bounded support consent and authority revisions`; checkpoint/push.

### Task3: Native proof and tenant policy/approval/history controls

**Files:** Create proof/controller, `smoke-support-access-consent.mjs`; extend store/helper; register providers/controller in `apps/api/src/app.module.ts`. Use actual native verifier; no native admin plugin or target authentication hook.

**Interfaces:** `SupportProofService.confirm(headers:Headers,password:string):Promise<SupportProof>`; store `getPolicy(actor:TenantRequestContext):Promise<SupportPolicy>`, `setPolicy(actor:TenantRequestContext,input:SupportPolicyInput,proof:SupportProof|null):Promise<SupportPolicy>`, `approve(actor:TenantRequestContext,input:SupportApprovalInput,proof:SupportProof):Promise<SupportGrantSummary>`, `listTenant(actor:TenantRequestContext,query:SupportListQuery):Promise<SupportGrantPage>`. Consumes Task1 validators and Task2 captured version/current scope. Tenant routes use normal AccessGuard plus explicit tenant-wide grant evaluation; no entity-header trust.

- [ ] **Write failing tests** `real_native_consent_proof`: positive Owner/Admin/custom tenant-wide consent with actual completed TOTP/backup/trusted/SSO/passkey authentication; negative pending challenges, unverified email, disabled/unverified local factor, no password, age300s, incorrect password and forged proof fields. Approval password-reset race uses an actual blocked native verifier/SQL source mutation, not a caller fault hook. Entity-only approver, x-entity-id, self-approval, inactive/foreign target/entity and any target platform-admin record refuse. Exact operator lookup has generic unavailable failures/no directory. Policy disable/reconfigure invalidates all older consent; read-only delegated history cannot approve.
  ```js
  assert.equal(entityScopedApproval.status,403);
  assert.equal(pendingPasskeyApproval.status,403);
  assert.equal(resetDuringProof.status,403);
  assert.equal(validConsent.data.durationSeconds,1800);
  assert.equal('passwordVersion' in validConsent.data,false);
  ```
- [ ] **Run RED:** dependency build then `node --env-file-if-exists=.env apps/api/scripts/smoke-support-access-consent.mjs`; expect absent controls/proof checks.
- [ ] **Implement proof** using native authoritative non-renewing `getSession` and `verifyPassword({body:{password},headers})`. Capture server epoch/HMAC password version before verification; derive HMAC from existing auth secret with support-specific domain separation, never store raw credential hash. Recheck exact native session/current completed challenge flags, email/TOTP, database freshness and epoch/version under Task2 locks after verifier/waits. No password persists or reaches audit. Session createdAt must be native completed-session creation/provenance, not a browser freshness claim; exercise actual retained native MFA/SSO/passkey completion behavior.
- [ ] **Implement tenant controls** at the approved GET/PATCH policy and GET/POST grants routes. Enablement requires proof; disabling/reconfiguration still requires configure authority and invalidates grants. Enforce tenant-wide read/configure/approve, exact target entity eligibility and permission intersection. Resolve operator from exact normalized existing email without directory/detail leakage. Reject unknown fields, snapshot immutable600s start deadline and current revisions, append lifecycle evidence and existing tenant audit in the same control transaction.
- [ ] **Run GREEN:** consent/schema/config fixtures plus existing `smoke-sso-actions.mjs`, `smoke-sso-review-guards.mjs`, `smoke-passkeys-actions.mjs`, `smoke-passkeys-mfa.mjs`, `smoke-email-auth.mjs`; actual current native paths PASS, no target session/cookie added. These prerequisite files are on the completed passkey branch and must exist on merged main first.
- [ ] **Commit** `Require native proof for tenant support consent`; checkpoint/push.

### Task4: Single-use operator start and participant stop/revoke

**Files:** Extend controller/store/proof; create `smoke-support-access-lifecycle.mjs`.

**Interfaces:** Store `listOperator(actor:RequestContext,query:SupportListQuery):Promise<SupportGrantPage>`, `start(actor:RequestContext,grantId:string,proof:SupportProof):Promise<SupportWorkspaceContext>`, `end(actor:RequestContext,grantId:string,kind:'stop'|'revoke',mode:'operator'|'subject'|'tenant'):Promise<{state:SupportState}>`. Dedicated operator level check allows support/SuperAdmin only; tenant revoke requires tenant-wide cancel; subject stop requires exact native subject ID.

- [ ] **Write failing tests** `single_use_deadline_and_actor_binding`: one start, simultaneous starts handled in Task9;600s-old approval fails, earliest requested/tenant1800/native deadline wins, start DBclock occurs after locks. Operator own inbox only, unrelated session cannot read/start/stop another operator's active grant; renewal cannot extend deadline. Approver logout after approval remains valid; security/authority changes do not. Self-stop/revoke/disable ends access; repeated same-actor stop succeeds even expired without replacing native cookie. Normal platform console still excludes support level.
  ```js
  assert.equal(secondStart.status,409);
  assert.equal(foreignOperatorLookup.status,404);
  assert.equal(started.data.actorSessionId,operator.ctx.sessionId);
  assert.ok(Date.parse(started.data.expiresAt)<=Date.parse(nativeExpiry));
  assert.equal(nativeSessionIdsAfter.some(id=>!nativeSessionIdsBefore.includes(id)),false);
  ```
- [ ] **Run RED:** dependency build then `node --env-file-if-exists=.env apps/api/scripts/smoke-support-access-lifecycle.mjs`; expect missing transitions/operator/stop routes.
- [ ] **Implement** exact operator GET/start/stop and tenant revoke/subject stop routes from the spec. Start consumes approved grant under canonical locks, rechecks proof/platform/target authority and captures actor session plus immutable minimum deadline using current database time. Terminal state never resets. Stop/revoke are scoped, audited and idempotent for the same authorized participant; session expiry alone is recorded as expired, not fictitious logout. History remains derived even if nobody requests the workspace.
- [ ] **Run GREEN:** lifecycle/consent/schema fixtures and typecheck; all actual cookie/session and authority assertions PASS.
- [ ] **Commit** `Bind single-use support access to the native operator`; checkpoint/push.

### Task5: Pure scoped business readers and a bounded read-only pool

**Files:** Create the five reader files, read-pool/presenter and `smoke-support-access-readers.mjs`; modify `packages/db/src/index.ts` for the dedicated pool factory and only matching ordinary read methods in `apps/api/src/modules/inventory.controller.ts`, `selling.controller.ts`, `buying.controller.ts`, `manufacturing/work-orders.controller.ts`, `accounting/reports.controller.ts`.

**Interfaces:** Readers produce `readInventory(db:SupportExecutor,scope:SupportScope,query:Extract<SupportQuery,{area:'inventory'}>):Promise<SupportPanelResult>`, `readDocument(db:SupportExecutor,scope:SupportScope,query:Extract<SupportQuery,{area:'sales-invoices'|'purchase-invoices'|'work-orders'}>):Promise<SupportPanelResult>` through an explicitly enumerated dispatcher, and `readAccounting(db:SupportExecutor,scope:SupportScope,query:Extract<SupportQuery,{area:'accounting'}>):Promise<SupportPanelResult>`. Each invoice/work-order file exports `readSalesInvoices`, `readPurchaseInvoices`, `readWorkOrders` with that document query signature and asserts its fixed area. `createSupportReadPool(databaseUrl:string):SupportReadPool`; `presentTable(columns:SupportTable['columns'],rows:SupportTable['rows'],nextCursor:string|null):SupportTable`. Pure ordinary helper return types are inferred from existing controller DTO shapes, with support projecting only its explicit display columns.

- [ ] **Write failing tests** `five_catalog_readers_are_scoped_selects`: real inventory balance/paginated ledger, frozen sales/purchase lines and tax, frozen work-order material/routing/WIP/job-card facts (including the merged NCR rework orders with null bom_id and Rework revision) and accounting status/trial/ledger/daybook. Same IDs/labels in another entity/tenant cannot escape scope; every detail join verifies parent/entity and tenant-owned labels. Paginated stock running totals and accounting opening/closing/trial totals include earlier rows before slicing. Empty/inactive books do not seed/activate defaults. Verify ordinary matching endpoints keep DTOs/results/permissions.
  ```js
  assert.equal(foreignDetail.status,404);
  assert.equal(readPoolBackendPid===controlBackendPid,false);
  assert.equal(readTransactionReadOnly,'on');
  assert.equal(attemptedWriteError.code,'25006');
  assert.deepEqual(afterRead.bookHashes,beforeRead.bookHashes);
  ```
- [ ] **Run RED:** dependency build then `node --env-file-if-exists=.env apps/api/scripts/smoke-support-access-readers.mjs`; expect missing pure readers/read-only enforcement.
- [ ] **Extract SELECT helpers** for just the matching existing reads; replace implicit `this.db` with explicit executor. Existing ordinary controllers keep existing DTOs/unbounded normal read semantics; support projection/pagination is a separate wrapper around those pure helpers. Work-order extraction must not call mutation services or query auth rows: safe recorded operator labels only. All related documents/warehouse/batch/party/item joins are bound to the approved parent/entity/tenant. No invoice-balances, credit-status, synchronization, attachments/providers, billing activation, genealogy or future `.read` auto-routing.
- [ ] **Implement pool and presentation** using a separate `pg.Pool({max:2,connectionTimeoutMillis:2000})` through the DB package's declared pg dependency. Export `createReadOnlyDb(connectionString:string):{run<T>(fn:(tx:Pick<Database,'select'|'execute'>)=>Promise<T>):Promise<T>;close():Promise<void>}` from `packages/db/src/index.ts`; API `createSupportReadPool` delegates to it. Begin transaction READ ONLY before any business query; statement/lock timeout5000ms plus overall transaction deadline; commit/rollback/release in finally and close on Nest shutdown. A deadline cancels pending SQL and completes rollback before connection reuse, rather than racing a timeout against a still-live transaction. SupportExecutor exposes no insert/update/delete and runtime readonly also rejects raw execute writes. Emit explicit safe fields/tables, no row spreads/auth blobs, page bound500 and stable validated cursors; dates/amounts use existing exact semantics.
- [ ] **Run GREEN:** readers fixture; ordinary inventory/buying/selling/accounting/manufacturing smoke suites, plus typecheck. Exact safe panel/cross-scope/readonly/invariance and ordinary DTO assertions PASS.
- [ ] **Commit** `Extract scoped support readers with read-only transactions`; checkpoint/push.

### Task6: Pre-dispatch transport, locked read execution and required audit

**Files:** Create transport/read/audit/workspace controller and `smoke-support-access-boundary.mjs`; modify `apps/api/src/main.ts`, `app.module.ts`, `common/audit.service.ts`. Keep ordinary audit row property/hash order unchanged.

**Interfaces:** `supportTransport(config:SupportConfig):RequestHandler`; `SupportReadService.context(actor:RequestContext,grantId:string):Promise<SupportWorkspaceContext>`, `panel(actor:RequestContext,grantId:string,query:SupportQuery):Promise<SupportPanelResult>`; `SupportAudit.recordRead(tx:SupportTx,actor:RequestContext,authority:SupportReadAuthority,evidence:SupportEvidence):Promise<void>`. AuditService adds `recordSupport(ctx:RequestContext,input:AuditInput,subjectUserId:string,tx:SupportTx):Promise<void>` with explicit operator impersonator; ordinary `record` retains its signature/behavior. Shared internal append helper accepts exact identity arguments, never caller DTO identity overrides.

- [ ] **Write failing tests** `support_selector_cannot_escape_read_boundary`: header on native auth/signout, public route, normal tenant API, invoice-balance GET, export/attachment/mutation/control and wrong method refuses before handler/book work. Duplicate/malformed headers/params fail; no cookie means no access. Origin tests include omitted GET Origin with valid/invalid Fetch Metadata+Referer, evil subdomain/port/Host spoof, absent POST Origin and valid actual web proxy. Known-grant denies append safe evidence; foreign/unknown grants generic404. Required audit INSERT failure rolls back event and returns no data. Ordinary chained hash is byte-identical for a fixed input; support read has both identities.
  ```js
  assert.equal(nativeDispatchCountWithSupportHeader,0);
  assert.equal(unsafeGetWithHeader.status,403);
  assert.equal(forgedHostOrigin.status,403);
  assert.equal(readAfterAuditFailure.data.code,'SUPPORT_UNAVAILABLE');
  assert.equal(auditRow.actor_user_id,subject.id);
  assert.equal(auditRow.impersonator_user_id,operator.id);
  ```
- [ ] **Run RED:** dependency build then `node --env-file-if-exists=.env apps/api/scripts/smoke-support-access-boundary.mjs`; expect missing early boundary/read audit guarantees.
- [ ] **Implement early transport** before native routes/json/public guards. Permit selector only on exact workspace GET context/enum routes; require strict grant UUID, exact configured origin policy and no conflicting tenant/entity headers. Normal control requests cannot carry support selector. Dedicated workspace controller builds real native actor using non-renewing authoritative lookup and current SQL pending checks; it never resolves target through ordinary AccessGuard shortcuts. Unknown area/path never dispatches a reader. No errors expose native/DB parameters.
- [ ] **Implement read/audit** through Task2 `withAuthority`: canonical locks, current native session/platform/subject/policy/deadline/permissions, dedicated read-pool data, then required support event and tenant audit, then database time/authority recheck after audit wait and immediately before control commit. Only return held data after successful control commit; rollback/timeout/expired authority returns none. Context reads use the same authority/evidence rule. Denials for known own grants persist safe denial/one-time observed terminal evidence in an authorized control transaction; evidence failure remains fail-closed. Retry cannot append duplicate terminal lifecycle. Lifecycle audits identify actual approver/operator; read audit identifies subject+operator without changing ordinary request context.
- [ ] **Run GREEN:** boundary/readers/lifecycle fixtures, existing SSO/passkey/email guard fixtures and typecheck; no native target session/cookie, ordinary auth dispatch and audit hashes remain correct.
- [ ] **Commit** `Enforce audited support reads before releasing data`; checkpoint/push.

### Task7: Tenant consent/history and operator inbox UI

**Files:** Create explicit client, controls, settings page and support inbox/layout; modify app-shell links, `apps/web/package.json`; create `apps/web/e2e/support-access-controls.mjs`.

**Interfaces:** Client exports `supportControl<T>(path:string,options:{method?:'GET'|'POST'|'PATCH';body?:object;tenantId?:string;signal?:AbortSignal}):Promise<T>` for fixed control paths, and `supportWorkspace<T>(grantId:string,path:'context'|SupportArea,query?:SupportQuery,signal?:AbortSignal):Promise<T>` only for workspace GETs. Uses native browser cookie/proxy, never cookie storage/target token. `SupportAccessControls({tenantId}:{tenantId:string}):ReactNode` and settings/inbox consume the safe shared DTOs. No support header on controls or global API client.

- [ ] **Write failing production browser tests** `tenant_consent_and_operator_inbox`: desktop/mobile configure disabled policy, exact operator email, active member/entity/area choices,300–1800 duration and reason/password; reauth links retain safe return path. Custom read-only/history users see no approval/configuration/revoke controls. Operator sees only addressed grants, starts with native proof, support-level console remains restricted. History labels actor/subject and derived ended state; proof/password disappears after success/error/navigation and never appears in query/storage. Unsupported panels show explicit unavailable message without normal API fallback.
  ```js
  assert.equal(await page.getByText('Read-only support',{exact:true}).isVisible(),true);
  assert.equal(JSON.stringify(historyResponse).includes('passwordVersion'),false);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  assert.equal(networkRequests.some(r=>r.path.includes('/operator/directory')),false);
  ```
  The visible text assertion belongs to the consent/inbox read-only notice; full workspace navigation/banner/panels are Task8. Inspect actual history text/response keys, not a production secrecy flag added solely for testing.
- [ ] **Run RED:** `pnpm --filter @factoryos/web build`, start owned production API/web on fixture DB, then `pnpm --filter @factoryos/web e2e:support-access-controls`; expect missing routes/UI. This task adds that script pointing to the named browser fixture.
- [ ] **Implement UI/client** using existing UI components/tokens and native local recovery/sign-in flows; fixed `/support` links, full tenant scope for controls, strict fields and bounded history. Operator email is an input, never a global directory. Target/entity choices come only from normal authorized tenant administration, not support-wide APIs. No edit/export/security controls in support layout; use mobile stacking. Preserve `workspace.tsx` `/me`, own tenant selection and storage.
- [ ] **Run GREEN:** control browser desktop/mobile, API consent/lifecycle fixtures, web typecheck/build. Actual proxy/cookie/Origin behavior and safe UI assertions PASS.
- [ ] **Commit** `Add tenant support consent and operator inbox`; checkpoint/push.

### Task8: Isolated support workspace, panels and account-switch cleanup

**Files:** Create provider/panels/workspace route and `apps/web/e2e/support-access-workspace.mjs`; extend explicit client and web scripts only.

**Interfaces:** `SupportAccessProvider({grantId,children}:{grantId:string;children:ReactNode}):ReactNode`, `useSupportAccess():{context:SupportWorkspaceContext|null;ended:boolean;stop:()=>Promise<void>}`, `SupportAccessPanels({context}:{context:SupportWorkspaceContext}):ReactNode`; `supportQueryKey(context:SupportWorkspaceContext,panel:SupportQuery):readonly unknown[]` includes actor user/session, grant/subject/tenant/entity/area/panel/filters. Dedicated QueryClient lives inside provider, not ordinary WorkspaceProvider. Existing native `/me` supplies account-change notification only, never target authority.

- [ ] **Write failing production browser tests** `support_cache_aborts_before_new_identity_render`: all approved panels show actual entity records and frozen details/totals; actor/subject/tenant/entity/reason/deadline/countdown/Stop always visible. Native account switch, grant switch, held old fetch, focus/navigation, expiry and tenant revoke clear panels before another response renders. Abort old request and ignore late results by generation+identity check. Stop returns to inbox while native actor stays signed in. No writes to fos.tenant/fos.entity, shared `/me/context` cache, native cookie swap, mutation/export/download requests or mobile overflow.
  ```js
  assert.deepEqual(await ordinaryStorageAfter,ordinaryStorageBefore);
  assert.equal(await currentNativeUserId(),operator.id);
  assert.equal(await page.getByText(oldSubjectInvoiceNumber,{exact:true}).count(),0);
  assert.equal(abortedOldWorkspaceRequest,true);
  assert.equal(businessMutationRequests.length,0);
  ```
- [ ] **Run RED:** production web build/runtime on owned support fixture, then `pnpm --filter @factoryos/web e2e:support-access-workspace`; expect missing isolated workspace or stale-return cleanup.
- [ ] **Implement** provider and panels with explicit support transport and strict catalog UI. Authoritative context fetch before cached data on entry/focus/navigation; countdown derives serverNow/deadline and invalidates display at expiry. Identity/grant change first increments generation, aborts all support fetches, removes support cache/data, then obtains new authoritative context. Ended responses clear all data and prohibit automatic old-grant resume. Show “Read-only support” and explicit unavailable-in-support copy for exclusions; no mounting existing edit forms/autosave. AbortSignal is passed through actual fetch, not only a query-key change.
- [ ] **Run GREEN:** workspace/control browsers on desktop/mobile plus existing local recovery/passkeys/SSO browsers and web typecheck/build. Capture actual held-response and account-switch evidence.
- [ ] **Commit** `Isolate temporary support workspace and cached data`; checkpoint/push.

### Task9: Real concurrency, populated upgrade, final verification and handoff

**Files:** Create `apps/api/scripts/smoke-support-access-barriers.mjs`, `smoke-support-access-invariance.mjs`, `docs/superpowers/reviews/2026-10-09-support-access-review.md`; extend focused browser/helpers as necessary; update `docs/ai/{STATUS,MEMORY,LOG,DUE}.md`, spec/decision delivery state. Append final selected command output under the review directory; no credentials/cookie/DB URLs.

**Interfaces:** Consumes all prior actual handlers/store/read-pool/browser interfaces. Test helper adds `withObservedBlocker(run:(connections:{first:pg.PoolClient;second:pg.PoolClient;observer:pg.PoolClient})=>Promise<void>):Promise<void>` inside the owned fixture, verifying distinct pg_backend_pid and pg_blocking_pids before releasing barriers. No production fault injection endpoint or sleep-only concurrency proof.

- [ ] **Write failing acceptance tests** `real_authority_and_deadline_barriers`: two starts yield one success/one409 and one started event; serialized read/revoke permits only the read authorized before revoke commit. Actual source member/role/tenant/entity/platform removal+restoration and native password/factor/email change cannot revive old grant; bound logout invalidates, unrelated cleanup/renewal does not. Include multi-row mutations and concurrent native/tenant transactions in differing source orders; successful normal source mutation has no lost bump/deadlock/cleanup restriction. Hold audit lock across support deadline, saturate max2 read pool past2000ms, delete bound session and fail required audit INSERT using owned DB constraints/privileges: no data return. Prove5000ms overall control deadline and post-wait database clock.
  ```js
  assert.deepEqual(startStatuses.sort(),[200,409]);
  assert.notEqual(firstPid,secondPid);
  assert.ok(observedBlockingPids.includes(firstPid));
  assert.equal(restoredOldGrantRead.data.code,'SUPPORT_ENDED');
  assert.equal(expiredAfterAuditWait.data.code,'SUPPORT_ENDED');
  assert.equal(requiredAuditFailureContainsPanelData,false);
  ```
- [ ] **Run RED:** dependency build then `node --env-file-if-exists=.env apps/api/scripts/smoke-support-access-barriers.mjs` and invariance suite. Expect any genuine unmet acceptance invariant to fail. If already correct, record PASS; do not weaken working code to manufacture RED.
- [ ] **Correct demonstrated failures** in their owning files only, retaining fixed contracts. Invariance migrates an owned read-only-source logical copy, verifies original published SQL/journal prefix, GL/journals/bills/effects/stock/bins/FIFO, original activations, native credential/valid-session rows and original audit rows before/after every safe panel/denial; only new support evidence/policy/grants legitimately differ. Verify tenant chain links/hashes including two identities. Never mutate original source or enable SMTP/SSO/passkeys/support in shared config.
- [ ] **Run final focused GREEN:** all eight support API suites (config/schema/consent/lifecycle/readers/boundary/barriers/invariance) sequentially and both production support browsers. Run accepted SSO/passkey/email focused suites, ordinary affected inventory/buying/selling/accounting/manufacturing/job-work/serial/genealogy/quality/FAI/attachments suites and retained production security and quality browsers. Evidence lists exact commands/counts/failures rather than inheriting old success claims; run a failed command unchanged at most twice before changing approach under AGENTS.
- [ ] **Run required root checks:** `pnpm typecheck`, `pnpm build`, `pnpm exec turbo run test --force`, `pnpm lint`, `git diff --check`. Report actual suite counts and lint0 if still no configured tasks; no invented lint coverage or remote CI. Verify final tree after any corrections; repeat only affected checks/new concerns. Stop/drop owned fixture resources in finally; protected Postgres/shared environment stays intact.
- [ ] **Request one fresh whole-branch review** after all tasks/checks, using the preserved Native workflow and requesting-code-review skill. Record evidence/severity/rulings. Reproduce/correct Critical/Important findings, run affected checks and required final checks on the changed tree; retain deferred Minors with exact cost/risk. One author correction pass, no second review or per-task review agents.
- [ ] **Commit/push handoff** `Verify audited support access and record delivery gates`. Update ownership/status with exact stopping point and fresh permanent evidence. Open own completion PR to main with provider-neutral body; require actual green CI before merge, never force/direct-main push. If known API403 remains, supply concrete branch/manual PR link and do not repeat identical lookup. Software verification does not enable deployment/tenant policies or establish real operator HTTPS acceptance. Live enablement and PostgreSQL RLS design remain separate.

## Inline plan self-review

- Spec scope/authority/durable evidence map to Tasks1–4; source lock order and restoration to Tasks2/9; five safe panels/purity to Task5; native/public/header/origin/pre-return audit to Task6; consent/history and isolated mobile cache to Tasks7–8; populated source/native regression, review and delivery gates to Task9.
- Shared wire/private names above are consumed consistently; no target RequestContext, client proof or unspecified future route. All five Review Focus conditions have named tests; exact durations/pool/timeouts/permissions remain approved values.
- Setup, scripts and docs travel with their deliverables. The plan specifies interfaces/assertions rather than full implementation bodies. Written-plan review and merged prerequisites/standalone claim still precede product code.
