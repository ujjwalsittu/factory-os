# 03 · Manufacturing, Inventory, Batches & Waste

## 1. Item master

| Field | Notes |
|---|---|
| Item type | `raw_material`, `powder`, `component`, `consumable`, `sub_assembly`, `finished_good`, `kit`, `tool`, `gauge`, `service`, `scrap`, `customer_owned` |
| Tracking | `none` · `batch` · `serial` · `batch+serial`. Raw material batch carries **heat number**; powders carry **powder lot**; reels carry **reel ID** |
| Revision | Item ↔ drawing revision (A, B, C…). Engineering change creates a new revision; open WOs keep theirs (AS9100 configuration control) |
| Shelf life / MSL | Expiry days, MSL level (1–6) with floor-life hours, storage conditions |
| Inspection | Incoming-inspection plan required? FAI required on first build / revision change? |
| Compliance | HSN/SAC, GST rate (from HSN master, overridable with effective dates), SCOMET flag **[confirm]** |
| Costing | Standard cost (optional), valuation method inherited from entity |
| Variants | e.g. bar stock by alloy × diameter × length; avoid item explosion with attributes |
| UoM | Multi-UoM with conversions (kg ↔ mm length for bar via density × section) |

## 2. Warehouses & locations

```
Plant (Navi Mumbai)
├─ Stores ─ racks/bins
├─ Quarantine (incoming, awaiting QC)          ← not available for issue
├─ MRB / Hold (nonconforming)                  ← not available
├─ Bonded / Dry cabinet (MSL parts, powders)
├─ Cleanroom stores
├─ WIP (per work center, virtual)
├─ Customer-owned (job-work inward)            ← quantity only, no value
├─ At job-worker (job-work outward, per vendor)← ours, valued, off-site
├─ Finished goods / Dispatch
└─ Scrap yard (segregated by alloy / waste category)
```

Location *types* drive rules: availability, valuation, ownership, GST treatment.

## 3. Stock ledger (the heart)

- Append-only `stock_ledger_entry`: `entity, item, warehouse, location, batch, serial, qty (+/-),
  uom, valuation_rate, value_delta, voucher(type,id,line), posting_ts, owner (self|customer)`.
- Balances are materialised (`stock_bin`) and updated in the same transaction.
- **Backdated entries** enqueue a reposting job for subsequent entries (valuation only).
- Negative stock: **disallowed by default** per entity, per item override.
- Ledger is the single source for stock balance, batch balance, ageing, valuation, and traceability.

## 4. Batches, serials & genealogy

Every movement that **consumes** and **produces** writes genealogy edges:

```
Supplier PO ─► GRN ─► Batch HN-23-4471 (Ti-6Al-4V bar, MTC.pdf, CoC.pdf)
                          │ issued to
                          ▼
                 Work Order WO-0123  ──► Job card OP10 (5-axis, machine M-03, operator, 2.3 h)
                          │ produced
                          ▼
           Serial AZ-BRK-000041 (bracket rev C) ──► FAI report, CMM data
                          │ consumed in
                          ▼
           Serial SAT-ASSY-0007 (satellite structure)  ──► Delivery, Invoice, CoC
```

- **Backward trace**: "which heat numbers and operators went into SAT-ASSY-0007?"
- **Forward trace / recall**: "heat HN-23-4471 failed a retest — which serials and customers are affected?"
- Certificates (MTC, CoC, CoA) attached at batch level and auto-compiled into the outgoing
  **certificate of conformance pack** at dispatch.

### Additive manufacturing (powder)

- Powder lot types: `virgin`, `reused`, `blended`. Blending creates a new lot with parent lots
  and ratios; **reuse cycle count** increments per build; block issue beyond a configured limit.
- **Build job** = one machine run with a plate of N parts (possibly for different WOs/customers):
  consumes powder (loaded − recovered), argon, plate; produces N parts + witness coupons + powder
  to sieve + powder waste. Cost is apportioned across outputs by volume/weight **[confirm basis]**.

### SMT

- Reels as serial-tracked containers of a component batch; split/merge reels.
- **MSL floor-life clock**: starts on dry-pack open, pauses in dry cabinet, alerts before expiry,
  blocks issue after expiry until bake is recorded.
- Solder paste: expiry + thaw time + open time.
- PCBA serial ↔ component lots (at reel/lot level, not per-placement, initially).

## 5. Raw-material procurement → stock

`Material request → RFQ → PO → GRN (to Quarantine) → Incoming inspection → Accept (→ Stores) /
Reject (→ return to vendor, debit note) / Conditional (→ MRB)`

- GRN captures heat number, MTC upload, quantity in both purchase and stock UoM (bars: count & kg).
- Imports: Bill of Entry, BCD + SWS + IGST, landed-cost allocation to batches.

