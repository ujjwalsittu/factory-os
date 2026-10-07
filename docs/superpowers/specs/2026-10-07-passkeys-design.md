# Optional configurable passkeys — design

Date: 2026-10-07 (Asia/Kolkata). Status: **Written spec approved by user Continue on 2026-10-08; implementation-plan review pending**. Continues decisions 009/045 and the requested foundation sequence. Decision 044 is already reserved for manufacturing on the shared development branch.

This document proposes application behavior. It authorizes no product implementation, dependency installation, database migration, credential enrollment or deployment. Merge the verified SSO corrections from `sso-completion-20261007` into `main` before dependent implementation. Execute the later approved plan inline using the existing Native preference, on a branch from current `origin/main`, through the required claim/PR/green-CI workflow.

## Intent and approved approach

Let existing FactoryOS users sign in with a personal passkey while keeping their local account, password recovery, TOTP, memberships, entity scope and audit identity. On a shared workstation, users should use their own phone or security key. A passkey authenticates the account; it never grants membership, Finance authority or platform privileges.

The user approved the presented approach with Continue, then approved this written spec with Continue on 2026-10-08: optional existing-account passkeys, the native Better Auth plugin with focused guards, recent password/MFA proof for management, server-enforced biometric/PIN verification and retained password/backup-code recovery. **Accounts with TOTP enabled still follow the existing TOTP/backup-code/trusted-device policy after passkey verification.** A user-verifying passkey does not itself replace TOTP in this phase. The detailed rules below are approved; implementation-plan review remains pending.

Success means an explicitly enrolled credential signs in exactly its immutable owner; an expired, replayed, foreign, unverified or removed credential grants no session; pending MFA grants no application or native-auth authority; a lost credential can be removed through existing local recovery; and existing password/SSO/email/tenant/accounting behavior remains intact.

## Alternatives considered

1. **Selected: version-matched native plugin plus application guards.** Reuse native WebAuthn challenge/client/cryptographic verification and Better Auth sessions. Add local consent, explicit configuration, verified-user checks, durable ownership/evidence, pending-MFA provenance and recovery controls. This fits the current self-hosted auth boundary.
2. Standalone WebAuthn service: offers complete ceremony control, but duplicates browser/challenge/session integration and adds another authentication implementation to maintain. Not selected.
3. Passkeys only at an external identity provider: can complement Google/Microsoft SSO, but requires live provider setup and does not give local-account users a FactoryOS passkey. Not selected for this phase.

## Configuration and boundaries

Passkeys are deployment-configured and disabled by default, independently of Google, Microsoft and SMTP. Configuration belongs to the server; tenant administrators cannot expand RP/origin trust or waive TOTP.

| Proposed variable | Contract |
|---|---|
| `PASSKEY_ENABLED` | Boolean, default false. Enables enrollment and new sign-in only after valid configuration. |
| `PASSKEY_RP_ID` | Required when enabled; exact canonical web hostname, without scheme/path/port. Use the application's hostname, not its parent domain. |
| `PASSKEY_ALLOWED_ORIGINS` | Explicit exact browser origins; default the canonical `WEB_ORIGIN`. No wildcard, request-Origin fallback or automatic inheritance from extra trusted origins. |
| `PASSKEY_MAX_PER_USER` | Integer 1–20, default 10; enforced under the owner's database lock. Lowering the limit preserves existing keys but refuses additions until below the limit. |

The RP name is FactoryOS. Production origins require HTTPS. Local HTTP support is limited to literal `localhost` with explicit ports and RP ID `localhost`, for development and browser fixtures. Validate every allowed origin against the RP's WebAuthn domain rules. Allowed origins must also be explicitly trusted by core auth; passkey configuration never overrides core origin/CSRF refusal. The default origin must remain the canonical web origin. Browser ceremonies occur on the web origin through the existing `/api/auth` proxy; do not derive RP ID from a separate API hostname.

