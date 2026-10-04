# Status

_Last updated: 2026-10-05 · Slice 1b (buying) + 1b-2 (imports & landed cost) built, verified, deployed to dev_

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
- [x] **Phase 1 · slice 1b: buying** (migration 0004)
  - GST engine (`packages/compliance-in/src/gst.ts`, 16 tests): intra/inter-state, SEZ, export/LUT, import of goods and services (RCM), cess, per-line paise rounding
  - Purchase orders: draft → submit (`AZ/PO/26-27/0001`) → short-close or cancel (only if nothing received/billed); GST rate from the item's HSN on the order date unless overridden; live tax preview (`POST /buying/tax-preview`)
  - Receipts against a PO (stock entry with `purchaseOrderId` + `poLineId`): same supplier only, no over-receipt, PO rate fills the cost; cancelling refused once inspected or invoiced
  - Incoming inspection (`/app/buying/inspections`): queue of quarantine receipt lines for items needing inspection; accept → stores, reject → MRB via a system-generated transfer (`stock_entry.system_generated`), reversible only by cancelling the inspection
  - Purchase invoices: GST computed server-side, 3-way match (qty ≤ received − billed), rate variance needs explicit confirmation, same supplier invoice no. blocked within a FY, MSME micro/small due date capped at 45 days (Sec 43B(h)), RCM and ITC-eligibility flags; cancel returns billed qty to the PO
  - Web: Buying nav (Purchase orders, Incoming inspection, Purchase invoices), PO and invoice forms with live totals, "Receive goods" and "Record invoice" from a PO, ⌘K actions
  - Verified: `smoke-buying.sh` 60/60, `smoke.sh`, `smoke-inventory.sh`, `smoke-customer-material.sh`; e2e `buying`, `inventory`, `customer-material`, base walkthrough all pass
- [x] **Slice 1b-2: imports & landed cost** (decisions 026–028, migration 0005)
  - Foreign-currency purchase orders and invoices (overseas suppliers only; currency + exchange rate per document; invoice must match the PO currency); receipts valued in INR at the PO rate
  - Landed cost vouchers (`/app/buying/landed-costs`): Bill of Entry no./date/port, customs rate, assessable value, import IGST + cess (ITC, not cost); charges (BCD, SWS, other duty, freight, insurance, CHA, port, other) by value / quantity / weight with live allocation preview
  - Submit raises the FIFO layer rate for stock on hand (value-only `landed_cost` ledger row) and keeps the issued share as variance; guarded cancels keep ledger value = layer value
  - Verified: `smoke-imports.sh` 39/39; e2e `imports` plus all earlier suites pass
- [x] Dockerfiles for api and web; `pnpm deploy` bundle and Next standalone output verified to boot. (A full `docker build` could not run in the dev sandbox: its TLS proxy blocks npm inside containers.)

## In progress
- **Slice 1c: selling** (decisions 029–032, migration 0006). Backend done and verified (`smoke-selling.sh` 48/48):
  quotations → sales orders (from quotation, credit warning) → sales invoices that ship the goods via a system-generated
  `delivery` stock entry; outward GST (intra/inter, SEZ, export under LUT with LUT on the GSTIN), foreign-currency exports,
  per-GSTIN gapless invoice series ≤ 16 chars with a forward-only "next number" (`GET/PUT /number-series`), customer credit limits.
  **Stopping point:** web screens (Sales nav, quotation/order/invoice forms, statutory tax invoice print, series + LUT settings) + e2e not started.

## Next (in order; confirm with the user before starting)
1. Finish slice 1c web screens + tax invoice print, then user review on dev.
3. **Slice 1d: GL core** — chart of accounts (Tally group names), journal posting from stock and invoices.
4. **Slice 1e: e-invoice + e-way bill** — NIC direct adapter (sandbox) behind `packages/gsp`, effective-dated per GSTIN.
5. Phase 0 leftovers: email delivery, SSO, passkeys, impersonation, Postgres RLS, number-series settings UI.

## Blockers
- None. (Cloudflare record for factoryos.azeonics.com is DNS-only; HTTPS verified 2026-10-04.)

## Noticed (out of scope, for later)
- The first commit on this branch predates the message guard; its message names the assistant. Fixing it needs a force-push, which the user hasn't approved.
- `packages/core`, `gsp` (types only), `iot-protocol`, `sdk`, `apps/worker`, `apps/edge-agent` are still placeholders.
