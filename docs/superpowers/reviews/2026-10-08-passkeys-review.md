# Optional passkeys — final review and verification

Decision045 and the eight-task plan approved; Native inline execution. One fresh independent read-only final review, one author correction pass, no second review.

Spec: [approved design](../specs/2026-10-07-passkeys-design.md). Plan: [approved implementation](../plans/2026-10-08-passkeys.md). Original pre-auth baseline: [hashes, counts and activation metadata](2026-10-08-passkeys-baseline.json).

Reviewed range: a44dec69492cbc7f74a40818754fd6f3da0aee12..b6ce1946d4db2925c1739cd93e1052e8cba56b62. Incoming main95da60c includes manufacturing2b after this review. Preserve its0028 SQL/snapshot; regenerate the merged schema snapshot and relocate byte-identical, previously unmerged passkey SQL to0029/0030. No shared passkey migration applied. Merged snapshot parent-chain assertion initially failed at entry29; corrected its stale parent ID to main0028. All31 journal/snapshot links now match, the generator reports no schema changes, all29 main SQL files are byte-identical, and relocated passkey SQL matches reviewed source bytes. SQL/auth migration checks remain valid; no shared migration applied.

## Delivered behavior

Optional existing-account passkeys; fixed RP and exact trusted origin allowlist; actual native verification with required signed UV, resident credentials and immutable ownership/handle/key/RP. Recent password and completed-MFA proof for enrollment, rename and removal. SQL consent and append-only evidence share the native transaction; every sourced session starts pending, evidence releases authority atomically. Native TOTP/backup/trusted-device policy remains authoritative. Password reset/version changes invalidate pending completion. Removing keys revokes their sourced sessions and private challenges; local password recovery and disabled/old-RP management remain available. Explicit mobile ceremonies carry exact proof on GET/POST and abort on account/session changes; private credential/session data stay out of DTOs.

## Final review and author correction

0 Critical,1 Important,0 Minor. The Important finding is accepted: browser helpers compared RP ID to the current hostname for equality, despite server configuration intentionally supporting explicitly trusted subdomains. Canonical https://factory.example.test and allowed https://extra.factory.example.test therefore returned valid options, but both browser ceremonies failed before WebAuthn. Reproduce with genuine virtual-authenticator registration/sign-in through owned local HTTPS transport, then permit the parent-domain RP relationship in both client helpers. Fixed server RP and exact server origin allowlist remain authoritative. Actual HTTPS registration RED: valid native options200/parent RP, then no Remove Subdomain key because the old client check refused before WebAuthn. GREEN: genuine resident-key registration and native primary sign-in on the trusted HTTPS subdomain for the fixed parent RP; stored credential RP/user and completed sourced-session provenance match. Unrelated HTTPS options GET returns existing unavailable503 and leaves ceremony/session counts unchanged, with no unrelated-origin cookie. An initial15-second navigation wait timed out; diagnostic sign-in succeeded, and final30-second fixture passed. Initial negative test incorrectly invented403; source inspection confirmed the existing503 boundary. One diagnostic catch initially had an out-of-scope wire variable; corrected test instrumentation before the successful run. No additional production behavior change.

No Minor finding deferred. Reviewer declined to judge live HTTPS/reverse-proxy deployment and real phone/security-key interoperability; GitHub CI/merge/deployment readiness; unchanged manufacturing/accounting beyond supplied regression and invariance evidence. Author retains these separate acceptance gates and runs integrated manufacturing regressions. There is no live-device, SMTP, identity-provider, NIC legal issuance or deployment claim.

## Verification before integration

At reviewed head: all8 passkey/8 SSO/7 email fixtures passed;22 actual HTTP runs across20 isolated disabled-provider accounting/settlement/bank/sandbox/base suites, plus native platform grant200/revocation403; five production browsers (passkeys9, SSO, email-auth, email-delivery, original platform/mobile walkthrough). Original walkthrough retained its known invalid-GSTIN400 console response; no unexpected page errors or mobile overflow. Root typecheck19 (18 cached), build12 (11 cached),168 unique units across11 uncached tasks, lint0 configured tasks. These counts describe the pre-integration tree; integrated verification follows.