Use `attestation: none`, discoverable credentials and required user verification for enrollment. Personal platform/synced credentials, phone-assisted ceremonies and compatible security keys are supported when they meet verification requirements. AAGUID, transports and backup flags describe authenticator properties; they neither prove device ownership nor grant privileges. FactoryOS never receives biometric templates, PINs or private keys. Device ownership guidance is not a claim that the server can detect a shared computer.

Disabling refuses new enrollment, authentication and pending passkey-MFA completion. Existing completed sessions keep ordinary expiry/revocation semantics; it does not silently revoke every user session. Locally proved list/rename/removal remain available while disabled. Changing RP ID refuses old credentials for new sign-in; keep them visible for locally proved removal and explicitly re-enroll on the new RP. Never relabel historical credentials as issued for a new RP. Removing an allowed origin refuses new ceremonies from that origin, even if it appears in general auth trusted origins.

No passkey-only account creation, email matching/merging, account transfer, password removal, mandatory-per-tenant/role enforcement, administrator enrollment, enterprise attestation, device allowlisting, cross-domain related-origin feature or conditional autofill in this release. TOTP replacement requires a later explicit policy decision.

## Components and integration contracts

Keep the new work in focused passkey policy/configuration, durable store/identity, native verification/MFA integration and current-user UI components. The policy resolves fixed configuration, purpose and authoritative local proof. The store owns transactional credential/actions/events and locks. Native integration verifies actual WebAuthn responses, creates normal Better Auth sessions and composes with the completed SSO/TOTP hooks. The UI displays availability and performs browser ceremonies; client claims never establish proof or ownership.

Published source for `@better-auth/passkey@1.7.7` matches installed Better Auth 1.7.7 and depends on SimpleWebAuthn 13. The package is not installed yet. Planning must pin a compatible version and account for peer requirements without upgrading the auth stack opportunistically.

Source inspection found these integration obligations:

- Native registration requires a session by default, but native fresh-session age defaults to 24 hours. Require a live session created within five minutes plus explicit password confirmation and completed existing MFA. Ordinary session renewal is not fresh authentication.
- Both native verifiers hardcode `requireUserVerification: false`; authentication options request `preferred` verification. Use supported `registration.afterVerification` / `authentication.afterVerification` callbacks to refuse a cryptographically verified response lacking user verification **before credential persistence or session creation**. Request required verification in browser options as well. Browser options or decoded client flags alone are not proof.
- Configure native RP ID/origins explicitly; the native request-Origin fallback must not define expected origin.
- Native registration can accept caller `createSession`; refuse this bypass. Keep `registration.requireSession: true`; do not configure anonymous resolution/provisioning or permit caller identity/context to select the owner.
- Native delete/rename require ordinary ownership sessions. Add recent local proof and transaction-bound action checks to the direct native routes, not only the UI.
- Native credential schema indexes credential ID without declaring global uniqueness. Add the database constraint and immutable owner/RP/public-key/user-handle rules.
- Native registration generates a random user handle but does not persist it in the credential schema. Retain that exact server-generated handle in ceremony metadata and the successful credential; check the asserted handle against it. Never reconstruct it from email or accept a client-selected owner.
- Native challenge has a signed browser cookie, 300-second expiry and adapter consume. Preserve these mechanisms and prove cross-process single consumption and post-lock expiry through actual PostgreSQL tests.
- The installed native TOTP matcher covers credential sign-in, not passkey verification; the SSO wrapper covers callbacks, not passkeys. Extend the composed pipeline with a distinct passkey path and private provenance while preserving both existing paths and response cookies.
- Native authentication separately updates the counter and creates a session. An application transaction/lock boundary must serialize live-credential checks, verified counter update, provisional/completed session authority and event evidence. The plan must prove the supported adapter/hook composition; an after-hook that merely reports failure after authority was committed is insufficient.

Unsupported framework behavior must fail closed and be reported as a blocker; do not fork the native verifier, invent an option, weaken proof or route direct callers around the application guards.

