# Transactional Email Delivery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans for the preserved Native method. Implement inline, task by task; one fresh independent final reviewer after implementation, no implementer or per-task reviewer agents. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver configurable transactional SMTP email for account recovery, optional verification and tenant/platform owner invitations, with durable scoped evidence and safe recovery.

**Architecture:** A shared server-only email package owns strict contracts, authenticated envelopes, templates, SMTP outcomes and queue operations. API producers enqueue source-bound deliveries; a separate leased worker revalidates sources before network activity. Better Auth remains the auth-token authority, and existing tenant permissions/manual invitation links remain compatible.

**Tech Stack:** Node24, pinned pnpm10.28, TypeScript strict, Zod, NestJS, PostgreSQL/Drizzle, Better Auth1.7.7, Nodemailer, JOSE, Vitest, Playwright. New dependencies belong only to the shared email package/test utilities that use them; pin reviewed compatible versions through pnpm, preserve TLS/signature verification.

**Spec:** [Approved email delivery design](../specs/2026-10-06-email-delivery-design.md), decision042; user approved2026-10-06 after selecting existing SMTP. Written-plan review remains required before product claim/implementation. No execution-method question.

## Global Constraints

- Native inline on the existing default branch; no worktree or implementer agents. Claim product work alone in STATUS and commit/push before coding, then normal commits/pushes; never bypass hooks or force-push.
- `disabled` and `smtp` modes only. No public capture adapter, real recipients in tests, paid account, production send, deployment or shared-book activation.
- SMTP250 after DATA means server accepted, not inbox delivered; stable Message-ID is correlation, not a deduplication guarantee.
- Connection/data timeouts30 seconds, lease120 seconds, concurrency2. Definite temporary refusal retry delays30/120/600/3600/14400 seconds, at most five retries and never past source expiry. Unknown post-DATA acceptance never automatically retries.
- Invitation expiry7 days; reset/verification expiry3600 seconds. Existing unverified sign-in remains allowed; reset revokes prior sessions. Keep Better Auth's existing separately issued token lifecycle.
- Separate32-byte `EMAIL_PAYLOAD_KEY_V1`; envelope AAD binds scope/purpose/source. Purge envelopes on accepted/expired/cancelled/superseded/abandoned states; redacted operational records retained30 days. No raw tokens, URLs, content or provider responses in logs/diagnostics.
- Every table has `tenant_id`: non-null for exact tenant invitation scope, null plus immutable auth user ID for account mail. No entity ownership invented. Tenant queries never show global auth deliveries.
- Source enqueue + invitation/audit transaction atomic; platform tenant/roles/defaults/owner-invite/outbox/audits atomic. Never hold a DB transaction open over SMTP; auth callbacks cannot pretend to roll back an already-issued framework token.
- TLS certificate verification always enabled. Plaintext is development/test-only to a loopback SMTP sink. Additive generated migration after0021; never modify applied SQL or saved original activation/hash baseline.
- Tests default API4000/web3000 and accept API/WEB_ORIGIN/WEB_URL/CHROMIUM_PATH. Current overridden4001/3001 runtime may be reused only in disabled mode; use isolated local processes/fixture scopes for SMTP tests. Never replace the ignored root env or disclose its values.

## Review Focus

1. Known versus unknown reset addresses, including enqueue failure or recipient cooldown, must return the same public result and never leak raw links — Tasks1/5/8.
2. Two workers, lost DATA acknowledgements and crashes between accepted SMTP and DB completion must not blindly duplicate mail or let stale leases change evidence — Tasks2/4/8.
3. Revoked/accepted/expired invitations, tenant switches and renewal after role authority changes must not deliver usable stale access or leak another tenant's mail — Tasks3/4/7/8.
4. Disabled-to-SMTP transitions, wrong/changed envelope keys and changed/verified/deleted auth users must not reconstruct stale links or bypass source identity — Tasks1/2/4/5.
5. UTF-8 names, hostile HTML/header text and forged callback redirects must remain correctly escaped, bounded and same-origin while existing TOTP/sign-in flows remain usable — Tasks1/5/6/8.

