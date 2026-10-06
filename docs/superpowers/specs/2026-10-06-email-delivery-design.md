# Transactional email delivery design

Date: 2026-10-06 (Asia/Kolkata). Status: Proposed; written review required before implementation planning. Next decision: 042. Execution preference already established: Native inline on the default branch.

## Purpose and scope

The user requested the remaining foundation work after accounting: email delivery, SSO, passkeys, impersonation and PostgreSQL RLS. This first independent slice makes account recovery, optional address verification, tenant invitations and platform-created owner invitations usable through email. Success means these existing workflows produce durable delivery requests, expose appropriate operational status, preserve source permissions and do not publish login tokens in logs.

Confirmed constraints: configurable behavior, existing shared implementation retained, ordinary default-branch commits/pushes, no deployment or shared-book activation. User selected an existing SMTP service for the first adapter. Local verification uses a synthetic SMTP mailbox; exact production sender/service configuration follows separately. No SMTP/API credentials are currently present in the process or ignored local configuration; values were not displayed.

Existing code: `apps/api/src/auth.ts` logs reset URLs; `members.controller.ts` returns copyable invitation URLs; `platform.controller.ts` creates a tenant and owner invitation in separate transactions; `tenancy.service.ts` hashes invitation tokens and gives them seven-day expiry. Sign-in has no reset page. `user.emailVerified` exists but verification delivery is not configured. The installed Better Auth 1.7.7 exposes reset and verification callbacks; its reset token is stored before invoking the callback, while verification uses an expiring signed token. Documentation claiming verification is already delivered is ahead of the code.

Included: fixed plain-text/HTML templates, durable queue and leased worker, SMTP adapter and isolated local test adapter, environment validation, scoped delivery metadata, safe retry/source-refresh actions, forgot/reset-password screens and verification actions. Excluded: invoice/marketing mail, attachments, inbound mail, tenant-owned SMTP credentials, a general template editor, bounce/webhook ingestion, guaranteed mailbox arrival, SSO/passkeys/impersonation/RLS, and existing-account verification enforcement.

## Approaches and recommendation

1. **Durable PostgreSQL outbox plus SMTP — recommended.** Reuses PostgreSQL, supports existing SMTP services, and keeps source creation independent of network latency. Requires a worker and careful treatment of uncertain acceptance.
2. **Direct SMTP from request handlers.** Less infrastructure, but slow/failing mail blocks requests and commit/network ordering can lose messages or send rolled-back invitations.
3. **Durable outbox plus a managed HTTP email API.** Similar reliability, with provider-specific idempotency/status/webhook opportunities; requires selecting a vendor, credentials and billing. Preserve a transport boundary so this can be added through a separately reviewed adapter.

No provider account or paid service is created by this design. SMTP is the selected first adapter; exact production credentials and sender configuration remain separate.

## Configuration and ownership

A deployment-wide sender serves this slice. Proposed modes: `disabled` and `smtp`; local functional tests use a loopback SMTP sink containing only synthetic recipients. A unit-test transport is injected by test utilities, never enabled through a public API or production mode. Disabled mode removes token logging and openly reports unavailable delivery without pretending a message was sent.

Proposed server-only configuration: email mode; SMTP host/port; `implicit-tls` or `starttls-required`; username/password when required; sender address/display name; optional reply-to; separate 32-byte `EMAIL_PAYLOAD_KEY_V1`; worker enablement. SMTP mode requires a valid sender, host, port and encryption key. Reject partial credentials, newline/control injection, insecure TLS settings and credential values in browser responses. TLS verification stays enabled; plaintext transport is allowed only to a loopback test sink in development/test. No arbitrary per-request destination server or sender.

The worker and API share the reviewed deployment configuration and payload key. Keep the old key until all envelopes using it are cleared; missing/wrong keys block sending with a redacted configuration error. Key replacement is not silent rotation. Secrets go in secure environment settings, with documented names in `.env.example` during implementation. Live acceptance also requires sender-domain verification, SPF/DKIM/DMARC as directed by the selected service and reachable SMTP connectivity. These are deployment prerequisites, not simulated local successes.

## Queue, encryption and scope

