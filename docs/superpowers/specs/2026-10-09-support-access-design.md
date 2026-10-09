# Audited support access — approved design

Date: 2026-10-09 (Asia/Kolkata). Status: **Written spec approved by the user on 2026-10-09**. Decision: accepted 050. Execution method is the implementer's choice (optional note: Native inline was the preferred method). The [nine-task implementation plan](../plans/2026-10-09-support-access.md) approved by the user on 2026-10-09; prerequisite merges and the standalone product claim still precede implementation.

## Intent and scope

Continue the requested foundation sequence after optional SSO and passkeys: let a platform operator troubleshoot the tenant's business data with explicit tenant consent, bounded time and attributable history. The first release is read-only. The user's2026-10-09 approval accepts the complete written scope, including read-only access, configurability, conservative authority invalidation and this data model; the earlier scope question needs no repeated answer.

Success means a tenant administrator can approve access for one known operator, one active target member and one legal entity; the operator can inspect permitted data while remaining signed in as themselves; expiry, revocation and authority changes prevent further access; tenant owners can see both identities and the reason. Existing password, TOTP, backup-code, trusted-device, SSO and passkey behavior remains authoritative.

Business edits, provisioning, target-user authentication, credential recovery on another person's behalf, bulk exports, attachments/object-storage access and PostgreSQL RLS are separate scopes. Manufacturing quality2d is now merged; preserve its implementation and separate follow-up scope.

## Current evidence and prerequisites

- Design began at main1acf6c9; current planning incorporates main4374823, quality2d/0030_quality and the scheduling049 claim unchanged. Completed passkeys are reconciled on `passkeys-implementation-20261008` at45e4180, awaiting actual green-CI PR merge. All31 published SQL/snapshots/journal prefix are preserved; both reviewed passkey SQL files are byte-identical, finally numbered 0032/0033 after published 0031_scheduling, with 34 coherent snapshots/no-change generation. Fresh23 auth fixtures, eight HTTP suites/four production browsers and root checks passed; [review/current evidence](../reviews/2026-10-08-passkeys-review.md). Derive any later migration number from the freshly published journal, without reserving one here. The protected source retains prior unpublished passkey timestamps and lacks quality; only an owned logical copy was reconciled, never an automatic shared upgrade.
- [Auth/tenancy contract](../../15-tenancy-rbac-auth.md) specifies a reason, a30-minute expiry, a banner, protected secrets and two-identity audit. Decisions009/010/015 preserve native authentication, separate platform administration and application tenancy.
- [AccessGuard](../../../apps/api/src/common/access.ts) authenticates the native session, checks SSO pending state and resolves tenant membership/role scopes. The passkey integration also checks passkey pending state. `@PlatformAdmin` currently allows only SuperAdmin, despite the separate `support` level; retain that restriction on existing console endpoints.
- [AuditService](../../../apps/api/src/common/audit.service.ts) already hash-chains tenant/platform records, but always writes `impersonatorUserId:null`. [Audit schema](../../../packages/db/src/schema/access.ts) has both identity columns.
- The installed Better Auth1.7.7 admin endpoint creates a target-user session, replaces the login cookie, and defaults impersonation to3600 seconds. That plugin is not registered. Registering it would also add unrelated administrative routes/schema; do not enable it for this scope.
- [Invoice balance reads](../../../apps/api/src/modules/accounting/invoice-balances.controller.ts) call `BillService.syncIn` and can append bill effects. GET is not proof of a safe read. [Accounting report reads](../../../apps/api/src/modules/accounting/reports.controller.ts) use SELECT paths.
- [WorkspaceProvider](../../../apps/web/src/components/workspace.tsx) shares native `/me` state, query keys and saved tenant/entity selection. Support mode needs its own context/cache; no cookie swap or replacement of ordinary workspace storage.

## Approaches considered