---

## File Map and Shared Contracts

Create `packages/email/{package.json,tsconfig.json,README.md}` following the existing server-package pattern and exporting `src/index.ts`. Source files: `contracts.ts`, `config.ts`, `envelope.ts`, `templates.ts`, `queue.ts`, `source.ts`, `smtp.ts`, `worker.ts`, `retention.ts` and respective meaningful tests. Do not import this package into browser code. Dependency graph: email→db, API/worker→email; email never imports API/Auth/NestJS or the sandbox worker.

Create DB `packages/db/src/schema/email.ts`, export from schema index and generate next migration `email_delivery`. Narrow modifications: API config/auth/app module, tenancy/member/platform controllers; worker entry/package; auth/settings/platform web routes; permissions/roles. Test helpers live in test utilities, not production switches.

Shared types (defined Task1):
- `Tx = Parameters<Parameters<Database['transaction']>[0]>[0]` is derived from the shared database type, not imported from API code. `CipherEnvelope = {keyVersion:'v1';iv:string;tag:string;ciphertext:string}`.
- `EmailConfig` is discriminated by mode: disabled has workerEnabled:false and optional sender; smtp has smtp:{host,port,tls,user?,password?}, sender:{address,name}, replyTo?, payloadKey:Buffer, authSecret:string, authBaseUrl:string, webOrigin:string and workerEnabled:boolean. TLS choices are implicit-tls/starttls-required/plaintext-loopback-test; the last is forbidden in production. Config reads existing BETTER_AUTH_SECRET/BETTER_AUTH_URL/WEB_ORIGIN as well as the new mail names. `EmailClaim = {deliveryId:string;leaseToken:string;attemptId:string;input:EnqueueEmail;cipher:CipherEnvelope;retryCount:number}` (input.envelope remains null until decryption).
- `EmailStatus = 'unconfigured'|'queued'|'dispatching'|'retry_scheduled'|'accepted'|'failed'|'unknown'|'expired'|'cancelled'|'superseded'`; all persisted/API statuses use these spellings.
- `EmailPurpose = 'password_reset'|'email_verification'|'member_invitation'|'owner_invitation'`.
- `EmailSource = {kind:'invitation';tenantId:string;invitationId:string} | {kind:'password_reset';userId:string;verificationId:string} | {kind:'email_verification';userId:string;tokenDigest:string}`. Framework verification ID is evidence, not a raw identifier/token.
- `EmailEnvelope = {recipient:string;sender:{address:string;name:string};replyTo?:string;subject:string;text:string;html:string;actionUrl:string}`; key-versioned cipher metadata holds IV/tag/ciphertext only.
- `EnqueueEmail = {purpose:EmailPurpose;source:EmailSource;sourceExpiresAt:Date;dedupeKey:string;templateVersion:'v1';envelope:EmailEnvelope|null}`; null envelope is unconfigured metadata only, never dispatchable.
- `EmailOutcome = {kind:'accepted';remoteId?:string}|{kind:'temporary';code:string}|{kind:'permanent';code:string}|{kind:'unknown';code:string}`. No arbitrary provider-message string in persisted outcomes.
- `DeliveryView = {id:string;purpose:EmailPurpose;status:EmailStatus;recipient:string;createdAt:string;lastAttemptAt:string|null;nextAttemptAt:string|null;errorCode:string|null;invitationId:string|null}`; global recipient masked before returning.
- `enqueueEmailIn(tx:Tx,input:EnqueueEmail):Promise<{id:string;status:EmailStatus}>`; `claimEmail(db:Database,workerId:string,now:Date):Promise<EmailClaim|null>`; `finishEmail(db:Database,claim:EmailClaim,outcome:EmailOutcome,now:Date):Promise<boolean>`; `validateEmailSource(db:Database,input:EnqueueEmail,envelope:EmailEnvelope,authSecret:string,now:Date):Promise<'valid'|'expired'|'cancelled'|'superseded'>`; `runEmailOnce(db:Database,config:EmailConfig,transport:EmailTransport,now?:Date):Promise<number>`.
- `EmailTransport.send(envelope:EmailEnvelope,messageId:string):Promise<EmailOutcome>`; SMTP adapter exposes this interface only. `EmailClaim` contains frozen delivery/source/cipher metadata, leaseToken and attempt identity.

