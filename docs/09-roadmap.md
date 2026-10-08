# 09 · Roadmap

Each phase ends with something usable in production by Azeonics/EarthNow. Durations are rough
and assume a small team; we will re-plan after Phase 0.

## Phase 0 — Foundation ✅ (core built 2026-10-04; leftovers listed in ai/STATUS.md)
- Monorepo, CI, environments, DB migrations, RLS.
- Tenancy, legal entities, GST registrations, plants, fiscal years, number series.
- Auth (MFA, SSO), RBAC/ABAC, audit log.
- Design system v1: shell, ⌘K, DataGrid, DocForm, Timeline.
- Document engine (lifecycle, numbering, attachments, comments, approvals).
- **Exit**: create entities Azeonics + EarthNow, users with scoped roles, a generic doc end-to-end.

## Phase 1 — Masters, Inventory, Buying, Selling, GST core (in progress: 1a inventory 2026-10-04; 1b buying + imports, 1c selling done 2026-10-05)
- Items (types, tracking, revisions), UoM, parties (GSTIN lookup), HSN/SAC.
- Warehouses/locations, stock ledger, batches/serials/heat numbers, transfers, counts, gate pass.
- ✅ PO → GRN (quarantine) → incoming QC → purchase invoice (3-way match, MSME due dates); imports in foreign currency with Bill of Entry and landed cost.
- ✅ Quotation → SO → sales invoice that ships the goods; exports under LUT; tax invoice print. Pending: delivery challans (with job work), credit/debit notes.
- Tax engine, GL posting core (CoA, journal, AR/AP basics).
- **E-invoice + e-way bill** via GSP adapter (mock + first live provider).
- **Exit**: Azeonics buys bar stock and sells parts with legal invoices, IRN and EWB.

## Phase 2 — Manufacturing & Quality (in progress: 2a work orders, job cards, actual costing done 2026-10-07; 2b serials, remnants, as-built and genealogy done 2026-10-08)
- BOM & routing (revisioned), work centers/machines, work orders, reservations, pick/issue,
  job cards (shop-floor PWA), output with serials, remnants, genealogy explorer.
- Job-work outward (subcontract) + inward (customer material), **ITC-04**.
- Inspection plans, FAI, NCR/MRB, calibration register.
- Scheduler (finite capacity Gantt).
- **Exit**: a satellite bracket traced from heat number to delivered serial with FAI and CoC pack.

## Phase 3 — Services
- Resources, rate cards, bookings (shared calendar with production), usage records.
- Service orders (test campaigns, customer custody), memberships with credits, projects/milestones,
  subscriptions (EarthNow), timesheets, billing runs.
- **Exit**: a TVAC campaign and an EarthNow subscription billed end-to-end.

## Phase 4 — Accounting depth & compliance returns
- Payments, bank reconciliation, cost centers, inter-company + consolidation.
- **GSTR-1, GSTR-3B, 2B/IMS reconciliation**, TDS/TCS (26Q/27Q data), MSME 45-day, compliance calendar.
- **Exit**: monthly GST close and TDS done from FactoryOS for both entities.

## Phase 5 — IoT & EHS
- Edge agent + first drivers, machine states, OEE, metering → usage records.
- Environmental logs (cleanroom, chambers) → evidence bundles.
- Waste register, hazardous-waste manifests & annual return data, e-waste, scrap sale with TCS.
- **Exit**: machine-hour invoices generated from real spindle data.

## Phase 6 — Depth & differentiation
- AM powder genealogy & build jobs, SMT MSL clocks/reels.
- CAPA, skill matrix, maintenance (preventive/breakdown).
- Customer portal, analytics (buy-to-fly, margin per customer/machine), GSTR-9, SaaS tenant layer.