## Durable model and transaction rules

Credentials and authentication actions belong to the global auth user, like existing auth tables, because users can belong to several tenants. They do not carry a selected-tenant ownership claim. Every application request still resolves current tenant membership, entity scope and permissions normally.

Use additive generated SQL after reconciling the latest merged migration journal. Manufacturing already uses 0027 on another branch: **assign no next migration number in this design**, and never edit or overwrite prior migration SQL.

- **Native passkey credential plus private provenance:** native fields for public key/credential ID/counter/device/backup/transports/AAGUID/created time; globally unique canonical credential ID; immutable owner, RP ID, public key and server-issued opaque user handle; private last-used time. Bound user-entered labels to 1–80 characters. Device labels are escaped display text, not trust evidence.
- **Management action:** hashed random nonce, exact user/live session, kind (register/rename/remove), target credential for mutations, local-password proof reference, fixed RP/configuration snapshot, expiry no later than five minutes and one-time consumption. Revalidate proof/session/ownership and database time after waits. A grant from another session cannot be borrowed or replace a stale request's grant.
- **Ceremony metadata:** purpose, fixed RP/origin policy, native challenge/browser binding, opaque user handle and local management action for registration; private safe return path for authentication. No caller additional data can set these fields. Bound challenges to five minutes; a new ceremony can invalidate the browser's prior challenge without making it reusable.
- **Session/MFA provenance:** additive private credential/RP/pending fields on sessions and the actual native TOTP challenge. A provisional row is pending from its first insertion. Bind pending completion to the live credential and current policy; a server-keyed digest of the owner's current password credential, held privately on the pending challenge, invalidates it if the local password changes/resets before completion. Recompute it from the current owned password credential at completion. Do not copy the password hash into challenge metadata or expose the digest.
- **Append-only events:** credential added/renamed/removed and completed sign-in, with owner, credential's local ID, RP, time and action/session reference. Include bounded safe label changes where needed; exclude raw credentials, public-key material, challenges, tokens, password proof, user handle and authenticator responses. Failed required event insertion rolls back the corresponding credential/session mutation.

Order locks consistently: owner/security scope before action/credential/session rows. Registration limit checks and duplicate ownership checks run under locks. Authentication and removal contend on the same live credential. If removal commits first, the waiting sign-in/completion is refused; if sign-in commits first, subsequent removal revokes that credential's pending/completed local sessions. Validate expiry and configuration again after lock waits.

Persist counters with the verification library's semantics: accept legitimately non-counting/synced zero counters, refuse a non-advancing positive counter when the verifier does, and serialize updates so one stale verification cannot overwrite a newer counter. Retain verified backup/device metadata without treating synced or backed-up credentials as automatically invalid or verified devices. Failed proof, unsupported credential or event failure creates no authority.

Direct native route calls receive the same configuration, ownership, proof, expiry, label/body bounds and transaction rules. Requests cannot move credentials between accounts, overwrite public keys, submit arbitrary owners or insert private pending/MFA fields. Current-user list returns only safe local IDs, labels, creation/last-use and descriptive device/backup metadata, not raw credential IDs/public keys/handles. Guard the native list result as well as the application summary.

## Enrollment and management flow

1. A signed-in existing user opens My security. Display current-account passkeys, the enrollment limit and personal-device guidance. Password and TOTP options remain visible.
2. Adding, renaming or removing requires the current local account's password confirmation and a live session created within five minutes. If MFA is enabled, use the already completed native TOTP/backup/trusted-device policy. An SSO-authenticated session alone does not replace explicit password proof; an incomplete MFA session is refused.
3. Issue a short-lived action bound to the exact session and purpose/target. For enrollment, request native registration options with required discoverability/verification; retain the exact generated user handle server-side. Freeze allowed RP/origins and action binding in ceremony metadata.
4. On verification, consume the native challenge, verify its ceremony/browser/configuration, validate native cryptographic/user-verification results and revalidate current proof after locks. Create only the exact user's unique credential and evidence atomically. Return a safe summary, not a new session. A duplicate callback produces no second credential/event.
5. Rename changes only the bounded label with evidence. Removal atomically deletes the owned credential, consumes this request's action, records evidence and revokes local pending/completed sessions sourced from that credential. If the current session is one of them, clear its cookie and return to local sign-in. Password and SSO sessions follow their existing independent revocation policy.