## Task1: Strict configuration, envelopes and templates

**Files:** Create shared package files, `contracts/config/envelope/templates/index.ts`, tests; modify `.env.example` and API/worker package dependencies only where consumed. No network transport installed/invoked yet.
**Interfaces:** Produces shared types above; `loadEmailConfig(env:NodeJS.ProcessEnv):EmailConfig`, `sealEmail(input, key, aad):CipherEnvelope`, `openEmail(cipher,key,aad):EmailEnvelope`, `renderEmail(purpose,input:{actionUrl,recipient,tenantName?,sender,replyTo?}):EmailEnvelope`.

- [x] Create only the email package manifest/tsconfig/test harness following the existing package pattern, install its required Zod/JOSE/test dependencies through pinned pnpm, and verify Vitest actually discovers the new tests. This setup is part of Task1 after plan approval, not an unexplained product-code test pass.
- [x] Write tests `config_partial_credentials`, `plaintext_only_loopback_test`, `aad_wrong_key_refused`, `unicode_html_header_safety`, `url_origin_path_binding`, `redacted_outcome_codes`. Assertions: wrong key/AAD throws; hostile HTML escaped; CR/LF sender/subject refused; disabled permits absent secrets; production plaintext and foreign action origins refuse.
```ts
assert.throws(() => openEmail(cipher, wrongKey, aad));
assert.throws(() => loadEmailConfig({...productionEnv, SMTP_TLS:"plaintext-loopback-test"}));
```

- [x] Run `pnpm --filter @factoryos/email test`; observe missing contracts/exports RED, not a dependency-install failure.
- [x] Implement strict schemas and AES-256-GCM with random IV and canonical AAD. Config names: EMAIL_MODE(default disabled), SMTP_HOST/PORT/TLS/USER/PASSWORD, EMAIL_FROM_ADDRESS/NAME, EMAIL_REPLY_TO, EMAIL_PAYLOAD_KEY_V1, EMAIL_WORKER_ENABLED(default false). Add only a loopback-test plaintext TLS choice, rejected in production. URLs must match configured auth/web origins and exact reset/verification/invite paths. Names/subjects bounded200 characters; envelope bounded64KiB. MIME encoding must preserve Unicode, never strip/replace a recipient or action token. Freeze plain text and escaped HTML at template v1.
- [x] Run package tests/build/typecheck; verify all named tests pass. Do not manufacture credentials or sender-domain verification.
- [x] Commit `Define secure transactional email contracts and templates`.

## Task2: Scoped queue, state transitions and permissions

**Files:** Create DB email schema; modify index; generate migration; implement email `queue/retention.ts`; modify auth permissions/roles; create `apps/api/scripts/smoke-email-schema.mjs`, `email-test-helpers.mjs` and focused queue tests. The fixture helper produces isolated users/tenants/clock/SMTP state and `fixtureSourceSnapshot()` (tenant, roles, defaults, invitation, delivery and audit rows) for later rollback tests; never patch production services to inject test failures.
**Interfaces:** Produces enqueue/claim/finish functions and `reclaimEmailLeases(db,now)`, `pruneEmailEvidence(db,now)`; consumes Task1 contracts/config/envelopes. Queue source identities never depend on a mutable caller-supplied tenant.

