# Configurable Google and Microsoft SSO — design

Date:2026-10-07 (Asia/Kolkata). Status: **Accepted by user Continue2026-10-07; implementation-plan review pending**. Continues accepted decision009 and the authorized foundation sequence after completed email delivery. Native/default-branch preference persists. This document authorizes no implementation, credential registration or live identity-provider access.

## Intent and success

Let existing FactoryOS users sign in with their Google or Microsoft work identity while retaining their local account, TOTP, memberships, entity scope and audit identity. Providers are configurable and disabled until securely configured. A provider identity authenticates a person; it does not create a tenant membership or grant Owner/platform privileges.

The user requested configurable features and continuation of the foundation roadmap. The user approved this written design with Continue2026-10-07, including **optional SSO first**. Tenant-required enforcement is outside this accepted phase. Password/TOTP sign-in and recovery continue. Required-per-tenant SSO, new SSO-only user provisioning and automatic domain enrolment need a later policy design.

Success means: an existing user explicitly connects a same-email provider after verification and recent local authentication; subsequent provider sign-in returns that exact account; enabled TOTP is still enforced; cancellation, invalid state or a foreign provider identity grants no session or membership; disconnect leaves the password sign-in route available. Enabling providers must not change shared accounting/books/stock evidence.

## Approaches

1. **Recommended: native Better Auth Google/Microsoft providers.** Reuse the installed1.7.7 framework's code exchange, state, PKCE and signed-token validation. Add focused server policy, explicit linking and callback MFA enforcement. No new authentication service or provider plugin is needed.
2. Generic per-tenant OIDC/SAML: supports arbitrary enterprise IdPs, but adds provider ownership, discovery/network controls, tenant routing and enforcement/recovery policy. Defer to a separate enterprise phase.
3. External SSO gateway: centralizes federation but adds another service, credentials, deployment and recovery boundary. It does not remove FactoryOS membership/role checks. Defer.

## Scope and policy

- Google and Microsoft can be enabled independently per deployment. Both disabled by default. Credentials stay in deployment secrets; the web receives provider labels/availability only.
- First release signs in existing explicitly linked accounts. Both native providers set `disableSignUp:true`; caller `requestSignUp:true` must not bypass it. New users continue through current account/invitation onboarding, then connect SSO. This avoids silently creating or merging accounts from an IdP email claim and keeps the current password-based security/recovery UI usable.
- No implicit linking, even for matching verified emails. `disableImplicitLinking:true`, `allowDifferentEmails:false`, `updateUserInfoOnLink:false`; ordinary sign-in cannot mutate identity/profile or transfer an existing binding. Name/email changes at the provider never reassign the local account.
- Connecting requires a locally verified email, a live session created within5 minutes, password confirmation and the existing completed TOTP/trusted-device policy when enabled. Verification uses the delivered framework email flow; mail being disabled does not waive email ownership. Ordinary password sign-in remains available to unverified accounts.
- Explicit linking requires the returned email to equal the current local email after the same normalization used by existing auth. Google requires its verified email claim. Microsoft accepts a validated token from the configured organization for the explicit, locally authorized link; its email/preferred_username is not ownership proof and must never set local emailVerified. Trusting the configured Microsoft provider for explicit linking must not enable implicit linking.
- Existing password credentials cannot be disconnected through native unlink APIs in this phase. Only Google/Microsoft bindings may be disconnected; disabled providers can still be disconnected using a recent local login. Existing password/reset/TOTP/backup-code routes remain the recovery path.
- Disable a provider to refuse new starts, callbacks and new SSO sessions. Existing completed local sessions keep current expiry/revocation semantics; disabling does not claim remote IdP logout or immediate local session revocation. Operators can use existing local session revocation. Changing issuer/client configuration must not authenticate old bindings under a new authority.

## Provider configuration and verified identity

Configuration is validated from the original server environment before unknown keys are stripped. Proposed names:

| Variable | Meaning/default |
|---|---|
| SSO_GOOGLE_ENABLED | false; explicit enable |
| SSO_GOOGLE_CLIENT_ID / SSO_GOOGLE_CLIENT_SECRET | required when enabled, never returned in diagnostic APIs |
| SSO_GOOGLE_ALLOWED_HOSTED_DOMAINS | optional comma-separated exact lowercase Workspace domains; empty allows explicitly linked Google identities including personal accounts |
| SSO_MICROSOFT_ENABLED | false; explicit enable |
| SSO_MICROSOFT_CLIENT_ID / SSO_MICROSOFT_CLIENT_SECRET | required when enabled |
| SSO_MICROSOFT_TENANT_ID | required organization UUID; common/organizations/consumers refused in this first release |

