# Project Memory (durable facts)

Facts every contributor needs and should not have to rediscover. Keep entries short. Add new ones
at the end of the relevant section, with a date.

## Business

- Azeonics Private Limited, Thane West, Maharashtra 400604. Manufacturing at Navi Mumbai.
  Pay-per-use aerospace manufacturing, testing and integration (CNC, metal AM, SMT, sensor lab,
  environmental testing, cleanroom), plus products (Manha Sat Kit) and ground-station services.
- EarthNow is a **separate legal entity**, acquired by Azeonics. Satellite analytics services
  (subscriptions, government projects).
- GST: registered in Maharashtra only today; other states and SEZ units are possible later.
- FY 2026-27 is the first financial year after GST registration. E-invoicing applies from
  **1 Apr 2027** (they are above the turnover threshold).
- Accountants know Tally well. FactoryOS is the books of record, with Tally import + sync.
- Machine register (first batch, ~80% accurate): `docs/11-iot-machine-plan.md`. CNC/EDM/metrology
  vendors are not yet appointed, so connectivity requirements can still go into RFQs.
- Export/import and possibly defence/export-controlled work may start once the software is live.

## User preferences

- Ask before deciding anything significant; offer a recommendation.
- Never use AI vendor/model/assistant names in commits or PRs (hooks enforce this).
- Work must be resumable by anyone using any AI provider: keep `docs/ai/*` current.
- UI quality matters: it must be clearly better than Frappe/ERPNext.

## Environment and gotchas

- Dev hosting: Coolify at `https://central.azeonics.com`. Its MCP endpoint is `/mcp` with a
  Sanctum bearer token (Coolify → Security → API Tokens). Configure it as the env var
  `COOLIFY_API_TOKEN`; never commit it. The current token was shared in chat on 2026-10-04; the
  user chose not to rotate it (it expires ~30 days later). The REST API (`/api/v1`, same bearer
  token) works when the MCP connection isn't configured.
- Coolify resources (dev): project **FactoryOS** `hglookncst2vhgcplrqjvk2d`, environment
  `production`; Postgres 16 `factoryos-db` `rb56904benfhtj6up1bluhrm` (internal host
  `rb56904benfhtj6up1bluhrm:5432`, db/user `factoryos`; password only in Coolify). Server
  `localhost` `3mk1wlx3v2ous2tw0booaby2`. No wildcard domain is set; `central.azeonics.com` is
  behind Cloudflare.
- Coolify GitHub Apps: `azeonics-git` (Azeonics org repos) and `ujjwal-azeonics-git`
  `efit50pxykwkpiubgz4zir3l` (personal repos incl. `ujjwalsittu/factory-os`).
- Dev apps: `factoryos-api` `bsv3inwzrvuhuau7vojaxkms` (no public domain; network alias
  `factoryos-api`), `factoryos-web` `slubm3yhqacghghrqwg4barm` at https://factoryos.azeonics.com and
  http://slubm3yhqacghghrqwg4barm.13.205.93.77.sslip.io. Both build branch
  `claude/zealous-allen-35g1vm`. Server public IP 13.205.93.77.
- Coolify gotchas: env vars created via API default to build-time; set `is_buildtime:false`.
  Containers aren't reachable by app UUID; use `custom_network_aliases`. `/deploy` is POST.
- **Every push to `claude/zealous-allen-35g1vm` auto-redeploys both dev apps** (GitHub webhook).
  Don't push broken code to that branch; use another branch for experiments.
- First SuperAdmin on dev: sittu.ujjwal@gmail.com (bootstrapped 2026-10-04; the setting is now inert).
- `turbo` rewrites a managed block at the bottom of AGENTS.md. Keep it and commit it.
- Force-push is not permitted. The first commit on `claude/zealous-allen-35g1vm` predates the
  message guard and is left as-is.
- Local dev DB: PostgreSQL 16 (`docker compose up -d db`, or a local cluster). See `.env.example`.

## Implementation notes (2026-10-04)

