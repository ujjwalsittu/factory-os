# Approved support access — implementation prerequisites

User approved the written spec and nine-task plan on 2026-10-09. No further scope or plan approval is required; the execution method is the implementer's choice (optional note: Native inline was preferred). Accepted support decision050 preserves published scheduling049 and the other-owner scheduling/accounting claims. Product Task1 has not started.

Current main4374823 lacks the completed passkey implementation, support planning and support product claim. The passkey prerequisite is reconciled/verified at45e4180; [fresh evidence](2026-10-09-passkeys-quality-integration-verification.txt) and [review/rulings](2026-10-08-passkeys-review.md) explain source history and test limits. Planning incorporates that verified code unchanged. The queued claim478b870 is exactly STATUS-only from main; a merge-tree against planning is clean.

GitHub GraphQL and REST both returned Forbidden. The saved cloud draft now includes exact `api.github.com` and current startup/migration guidance; it is not published/applied. Review/save/publish environment settings before retrying with access-change evidence. Existing repositories, installation script, runtime variables, secrets and other custom/preset network domains remain preserved. No token/SSH request is needed for shell/Git proxy access, which already works. Actual API authorization/CI still requires verification after publication.

## Three PRs, in order

Merge only after actual green CI, never by direct main push. These are manual creation links, not claims that PRs already exist or CI is green. Approved integration/merge authorization persists; the blocker is access and the repository's merged-claim gate.

1. [Passkey completion](https://github.com/ujjwalsittu/factory-os/pull/new/passkeys-implementation-20261008), head45e4180.
2. [Approved support planning](https://github.com/ujjwalsittu/factory-os/pull/new/support-access-design-20261009), depends on1. After1 reaches main its product delta disappears; remaining change is support documentation.
3. [Standalone support claim](https://github.com/ujjwalsittu/factory-os/pull/new/support-access-claim-20261009), head478b870; STATUS-only, merge after1/2. No new support code before3 reaches main.

### PR1 title/body

Title: `Enable optional native passkeys with the current quality schema`

Existing accounts can enroll and sign in with personal passkeys while retaining native TOTP, backup/trusted-device policy, authorization and password recovery. Passkeys remain disabled by default. The completion includes the original final review/corrections and reconciles published quality0030 without changing any published SQL or main dependency versions; both reviewed passkey migrations are byte-identical, finally numbered 0032/0033 after published 0031_scheduling.

Validation: typecheck19/build12/186 uncached units,23 native auth fixtures, eight manufacturing/quality HTTP suites (514 counted checks plus attachment assertions), and four production browser suites passed. Lint has0 configured tasks. Protected populated books/activations/auth/audit/source migration history remain unchanged; copied pre-release history is normalized only in an owned test fixture. Real HTTPS devices, R2/provider setup, shared migration and deployment remain separate. See the permanent review and selected output for initial orchestration failures and the non-reproduced quality404.

### PR2 title/body

Title: `Record the approved audited support access design and plan`

Document tenant-approved temporary read-only support for one target member/entity while retaining the real native operator session. Accepted050 defines configurable5–30-minute limits, native proof, a fixed five-panel SELECT catalog, transactional authority invalidation, pre-return two-identity audit and an isolated mobile workspace/cache. The user approved the written spec/nine-task plan; Native inline method remains selected.

Depends on the completed passkey PR. No new support product code/schema/runtime/enablement. Planning documents, links/decision IDs and preservation of other owners were checked. A separate STATUS-only claim must merge through green CI before implementation.

### PR3 title/body

Title: `Claim the approved audited support access implementation`

STATUS-only named-owner/start-time queued claim for the approved nine-task Native implementation. Merge after passkey completion and planning, with actual green CI. Product Task1 waits until all prerequisites and this standalone claim appear on freshly fetched main; no support code/schema/runtime/shared migration or live enablement is included. Other scheduling/accounting owners remain unchanged.

## Resume without repeating approvals

Fetch `origin main:refs/remotes/origin/main`, read current handoff and verify the prerequisite/claim merges. Then create the own implementation branch from that main and execute Tasks 1–9 in order (any workflow; inline was preferred) using the existing spec/plan/ledger, RED/GREEN checks and one fresh final whole-branch reviewer. Generate the next migration from that published journal. Do not infer main integration from local tests or push main directly. PostgreSQL RLS and live configuration/acceptance remain separate.