Production requires HTTPS canonical auth/web origins. Development HTTP is literal loopback only. Provider authorization/token/JWKS authorities are the native public Google/Microsoft endpoints; no user-supplied discovery URL, custom authority or arbitrary scopes. Google hosted-domain restriction checks signed `hd`, not the typed email suffix or authorization hint. Microsoft checks signature, audience, exact issuer, tenant UUID and stable oid. Identity keys are native Google sub / Microsoft oid plus the persisted validated issuer; never email, display name or preferred_username.

Google requests only openid/profile/email. Microsoft overrides its native default scopes to openid/profile/email, sets disableProfilePhoto:true and requests neither User.Read nor offline_access. No Graph/directory/file/mail access is part of this phase.

Use native authorization-code redirect flow only. Reject client-supplied idToken sign-in/linking, arbitrary scopes, additionalParams and client-declared security context. Framework PKCE must be enabled for both configured providers and verified against the actual generated challenge/code exchange; state nonce/browser binding and token issuer/audience/signature/expiry checks cannot be bypassed in test or production configuration. Tests must establish whether a provider emits an OIDC nonce and validate it when required by that provider; do not infer protection from a UI success result.

Canonical provider callbacks are `<BETTER_AUTH_URL>/api/auth/callback/google` and `/microsoft`, using the web origin where the API is proxied. Only fixed same-origin success/error landings are permitted. Store a validated relative return path, including an authorized invitation path, in server-controlled OAuth state. Additional client data, tenant headers and query parameters cannot identify the account to link or certify MFA.

## Architecture and data

Keep authentication in the API's existing Better Auth factory. A focused SSO policy module owns config validation, request/callback checks and sanitized results. It depends on DB/config, not business ledgers. Compose its hooks with the current email hooks; do not replace reset/verification quota/privacy behavior.

Use the existing auth account table for provider links. Add an optional server-only `sso_issuer` field through the supported account schema extension: null for credentials; validated canonical issuer for Google/Microsoft. Account creation derives it from verified provider profile and server state, never the request body. Freeze userId/providerId/accountId/ssoIssuer for SSO rows; moving a binding requires disconnect/reconnect with new proof. Add uniqueness for providerId/accountId, matching the framework's actual lookup key. Existing duplicate keys must cause an explicit migration failure/report, never silent account deletion or reassignment. Read-only preflight currently finds0 Google/Microsoft accounts and0 duplicate provider/account keys; migration-time checks remain mandatory.

Any existing social row lacking issuer provenance is refused for SSO until explicit authorized reconnect; migration must not invent a verified issuer. Stored issuer must equal the currently validated provider issuer on both linking and subsequent sign-in. Microsoft configuration is one explicit organization per deployment in this release; changing its UUID cannot reuse an old binding.

Use a short-lived account-scoped `auth_sso_action` record for connection/disconnection authorization: user/session/action/provider, local-email snapshot, expected issuer, target account ID for disconnect, hashed random nonce, issue/expiry times and one-time consumed state. Lifetime5 minutes. A live recent session plus password confirmation mints the record; only its hash enters server-owned OAuth context. The callback rechecks the original session/user/email, local verification, provider configuration and expiry. A server-only action reference on the account mutation lets the binding trigger lock/revalidate/consume the matching authorization in the same transaction as creation/deletion and its event; native request hooks supply it only after validating the server-owned flow. Reject a missing, foreign, expired or previously consumed action at the DB boundary as well as the native API boundary. Session revocation, user deletion or account switching invalidates it. Expired unused records can be pruned independently of permanent evidence.

Account identity stays immutable, while a separate server-only action reference is the mutation authorization. Before native disconnect, policy sets that reference to the validated disconnect grant for the owned target account; the delete trigger rechecks its target/user/live session/expiry and consumes it with deletion. A link grant cannot authorize deletion or a disconnect grant creation. Setting the reference alone cannot transfer identity or consume a grant; failure/expiry leaves no permitted mutation. Concurrent references/consumption are serialized by row locks. The implementation plan must explicitly connect the supported adapter/native hook to this transaction-bound reference; do not substitute a non-atomic after-hook or claim it is atomic before testing forced failures.

