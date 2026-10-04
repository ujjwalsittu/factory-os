# Status

_Last updated: 2026-10-04 · Phase 0 built and verified; awaiting user review before Phase 1_

## Done
- [x] Plan docs 01–16, decision register (001–016 accepted), open questions (docs/10)
- [x] Commit-message guard (git hooks + CI) and handoff guard (CI)
- [x] Agent contract (AGENTS.md) and handoff files (docs/ai/)
- [x] **Phase 0 backend** (`apps/api`, `packages/db`, `packages/auth`, `packages/compliance-in`)
  - Better Auth: email/password, TOTP two-factor with backup codes, sessions, rate limiting
  - Tenancy: tenant → legal entity (with subsidiaries) → GST registration (validated GSTIN, PAN match, date-effective e-invoicing, per-GSTIN providers) → plant
  - RBAC: permission catalog, 11 system roles, custom roles, entity-scoped assignments, no-escalation rules, maker-checker on GST filing
  - Invitations (hashed tokens, 7-day expiry), member enable/disable
  - Hash-chained append-only audit log (tenant + platform chains)
  - Platform SuperAdmin: tenants (create with owner invite, suspend/reactivate with reason), platform admins, platform audit; CLI seed
- [x] **Phase 0 web** (`apps/web`, `packages/ui`)
  - Landing page, sign-in, sign-up, two-factor step, invite acceptance, onboarding
  - App shell: sidebar (with phase badges), mobile drawer, entity switcher, ⌘K palette, theme toggle (light/dark), user menu
  - Home dashboard (setup checklist, e-invoice readiness, roadmap), Settings: entities & GST, users & invitations, roles matrix, audit log (chain check), my security (2FA)
  - Platform console
- [x] Verification: `pnpm typecheck`/`build`/`test` green (13 unit tests); `apps/api/scripts/smoke.sh` 26/26; browser walkthrough (`pnpm --filter @factoryos/web e2e`) passes incl. 2FA sign-in, mobile, dark mode
- [x] Dockerfiles for api and web; `pnpm deploy` bundle and Next standalone output verified to boot. (A full `docker build` could not run in the dev sandbox: its TLS proxy blocks npm inside containers.)

## In progress
- Nothing. Stopping point is clean.

## Next (in order; confirm with the user before starting)
1. User review of Phase 0 UI and the open questions in docs/10 (especially B6 valuation, B7 Tally cut-over, B18/B19 GSP).
2. Deploy dev to Coolify (docs/16). Needs the user to rotate the Coolify token and set `COOLIFY_API_TOKEN`.
3. Phase 0 leftovers: email delivery (invites, password reset), SSO (needs Google/Microsoft OAuth apps), passkeys, impersonation, Postgres RLS policies, number-series engine, document lifecycle engine in `packages/core`.
4. Phase 1 kickoff: masters (items, UoM, parties, HSN/SAC), warehouses/locations, stock ledger + batches/serials/heat numbers.

## Blockers
- None for code. Business answers in docs/10 are needed before the Phase 1 data model is finalised.

## Noticed (out of scope, for later)
- The first commit on this branch predates the message guard; its message names the assistant. Fixing it needs a force-push, which the user hasn't approved.
- `packages/core`, `gsp` (types only), `iot-protocol`, `sdk`, `apps/worker`, `apps/edge-agent` are still placeholders.