- Everything is ESM (NestJS 12 and Better Auth 1.7 are ESM-only). Relative imports in TS use `.js`.
- Next.js 16: `middleware` is now `src/proxy.ts`; request APIs are async. Read
  `apps/web/node_modules/next/dist/docs/` before changing Next conventions.
- The web app reaches the API via a runtime route handler (`apps/web/src/app/api/[...path]/route.ts`)
  using `API_INTERNAL_URL`, so cookies are first-party and the API URL can change without a rebuild.
- Better Auth's two-factor plugin needs `verified`, `failed_verification_count`, `locked_until` on
  `two_factor` (migration 0001). If Better Auth is upgraded, run the API and watch for
  "Drizzle schema mismatch" at startup.
- API permissions without `x-entity-id` come from tenant-wide grants only. With `x-entity-id`, mutations
  must target that same entity (see `getEntity` in `entities.controller.ts`).
- When killing dev servers, anchor the pattern (`pkill -f '^next-server'`). An unanchored pattern
  matches the shell running the command and kills it.
- Dev SuperAdmin in a local DB is created with `seed:superadmin`; no default credentials exist.
- **Drizzle pitfall:** inside `sql\`...\`` subqueries, column references render *unqualified*, so
  `${table.id}` silently binds to the inner table. Use explicit aliases (`from stock_bin sb where
  sb.batch_id = "batch"."id"`). Bit us twice (platform counts, batch balances); smoke tests now cover both.
- **Next.js:** `window.history.replaceState` is synced into `useSearchParams`; capture initial query
  params in state if a page rewrites its own URL (see `inventory/entries/new/page.tsx`).
- Local Postgres in the cloud sandbox stops between sessions: `sudo pg_ctlcluster 16 main start`.
- Inventory APIs need `x-entity-id`; masters are tenant-wide but accept it so entity-scoped roles work.
- Buying: a goods receipt *is* a stock entry (purpose `receipt`) with `purchaseOrderId`/`poLineId`; PO `receivedQty`/`billedQty`
  are maintained by submit/cancel hooks in `stock-posting.service.ts` and `buying.controller.ts`. Documents that post stock on
  their own (inspections) create `system_generated` entries through `posting.submitIn(tx, …)`; the public cancel endpoint refuses them.
- GST is only ever computed on the server (`computeGst`); the web shows `POST /buying/tax-preview`. Never compute tax in the UI.
- Smoke suites must run ~15 s apart locally (auth rate limit → 429).
- Landed cost revalues `fifo_layer.rate` in place and writes a value-only ledger row (`voucher_type = 'landed_cost'`, qty 0).
  `landed_cost_layer_change` stores old/new rate and qty on hand at posting; cancels (voucher, covered receipt, earlier issue)
  are refused whenever they would make ledger value ≠ layer value. Keep that invariant if you touch FIFO or cancel code.