| Approach | Benefit | Cost |
|---|---|---|
| **Native operator session plus scoped application grant — recommended** | Retains native login/MFA and real actor; tenant consent never produces target credentials; exact read surface | Dedicated consent/read boundary and a small isolated workspace |
| Native admin impersonation session | Framework provides start/stop and cookie restoration | Target authentication can reach routes outside tenant guards; plugin roles differ from `platform_admin`; broader hooks/schema/endpoints and restoration failure modes |
| Separate diagnostic portal and duplicate reporting engine | Independent presentation and read models | More duplicated queries/UI and greater drift from the user's actual data |

Choose the first approach. Reuse proven business SELECT helpers/components through explicit read interfaces, rather than duplicating a reporting engine or mounting existing edit forms.

## Approved authorization rules

1. Deployment `SUPPORT_ACCESS_ENABLED` defaults false. Each tenant's typed support policy also defaults disabled. Both must be enabled for grants/reads. There is no emergency bypass.
2. Operators must have an existing current `platform_admin` record with level `superadmin` or `support`. A dedicated support controller/guard allows these two levels; it does not widen `@PlatformAdmin` or ordinary tenant membership.
3. A normal tenant session with tenant-wide `settings.support_access.approve` can create consent. `configure` changes policy; `cancel` revokes access; `read` views tenant history. Seed Owner and Administrator with these permissions. Existing audit/report-only users may receive `read` through the read-only role rule, never approve/configure/cancel through that rule. Custom delegation requires tenant-wide scope. Reject `x-entity-id` on consent/policy control requests so entity-scoped grants cannot approve tenant access.
4. The approver and operator must be different people. The target must be an active member of the chosen tenant and must not hold any platform-admin record. A target may be a tenant Owner/Admin; support context never inherits their owner/admin shortcuts or platform privileges.
5. Approval, policy enablement and start require a locally verified email, enabled verified local TOTP, a native completed sign-in less than300 seconds old, and actual native password confirmation. Current native TOTP/backup/trusted-device policy defines completed sign-in; this does not claim a new TOTP entry on every proof or invent a new factor verifier. Pending SSO/passkey/native factor challenges confer no authority. Missing password/MFA requires ordinary enrollment/sign-in; no exception or credential creation. Approver logout after consent does not itself revoke approval; authority/security changes still do. The operator must keep the exact native session bound at start.
6. Approval fixes operator ID, target user/membership, tenant, entity, read areas/permissions, reason and duration. A tenant administrator chooses the operator by exact existing email; failure is a generic unavailable result, with no platform directory. The operator sees only grants addressed to their own ID. No support-wide tenant/member directory is introduced.
7. Default/max session duration is1800 seconds, matching the existing30-minute contract. Tenant maximum is configurable300–1800 seconds; requested duration is300 seconds to that maximum. Consent must start within600 seconds of approval. One consent starts once; it cannot be renewed or broadened. Start uses database time after waits. Session expiry is the minimum of requested duration, tenant/deployment cap and the native actor session's then-current expiry. Native renewal never extends the support deadline.
8. The effective permission set is the intersection of the approved permission ceiling, the target's current scoped permissions and the implemented safe-read catalog. No ownership override. Every business query binds the approved tenant/entity, independent of client headers/IDs. Shared tenant metadata is limited to item/party labels needed by the approved entity's records.
9. Store the exact native actor session ID at start. Logout, native session revocation, platform-role changes, password/factor authority changes, tenant suspension, policy changes, member/role changes or selected-entity disablement invalidate access. Restoring the old authority cannot revive an invalidated consent; new consent is required.
10. Revocation prevents reads authorized after its transaction commits. A read already serialized before revocation may complete; delivered data cannot be recalled. No longer-lived access token, target session or target credential is issued.

## Tenant policy and durable evidence

Use additive tables; never modify published SQL or backfill privileged grants. Missing tenant policy behaves as disabled, with a1800-second cap and the five implemented read areas as its configuration defaults. Consent always selects a nonempty subset of enabled areas that the target currently has permission to read; future catalog additions require a policy update/new consent.