Add a generated migration after 0021; never rewrite existing SQL. Define delivery records and append-only attempt/event records. A delivery freezes its purpose, template version, sender identity, recipient, source identity, source expiry, creation time and idempotency key. Recipient/content/action URL live in an authenticated encrypted envelope, with AAD binding purpose, source and scope; never store the raw action token separately. Immutable metadata plus controlled state transitions permit delivery without rewriting source evidence. Purge encrypted envelopes on acceptance, expiry, cancellation, supersession or terminal abandonment; retain redacted delivery/attempt metadata for 30 days, then remove only email operational records, not source/audit records.

Every row includes `tenant_id`; conditional scope constraints distinguish tenant invitations (non-null tenant and matching invitation FK) from account-security mail (null tenant, exact auth user ID and purpose). Email is tenant-wide rather than entity-wide. Global auth users can belong to several tenants: do not pick a tenant from an unrelated session, and never expose their security deliveries through tenant queries. Attempt/event FKs preserve the parent scope. Account addresses are masked in platform diagnostics; tenant delivery metadata uses the already-authorized invitation address. No diagnostic API returns envelopes, HTML, tokens or full action links.

Uniqueness binds purpose plus source token/revision identity and scope. A repeat of the same callback/invitation queues one request; a fresh reset or renewed invitation has a new identity. Hashing an action token for internal deduplication does not make the raw URL public. Source status and permissions remain authoritative.

## Source integration and transaction boundaries

**Member invitations:** create invitation, encrypted delivery and tenant audit in the existing transaction. Network delivery starts only after commit. Preserve the authorized create response's one-time copyable invitation URL and existing roles/entity assignments. Missing delivery configuration yields an unconfigured metadata-only record (no envelope/token, no encryption-key requirement) and preserves the current manual-copy flow; it never generates a worker attempt. Later configuration does not silently reconstruct/send that old link: explicitly renew the source under the existing invitation authority.

**Platform owner invitations:** introduce a narrow transaction-aware `createTenantIn` helper and retain `createTenant` as a wrapper for existing self-service callers. Platform tenant, seeded roles/defaults, owner invitation, delivery and platform/tenant audit commit together. A failed enqueue in configured mode rolls the entire new platform tenant back; no orphan tenant or emailed rolled-back owner link. This is a targeted existing-flow correction, not a tenancy redesign.

**Password reset:** Better Auth remains the issuer, validator and consumer of the reset token. Replace URL logging with a callback that durably queues the actual generated URL, expiry and auth user identity. Validate action origins against the configured public auth/web origin; reset landing redirects are fixed same-origin paths, not caller-selected external URLs. The delivery callback must not reveal account existence when enqueue fails: known/unknown addresses retain the same generic request result, including forced enqueue failures. Record only redacted operational failure metrics; never say a request was queued without a row. A later user request can issue a fresh token. Rate-limit reset/resend by recipient identity and request origin without logging the submitted address or token.

**Verification:** use Better Auth's signed token, explicit one-hour expiry and callback. Send on new signup when mail is configured and expose a signed-in “Send verification email” action with cooldown. Existing sign-in remains compatible: this slice does not require verification or backfill existing users as verified. Before dispatch, verify the current user's email still matches and is not already verified. Do not mark an email verified because SMTP accepted it or an invitation was created.

Before each dispatch, revalidate source scope, pending/consumed/revoked status, recipient and expiry. For resets, check the original Better Auth verification record; for verification, validate the original signed-token expiry and current user/email state; for invitations, check the exact pending invitation and active tenant. Skip stale/consumed/revoked/expired sources. A revocation after the final check may race a network send, but its emailed link remains invalid because the source acceptance endpoint is authoritative. Never hold a database transaction open over SMTP.

## Worker and delivery outcomes

Claim due requests with PostgreSQL row locks/`SKIP LOCKED`, a lease and fencing token. Record a dispatch-start event durably before network activity. Only the current lease may record an outcome; two workers cannot dispatch the same claim simultaneously. Bounded concurrency defaults to two; connection/data timeouts default to 30 seconds and a 120-second lease prevents ordinary overlap. A restarted worker does not assume the old request was never sent.

