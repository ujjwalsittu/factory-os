# Status

_Last updated: 2026-10-05 · Customer notes/returns verified and ready for final push_

## Done
- [x] **Customer credit/debit notes and sales returns** (decision037, additive0012/0013): original invoice/tax/accounts/currency snapshots, exact partial original-cost and zero-cost tracked-batch returns, automatic source application, remaining customer credit and typed later applications, scoped editor/list/print, immutable reversals and dependency/race guards. Build11/typecheck16/unit60, thirteen focused API fixtures530 reported checks, existing accounting/settlement/operational regressions and eight production browsers pass; lint has zero tasks. Independent review's two Important defects were reproduced/fixed; all four PostgreSQL race scenarios pass. Shared0011 and inactive shared books preserved. [Review/rulings](../superpowers/reviews/2026-10-05-sales-notes-returns-review.md).
- [x] **PR #1 conflict resolution**: merged alternate settlement history while retaining the chosen shared implementation and migration; source tree unchanged from `17a594c`. Native backup remains `21c285d`. Fresh verification: build/typecheck, 55 unit tests, 93 settlement + 16 duplicate-reference + 32 historical-control checks, invoice-balance production browser all pass. Lint has zero tasks. Normal target push succeeded; GitHub confirms PR #1 MERGED at 2026-10-05T10:45:45Z.
- [x] **Compatible AR/AP improvements**: retain the shared implementation/schema; seed pending invoice identities before legacy reference matching, show scoped exact invoice balances, allow validated historical trade-control clearing, and refresh balances after settlement/cancellation/navigation. Build/typecheck and 55 unit tests pass; focused/settlement/accounting/review/buying/selling/import API suites report 526 checks plus the lock-order barrier; five production browser suites pass. Lint has zero configured tasks. Independent review's one Important cache finding fixed and browser-regressed. Review: `docs/superpowers/reviews/2026-10-05-settlement-compatible-improvements-review.md`. Native backup and original local database preserved.
- [x] **AR/AP settlements** (decision 036, migration 0011): bill-wise subledger derived from GL, customer receipts and supplier payments with FX and on-account money, later allocation, cancellation dependencies, outstanding/ageing/reconciliation reports, selling credit from real outstanding, Accounts → Receipts & payments / Outstanding screens. Verified: `smoke-settlements.mjs` 91 checks, `e2e:settlements`, all accounting + operational suites and walkthroughs. Review: `docs/superpowers/reviews/2026-10-05-ar-ap-settlements-review.md`.
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

- [x] **Slice 1c: selling** (decisions 029–032, migration 0006)
  - Quotations → sales orders → invoices with system-generated delivery; outward GST, SEZ, foreign-currency exports under LUT, credit warnings with permission-gated override, exact stock reversal on cancel
  - Web: Sales navigation, scoped lists and forms, server-calculated tax previews, draft autosave, quotation conversion, partial invoice creation, document history, reason confirmations, keyboard save, mobile layouts
  - A4 tax invoice print/PDF: seller/customer addresses, GSTIN, HSN, quantities, heat/batch, tax breakdown, currency/rate and LUT declaration
  - Settings: per-GSTIN/FY forward-only number series, LUT ARN/validity, customer credit limits
  - Verified: production build, typecheck, 36 unit tests, selling API smoke 48/48; production selling, buying and base browser walkthroughs pass. Selling coverage covers delivery/cancel, printed tax columns, LUT exports, settings, credit approval, address reopening and autosave race/error recovery. `pnpm lint` executes zero tasks (no package lint scripts).

- [x] **Slice 1d: GL foundation** (migrations 0007–0010)
  - Deliberate per-entity, current Asia/Kolkata cut-over: reviewed opening trial balance, FIFO inventory, party/bill balances and settlements, frozen unbilled receipt quantity/base-cost baselines; stale previews and competing activations refused. Empty entities record a genuine zero opening.
  - Tally-style chart and required mappings; immutable six-decimal INR journals from stock, purchase/sales invoices and landed cost, with original-account reversals in the operational transaction. Receipt allocations protect partial billing and cancellation; historical sources cannot be cancelled through active books.
  - Price/FX variances, eligible input/output GST, pending RCM credit and explicit customs eligibility; non-creditable acquisition costs split between actual remaining FIFO and consumption. Precision residuals are explicit rounding, with evidence and movement guards.
  - Accounts workspace: setup/reconciliation, chart/group editing, manual journals with exact server previews and keyboard save, day book/ledger/trial balance, source/reversal links and scoped print/export. Inactive books and historical/no-value/missing source postings are disclosed.
  - Verified: root typecheck (16 tasks), build (11 tasks), 48 uncached unit tests; six accounting API suites (202 checks), six legacy API suites (252 checks), eight review regressions and real PostgreSQL lock-order barrier. Production accounting, selling, buying, imports and base browser walkthroughs pass after final fixes. `pnpm lint` has zero configured tasks; base walkthrough logs its existing HTTP 400 console resource error and exits successfully.
  - Independent review found seven Important defects, all reproduced and fixed; an additional fractional tax-allocation regression was fixed in the same pass. [Review, rulings and two deferred UI minors](../superpowers/reviews/2026-10-05-gl-core-review.md). No shared entity has been activated. Historical stock/GL date comparisons remain limited by existing stock reversal dating; current cumulative balances reconcile.

## In progress
- None.

## Next (in order; confirm with the user before starting)
1. User review of accounts, receipts/payments, outstanding and customer notes/returns on dev. Books stay inactive until a Finance user activates an entity (decision 034); customer notes/returns received one independent review with all Important findings fixed.
2. **Supplier credit/debit notes and purchase returns**: write the separate design before implementation, preserving original receipt/invoice costs, ITC and supplier payments.
3. **Slice 1e: e-invoice + e-way bill** — NIC direct adapter (sandbox) behind `packages/gsp`, effective-dated per GSTIN.
4. TDS/TCS and bank charges on receipts/payments; bank reconciliation.
5. Phase 0 leftovers: email delivery, SSO, passkeys, impersonation, Postgres RLS.

## Blockers
- None. (Cloudflare record for factoryos.azeonics.com is DNS-only; HTTPS verified 2026-10-04.)

## Noticed (out of scope, for later)
- The first commit on this branch predates the message guard; its message names the assistant. Not rewritten (no force-push); the hook and the message-guard workflow now skip commits another branch already has, so it no longer fails new branches.
- `packages/core`, `gsp` (types only), `iot-protocol`, `sdk`, `apps/worker`, `apps/edge-agent` are still placeholders.