- **`support_access_policy`**: tenant ID, disabled-by-default flag, max duration, allowed read areas, configuration revision and tenant authority revision. Configuration updates are audited and invalidate existing consents, including a change that relaxes limits. Removing an area cannot extend old consent.
- **`support_access_grant`**: immutable tenant/entity/operator/target membership identity; approved areas/permission ceiling/reason/duration; approver and proof provenance; approval/start deadline; captured policy/authority revisions; actor native session binding; one-way start/stop/revoke timestamps and safe reason codes. Terminal consent cannot start again. Private proof/version fields never appear in public DTOs or audit `before/after` payloads.
- **`support_access_user_epoch`**: server-only global native-user security revision for identities participating in consent. This follows the existing global auth-evidence pattern; policy/grant/events are tenant-scoped. Captured versions prevent changes followed by restoration from reviving old consent.
- **`support_access_event`**: append-only scoped lifecycle/read/denial evidence, grant ID, subject, actual operator/approver where applicable, fixed event kind, route/area code and database time. No response bodies, passwords, cookies, native challenges or token material.

Native authority changes bump revisions in their original SQL transaction. Narrow triggers cover tenant status; membership status/identity/ownership; role permissions and assignments; selected-entity eligibility; platform role changes; local password, email/verification and verified factor authority changes. Native actor-session deletion invalidates grants bound to that exact session, not unrelated expired-session cleanup. Compare relevant fields; failed-factor counters, session renewal, names and descriptions do not invalidate access.

The first release may invalidate every grant in a tenant on a relevant membership/role change. The user's written-spec approval accepts this conservative behavior: unrelated user administration can require new consent. Do not rewrite native user/account/session rows or require foreign keys that block native cleanup. Historical identity references survive deletion; absence refuses access. Version bumps and actual invalidation remain committed with the source mutation. Relevant trigger/reader lock order must be consistent, bounded and proved under concurrent native and tenant mutations.

Native password confirmation occurs before holding support authority locks. Capture the user security epoch and a server-HMAC password version before invoking the native verifier; the grant transaction rechecks the same native session, versions, email/MFA state and current roles. No plaintext password or native credential hash is persisted in grant evidence, and no new encryption secret is required. Never accept a browser-supplied boolean, timestamp or password version as proof. A password/reset race refuses consent/start.

Expiration is enforced from immutable deadlines on every validation; no queue/worker is needed for access enforcement. History reports derived expired/invalidated state even if no later workspace request occurs. An observed terminal transition appends its evidence once; underlying native/tenant mutation evidence identifies the authority change. No fictitious logout event is recorded for a session that simply timed out.

## Read boundary and component responsibilities

- **Support policy/store** owns typed configuration, immutable consent, single-use start/terminal transitions and authoritative clock/revision checks.
- **Support auth/control service** uses authoritative native actor authentication with `disableCookieCache:true` and `disableRefresh:true`, and supported native password proof; checks platform/tenant approval authority. The installed native session route supports both flags. Ordinary request context remains the real actor.
- **Support read boundary** resolves an approved grant and constructs a detached scoped subject context solely for its reader. It has no native target session. It admits only cataloged enum areas, exact filters and existing read permissions.
- **Pure business readers** accept an explicit scoped context and PostgreSQL read-only transaction. Extract only the SELECT helpers needed by supported panels; ordinary controllers delegate with unchanged normal behavior where applicable. Do not call controller methods that lazily seed defaults, reconcile bills or perform external work.
- **Support audit adapter** records subject in `actor_user_id`, real operator in `impersonator_user_id`, and grant/tenant/entity/area/reason metadata in the existing tenant hash chain. Lifecycle consent is attributed to the actual approver/operator, with the target in safe metadata. Ordinary audits retain their existing null impersonator and serialization/hash order. Tenant history clearly labels the real actor and target.
- **Support workspace** owns a separate client context, bounded read panels, banner/countdown and stop action. It does not replace native `/me` or ordinary workspace state.