Passkey fixtures: config43, schema17 plus historical upgrade, adapter8, actions13, native22 genuine signed cases, MFA17, barriers15, populated invariance. Observed real distinct PostgreSQL blocker/waiter PIDs include245120/245124/245121, not mocked or same-connection waits. Replay, duplicate ownership, final slot, both removal orderings, counter, after-wait action/ceremony/owner/key/MFA expiry, actual reset, disabled/RP change and required evidence rollback are covered.

Read-only-source logical copy upgraded only its owned database. Original populated rows: GL5917, journals2481, bills902, effects2163, stock ledger801, bins276, FIFO layers328, consumption260. All537 saved original activation records and28 original SQL hashes preserved; existing audit/auth rows retained byte-for-byte. Baseline JSON stores hashes/counts/activation metadata, no auth secrets or raw book rows. Historical fixtures accept explicit baseline overrides; original defaults remain.

Evidence: [selected actual output](2026-10-08-passkeys-verification.txt).

## Integrated correction evidence

Final integrated results: all23 auth fixtures PASS; eight actual production browsers PASS (trusted-subdomain HTTPS3, original mobile passkeys9, SSO, email-auth, email-delivery, genealogy, manufacturing, original platform/mobile walkthrough).25 actual HTTP runs across23 distinct suites plus native platform grant200/revocation403 PASS. Added main integration regressions: serials59, genealogy53, manufacturing104 HTTP checks and both manufacturing browsers. Bank large review used1000 rows/23 HTTP checks; this run does not claim a new10000-row exercise.

Final current-tree commands all exited0: `pnpm typecheck`19 successful/12 cached; `pnpm build`12 successful/9 cached; `pnpm test`11 successful/10 cached,171 unique unit cases (79 core,19 auth,33 compliance,10 GSP,30 email); `pnpm lint`0 configured tasks. Earlier integrated `pnpm exec turbo run test --force` ran all171 units across11 tasks with0 cached. Distinguish command execution from compilation/test replay; no lint coverage claim.

The final main fetch remains95da60c0b61026eb5745c9890f22215c39f2fb1f. Main integration commit58f744b; snapshot-chain correction8af756a. All29 published-main SQL files remain byte-identical; passkey0029/0030 retain reviewed source bytes. No persistent/shared passkey migration, configuration enablement or book activation. All fixture services/databases/certificates were closed or removed by their owners. Cloud install/start draft saved, including explicit main refspec and verified local HTTPS regression; settings review/save/publication and fresh-task restoration remain separate.

