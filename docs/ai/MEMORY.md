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
