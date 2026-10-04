# FactoryOS — Plan

A modern, India-compliant ERP for a **single company group with multiple legal entities**, focused on
**precision manufacturing and services**, shaped around **Azeonics** (aerospace manufacturing,
testing and integration sold as pay-per-use) and **EarthNow** (satellite analytics services).

> **Status: plan for review.** The repo contains a structural scaffold only. No feature code
> is written until this plan and the open decisions are approved.

| Doc | Contents |
|---|---|
| [01 · Business context](./01-business-context.md) | What Azeonics & EarthNow do and what that demands from the ERP |
| [02 · Architecture](./02-architecture.md) | Monorepo, stack, modules, tenancy/entity model, core engines |
| [03 · Manufacturing & inventory](./03-manufacturing-inventory.md) | Items, stock ledger, batches/heat numbers, genealogy, AM powder, SMT, machining, stock issue, quality, **waste** |
| [04 · Services](./04-services.md) | Machine-hour MaaS, test campaigns, memberships, projects, EarthNow subscriptions & govt projects |
| [05 · India compliance](./05-india-compliance.md) | Tax engine, e-invoice, EWB, GSTR-1/3B/2B/IMS, ITC-04, TDS/TCS, MSME, GSP adapter |
| [06 · Security](./06-security.md) | MFA/SSO, RBAC+ABAC, RLS, customer IP vault, audit trail, gate pass |
| [07 · IoT](./07-iot.md) | Edge agent, OPC UA/MTConnect/Modbus, machine states, metering, environmental evidence |
| [08 · UX & design system](./08-ux-design-system.md) | Where we beat Frappe and how |
| [09 · Roadmap](./09-roadmap.md) | Phases 0–6 with exit criteria |
| [10 · Open decisions](./10-open-decisions.md) | **What I need from you** |

## The plan in one paragraph

A TypeScript modular monolith (Next.js web + Node API + worker + on-prem edge agent) on Postgres
with TimescaleDB. Every record is tenant- and legal-entity-scoped and enforced with row-level
security. Business documents follow a draft → submitted → cancelled lifecycle and post to
append-only ledgers (stock, GL, genealogy, audit), which makes AS9100 traceability and the
Companies Act audit trail native. India compliance is a deterministic tax engine plus a
provider-agnostic GSP adapter chosen per GSTIN. Services (machine-hours, test campaigns,
memberships, subscriptions) are first-class and metered from machine IoT. The UI is a purpose-built
design system with a command palette, real data grids, split views, a genealogy explorer and a
shop-floor PWA.
