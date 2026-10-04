# 01 · Business Context

> Source: azeonics.com and earthnow.tech (read Oct 2026). Items marked **[confirm]** are my
> assumptions and are collected in [10-open-decisions.md](./10-open-decisions.md).

## The group

| | Azeonics | EarthNow |
|---|---|---|
| Legal | Azeonics Private Limited, Thane West, MH 400604 | Separate legal entity, **acquired subsidiary** of Azeonics |
| GST | Maharashtra today; other states and SEZ units possible later | Same |
| E-invoice | Above threshold; applies from **1 Apr 2027** (FY 2026-27 is the first year after GST registration) | Per its own turnover |
| What | Integrated precision manufacturing, testing & innovation facility for drones, satellites, aerospace — sold **pay-per-use** | Satellite imagery → decision-ready intelligence (16 solutions, 9 industries) |
| Where | HQ Thane, manufacturing Navi Mumbai (both Maharashtra) | India-wide coverage, 95,000+ ha monitored |
| Quality | ISO 9001, AS9100, ISRO-grade | — |
| Nature | Manufacturing **and** services | Services (SaaS / analytics / projects) |

FactoryOS is therefore built for **one company group** with **N legal entities**, each with its own
PAN, one or more GSTINs (one per state registration), its own books and number series — but shared
masters, shared users, and consolidated reporting.

## Azeonics — the six capabilities, and what each means for the ERP

| Capability | Operational reality | ERP must handle |
|---|---|---|
| **Precision manufacturing** (5-axis CNC, ±5 µm) | Job-shop, low volume / high mix, customer drawings, expensive alloys (Ti, Inconel, Al 7075) | Drawing revisions, routings, job cards, machine time capture, heat-number traceability, mill test certificates (MTC), FAI (AS9102), buy-to-fly ratio, swarf segregation by alloy |
| **Metal additive** (DMLS/LPBF: Ti, Inconel, Al) | Build jobs carry many parts from many customers on one plate; powder is reused | Powder-lot genealogy (virgin/reused/blended, reuse-cycle count), build-job → multiple outputs (co-products), witness coupons, post-processing routings, powder waste |
| **Electronics & SMT** (300–400 boards/month) | Component reels, stencils, solder paste, BOM-heavy | Reel-level tracking, MSL floor-life clocks, shelf-life (paste, adhesives), serialized PCBAs, AOI/X-ray results, e-waste |
| **Advanced sensor lab** (EO/IR, LiDAR, RF) | Test services on customer payloads | Service orders, customer-owned equipment in custody, test reports, calibrated instrument register |
| **Environmental qualification** (TVAC, EMI/EMC, vibration to ISRO standards) | Chambers booked by the day, campaigns | Resource booking calendar, day-rate billing, chamber sensor logs attached to reports |
| **Cleanroom integration** (ISO 6/8) | CubeSat assembly, controlled access | Cleanroom access log, particle-count/T/RH logs, gowning, integration travelers |

### Commercial models (all must be first-class)

1. **Hourly machine time** — metered (ideally from machine IoT, spindle-on hours) against a rate card.
2. **Day-based test campaigns** — resource booking → usage → invoice.
3. **On-demand parts manufacturing** — RFQ → quote (costed from routing) → sales order → work order.
4. **Annual studio memberships** — subscription with included credits/hours, overage billing.
5. **"Idea-to-Orbit" bundle** — a project with milestones spanning many of the above.
6. **Products** — e.g. *Manha Sat Kit* (1U CubeSat kit: OBC, EPS, ADCS, comms) → kit BOM, serialized.
7. **Ground-station services** — pass scheduling, telemetry; billed per pass / per month **[confirm]**.

## EarthNow — what it needs from the ERP

EarthNow is not a manufacturer; it needs the **services** half of FactoryOS:

- Customers are often **government / public sector** → tenders, EMD, performance bank guarantees,
  milestone billing, retention money, TDS u/s 194J deducted by the customer (26AS reconciliation),
  long payment cycles.
- Recurring **subscriptions** (monitoring a region on a schedule), priced per hectare / per AOI /
  per alert product **[confirm]**.
- **Project delivery** with deliverables and timesheets (data scientists, GIS analysts).
- Purchases of **satellite imagery** — often imported services (RCM on IGST, possibly equalisation
  levy / withholding on foreign payments) **[confirm]**.
- Cloud/GPU cost tracking per project (cost allocation).
- Inter-company: EarthNow may buy services from Azeonics (ground-station passes, compute) →
  inter-company invoices with GST.

## Cross-cutting realities (Indian aerospace MSME)

- **Customer-supplied material** (free-issue Ti bar, customer PCBs) is common → *job-work inward*,
  stock that is held but not owned, never valued.
- **Outsourced processes** (heat treatment, anodising, NDT, plating) → *job-work outward* under
  Sec 143 CGST with delivery challans and **ITC-04**.
- **Imports** of raw material, powders, components → Bill of Entry, customs duty, IGST ITC,
  landed cost.
- **Exports / SEZ** of services and parts → LUT, zero-rated supplies **[confirm]**.
- Possibly **defence / export-controlled** items (SCOMET) **[confirm]**.
- Hazardous and e-waste obligations to **MPCB** (Maharashtra Pollution Control Board).
