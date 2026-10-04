# Status

_Last updated: 2026-10-05 · Slice 1a + customer-supplied material & waste register built, verified, deployed to dev_

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
- [x] **Phase 1 · slice 1a: inventory core**
  - `packages/core`: `Dec` fixed-point decimal (no floats for money/qty), FIFO engine, number-series formatting, FY codes (12 tests)
  - DB (migration 0002): uom, hsn_code, item, party, warehouse (tree), batch, number_series, stock_entry(+line), stock_ledger_entry (append-only), fifo_layer, fifo_consumption, stock_bin
  - API: masters (UoM, HSN/SAC, items, parties with GSTIN/MSME), warehouses (+ standard layout), batches (FEFO, in-stock), stock entries (draft → submit → cancel with exact reversal), stock balance (FIFO value), stock ledger (running balance)
  - Rules: quarantine/MRB not issuable, customer-owned stock unvalued and unmixable, negative stock and backdating refused, gapless numbers per entity/FY (`AZ/SE/26-27/00001`), per-item advisory locks (race-tested)
  - System roles re-sync from the permission catalog at startup; default UoMs seeded per tenant
  - Web: Masters (items, customers & suppliers, units & HSN/SAC), Inventory (stock entries list + document form with item picker, batch picker, Ctrl+Enter save; stock balance; stock ledger; warehouses), entity gate, ⌘K actions
  - Verified: `apps/api/scripts/smoke-inventory.sh` 43/43, `smoke.sh` 26/26, `pnpm --filter @factoryos/web e2e` and `e2e:inventory` pass
- [x] **Customer-supplied material & waste** (decisions 024, 025; migration 0003)
  - Owner (`owner_party_id`) on stock lines, ledger and balances; customer stock unvalued, outside FIFO, owner never changes on transfer; owner-aware batch picker and balances
  - New stock purposes: **Return to customer** (only to the owner) and **Scrap** (into the waste register, same owner, cancel cascades)
  - Waste register (`waste_movement`, append-only): generated / disposed (returned, sold, authorised recycler, TSDF), consent required for disposing customer waste, document no. required for sale/recycler/TSDF, balance-checked with locks, hazardous flag + 90-day hold warning
  - Customer material statement (`GET /reports/customer-material`, `/app/inventory/customer-material`): opening, received, consumed, returned, scrapped, adjusted, with us; waste generated/returned/disposed/pending; documents; print/PDF layout
  - Permissions: `ehs.waste.*`; Stores gets waste, Quality can record waste
  - Verified: `smoke-customer-material.sh` 36/36, `smoke-inventory.sh`, `smoke.sh`, e2e `customer-material`, `inventory`, base walkthrough all pass
- [x] Dockerfiles for api and web; `pnpm deploy` bundle and Next standalone output verified to boot. (A full `docker build` could not run in the dev sandbox: its TLS proxy blocks npm inside containers.)

## In progress
- Nothing. Stopping point is clean.

## Next (in order; confirm with the user before starting)
1. User review of slice 1a and customer material / waste on dev.
2. **Slice 1b: buying** — purchase order → GRN (into quarantine, posts via the stock engine) → incoming inspection (accept → stores / reject → return) → purchase invoice; landed cost for imports (B4).
3. **Slice 1c: selling + GST engine** — quotation → sales order → delivery → sales invoice; tax engine in `packages/compliance-in` (place of supply, CGST/SGST/IGST, RCM) with golden-file tests; tax invoice PDF.
4. **Slice 1d: GL core** — chart of accounts (Tally group names), journal posting from stock and invoices.
5. **Slice 1e: e-invoice + e-way bill** — NIC direct adapter (sandbox) behind `packages/gsp`, effective-dated per GSTIN.
6. Phase 0 leftovers: email delivery, SSO, passkeys, impersonation, Postgres RLS, number-series settings UI.

## Blockers
- None. (Cloudflare record for factoryos.azeonics.com is DNS-only; HTTPS verified 2026-10-04.)

## Noticed (out of scope, for later)
- The first commit on this branch predates the message guard; its message names the assistant. Fixing it needs a force-push, which the user hasn't approved.
- `packages/core`, `gsp` (types only), `iot-protocol`, `sdk`, `apps/worker`, `apps/edge-agent` are still placeholders.
