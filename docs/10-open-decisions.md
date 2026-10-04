# 10 · Open Decisions & Questions

Nothing below is decided. Each has my recommendation; please answer or override.

## Already decided (from you)

| # | Decision |
|---|---|
| D1 | TypeScript full-stack on pnpm + Turborepo, Next.js, Postgres, shadcn/Tailwind |
| D2 | Entity-scoped data now, SaaS tenant layer reserved for later |
| D3 | v1 compliance: GSTR-1/3B + 2B, e-invoice + EWB, TDS/TCS, MSME, HSN/SAC |
| D4 | GSP: provider-agnostic; **all** providers supported, selected + credentialed per entity/GSTIN in settings |
| D5 | First deliverable: this plan + scaffold; no feature code until approved |

## Technical choices (my recommendation in bold)

| # | Question | Options |
|---|---|---|
| T1 | API framework | **NestJS** · Fastify + routers · tRPC-only |
| T2 | ORM | **Drizzle** · Prisma |
| T3 | Job queue | **pg-boss (Postgres)** · BullMQ + Redis |
| T4 | Hosting | **AWS Mumbai (ap-south-1)** · Azure India · on-prem · Railway/other |
| T5 | Auth | **Self-hosted (Better Auth) + Google/Microsoft SSO** · Keycloak · Clerk/Auth0 |
| T6 | Product name | "FactoryOS" (repo name) — keep? |
| T7 | Order of GSP adapters after `mock` | Which provider first? (Masters India, ClearTax, IRIS, Adaequare, Cygnet, Tera, NIC direct) |

## Business questions

| # | Question |
|---|---|
| B1 | Is EarthNow a **separate legal entity** (own PAN)? Any other entities (LLP, Section 8, foreign sub)? |
| B2 | GSTINs: only Maharashtra, or registrations in other states? Is any unit in an **SEZ**? |
| B3 | Is aggregate turnover above the **e-invoice threshold** for each entity today? |
| B4 | Do you **export** services/parts (LUT)? Import raw material/powders (Bill of Entry)? |
| B5 | Any **defence / SCOMET / export-controlled** work needing restricted access? |
| B6 | Valuation method: **FIFO** or moving average? Batch-wise valuation for traceable metals? |
| B7 | Current systems to migrate from (Tally, Zoho, ERPNext, Excel)? Opening balances date? |
| B8 | Accounting: should FactoryOS be the **books of record**, or sync to Tally for the CA? |
| B9 | Payroll/HR in scope, or keep an external payroll (and only import cost)? |
| B10 | AM build cost apportionment basis across parts on one plate: volume, weight, or build height? |
| B11 | Ground-station services: billed per pass, per minute, or monthly plan? |
| B12 | EarthNow pricing units: per hectare, per AOI, per report, per alert? |
| B13 | Machine list with make/model/controller (for IoT drivers). Budget for retrofit sensors on legacy machines? |
| B14 | Hazardous waste authorisation from MPCB already held? Which waste categories? |
| B15 | Users: roughly how many desk users / shop-floor users / customers on the portal? |
| B16 | SSO provider: Google Workspace or Microsoft 365? |
| B17 | Should GST returns be **filed** via GSP API (with EVC), or only prepared/uploaded and filed by the CA? |
