# 02 · Architecture

## Principles

1. **Modular monolith first.** One deployable API with strictly separated domain modules; split out
   services only where load or isolation demands it (IoT ingestion, compliance workers).
2. **Ledgers are append-only.** Stock ledger, general ledger, batch genealogy and audit log are
   never updated in place. Corrections are reversals. This is what makes traceability (AS9100) and
   audit-trail rules (Companies Act audit-trail rule) easy instead of bolted-on.
3. **Documents have a lifecycle.** `draft → submitted → cancelled` (+ `amended-from`) — the one idea
   worth keeping from Frappe. Only `submitted` documents post to ledgers.
4. **Everything is entity-scoped**, and every entity is tenant-scoped (see below).
5. **Typed end-to-end.** One Zod schema per document → DB types, API validation, OpenAPI, form UI.
6. **India compliance is a module, not a patch.** Tax is computed by a deterministic engine with
   golden-file tests, not by per-form scripts.

## Monorepo layout (Turborepo + pnpm)

```
factory-os/
├─ apps/
│  ├─ web/           Next.js (App Router) — desk UI + shop-floor PWA routes
│  ├─ api/           Node API — REST + OpenAPI, all domain modules
│  ├─ worker/        Background jobs — GSP calls, posting, reports, notifications
│  └─ edge-agent/    Runs on-prem at the plant — OPC UA / MTConnect / Modbus → MQTT
├─ packages/
│  ├─ ui/            Design system (shadcn/Radix/Tailwind), data grid, form engine
│  ├─ db/            Drizzle schema, migrations, RLS policies, seed
│  ├─ core/          IDs, money/decimal, doc lifecycle, numbering series, events
│  ├─ auth/          Session, RBAC/ABAC policy engine, permission helpers
│  ├─ compliance-in/ GST engine (place of supply, rates, RCM), HSN/SAC, TDS/TCS, validators
│  ├─ gsp/           Provider-agnostic GSP/IRP/EWB adapter interface + provider adapters
│  ├─ iot-protocol/  Shared telemetry/event schemas (edge ↔ cloud)
│  ├─ sdk/           Typed API client used by web, worker, and external integrations
│  └─ config/        Shared tsconfig / eslint / prettier
├─ docs/
└─ turbo.json, pnpm-workspace.yaml
```

Domain modules live inside `apps/api/src/modules/*` at first and are promoted to
`packages/modules-*` only when the worker or another app needs them directly.

### Domain modules (bounded contexts)

| Module | Owns |
|---|---|
| `platform` | Tenants, legal entities, branches/GSTINs, plants, fiscal years, number series, settings |
| `identity` | Users, roles, policies, sessions, API keys, approval rules |
| `masters` | Items, UoM, item variants, parties (customers/suppliers), addresses, price lists, HSN/SAC |
| `inventory` | Warehouses, locations, stock ledger, batches, serials, reservations, transfers, counts |
| `buying` | RFQ, supplier quotation, PO, GRN, purchase invoice, landed cost, imports |
| `selling` | Lead/RFQ, quotation, sales order, delivery, sales invoice, credit notes |
| `manufacturing` | BOM, routing, work centers, work orders, job cards, build jobs, subcontracting |
| `quality` | Inspection plans, incoming/in-process/final QC, FAI, NCR/MRB, CAPA, calibration |
| `services` | Resource booking, usage metering, rate cards, memberships, subscriptions, projects, timesheets |
| `accounts` | Chart of accounts, GL, AR/AP, payments, bank reconciliation, cost centers, inter-company |
| `compliance` | GST returns, e-invoice, e-way bill, ITC-04, TDS/TCS, MSME, 2B/IMS reconciliation |
| `ehs` | Waste register, hazardous-waste manifests, e-waste/EPR, scrap sales |
| `iot` | Devices, tags, machine states, OEE, environmental logs, metering feed to `services` |
| `documents` | Files (drawings, MTCs, CoCs, reports), revisions, access control |