- [x] Write schema/queue tests: `scope_constraints`, `same_source_one_queue`, `unconfigured_cannot_claim`, `accepted_envelope_purged`, `dispatch_started_lease_expires_unknown`, `before_dispatch_lease_safe_retry`, `stale_fence_no_update`, `thirty_day_cleanup`. Assert two same-source enqueues yield one ID; source/auth raw identifiers absent from redacted metadata; unknown claims have no next automatic attempt.
```ts
assert.equal(first.id, repeated.id);
assert.equal(await claimEmail(db, "second-worker", now), null); // unconfigured evidence
```

- [x] Run focused tests/schema fixture; observe missing schema/functions RED. Save original0011–0021 SQL hashes and original activation IDs once in this plan's ignored ledger, without replacing the older saved baseline.
- [x] Generate additive schema: delivery, attempt/event, recipient-rate-limit evidence and worker heartbeat. Immutable frozen identity/source/cipher metadata; mutable envelope only transitions to null on authorized purge, not replacement. Attempts/events reject UPDATE; bounded retention deletes email operational evidence together after30 days through the cleanup owner. Composite tenant invitation FK/index; parent-scope attempt/event constraints. Do not add restrictive FK to Better Auth verification rows, which it deletes on token consumption; preserve immutable original verification ID and validate at dispatch. Auth-user source IDs remain evidence after account deletion and dispatch must then cancel.
- [x] Implement claim fencing, dispatch-start and outcome transitions with due-source expiry, retry schedule and unknown handling. Persist only allowlisted categorized error codes. Add `settings.email.read/retry` to Owner/Administrator; restricted roles refuse. Replay uniqueness includes purpose/source/scope. Missing configuration creates a non-dispatchable metadata-only row; never retain plaintext token for later reconstruction.
- [x] Run queue/schema/auth package tests and db/email builds; assert original SQL/activation hashes unchanged. Commit `Add scoped durable email queue and delivery evidence`.

## Task3: Atomic invitations, renewal and scoped recovery APIs

**Files:** Modify tenancy/member/platform controllers and API module; create `modules/email/{email.service,email.controller}.ts`, `smoke-email-invitations.mjs` and source rollback tests.
**Interfaces:** `createTenantIn(tx:Tx,ctx:RequestContext,input:ExistingTenantInput)` returns existing tenant/entity result plus seeded owner-role ID; existing `createTenant` wraps it. `EmailService.enqueueInvitationIn(tx,ctx,inv,token,purpose)` produces Task2 input; `listTenant(ctx)`, `retryInvitation(ctx,id,reason)`, `renewInvitation(ctx,id,reason)` consume original invite authority.

- [x] Write fixtures `configured_invite_enqueue_rollback`, `owner_tenant_roles_queue_atomic`, `disabled_manual_link_preserved`, `renewal_rechecks_current_roles`, `foreign_tenant_delivery_refused`, `accepted_revoked_expired_not_retried`. Assert failed configured enqueue leaves no invitation/owner tenant/roles/defaults/audit; unconfigured returns original authorized one-time URL and metadata-only record.
```ts
assert.deepEqual(await fixtureSourceSnapshot(), before); // forced configured enqueue failure
assert.equal(disabledResult.delivery.status, "unconfigured");
```

- [x] Run new fixture and observe missing routes/atomic behavior RED. Do not send any email.
- [x] Integrate member invitation in its transaction and platform tenant/owner invitation/audits in one transaction using the narrow helper. Preserve self-service `MeController.createTenant` behavior and response. Add tenant GET `/email/deliveries`, POST `/email/deliveries/:id/retry`, POST `/invitations/:id/renew`, plus SuperAdmin-only GET `/platform/email/deliveries` and `/platform/email/health`. Retry requires email.retry plus settings.user.create; renewal uses existing current role-assignment checks and reason, locks original invitation, revokes it and enqueues a fresh invitation atomically. Support/global account mail cannot use tenant retry. Platform owner renewal is separate POST `/platform/email/deliveries/:id/renew` with existing SuperAdmin authority.
- [x] Run fixture and base tenancy/RBAC/invitation smoke regressions; verify no raw URL in diagnostic responses/logs and no metadata from another tenant. The existing manual creation response is the explicitly authorized one-time URL exception, not a diagnostics response. Commit `Queue invitations atomically and expose scoped delivery recovery`.