Record append-only account-scoped SSO mutation events in the same transaction as account create/delete using DB triggers, so missing application audit cannot leave an unaudited binding. Events contain user/account identifiers, provider, validated issuer, action and timestamp; no provider tokens, raw OAuth code/state, grant nonce or passwords. Identity columns and events are immutable. This is global account security evidence, like auth/email account records, not a tenant permission record; no pretend tenant ownership. Successful completed SSO sign-ins and redacted failures are recorded through server auth hooks; account-event failure must prevent a binding mutation, and sign-in evidence failure must prevent issuing a usable new session. Do not claim that these account events use the existing per-tenant hash chain.

All SQL is additive, generated with descriptive migration names. Do not rewrite0024 or any earlier SQL, change original book activation state, reset shared data or migrate credentials into tenant business tables.

## Callback and MFA flow

1. Sign-in lists only enabled/configured providers. Server validates the selected provider and chooses fixed success/error URLs; it stores the safe return path in server-owned OAuth state. No link authorization is issued during ordinary sign-in.
2. Native framework validates state/browser cookie, exchanges the code and verifies provider token claims. SSO policy refuses unknown/unlinked identities and issuer/configuration mismatches. Matching email alone produces a generic failure with password/connect guidance.
3. A completed provider identity may only authenticate its existing immutable local binding. If the user has TOTP enabled, route through the **same installed twoFactor hook and verification/backup-code/trusted-device machinery**, extended to OAuth callback paths. Its existing matcher only covers email/username/phone credential paths; adding buttons alone would bypass local TOTP.
4. Before the response leaves, a pending-MFA callback deletes the provisional session, clears its cookie and newSession context, sets the framework challenge cookie and redirects to `/sign-in/two-factor` with the validated first-party return path. No API, get-session, account-management or tenant access is possible before completion. A failure in challenge/evidence handling removes provisional authority rather than leaving a session behind.
5. After MFA (or the existing valid trusted-device allowance), the ordinary session resolves current membership/tenant status/roles on every API request. Suspended tenants, disabled members, entity limits and SuperAdmin/support checks remain authoritative.

Do not fork or edit node_modules. Adapt the installed plugin's returned hook through a small typed wrapper; assert its supported hook shape at startup and fail closed if an upgrade changes it. Authorization logic never depends on whether the browser visits the expected landing page.

## Explicit connection/disconnection

“My security” is keyed by the actual current authenticated user, not workspace cache. It shows connected Google/Microsoft methods and local password recovery availability; no tokens or raw account keys are displayed. Verified-email prerequisite and recent-login/password confirmation are explained before redirect.

Connect uses a one-time action authorization bound to provider/user/session. Server inserts that authorization into `addOAuthServerContext`; callback reads it using exported `getOAuthState`, validates and consumes it, then permits the native explicit link. Normal/native direct `/link-social` requests lacking this authorization are refused. Authentication of a different provider account, different local session or changed local email does not complete a link. No provider profile can overwrite the local email/verification/name.

Disconnect requires equivalent local proof, removes only the selected owned provider binding and records its event atomically. Guard the native unlink endpoint as well as UI endpoints; a caller cannot remove credentials or a foreign account. Serialize ownership/action consumption so two concurrent connections for one provider identity can produce one owner only; duplicate callbacks never transfer a binding or repeat a successful action. Concurrent disconnect versus sign-in checks the binding at session creation; removal prevents new sessions and already-created sessions keep the explicitly described revocation policy.

Token material is encrypted with native encryptOAuthTokens:true and account cookies are disabled. Block browser-facing get-access-token/refresh-token/account-info routes for these sign-in-only providers, including native direct routes; provider tokens are not an application feature. Raw provider responses/errors are never logged or echoed; public landings map allowlisted error codes to fixed messages. Provider denial/account-not-linked/state failures never reveal whether an arbitrary email exists.

## UX and endpoints

Sign-in gains “Continue with Google” / “Continue with Microsoft” only for available providers; password form remains primary and unchanged. Cancellation returns a fixed safe message. SSO sign-up buttons are omitted because account creation remains the existing onboarding flow. Invitation return paths survive successful sign-in and any MFA challenge; source acceptance still happens through the authoritative invitation endpoint.

Add a small public provider-availability endpoint returning labels/enabled state only. Authenticated security endpoints return only current-user connection summaries, issue action proof after local checks and complete explicit disconnect. They do not accept a target userId, tenant role, provider token or client-certified identity. Native auth routes are policy-guarded so bypassing these API helpers confers no extra capability.

Sensitive SSO landings use no-store/no-referrer and clear query state before rendering ordinary account content. Mobile browser states include provider disabled, cancellation, unlinked account, mismatched email, email verification needed, reauthentication needed, pending MFA and connection removed. Late callbacks/results for an old user/session cannot repopulate the new user's security UI.