Integration: own branch `passkeys-implementation-20261008`, PR targetmain. Known GitHub GraphQL403 blocks automated PR/CI lookup; no identical retry without access-change evidence. [Open integration PR](https://github.com/ujjwalsittu/factory-os/pull/new/passkeys-implementation-20261008), require actual green CI before merging; no direct main push, deployment or remote CI claim. Audited impersonation design follows integration; PostgreSQL RLS is a separate design/migration task.

## Integration handoff

PR title: `Add optional passkeys with native MFA and recovery`

PR body: Existing users can enroll personal passkeys and explicitly sign in while keeping native TOTP, backup codes, trusted-device policy and password recovery. Immutable verified credential authority, private pending sessions and transactional consent/evidence prevent partial sign-in. Adds current-account mobile controls and atomic key/session revocation; fixes explicitly trusted subdomain ceremonies while retaining the fixed server RP and exact origin allowlist. Integrates manufacturing main95da60c, preserves its0028, and relocates unchanged passkey SQL to0029/0030 with coherent generated metadata.

Validation:23 auth fixtures,25 HTTP runs/23 suites,8 production browsers, final typecheck19/build12/project171 units; earlier171 units were uncached. Lint has0 tasks. No shared migration/enablement/deployment; real HTTPS/device acceptance and actual remote green CI remain separate. Complete review/rulings above and below.

## Rulings I made

1. Use the existing isolated cloud checkout on an own branch rather than another worktree — onboarding skill requires existing checkout unless expressly asked for a worktree — cost if wrong: branch isolation provides less protection against concurrent filesystem edits; detect changes before each commit.

2. Use equivalent manual brief/ledger commands — skill resource scripts are unavailable from the cloud provider (recorded read failures), no local skill root — cost if wrong: extra bookkeeping; enforce exact plan identity, task BASE and verification evidence.

3. add exact @better-auth/utils@0.4.2 API peer pin alongside planned dependencies — pnpm auto-installed incompatible0.5.0 despite both native/core1.7.7 requiring0.4.2; existing auth also uses0.4.2 — cost if wrong: one extra direct peer dependency, covered by full auth regression. No framework upgrade.

4. native generic adapter constraint is structurally unknown inside whole-call wrapper, checked against the registered facade identity before use — native per-option adapter types are invariant and the plan's broad NativeAdapter constraint erased generated API signatures — cost if wrong: runtime refusal instead of compile-time adapter rejection; fixture and root typecheck cover preservation.

5. SQL request-local action/ceremony/session settings bind native mutation triggers to exact authorized records — scoped store sets only server-verified IDs, no HTTP input reaches settings — cost if wrong: a store call missing its setting fails closed; native verifier/management fixtures will cover composition.

6. permit completed-MFA last-used evidence after consumed browser ceremony deadline, with exact signed-in event; counter verification still requires unexpired ceremony — native TOTP has its own authoritative challenge deadline — cost if wrong: incorrect late-MFA acceptance; Task5 must test actual native expiry/provenance. Observed deadline RED→GREEN and counter refusal retained.

7. old SSO schema fixture accepts explicit current-session baseline path and upgrades historical auth rows to current schema before current application calls — removed prior workspace caused ENOENT and new ORM fields caused actual missing-column error — cost if wrong: narrower legacy simulation; keep original historical refusal/no-invented-provenance assertions and compare each saved original hash/book/activation.

8. additive0029 tightens optional/consumed ceremony shape and uses NULL-safe trigger identity comparisons — preserves accepted immutable verified authority, SQL NULL must not pass CHECK/IF — cost if wrong: refuses malformed historical passkey rows; does not invent repair/provenance.0028 stays byte-identical to committed source. Task5 will strictly encrypt return+ceremony ID in the existing private cipher envelope to restore exact native challenge frame, never latest-key lookup.

9. options capture their freshly minted native challenge from server response Set-Cookie plus exact stored challenge match — native getSignedCookie closes over request cookies and cannot see newly minted response cookies — cost if wrong: wrong server record selection refuses the whole transaction; later verification still requires native signed cookie and exact challenge/proof. No unsigned caller cookie authenticates.

10. freeze ceremony ID with versioned return JSON in existing private cipher, and native challenge deadline in server-only MFA frame — avoid latest-credential/ceremony guessing and recheck expiry after native waits — cost if wrong: malformed/old payloads refuse completion and require fresh sign-in; no repair/provenance invention. Phase4 TOTP test now asserts genuine challenge/no authority rather than unavailable ceremony.

11. retain only recognized native factor-failure/lockout results after authenticated private MFA classification when the request attempted no native authority insert — preserve existing retry limits without committing provisional authority/evidence — cost if wrong: a misclassified failure could commit unrelated work; exact error allowlist, per-request authority tracking, native HTTP/API counters and forced-evidence rollback tests bound it. Native cookie clearing only (max-age=0) may survive these expected failures; required-authority failures strip every cookie.

12. add focused passkey card/sign-in components beside existing SSO/email cards rather than putting lifecycle code into unrelated TOTP page — same approved UI/path, preserve original TOTP handlers — cost if wrong: two additional component files to maintain.

13. pin direct web zod4.6.5 already installed elsewhere — repository requires Zod boundaries but web has no declared Zod dependency — cost if wrong: one extra direct dependency/bundle parser, no version/stack upgrade.

14. classify Origin-less options GET via same-origin Fetch Metadata and exact configured allowed referrer origin — actual browser omits Origin and cannot set forbidden header — cost if wrong: forged HTTP metadata can obtain options; registration still needs exact local consent/session and every verification still uses fixed native RP/origins/actual signatures. Foreign/present origins or missing/cross-site metadata refuse; no verifier request-origin fallback, no Next proxy origin invention.

15. signInPasskey returns frozen safe next alongside planned twoFactorRedirect — the real native MFA response freezes invitation/security return; client must consume it — cost if wrong: a slightly wider client helper interface, covered by actual invitation browser return.

16. observeWaiter keeps the planned PID parameters with explicit third db reader — avoid module-global DB state across fixtures — cost if wrong: one test helper argument.

17. persist original pre-auth-mutation baseline as review JSON and make schema fixture accept PASSKEY_BASELINE_FILE — task workspace must be deleted at final handoff, old hardcoded default otherwise breaks clean checkout — cost if wrong: environment-specific hash/count/activation provenance artifact; no auth secrets/raw books stored.

18. populated invariance uses PostgreSQL read-only logical copy via local Compose tools, then migrates/exercises only that owned copy — never apply unmerged migrations to shared DB — cost if wrong: extra Docker/PostgreSQL fixture dependency and copy time; source before/after exact hashes still checked.

19. add explicit EMAIL_BASELINE_FILE/SSO_BASELINE_FILE overrides to remaining historical email/SSO fixtures and run them on owned populated copies with the actual current saved pre-auth baseline — deleted historical workspaces cannot be reconstructed and shared source must stay read-only — cost if wrong: overrides compare selected historical SQL hashes against a superset rather than exact map membership; original defaults remain, and Task7 separately checks all28 original hashes/current books/537 activations. No fabricated older evidence. Secondary code-reviewer template resource is unavailable; use equivalent skill requirements/full Review Focus and a fresh read-only reviewer once.

20. bind only the passkey test Nest listener/transport to127.0.0.1 when API hostname is localhost, preserving standard4000 and configured localhost web/RP/native origin — avoid environment IPv6 loopback ambiguity — cost if wrong: fixtures no longer exercise IPv6 transport; production host/RP/verifier untouched. Rerun affected fixtures before continuing final regression.

21. Preserve newly merged manufacturing0028 and relocate unmerged passkey SQL byte-identically to0029/0030, generating the schema snapshot against incoming main — cost if wrong: pre-release fixture databases using the old branch journal require recreation; no shared passkey migration was applied. Fresh migration/upgrade/invariance suites must pass.

22. Exercise trusted-subdomain behavior through a local HTTPS reverse proxy, temporary synthetic certificate and genuine Chromium virtual authenticator — cost if wrong: local test certificate exception and an extra reserved fixture port3443; no installation trust bypass, external DNS, deployment or real-device acceptance claim.

23. Treat live HTTPS/reverse-proxy deployment and real phone/security-key interoperability as separate acceptance gates — local HTTPS/native browser proof verifies software, not a deployment or device fleet — cost if wrong: deployment/device-specific defects remain undiscovered until live acceptance.

24. Treat CI/PR integration/deployment as unverified until actual remote evidence is available; preserve the own branch and manual PR handoff under known API403 — cost if wrong: integration delay; never infer green CI or push main directly.

25. Preserve unchanged manufacturing/accounting implementation and use supplied regressions plus fresh integrated manufacturing HTTP/browser checks — the correction changes personal passkey client validation and migration ordering, not business behavior — cost if wrong: cases outside executed regression coverage could still regress; no exhaustive live manufacturing/accounting claim.

26. Use explicit git fetch origin main:refs/remotes/origin/main in reusable startup instructions — the configured narrow fetch refspec demonstrably left main stale — cost if wrong: one extra targeted read-only fetch; no remote/refspec rewriting or work reset.

27. Assert the existing untrusted-origin503 unavailable response rather than an invented403, plus unchanged ceremony/session counts and no unrelated-origin cookies — the native boundary intentionally shares disabled/unavailable wording — cost if wrong: generic status hides the denial cause; exact no-authority assertions remain.

28. Allow30 seconds for cold production-browser navigation instead of15 — genuine trusted-subdomain sign-in succeeded on the diagnostic run and native source-session identity is asserted — cost if wrong: a slow failure takes longer to surface; application ceremony/reauthentication deadlines stay unchanged.