## Task4: SMTP adapter and fenced worker

**Files:** Create email `smtp/source/worker.ts` and tests; create `apps/worker/src/email-worker.ts`; modify worker entry/package/README; create local SMTP helper and `smoke-email-worker.mjs`.
**Interfaces:** Produces `createSmtpTransport(config):EmailTransport` and `runEmailOnce`; source validator consumes readonly DB source evidence plus envelope and Better Auth signing secret. Worker entry retains `runSandboxOnce` and `--once` behavior, invokes email work only when explicitly enabled, and stops claims on SIGTERM.

- [x] Write real local SMTP tests `250_is_accepted`, `450_definite_retry`, `550_permanent_stop`, `disconnect_after_data_unknown`, `accepted_then_db_crash_unknown`, `two_workers_one_send`, `deleted_changed_verified_user_skipped`, `wrong_key_never_sends`. Assertions: capture count1 under two workers; post-DATA unknown is not re-claimed; stale completion returns false; retry delays exactly30/120/600/3600/14400 seconds, sixth retry refused and expiry wins.
```ts
assert.equal(afterLostDataAck.status, "unknown");
assert.equal(capturedMessages.length, 1);
assert.equal(await finishEmail(db, staleClaim, {kind:"accepted"}, now), false);
```

- [x] Run tests; observe missing transport/worker RED. Synthetic fixture SMTP listens only on loopback; no real service hostname/recipient is used.
- [x] Install reviewed pinned Nodemailer/type dependencies in email package and use strict TLS. Classify definite SMTP rejection separately from socket/protocol loss after DATA; default ambiguous outcomes to unknown. Persist dispatch-start before network; source recheck before it; never hold queue transaction during send. Validate reset verification identifier/value/expiry from decrypted URL, verification JWT using JOSE with the actual library signature/algorithm contract pinned by a real Better Auth token test, and scoped invitation/tenant status. Worker lease recovery after dispatch-start never resends. Purge envelopes on terminal safe transitions; configuration/key failure never prints exception content. Heartbeat has no secrets. Keep mock sandbox behavior intact.
- [x] Run SMTP/worker/schema fixtures and existing sandbox lease recovery tests. Verify two actual PostgreSQL claim contenders, interruption/fencing and shutdown without duplicate send. Commit `Deliver queued email through fenced SMTP worker`.

## Task5: Better Auth callbacks, privacy and cooldown

**Files:** Modify API auth/config/module; create `modules/email/auth-email.ts`, email rate-limit helper and `smoke-email-auth.mjs`; modify documentation claiming already-delivered verification.
**Interfaces:** Expose `email:EmailConfig` from AppConfig via loadEmailConfig on the original environment input, so Zod does not strip mail variables before validation. Inject EmailService into AUTH factory without a cycle; `authEmailCallbacks(db,config,email):{sendResetPassword,sendVerificationEmail}` use actual generated URLs/tokens; `reserveEmailRateIn(tx,recipientDigest,originDigest,purpose,now)` returns allowed/cooldown without an address-existence result.

- [x] Write actual auth fixtures `known_unknown_identical_result`, `enqueue_failure_non_enumerating`, `recipient_cooldown_non_enumerating`, `reset_delivered_token_single_use`, `old_session_revoked`, `signup_verification_not_required`, `verified_or_changed_address_not_sent`, `forged_callback_origin_refused`. Assert response status/body equality for known/unknown requests and callback enqueue failure; no raw URL/token/address in captured logs; existing unverified sign-in and TOTP redirect remain usable.
```ts
assert.deepEqual(knownResponse, unknownResponse);
assert.deepEqual(knownWithEnqueueFailure, unknownResponse);
assert.equal(oldSessionResponse.status, 401);
```