- Debounced previews (`useTaxPreview`, landed-cost preview) must decide `enabled` from the debounced body, not live inputs.
- Current cloud setup uses Docker Compose PostgreSQL (`docker compose up -d db`), Node 24, and pnpm 10.28.0; use the version pinned in package.json. API migrations apply at startup.
- Selling invoice creation uses company-owned in-stock batches (`owner=company`); invoice submission generates delivery and cancellation reverses it. Tax previews remain server-calculated.
- Draft autosave must compare saved payload snapshots, reschedule after pending requests, and suppress retries only for unchanged rejected payloads. Read/submit reviewers can submit without draft-update permission.
- 2026-10-05: User selected a controlled per-entity GL cut-over with reconciled opening balances and new-activity posting, rather than reconstruction of historical journals. Approved specification: docs/superpowers/specs/2026-10-05-gl-core-design.md.
- Business facts (2026-10-05): Azeonics imports some raw material (foreign currency, Bill of Entry, landed cost) and exports under LUT. FY 2026-27 is the first GST year; invoices may already exist in Tally, so tax invoice series can be moved forward (forward only).
- Selling backend: the sales invoice is the dispatch document (decision 030); its stock movement is a `system_generated` stock entry with purpose `delivery` (cancel the invoice, never the entry). Invoice numbers are per GSTIN: `number_series.doc_type = 'sales_invoice:<gst_registration_id>'`.
- Two implementations of the same task once collided on this branch (a human push and an agent's local work). Before starting a slice, `git fetch` and check the branch head; never overwrite someone else's pushed commit.

- GL uses `gl_account` (auth already owns `account`) and explicit inactive→active per-entity setup. Finance activation rechecks opening FIFO, bills/settlements and unbilled receipt baselines under the entity advisory lock; never auto-activate shared entities.
- Acquire `accounting:<entityId>` before document/item/PO locks for every operational lifecycle. Automatic GL postings and audit share the operational transaction; GL/allocation/disposition rows are append-only and reversals retain original accounts and six-place amounts.
- Receipt invoice allocations track quantity and actual base cost; final exhaustion consumes the remaining cost, including frozen opening baselines. Refuse cancellation of any receipt with positive net allocation, even when another receipt satisfies aggregate PO billed quantity.
- Manual journals cannot alter Inventory or GRNI; retain control-role history across remaps. Required mapped account roots cannot change; trade controls require party and bill/on-account references.
- Non-creditable invoice/customs taxes and landed charges share bounded six-place FIFO rate arithmetic. Unrepresentable on-hand value goes to explicit GL rounding with evidence, never negative consumption. Use `allocateProportion` to round quantity/value shares once; preserve final residuals.
- RCM credit stays pending until the future settlement/compliance slice. Customs eligibility is explicit on active-era landed cost; imports do not create customs tax twice. Accepted receipt-rate overrides produce price variance against actual receipt cost, not substantive rounding plugs.
- Reports disclose activation status even to report-only roles; source status distinguishes inactive, historical, no-value and missing postings. Historical stock/GL date comparisons remain limited because stock reversals retain existing dates while GL reversals use current Asia/Kolkata date.
- Linked clearing journals are traceable manual adjustments without a settlement ceiling; reverse them before cancelling their landed-cost source. AR/AP receipts/payments remain next. Review notes and two deferred UI minors: docs/superpowers/reviews/2026-10-05-gl-core-review.md.
- 2026-10-05: User approved proceeding with core AR/AP settlements and the recommended deferral of TDS/TCS to the compliance phase. Written design subsequently approved: docs/superpowers/specs/2026-10-05-ar-ap-settlements-design.md. Implementation plan awaits review and execution-method selection: docs/superpowers/plans/2026-10-05-ar-ap-settlements.md. No shared-entity activation is authorized.
- AR/AP subledger: bills/effects (`trade_bill`, `trade_bill_effect`) are derived from posted GL by `BillService.syncIn` under the accounting lock; never write effects for GL-sourced lines by hand. Settlement/allocation services write their own effects and their GL vouchers (source types `settlement`, `settlement_allocation`) are excluded from sync. Cancels are guarded centrally in `GlPostingService.reverseIn`.
- The web QueryClient caches for 30 s (`providers.tsx`); pickers that must be current (open bills) set `staleTime: 0, refetchOnMount: 'always'`.

- 2026-10-05: User chose to retain the shared AR/AP implementation and add compatible improvements. Preserve shared migration `0011_settlements.sql`; alternate code is backed up on `native-ar-ap-settlements-20261005` (`21c285d`). Never interchange their migration0011/database histories. Local shared validation uses `factoryos_shared_integration`; the original local database/configuration are preserved.
- Invoice balance queries use scoped operational read permissions, six-place amounts, `staleTime: 0` and always refetch on mount; settlement submission and invoice cancellation invalidate them. Pending legacy journal matching must seed all invoice identities first. Never rewrite already-initialized append-only bill effects to repair historical matching.

- 2026-10-05: User requested ongoing phases on the repository default branch, currently `claude/zealous-allen-35g1vm`. Customer credit/debit notes and sales returns draft design: `docs/superpowers/specs/2026-10-05-sales-notes-returns-design.md`; proposed subsequent slices are supplier returns, then NIC sandbox e-invoicing/e-way bills. Business rules in the new design await written-spec approval; Native remains the execution preference.

- 2026-10-05: Customer credit/debit notes and sales returns written spec approved; decision037 accepted. Implementation plan `docs/superpowers/plans/2026-10-05-sales-notes-returns.md` awaits review; execution method Native is already selected and should not be asked again. No shared-entity activation is authorized.

- 2026-10-05: Customer notes/returns are complete under decision037. Shared0011 remains unchanged; additive0012 introduces scoped notes/immutable return effects and typed allocation source,0013 snapshots seller name/GST/address. Customer credit uses original invoice rates/accounts and remaining carrying values; physical returns use original dispatch ledger value/batch, not current FIFO rates. Debit cancellation cannot remove a ceiling consumed by credits. Verified zero-cost deliveries return with a no-value disposition. GST notes needing IRN remain refused until that workflow; ambiguous historical custom tax-account evidence requires Finance review. See the customer-notes review for all rulings, reproducible fixture names and coverage limitations. Next separate design: supplier notes/returns, then NIC sandbox.

- 2026-10-05: Supplier-return conversational design approved: supplier-issued notes plus own claims; claims do not change AP/ITC, pre-acceptance dispatch moves carrying value to pending returns. Partial acceptance and explicit rejection/write-off/received-back resolution. Four Finance-controlled entity policies default to pending dispatch allowed, every-claim approval, automatic original-invoice credit application, rejected balance kept open. Written supplier spec awaits review; no accepted decision or product implementation yet.

- 2026-10-05: Supplier notes/returns written spec approved; decision038 accepted. Seven-task implementation plan awaits user review; Native method already selected. Keep original purchase matching, FIFO carrying and shared inactive books; supplier credit FX gain/loss must use AP sign, not copy customer-credit sign.

- 2026-10-06: Supplier return claims, dispatch, supplier-issued note, credit application and resolution have separate identities (decision038). Claims have no AP/ITC effect; dispatched unaccepted carrying is pending returns. Four audited entity policies are snapshotted, with Finance approval and Stores receipt separated. Gross PO/invoice matching stays unchanged.
- Supplier carrying evidence keeps exact acceptance/dispatch links in additive0015–0017. Dispatch-first acceptance consumes original ledger order; received-back restores its actual dispatch cost, not a blended claim rate. Chronology guards include cancelled notes and signed reversals. Inactive original accounts require scoped GL evidence; remapped compensation uses the dispatch's original variance account.
- Existing entities lazily receive missing default account mappings without replacing chosen mappings or activating books. Supplier endpoints seed required controls under the entity accounting lock. Duplicate supplier references are enforced on submitted notes. Imported/RCM GST adjustments remain separate; commercial supplier adjustments are supported.

- 2026-10-06: Supplier notes/returns decision038 completed and verified. Review artifact records all19 execution rulings and two deferred audit/label minors. Imported/RCM GST adjustments, mixed historical pending-control allocation and resend after received-back require separate explicit workflows. Next feature is NIC sandbox design, not live statutory submission.

- 2026-10-06: User explicitly requested continued work in order: NIC sandbox e-invoice/EWB design and implementation; accounting TDS/TCS, bank charges and reconciliation; foundation email delivery, SSO, passkeys, impersonation and PostgreSQL RLS. Native/default-branch preference persists. Draft NIC spec: `docs/superpowers/specs/2026-10-06-nic-sandbox-design.md`; review pending. Sandbox evidence must never appear as legal invoice IRN/QR; mock checks are not real provider verification. No NIC/GSP credential configuration found; secure access/whitelist status pending.

- 2026-10-06: NIC sandbox written design approved; decision039 accepted. Eight-task Native plan `docs/superpowers/plans/2026-10-06-nic-sandbox.md` awaits written-plan review. Official NIC documentation requests hit network proxy403; do not guess wire encryption/rules. Independent offline work can proceed after approval, while protocol/live checks remain separately blocked pending official contracts/access. Shared outbox lease functions belong in the database package so the worker does not import NestJS services.