SMTP `250` after DATA means **server accepted**, not inbox-delivered. Use a stable Message-ID for correlation; SMTP does not promise deduplication. Definite temporary failures before acceptance retry after 30 seconds, 2 minutes, 10 minutes, 1 hour and 4 hours, bounded by source expiry and five retries. Permanent recipient/auth/configuration refusals stop automatically. Connection loss after DATA, missing acknowledgement, or a crash after dispatch started yields **acceptance unknown**: no automatic resend. A worker crash before dispatch-start can safely release/retry the claim. Record only categorized error codes and redacted remote IDs, never provider response bodies that may include addresses/content.

Delivery states distinguish unconfigured, queued, dispatching, retry scheduled, accepted, failed, acceptance unknown, expired and cancelled/superseded. Operators retry only definitely-unsent, still-valid source evidence. An unknown/reset/expired link requires a new source request; never resend the old encrypted envelope blindly. Creating a replacement invitation requires the existing invite-creation authority, retains the prior audit trail and explicitly revokes the old pending invitation. Recheck assigned roles against current caller authority. Recovery grants no ability to change a recipient, role or password.

## UI and authorization

Sign-in gains a forgot-password link. Request UI gives the same generic acknowledgement for known/unknown email; reset UI handles expired/invalid/already-used tokens and uses Better Auth's password policy. A successful reset revokes prior sessions through the library's configured reset policy and requires a fresh sign-in; no role/member changes. Reset-token issuance/consumption remains Better Auth's existing lifecycle; this slice does not claim all separately issued reset tokens are invalidated by consuming one. Verification delivery never consumes password-reset records. URLs with tokens use no-referrer headers, no analytics/third-party resources, and query/history cleanup after consumption. Error messages never echo a token.

Security settings show current address verification and a rate-limited send action. Confirmation updates only the verified-address state; it does not bypass TOTP, invite acceptance, membership enablement or tenant permissions.

Invitation lists add delivery status/time/redacted failure category. New `settings.email.read` and `settings.email.retry` permissions belong to Owner/Administrator; retry additionally requires the original source permission. Tenant lists always filter the active tenant; global auth mail is excluded. A SuperAdmin-only platform delivery view shows redacted operational records and worker/configuration health, with no access to action URLs. Support users do not gain account-reset or mail-resend privileges. Platform owner-invite recovery uses the original platform-create authority. Account-security email is re-requested by its normal public/signed-in workflow, not an administrator acting as that user.

## Verification and delivery criteria

- Pure template/config/envelope tests cover escaping, sender/header injection, wrong-key/AAD refusal, expiry, redacted errors, idempotency and safe callback origins.
- Real PostgreSQL tests prove invitation/queue/audit rollback atomicity, platform tenant/roles/invite atomicity, scope isolation, accepted/revoked source checks, stale-worker fencing and two-worker claim behavior with observed distinct lock contenders.
- Local SMTP tests distinguish accepted, definite temporary/permanent refusal, disconnect after DATA and crash after dispatch-start. Assert no blind resend for unknown acceptance and exactly one request for repeated source callbacks. No genuine mailbox is contacted by tests.
- Auth API/browser tests exercise reset request equality for known/unknown addresses and enqueue failure, actual delivered-token consumption, invalid/expired/replayed tokens, old-session revocation, signup verification and resend cooldown, unchanged unverified existing sign-in and existing TOTP/invite flows.
- Tenant/platform browser tests cover delivered/failed/unconfigured statuses, restricted roles, changed tenant/account while responses are pending, renewed invitation roles, mobile layouts and no raw token in diagnostics.
- Root build/typecheck/tests and configured lint tasks run; zero lint tasks are reported honestly. Existing accounting/bank fixtures and original migration/book activation baseline remain unchanged. No deployment or production SMTP send occurs in verification.

## Review and next stage

This is one architectural slice; the user selected existing SMTP delivery. Self-review: source ownership, callback transaction limits, scope, ambiguous SMTP acceptance, encrypted retention, manual compatibility and verification enforcement are explicit; no placeholder provider credentials or guessed acceptance claim. Written-spec approval permits writing the implementation plan only. The existing Native/default-branch preference remains; no execution-method question is needed.