## 6. Manufacturing flow

```
Sales order / Forecast / Reorder
   └─► Production plan (MRP: net requirements, lead times, open POs/WOs)
          ├─► Purchase requests
          ├─► Subcontract orders (job-work outward)
          └─► Work orders  (BOM rev + routing rev frozen at release)
                 ├─► Material reservation  → Pick list → Issue (scan) → WIP
                 ├─► Job cards per operation (setup/run, machine, operator, qty good/rework/scrap)
                 ├─► In-process inspection gates
                 ├─► Output: FG / sub-assembly (serials/batch generated)
                 └─► Close: variance (material, labour, machine) → GL
```

- **Routing**: operations with work center (machine group), setup time, cycle time, tooling,
  inspection points, NC program reference/revision, outsourcing flag.
- **Work center = machine group**; machines are resources (linked to IoT device).
- **Job card capture**: tablet at machine (shop-floor PWA): start/pause/stop with reason codes;
  IoT can auto-fill actual run time and part count.
- **Digital traveler**: printable + on-screen, with sign-offs per operation (operator, inspector,
  timestamps) — replaces paper travelers.
- **Job-shop scheduling**: finite-capacity Gantt per machine, drag-to-reschedule, clashes with
  MaaS bookings shown on the same calendar (machines are shared between production and
  pay-per-use customers).
- **Kits** (Manha Sat Kit): kit BOM, kitting work order, serialized kit with component serials.
- **Rework / repair** orders linked to NCR.

## 7. Stock issuing & control

| Mechanism | Behaviour |
|---|---|
| Material request | From WO, project, maintenance, R&D, cleanroom — approval by role/value |
| Reservation | Hard (specific batch) or soft (qty) against WO/SO/project |
| Pick list | Batch suggestion by **FEFO** (shelf-life items) / **FIFO** / **specific heat** (customer-mandated) |
| Issue | Scan item + batch + location; over-issue requires approval; partial bars return as **remnant** batch with new length |
| Backflush | Optional per item (consumables, fasteners) on job-card completion |
| Return to stores | Unused material back with same batch identity |
| Gate pass | Every physical outward (returnable/non-returnable) — tied to challan/invoice; security desk verifies by scan |
| Cycle count | ABC classification, blind counts on mobile, variance approval, adjustment posting |
| Customer-owned | Separate ownership; issued/consumed/returned against the customer's inward challan |

**Remnant management** matters with Ti/Inconel: a 1 m bar cut to 340 mm leaves a 660 mm remnant
that stays traceable to the original heat.

## 8. Quality (AS9100)

- Inspection plans (incoming / in-process / final) with characteristics, tolerances, sampling.
- **FAI per AS9102** (Forms 1–3) triggered by new part / new revision / process change / 2-year lapse.
- **NCR → MRB disposition**: use-as-is, rework, repair, scrap, return to vendor — each disposition
  creates the corresponding stock/WO transaction.
- **CAPA** with root cause (8D/5-Why) and effectiveness checks.
- **Calibration register** for gauges/instruments: due dates, certificates, block use of overdue
  gauges in inspection entries.
- Operator **skill matrix / certifications** (e.g. only certified operators run 5-axis).

## 9. Waste & scrap management

| Stream | Source | Handling in FactoryOS |
|---|---|---|
| Metal swarf/chips | CNC | Captured per job card (expected vs actual); scrap item per **alloy** (Ti, Inconel, Al) — never mixed; weighed into scrap yard; sellable by kg |
| Remnants / offcuts | CNC | Stay as traceable remnant batches if reusable, else to scrap |
| Rejected parts | NCR → scrap | Scrapped with full genealogy (value write-off to GL) |
| Metal powder waste | AM sieving / failed builds | Hazardous (reactive/combustible) — stored and disposed via authorised handler |
| Coolant, cutting oil, solvents | CNC / cleaning | **Hazardous Waste Rules 2016** — category, generation log, storage limit/time, **manifest (Form 10)** per disposal, **annual return (Form 4)** to MPCB |
| E-waste (rejected PCBAs, components) | SMT | **E-Waste (Management) Rules 2022** — handover to registered recycler, EPR records |
| Packaging | Stores | Plastic EPR tracking if applicable **[confirm]** |

- **Waste register** = a stock ledger for waste (category, qty, location, storage start date →
  alert before the legal storage limit).
- **Scrap sale** = sales invoice with correct HSN, GST, and **TCS u/s 206C(1)** on scrap.
- **Authorised vendor register** with consent/authorisation validity dates.
- KPIs: **buy-to-fly ratio**, yield per part/operation, scrap cost by reason, powder reuse rate.