- [x] Run actual auth fixture against disabled/isolated SMTP configurations; observe logged URL/no queue/missing verification callback RED.
- [x] Wire reset callback with explicit3600-second expiry and revokeSessionsOnPasswordReset true. Callback enqueue failures produce only redacted operational counters, never throw an existence-revealing difference or claim nonexistent queue success. Wire verification sendOnSignUp when configured, no required verification and no sendOnSignIn. Auth callback dedupe keys use the exact source/token digest; metadata-only disabled auth mail must also preserve generic acknowledgement. Confirm callback user/token persistence ordering through real Better Auth requests; do not add a fake encompassing auth transaction. Recipient reset requests default5/hour, origin30/10 minutes; signed-in verification cooldown60 seconds and5/hour. These are operational configurable defaults; store hashed recipient/origin keys and apply the same public acknowledgement when blocked. Keep existing Better Auth auth rate limit. Public callback redirects are fixed same-origin landing paths; no credentials/content in availability status.
- [x] Run all auth/core/email tests, auth fixture and base TOTP/invitation APIs. Verify consumed/expired framework records stop queued sends and signup enqueue failure does not orphan the account or leak private state. Commit `Send private account recovery and verification email`.

## Task6: Recovery and verification web flows

**Files:** Create `(auth)/forgot-password/page.tsx`, `(auth)/reset-password/page.tsx`, `(auth)/verify-email/page.tsx`, focused shared auth-email form; modify sign-in, security settings, web headers and auth-client usage; create `e2e/email-auth.mjs`.
**Interfaces:** Uses installed authClient requestPasswordReset/resetPassword/sendVerificationEmail APIs and canonical callback paths from Task5. Verification consumes the original Better Auth callback, not a client-declared verified flag.

- [x] Write production browser fixture `forgot_reset_verify`: generic acknowledgement, real SMTP fixture token consumption, bad/expired/used token screens, old session unusable, verified state refresh, cooldown, current account changed during preview and TOTP preserved. Assert no external navigation for malicious next/callback values, no-referrer headers and token cleared after success.
```js
assert.equal(await page.getByRole("heading", {name:"Reset password"}).count(), 1);
assert.equal(new URL(page.url()).searchParams.has("token"), false); // after consumption
```

- [x] Run fixture; observe missing forgot/reset routes RED.
- [x] Implement accessible forms using shared UI components and existing query/session refresh patterns. Preserve minimum password10 and server error authority. Signup/sign-in remain compatible when delivery disabled; show unavailable email actions without identifying a submitted account. Apply no-referrer policy to invite/reset/verify routes and avoid third-party resources. Never copy raw security URLs into toast/logs/browser storage. Successful reset requires fresh sign-in; pending responses bind current user/scope and cannot revive old-account UI.
- [x] Run production browser and base auth/TOTP/invite browser regressions, including390px. Commit `Add account recovery and verification screens`.

## Task7: Tenant and platform delivery diagnostics

**Files:** Modify users/platform pages; create `components/email/delivery-table.tsx`, `lib/email.ts`, `/platform/email/page.tsx`; add existing platform navigation link; create `e2e/email-delivery.mjs`.
**Interfaces:** Consumes Task3 DeliveryView APIs and existing workspace scope. UI statuses distinguish accepted from delivered and unknown from definite failure; renewal returns only the existing authorized one-time invitation URL.

- [ ] Write browser tests `tenant_delivery_scope`, `support_cannot_manage_mail`, `renewal_permission_change`, `late_response_after_tenant_switch`, `unconfigured_manual_invite`, `failed_retry_unknown_renew`. Assert a global reset recipient/action URL never appears in tenant diagnostics and lower roles cannot retry by direct API.
```js
assert.equal(tenantDeliveryJson.includes(resetTokenCanary), false);
assert.equal(restrictedRetryResponse.status(), 403);
```