## Runtime stack (recommended — see open decisions)

| Concern | Choice | Why |
|---|---|---|
| Language | TypeScript everywhere | One type system from DB to UI |
| Web | Next.js + React Server Components, TanStack Query/Table | Fast desk UI, PWA for shop floor |
| API | **NestJS** (modules/DI map to bounded contexts) — alt: Fastify + Hono-style routers | Large-ERP structure, guards for RBAC |
| ORM | **Drizzle** | SQL-close (ledgers, window functions, RLS), fast migrations |
| DB | PostgreSQL 16+ with **TimescaleDB** extension | One DB for OLTP + machine time-series |
| Jobs | **pg-boss** (Postgres-backed) — alt: BullMQ + Redis | Fewer moving parts; transactional enqueue |
| Cache / realtime | Redis + WebSockets (SSE fallback) | Live job-card / machine status |
| Files | S3-compatible object storage (AWS S3 Mumbai / MinIO on-prem) | Drawings, certificates, reports |
| IoT broker | EMQX or Mosquitto (MQTT 5, Sparkplug B) | Standard for industrial telemetry |
| Search | Postgres FTS + trigram → Meilisearch later | Global search / command palette |
| PDFs | React-PDF / headless Chromium templates | Tax invoices, challans, travelers, CoCs |
| Observability | OpenTelemetry → Grafana stack | Traces across API/worker/GSP calls |

## Tenancy & legal-entity model

```
Tenant (the group; SaaS boundary reserved for later)
 └─ Legal Entity (PAN, CIN, books, base currency INR, fiscal year Apr–Mar)
     ├─ GST Registration (GSTIN, state, type: regular/SEZ/ISD, GSP provider + credentials)
     │    └─ Branch / Place of business (address, used for place-of-supply)
     ├─ Plant / Site (Navi Mumbai) ── Warehouses ── Locations (bins)
     ├─ Number series per doc type × entity × GSTIN × FY (GST requires ≤16-char unique per FY)
     └─ Cost centers / Projects
Shared at tenant level: users, items, parties, HSN master, UoM, templates
Scoped at entity level: stock, ledgers, prices (optional), documents, settings
```

- Every row carries `tenant_id`; every transactional row also carries `entity_id`.
- **Postgres Row-Level Security** enforces both, using `SET LOCAL app.tenant_id / app.entity_ids`
  per request — a bug in a query cannot leak another entity's data.
- **Inter-company**: a sales invoice from Azeonics to EarthNow auto-creates a draft purchase invoice in
  EarthNow; consolidation eliminates inter-company balances.
- **Consolidated reporting** across entities a user is allowed to see.

## Core engines

- **Document engine** (`packages/core`): lifecycle, numbering, versioning, amendments, attachments,
  comments, activity timeline, workflow states & approvals — every doc type gets these for free.
- **Posting engine**: on submit, a document emits *postings* (stock ledger entries, GL entries,
  genealogy links) in one transaction. Cancel emits exact reversals.
- **Valuation engine**: per entity × item, FIFO or moving average; batch-wise valuation for
  traceable items; landed-cost redistribution; repost-on-backdate handled as a queued job.
- **Tax engine** (`packages/compliance-in`): pure functions —
  `(supplier GSTIN, recipient GSTIN/state, place of supply, item HSN/SAC, value, flags) → tax lines`.
- **Event bus** (outbox table → worker): `stock.moved`, `invoice.submitted`, `machine.state_changed`…
  drives notifications, GSP calls, IoT-to-billing, and webhooks.

## Deployment

- Docker images per app; Postgres managed (AWS RDS ap-south-1 Mumbai, data residency) **[confirm]**.
- `edge-agent` runs on a small industrial PC in the Navi Mumbai plant, buffers offline, pushes
  over MQTT/TLS.
- Environments: dev, staging (GSP sandboxes), prod.