The last passkey can be removed because the first release retains the password credential and native MFA recovery. Ordinary native account unlink must continue refusing password removal as in decision 043. Enrollment changes no email-verification status and makes no external email-ownership claim; live SMTP is not a prerequisite for adding a passkey after sufficient local proof.

## Sign-in and MFA flow

1. When enabled and supported by the browser, show an explicit Sign in with a passkey button. Its availability reveals deployment capability, not whether an entered email owns a key. Use discoverable credentials; no account lookup by typed email is necessary.
2. Issue native authentication options with the fixed RP and required user verification, signed browser binding, expiry and a validated relative return path. Primary sign-in is for signed-out users; a completed signed-in session must not be silently switched by this endpoint. Require explicit sign-out to change accounts. Any separate management reauthentication must require the same current owner.
3. Native verification proves challenge, RP, configured exact origin, signature/presence and counter against the unique live credential. Enforce verified UV and the exact recorded user handle; resolve the user by immutable credential ownership, never supplied email/display name. Check current enabled/RP/credential state under locks.
4. For accounts without TOTP, create a completed normal local session and completed sign-in event atomically. For TOTP-enabled accounts, mark the session pending at creation and run the actual native TOTP pipeline. Preserve valid native trusted-device handling; a passkey's UV flag is never itself a trusted-device or TOTP grant.
5. Pending sessions cannot access tenant/platform APIs, get-session authority or unrelated native auth/security mutations. Persist provenance on the real signed-cookie TOTP/backup challenge, not a process-only map. Challenge completion revalidates enabled config, RP, live owner/credential and unchanged local password version; only then may it create completed session authority and evidence. Expired/removed/disabled/password-changed provenance refuses completion.
6. Wrong/expired/replayed TOTP or backup proof follows current attempt limits and grants no access. Cancellation/failure removes unusable provisional state and clears its cookies. A trusted-device path still performs live-credential and atomic completion checks.
7. Return only to the validated local destination. Preserve invitation acceptance and the original safe `next` behavior across the native two-factor screen. Re-resolve current memberships/roles on application access; no enrollment or sign-in grants or revives an invitation's permissions.

Compose hooks carefully: retain email privacy/quotas, non-renewing authoritative session lookup, SSO consent guards, early-response headers, native renewal cookies and redacted non-API failures. Keep passkey/SSO pending provenance distinct and reject either kind wherever incomplete sessions cannot confer authority.

## Recovery, errors and current-user UI

Password plus TOTP/backup codes remain the recovery path when the phone/security key is lost. Encourage a second personal authenticator and secure existing backup-code storage, but do not require enrollment of a shared device. When all authenticators and TOTP backup codes are lost, this phase adds no administrator MFA bypass; a separate account-recovery policy would be needed.

Existing password reset remains private, uses the delivered email flow when configured and revokes old sessions. It does not silently delete enrolled passkeys: explicitly remove a lost credential from My security after local recovery. Reject pre-reset management grants through live-session checks and pre-reset pending passkey-MFA through the frozen password version. Tell users that changing a password does not replace removing a lost passkey.

Treat dismissal, unsupported authenticator, wrong origin/RP, duplicate, expired/replayed challenge and verification failure as fixed user-safe messages with password sign-in available. Do not disclose whether a credential ID/user exists or return raw library/SQL errors. Never log passwords, complete request bodies, native challenge cookies, credential responses, public-key/handle material or MFA secrets. Keep capability detection client-side and fail cleanly when WebAuthn is unavailable.

