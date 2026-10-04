# Decision Register

Binding for every contributor (AGENTS.md rule L7). Statuses: **Accepted** (do not reopen without
the user), **Proposed** (awaiting the user), **Superseded** (points to its replacement).
To add one, append the next number and keep it short: context → decision → consequences.

| # | Date | Status | Decision |
|---|---|---|---|
| 001 | 2026-10-04 | Accepted | **Stack:** TypeScript, pnpm + Turborepo monorepo, Next.js (web), NestJS (API), Drizzle ORM, PostgreSQL 16 (+ TimescaleDB later for IoT). |
| 002 | 2026-10-04 | Accepted | **Tenancy:** `tenant → legal entity → GST registration → branch/plant`. Every row has `tenant_id`; transactional rows also `entity_id`. One tenant (the Azeonics group) today; SaaS-ready. |
| 003 | 2026-10-04 | Accepted | **Entities:** Azeonics Private Limited (parent, Thane, MH) and EarthNow (acquired subsidiary, separate PAN). Multi-state GSTINs and SEZ units must be supported by data model now, even though only MH exists today. |
| 004 | 2026-10-04 | Accepted | **Compliance v1 scope:** GSTR-1/3B, 2B/IMS reconciliation, e-invoice (IRN), e-way bill, TDS/TCS, MSME 45-day, HSN/SAC, ITC-04. |
| 005 | 2026-10-04 | Accepted | **GSP/IRP:** provider-agnostic adapter. All providers supported; provider and credentials chosen per entity/GSTIN in settings. **First live integration: government portals directly** (NIC IRP `einvoice1.gst.gov.in`, NIC e-way bill). GSTN returns APIs go through a GSP (direct access to returns APIs isn't offered to taxpayers). |
| 006 | 2026-10-04 | Accepted | **E-invoice applicability is effective-dated per entity.** Azeonics is above the threshold, but e-invoicing applies from the next FY (FY 2027-28, i.e. 1 Apr 2027). Before that date, invoices are issued without IRN. |
| 007 | 2026-10-04 | Accepted | **Return filing:** via GSP with maker-checker approval. Preparer drafts, Accounts reviews, Finance Controller (or permission `compliance.gst_return.file`) approves and files. |
| 008 | 2026-10-04 | Accepted | **Books of record = FactoryOS.** Tally: one-time import of history plus optional ongoing two-way sync. Accounting UX must feel familiar to Tally users (voucher keys, Gateway-style reports). |
| 009 | 2026-10-04 | Accepted | **Auth:** Better Auth, self-hosted, data in our Postgres. Email+password, MFA (TOTP + passkeys), Google/Microsoft SSO later. |
| 010 | 2026-10-04 | Accepted | **Admin levels:** Platform SuperAdmin (all tenants, plans, feature flags, audited impersonation) and Tenant Owner/Admin (entities, users, roles inside the tenant). |
| 011 | 2026-10-04 | Accepted | **Landing page:** public FactoryOS product site with sign-in; SaaS-ready. |
| 012 | 2026-10-04 | Accepted | **Hosting (dev):** existing Coolify instance (`central.azeonics.com`) on AWS. Docker image per app. Production hosting decided later. |
| 013 | 2026-10-04 | Accepted | **Commit hygiene:** no AI vendor/model/assistant names in commits or PRs; enforced by git hooks + CI. No force-push or history rewrite. |
| 014 | 2026-10-04 | Accepted | **Agent contract:** AGENTS.md is the single source of working rules for any agent/provider; handoff state lives in `docs/ai/`. |
| 015 | 2026-10-04 | Accepted | **RBAC model:** permission strings `module.resource.action`; roles are tenant-defined bundles of permissions; role assignments are scoped (tenant-wide, or limited to entities/plants). Postgres RLS added as defence-in-depth in Phase 1. |
| 016 | 2026-10-04 | Accepted | **IoT:** buy machines with open interfaces (IPC-CFX/Hermes for SMT, MTConnect/OPC UA for CNC/EDM) where possible. Self-built ESP32 nodes for legacy/simple equipment. Edge agent per plant, MQTT to cloud. See docs/11. |
| 017 | 2026-10-04 | Proposed | **Job queue:** pg-boss (Postgres) rather than BullMQ/Redis. |
| 018 | 2026-10-04 | Proposed | **Valuation:** FIFO with batch-wise valuation for traceable metals/powders; moving average for consumables. |