- [ ] Run fixture; observe absent delivery metadata/route RED.
- [ ] Add scoped status/time/failure and reasoned retry/renew actions. Query keys include tenant and authenticated user identity; late responses cannot restore old-scope actions. Server dictates allowed recovery; unknown never offers blind Retry. Platform view masks auth recipient and shows worker/config health without SMTP server secrets. Preserve existing one-time copy invitation links and platform tenant creation UI; no new credential editor or mass-send action.
- [ ] Run new production fixture and existing users/platform/auth browsers; verify mobile and inaccessible action boundaries. Commit `Expose scoped email status and safe invitation recovery`.

## Task8: Concurrency, invariance, final review and delivery

**Files:** Create `smoke-email-barriers.mjs`, `smoke-email-invariance.mjs`; final review `docs/superpowers/reviews/2026-10-06-email-delivery-review.md`; update plan/STATUS/MEMORY/LOG and execution ledger.
**Interfaces:** Uses actual queue locks, worker leases, source endpoints and local SMTP helper. No new architecture or provider selection.

- [ ] Run deterministic barriers `two_workers_one_claim`, `stale_completion_after_unknown`, `renew_revoke_vs_dispatch`, `same_invite_two_retries`; observe actual distinct PostgreSQL contenders and one permitted state/source outcome. SMTP acceptance before failed DB completion becomes unknown with no automatic second capture.
- [ ] Snapshot populated original GL/bills/stock/FIFO, migrations and saved book activation IDs; email/source status changes must leave all ledger values unchanged. Compare original migration hashes from the once-saved baseline; never recapture after changes. Confirm diagnostics/logs contain no synthetic raw token/URL by exact test canaries.
- [ ] Run root build/typecheck/`pnpm exec turbo run test --force`/lint (zero tasks reported honestly), all email/schema/auth/worker/invitation fixtures, existing accounting/bank/sandbox auth regressions and both production email plus original auth/TOTP/invite browsers. Pace signup suites12 seconds and keep isolated SMTP runtime credentials local/ephemeral; return old runtime configuration without overwriting env files.
- [ ] Request one fresh read-only independent reviewer with baseline/head/spec/plan, all five Review Focus bullets verbatim, actual test logs and explicit SMTP acceptance/source-scope boundaries. No implementer/per-task agents. One test-backed Critical/Important correction pass, defer Minors with reason/cost, no second review; rerun affected checks.
- [ ] Complete handoff, close task claim, record live SMTP prerequisites as limitations (selected service/sender, secure credentials/key, verified DNS/connectivity). No genuine test mail or deployment claim. Normal commit/push and verify clean checkout/remote SHA. Commit `Record verified transactional email delivery and review`.

## Self-Review and Execution Handoff

Coverage: configuration/encryption/templates1; scoped immutable evidence/auth2; invitation/platform atomicity and recovery3; source expiry/SMTP outcomes/worker/retention2/4; auth callbacks/privacy/cooldown5; account UI6; tenant/platform diagnostics7; barriers/ledgers/regressions/one final reviewer8. All five focus classes have named tests in their owning tasks.

Interfaces: shared source/outcome/envelope types precede schema/consumers; generic email package never imports AUTH or API, so auth injection is acyclic. Framework token evidence does not block Better Auth deletion. Network activity remains outside DB transactions. Disabled envelopes cannot turn into scheduled live sends. Platform helper preserves self-service behavior. Lifecycle/data/model choices are within accepted042; no SSO/passkey/RLS expansion.

This plan is ready for written review. Implementation has not started; no dependencies installed, migration applied, secret created or email sent while writing it. On plan approval, claim product work and execute Task1 inline with the preserved Native/default-branch method.

Task1 checkpoint2026-10-06: shared email contracts/configuration/envelopes/templates implemented,27 pure tests pass after missing-export RED25 failures (two generic negative assertions subsequently tightened). Root build12/typecheck18/153 uncached unit tests PASS; lint0. No transport or auth/invitation integration yet. Continue Task2 under the existing claim.