My security uses existing UI components and responsive patterns. Show a bounded name, added/last-used time and descriptive authenticator information; support add, rename and remove with current-user local proof. Do not treat an AAGUID label as verified device ownership. While disabled, show existing keys and locally proved management without offering enrollment/sign-in. Clear keys, proof, errors, outstanding responses and action state on user/session change; discard late responses from a previous account. Disable duplicate submissions during ceremonies. Test at mobile width and with held requests/account changes.

## Verification required by the implementation plan

- Genuine negative-to-positive native handler fixtures using generated authenticator responses and the actual verifier: valid registration/authentication, signed UV absent, wrong challenge/origin/RP/signature/handle, unknown/removed credential, duplicate IDs, positive-counter rollback and valid synced-zero counters. No production test bypass or hand-edited success claims.
- Management boundaries through direct native and application routes: anonymous/old/pending/foreign/revoked session, wrong password, mismatched action/target, caller createSession/user/context, expired proof after database wait, duplicate callbacks, rename limits and maximum-key contention. No foreign key list or raw native credential metadata disclosure.
- Actual PostgreSQL contenders on distinct backend PIDs: concurrent challenge consumption, duplicate registration/credential ownership, two additions at the limit, sign-in/removal, pending-MFA/removal and counter ordering. Assert observed waiting and the permitted committed outcome, including event-failure rollback and clocks advancing after waits.
- Native TOTP/backup/trusted-device completion with actual private provenance; pending API/get-session/security refusal, expired/replayed challenge, disabled config, RP change, removed key and password reset/change before completion. Regression of both original password MFA and completed SSO callback/challenge provenance/cookie renewal/unlink authority.
- Production-built browser with a real WebAuthn virtual authenticator and actual server signature verification: enroll, sign out/sign in, TOTP/invitation return, cancellation, rename, delete/current-session revocation, last-key local recovery, unsupported browser, disabled feature and held request/account switch. Phone/physical-key compatibility remains an explicit live acceptance step; virtual-authenticator success is not that claim.
- Root typecheck/build, uncached meaningful tests and configured lint (report zero tasks honestly). Existing email auth/privacy/recovery, SSO fixtures, original onboarding/invitation/tenant/roles/platform and affected legacy regressions. Snapshot populated GL/journals/bills/stock/FIFO plus original migration hashes/book activation rows before owned auth mutations; prove exact invariance without resetting shared data or activating books.
- One fresh read-only final reviewer after full verification, one test-backed correction pass for Critical/Important findings, and separately recorded Minor costs; no repeated final review. Keep execution inline without per-task agents. The written plan will make this review workflow concrete.

## Delivery and remaining gates

Written-spec approval permits writing the implementation plan, not implementation. The plan must cover native integration proof, additive transactional authority, exact handler/MFA boundaries, current-user UX, observed PostgreSQL races and regression. Preserve the user's Native inline preference without asking again.

Merge SSO completion first; reconcile concurrent manufacturing decisions/migrations from latest main, then merge a standalone passkeys claim PR before product work. Use own branches/PRs and verified green CI; never push directly to main. This documentation branch contains no product changes and grants no deployment/secret/provider/mailbox/device registration authority.

Live enablement later needs a stable HTTPS canonical origin/RP behind the real proxy, deliberate server configuration, supported personal devices and actual browser/device acceptance. It needs no new OAuth app or external passkey service. SMTP/SSO remain independently configured. Audited impersonation and PostgreSQL RLS are separate next designs; statutory TDS/NIC blockers and deferred review Minors are not included here.

Self-review: one optional existing-account auth layer; no provisioning/enforcement/recovery bypass. TOTP remains the approved policy, UV remains separately required, recovery and credential-session revocation are explicit, metadata is private, native gaps have verification requirements and migration numbering is left to the live journal rather than guessed. Written spec/decision045 approved on 2026-10-08. Next: review the [implementation plan](../plans/2026-10-08-passkeys.md), then its prerequisite claim gate before product work.