## Verification and review requirements

- RED→GREEN configuration/claims tests: disabled/no credentials, partial config, production HTTP, arbitrary provider/scopes/authority, Google hd spoof, wrong Microsoft tenant/issuer, invalid audience/signature/expiry, and client idToken bypass.
- Actual installed Better Auth handler against disposable PostgreSQL and local synthetic OAuth token/JWKS fixtures. Intercept only provider network responses in the fixture; preserve real state parsing, browser cookie binding, PKCE exchange, signed token verification, framework account linking and session creation. No production fixture bypass flag or live IdP credentials. Verify that token canaries are encrypted at rest and absent from API metadata/logs.
- Explicit link proof: unknown provider identity and matching email cannot create/merge accounts; expired/consumed/foreign-session action, revoked session, changed user email or verification, disabled provider, duplicate callbacks and account ownership races are refused. Failed event insertion leaves no new binding/deletion/session authority. Direct native account/token endpoints receive the same restrictions as UI routes.
- MFA proof: real provider callback for TOTP-enabled user creates no usable provisional session, wrong/expired/replayed challenge denied, actual TOTP/backup completion succeeds, valid trusted-device semantics remain unchanged. Direct get-session/tenant API before completion denied; forged callback/next/additionalData cannot certify MFA or redirect outside canonical origin.
- Distinct actual PostgreSQL lock contenders for two linking callbacks and disconnect-versus-session creation; assert one binding owner and the documented permitted session outcome. Do not count Promise concurrency without observed database contenders.
- Production browser: mobile optional-provider UI, local sign-in/recovery, current-account security linking/unlinking, IdP denial, held callback/account switch, invitation return through TOTP and legacy signup/invite/TOTP flows. Both providers must exercise framework callbacks; a mocked UI-only success is insufficient.
- Root build/typecheck/uncached tests/lint (report0 tasks honestly), email regression/privacy fixtures and original tenancy/RBAC/invitation browser/API checks. Snapshot populated GL/bills/stock/FIFO and original migration/activation evidence before SSO mutations; exact invariance required.
- Execute inline on default branch after written spec/plan approval; preserve Native preference without asking again. No implementer/per-task agents. Proposed review method follows prior phases: one fresh read-only independent final reviewer after full verification, one test-backed Critical/Important correction pass, Minors deferred with reason/cost and no second review. Written-plan review will make this method concrete.

## Boundaries and live readiness

Deferred: required-per-tenant SSO, per-tenant credential/discovery editors, SAML/generic OIDC, SCIM/group/role mapping, provider-created accounts, password removal, remote logout/session enforcement and passkeys/impersonation/RLS (their own next phases). The email reset-success Minor stays separately recorded; do not mix it into SSO.

Live enablement needs the organization's registered Google/Microsoft OAuth application(s), secure client credentials, exact registered web-origin callback URLs, configured Microsoft organization UUID/optional Google hosted-domain restrictions, and working local email verification for connection. Required domains will be taken from the chosen official public provider endpoints; no arbitrary allowlist request during design. Local signed fixtures prove application behavior, not real tenant admin consent, production proxy settings or live IdP acceptance. No new service account, dependency, migration, secret or external project is created while reviewing this proposal.

## Review focus for implementation plan

1. Matching emails, stale/foreign link consent and concurrent callbacks must never merge or transfer a local account.
2. Native provider callbacks and direct auth endpoints must not bypass existing TOTP, browser state binding, same-origin returns or local-session revocation.
3. Provider configuration/issuer changes, signed hosted-domain/tenant restrictions and changed profile emails must not authenticate a stale or foreign binding.
4. Provider tokens, codes, state and action proof must stay encrypted/redacted; failed mutation evidence must not leave unaudited identity authority.
5. Account switching, invitation returns and current tenant membership/role checks must preserve existing access boundaries without ledger/book changes.

## Self-review and next step

Scope is one optional authentication method layer for existing accounts. Configuration, explicit binding proof, callback MFA and security UI fit one written implementation plan; tenant enforcement/provisioning remain separate. Policy defaults are stated above and accepted with the written design. Installed exported hooks and provider behavior were inspected; implementation must validate the exact wrapper/adapter behavior through real handler fixtures before claiming guarantees. No placeholders or live-service success claims.

Written design approved by user Continue2026-10-07; decision043 Accepted. Next: review the implementation plan before standalone product claim. No implementation has started.
