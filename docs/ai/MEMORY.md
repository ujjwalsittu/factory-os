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
- 2026-10-05: User approved proceeding with core AR/AP settlements and the recommended deferral of TDS/TCS to the compliance phase. Written design awaits its own review: docs/superpowers/specs/2026-10-05-ar-ap-settlements-design.md. No shared-entity activation is authorized.