A support read holds the relevant authority/grant locks in a control transaction, validates current native identity and scoped permissions, materializes data through a separate bounded read-only transaction, rechecks database time/authority after waits, and commits required event/audit before returning data. The read pool is separate and bounded (max2, connection wait2 seconds); control/statement work has a5-second timeout. Acquiring a second connection from the same saturated ordinary pool is forbidden. Read-only SQL prevents an accidentally reused write path from silently altering books. Audit failure, timeout, rollback, expiry or lost authority returns no data.

Read queries never execute arbitrary SQL, target paths or filters supplied by the caller. Zod `.strict()` parses each area-specific query. Data operations enforce entity ownership on every document ID/join. Errors from the DB/native framework are mapped to bounded public codes without raw parameters. Record known-grant denied operations without response data; unknown/foreign grant lookup returns generic404 without identity details.

Support selection uses `x-factoryos-support-access` as an untrusted grant ID, together with the real native cookie. The ID is not a bearer credential. The header is valid only on the dedicated workspace endpoints; reject it before native auth dispatch or public-route shortcuts on every other route. Consent/policy/start/stop control requests use the normal actor/tenant context, never a support subject context. Normal authenticated access without this header stays the operator's own authority.

Control POSTs require the exact configured same-origin web Origin and existing native cookies. Workspace GETs require an exact allowed Origin, or same-origin Fetch Metadata plus exact allowed Referer when browsers omit Origin. No deployment origin is derived from arbitrary Host/forwarded headers. Server-side tests must exercise the actual supported transport; no custom trust fallback.

## First-release read surface and API

Only these panels are in scope; their readers must remain pure SELECT and pass cross-tenant/entity tests. No default authorization for future routes or new permissions ending in `.read`.

| Area | Existing permission | Data shown |
|---|---|---|
| Inventory | `inventory.report.read` | Entity stock balance and paginated stock ledger |
| Sales invoices | `selling.sales_invoice.read` | Entity list/detail and frozen invoice lines/tax; related party/item labels |
| Purchase invoices | `buying.purchase_invoice.read` | Entity list/detail and frozen invoice lines/tax; related party/item labels |
| Work orders | `manufacturing.work_order.read` | Entity list/detail, frozen BOM/routing and recorded WIP/job-card facts (no payroll/private credentials) |
| Accounting reports | `accounts.report.read` | Existing activation status, trial balance, account ledger and day book |

Invoice-balance endpoints, credit-status checks, bill synchronization, opening/activation, tax/provider/bank/email diagnostics, user/role/security settings, raw audit payloads, attachments, downloads/print/export and all business mutations are outside the catalog. Show an explicit unavailable-in-support message for excluded areas; do not automatically fall back to normal target APIs. The target's labels/permissions are visible as context, never their authentication/account rows.

Approved routes (names include no arbitrary forwarding endpoint):

- Tenant control: `GET/PATCH /support-access/policy`, `GET/POST /support-access/grants`, `POST /support-access/grants/:id/revoke`. Authenticated target self-stop uses `POST /support-access/grants/:id/stop` and an exact subject-ID check; it does not permit listing or administering other grants. POST creates the fully scoped approval after native proof; grants are tenant-initiated, avoiding a new global support directory. SMTP is unnecessary.
- Operator control: `GET /support-access/operator/grants`, `POST /support-access/operator/grants/:id/start`, `POST /support-access/operator/grants/:id/stop`. Lists return only addressed consent. Start confirms native proof and consumes consent once; stop can close expired access and is idempotent for the same actor/grant.
- Workspace: `GET /support-access/workspace/context` and `GET /support-access/workspace/:area`, where area is a fixed enum and each panel has strict bounded filters. Context supplies actor/subject display, fixed tenant/entity, effective approved panels and server expiry.

Policy/consent/history use safe DTOs. Database revision/proof versions, raw passwords, native cookie/token values and factor material are private. Grant IDs/history metadata are not used as authentication.

## User flow and isolation

