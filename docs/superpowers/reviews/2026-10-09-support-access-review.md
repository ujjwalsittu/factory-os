# Audited support access — final review and evidence (decision 050)

Branch `claude/zealous-allen-35g1vm` (Tasks 1–9 of the [plan](../plans/2026-10-09-support-access.md)), reviewed 2026-10-10.
Software only: the deployment switch `SUPPORT_ACCESS_ENABLED` stays `false`, every tenant policy defaults to off, and no
live operator acceptance over HTTPS has been done.

## What was built

| Task | Commit | Result |
|---|---|---|
| 1 Disabled deployment policy, wire contracts, permissions | 14d6b85 | `settings.support_access.{read,configure,approve,cancel}`; shared types and the frozen five-area catalog |
| 2 Durable consent, epochs, source triggers | 4ac5c59 | Migration `0035_support_access` (four additive tables, statement-level source triggers, append-only evidence) |
| 3 Native proof, tenant policy/approval/history | 09cd31b | Recent completed sign-in, verified email, verified TOTP and the actual password, rechecked under locks |
| 4 Single-use start, stop/revoke | e16ebfa | Start bound to the operator's native session; deadline = earlier of duration and session expiry |
| 5 Pure scoped readers, read-only pool | 42a7477 | Five readers shared with the ordinary controllers; max-2 READ ONLY pool, 2 s wait, 5 s deadline |
| 6 Transport, locked reads, required audit | 0f4577d | Pre-dispatch header/origin boundary; data leaves only after the event and two-identity audit commit |
| 7 Consent/history UI, operator inbox | 10365f8 | Settings → Support access; `/support` inbox in a separate shell |
| 8 Isolated workspace and cache | 59bd56f | Own QueryClient, generation + abort on identity/grant change, server-anchored countdown |
| 9 Barriers, invariance, review | this commit | Two new suites; two review findings fixed (below) |

## Review findings and rulings

One whole-branch adversarial read of the diff after all tasks and checks; one correction pass.

1. **Important — fixed.** The transport compared the control path case-sensitively, but routing ignores case and
   trailing slashes. `POST /api/Support-Access/operator/grants/:id/stop` without an Origin reached the handler and
   stopped the grant (reproduced in the boundary suite before the fix). The checks that guard ordinary routes now use
   a normalised spelling (decoded, lower-case, collapsed and trimmed slashes); the selector header is still accepted
   only on the exact canonical workspace paths. Regression cases added to `smoke-support-access-boundary.mjs`.
2. **Minor — fixed.** The workspace ended itself on any `SUPPORT_UNAVAILABLE`, including a transient 503 (busy read
   pool, control deadline), and the access re-check could stay on "Checking access…" after one. A 503 now shows
   "The server is busy" in that panel; authority answers (403/404/ended) still end the workspace.
3. **Minor — retained.** Every workspace context check (entry, focus, visibility) records a `read` event and a
   two-identity audit row with `{area: null, panel: 'context'}`. This is intended evidence, but frequent tab switching
   produces many rows. Cost of changing: a separate, unaudited context route, which the design rejected. Kept.

No Critical finding.

## Deviations from the written plan

- **Hidden reference columns.** Document lists, the stock balance and the trial balance return an `id`/`itemId`
  reference column so the UI can open the detail or ledger. The UI hides them; detail reads still check the entity
  scope. Ordinary DTOs are unchanged (the ordinary controllers do not use the support column lists).
- **Work-order detail is support-only.** `workOrderFacts` omits user joins instead of reusing the ordinary detail.
- **Completed SSO/passkey proof modes** are covered by their own suites (`smoke-sso-actions`, `smoke-passkeys-actions`,
  passkeys browser); the support fixtures use TOTP, backup-code and trusted-device completions.
- **Deployment switch.** It is checked at request time; every support route refuses while it is off. It is not stored
  as an invalidation. While it is off, an unusable `WEB_ORIGIN` no longer stops the API from starting.
- **Backup-code consumption** is not an epoch bump (failed-factor counters and code use do not change authority).
- **Native renewal.** `verifyPassword` renews the native session (native behaviour, preserved); the deadline captured
  at start never extends.
- **Epoch rows are seeded lazily** at approval; a user who never took part in consent has none and needs none.
- **`withObservedBlocker`** lives in `support-access-test-helpers.mjs`; `startSupportFixture` accepts an owned
  database (`extra.database`) for the invariance suite.
- **Required audit failure** is proven in the boundary suite (forced failure of the audit insert), not repeated in
  the barriers suite.

## Evidence (final tree)

Commands run from the repository root unless noted; fixture suites own their databases and processes.

| Check | Result |
|---|---|
| `node apps/api/scripts/smoke-support-access-config.mjs` | 23 checks PASS |
| `… smoke-support-access-schema.mjs` (incl. upgrade of a copy of the local DB) | 33 PASS |
| `… smoke-support-access-consent.mjs` | 17 PASS |
| `… smoke-support-access-lifecycle.mjs` | 16 PASS |
| `… smoke-support-access-readers.mjs` (local books, read-only) | 12 PASS |
| `… smoke-support-access-boundary.mjs` | 12 PASS |
| `… smoke-support-access-barriers.mjs` | 9 PASS |
| `… smoke-support-access-invariance.mjs` (owned copy of the local DB) | 5 PASS |
| `pnpm --filter @factoryos/web e2e:support-access-controls` (desktop + 390 px) | PASS |
| `pnpm --filter @factoryos/web e2e:support-access-workspace` (desktop + 390 px) | PASS |
| `smoke-sso-actions` / `smoke-passkeys-actions` / `smoke-email-auth` | 11 / 13 / PASS |
| `e2e:passkeys` (production mobile browser) | 9 cases PASS |
| Ordinary API suites against the production API with the transport mounted: `smoke.sh`, inventory, buying, selling, accounting (31), manufacturing (104), job work (101), serials (59), genealogy (53), quality (112), FAI (52), attachments | all PASS |
| `pnpm typecheck` / `pnpm build` / `pnpm exec turbo run test --force` | 19 / 12 / 11 tasks (209 unit tests) PASS |
| `pnpm lint` | 0 configured tasks |
| `git diff --check` | clean |

Barriers proven on separate PostgreSQL backends (distinct `pg_backend_pid`, waits observed through
`pg_blocking_pids`): concurrent starts give `[200, 409]` and one start event; a read queued before a revoke returns data
and one queued after returns `SUPPORT_ENDED`, in that event order; removal then restoration of nine sources (role
assignment, membership status, role permissions, tenant status, entity active flag, operator platform role, subject
email, operator password via native change and back, approver TOTP via native disable and re-enrol) never revives
consent; unrelated session cleanup, bound-session renewal and name changes do not end consent, bound logout does;
concurrent native and tenancy transactions in opposite orders commit with exactly one bump each; an audit wait across
the support deadline, the 5 s control deadline, a saturated read pool (≥ 2 s wait) and deletion of the bound session
during a lock wait all return no data and record no read.

Invariance: 159 tables (books, stock, FIFO, bills, activations, native credentials, sessions, tenancy, consent) are
byte-identical before and after 13 panel reads with drill-downs and one denial; the only new rows are 12 two-identity
audit rows and 13 support events; the tenant audit chain links over 165 rows and every new row re-hashes; published SQL
and the migration journal prefix are unchanged.

## Not done here (separate decisions)

- Live enablement: setting `SUPPORT_ACCESS_ENABLED=true` in Coolify, a tenant turning its policy on, and real operator
  acceptance over HTTPS.
- PostgreSQL row-level security.
