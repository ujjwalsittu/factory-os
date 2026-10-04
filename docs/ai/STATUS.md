# Status

_Last updated: 2026-10-04 · Phase 0 built and deployed to dev (https://factoryos.azeonics.com)_

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
- [x] Decisions 018–021 recorded (FIFO, Tally Edit Log + sync, NIC/Adaequare, Coolify token).
- [x] **Dev deployed on Coolify**: https://factoryos.azeonics.com (Let's Encrypt). Apps `factoryos-web` (public) and `factoryos-api` (internal, network alias `factoryos-api`), Postgres `factoryos-db`. Self-serve tenant creation is off on this host; the first SuperAdmin is promoted via `BOOTSTRAP_SUPERADMIN_EMAIL` after signing up.
- [x] Dockerfiles for api and web; `pnpm deploy` bundle and Next standalone output verified to boot. (A full `docker build` could not run in the dev sandbox: its TLS proxy blocks npm inside containers.)

## In progress
- Nothing. Stopping point is clean.

## Next (in order; confirm with the user before starting)
1. User signs up at https://factoryos.azeonics.com as sittu.ujjwal@gmail.com; then restart `factoryos-api` in Coolify to promote that account to SuperAdmin, and create the Azeonics Group tenant from the platform console.
2. User review of Phase 0 UI and the remaining open questions in docs/10.
3. Phase 0 leftovers: email delivery (invites, password reset), SSO (needs Google/Microsoft OAuth apps), passkeys, impersonation, Postgres RLS policies, number-series engine, document lifecycle engine in `packages/core`.
4. Phase 1 kickoff: masters (items, UoM, parties, HSN/SAC), warehouses/locations, stock ledger + batches/serials/heat numbers.

## Blockers
- **Cloudflare 526 on https://factoryos.azeonics.com** since the DNS record was switched to proxied (orange cloud). The origin is healthy (http://slubm3yhqacghghrqwg4barm.13.205.93.77.sslip.io/api/health returns 200). Fix in Cloudflare (user): set the record to DNS-only (grey cloud), or keep the proxy and use SSL mode "Full" for this host, or install a Cloudflare Origin Certificate on Coolify.

## Noticed (out of scope, for later)
- The first commit on this branch predates the message guard; its message names the assistant. Fixing it needs a force-push, which the user hasn't approved.
- `packages/core`, `gsp` (types only), `iot-protocol`, `sdk`, `apps/worker`, `apps/edge-agent` are still placeholders.