1. Tenant administrator opens Settings → Support access, enables the tenant policy if desired, and selects an existing operator by exact email, target member, one entity, allowed panels, duration and reason/ticket reference. Recent completed native sign-in and password confirmation authorize consent; operator cannot self-approve.
2. Operator opens their dedicated Support inbox, sees only addressed consents, signs in again through the existing native flow when required and confirms password to start. No silent tenant switch or cookie replacement.
3. `/support/workspace/:grantId` shows "Read-only support", real operator, target, tenant/entity, reason, expiry/countdown and Stop. Only approved panels appear. Form mutation/autosave, bulk download and owner/admin controls are absent. Use existing UI components/tokens and mobile layout.
4. Stop clears only support state; the native operator stays signed in. Tenant administrator can revoke; target may also stop a grant addressed to themselves through an authenticated subject-ID check, without gaining general support-administration permission. Deployment/tenant disabling closes access.

Support query keys include native actor ID/session ID, grant ID, subject, tenant, entity and panel/filter. No shared cached `/me/context` or `fos.tenant`/`fos.entity` write. Identity/grant change aborts in-flight requests and clears support query data before another panel renders. Refetch authoritative context before showing cached data after navigation/focus. A revoked/expired response clears displayed data and ends the workspace; it cannot switch to another user or resume an old consent.

## Validation required before software completion

These are future implementation acceptance checks, not checks already run for this document.

- Real native password/TOTP/backup/trusted-device, SSO and passkey paths prove completed actor/approver identity; pending challenges, expired session/proof, password-reset races and forged proof fields refuse. No native target session/cookie is produced.
- Real tenant Owner/Admin/custom tenant-wide versus entity-scoped approvals; operator self-approval, foreign memberships/entities/IDs, target platform-admin status and removal/regrant of operator authority refuse.
- One approval/one start, expired approval, maximum/default/changed policy, stop/revoke and revision changes; restoring tenant/member/platform/role authority cannot revive consent. Clock checks occur after lock/pool/audit waits, not before them.
- Every catalog panel has positive actual data, target permission and exact entity checks. Unknown routes, direct native auth requests with the header, ordinary target APIs, GET bill synchronization, mutations, exports and attachment requests refuse without book effects. Actual PostgreSQL read-only transaction rejects an attempted write.
- Distinct PostgreSQL connections/PIDs and observed blockers prove start/start, read/revoke, role/member/tenant changes, logout/reset, source authority restoration, expiry after audit wait and required-audit failure. No fake waits or caller-controlled fault hooks. Source mutations and native auth retain their normal successful behavior.
- Owned populated logical copy proves original GL/journals/bills/effects/stock/bins/FIFO, activation records, native credentials/valid sessions and prior audit rows unchanged by support reads; only legitimate new support evidence is appended. Published migration bytes remain immutable. Never activate or migrate shared books automatically.
- Production desktop/mobile browser proves consent/inbox/banner/panels/stop, expiry/revocation cleanup, native account switching, aborted stale returns, cache isolation, local recovery and no overflow. Current ordinary user/platform/SSO/passkey/email/manufacturing workflows remain intact.
- Required root typecheck/build/unit checks and meaningful focused HTTP/schema/browser suites run on the final tree; report lint0 coverage honestly if still unconfigured. One fresh final review after implementation, followed by author correction, retaining the established inline preference.

## Delivery and remaining gates

Written-spec review accepted these business/security choices on2026-10-09. The [implementation plan](../plans/2026-10-09-support-access.md) was approved by the user on 2026-10-09; any agent or human may execute it (optional note: Native inline was the preferred method). Before product code, merge prerequisites and a standalone named-owner claim through green-CI PRs as required by [AGENTS.md](../../../AGENTS.md). Preserve other owners, fetch the latest journal and complete all approved work on an own branch; no direct main push.

GitHub GraphQL403 is the known PR/CI automation blocker; do not repeat identical requests without evidence access changed. A pushed design or local software tests do not establish remote green CI, merge, deployment or live enablement. Real HTTPS/proxy/operator acceptance and explicit deployment/tenant enablement are separate. PostgreSQL RLS follows as its own database role/context/pool/transaction design.
