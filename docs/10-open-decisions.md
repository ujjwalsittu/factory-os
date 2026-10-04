# 10 · Open Questions

Accepted decisions now live in [decisions/DECISIONS.md](./decisions/DECISIONS.md). This file
lists only what is **still open**. Answered items are removed (their answers are in the register or
in `ai/MEMORY.md`).

## Business

| # | Question | Why it matters |
|---|---|---|
| B4 | Which products/services will be exported, and which raw materials/powders imported? | LUT, Bill of Entry, landed cost (Phase 1) |
| B5 | Any defence / SCOMET / export-controlled work expected? | Restricted access flags (Phase 1 data model) |
| B6 | Valuation: FIFO with batch-wise valuation for metals/powders, moving average for consumables? (Proposed 018) | Stock ledger design (Phase 1) |
| B7 | Tally cut-over date, TallyPrime version, ongoing sync needed? (doc 12 §6) | Import tooling |
| B9 | Payroll/HR in scope, or import cost from an external payroll? | Module scope |
| B10 | AM build cost apportionment: by volume, weight or build height? | Costing (Phase 6) |
| B11 | Ground-station billing unit: per pass, per minute, or monthly? | Services (Phase 3) |
| B12 | EarthNow pricing units: per hectare, per AOI, per report, per alert? | Subscriptions (Phase 3) |
| B14 | MPCB hazardous-waste authorisation held? Which waste categories? | EHS (Phase 5) |
| B15 | Rough user counts: desk, shop floor, customer portal | Sizing |
| B16 | SSO: Google Workspace or Microsoft 365? | Auth (late Phase 0) |
| B18 | Which GSP for **returns** filing? (Needed before Phase 4) | Returns can't be filed via NIC directly |
| B19 | Does Azeonics meet NIC's direct-API eligibility (static IP, turnover criteria)? | Decides `nic_direct` vs IRP/GSP for e-invoice |
| B20 | IoT pilot budget (~10 machine taps, 1 edge PC, 2 scales) and board marking method (doc 11 §7) | Phase 5 |

## Technical

| # | Question | Recommendation |
|---|---|---|
| T3 | Job queue | pg-boss (Proposed 017) |
| T6 | Product name "FactoryOS": keep? | Keep for now |
| T8 | Production hosting (after dev on Coolify) | AWS Mumbai, decide before go-live |
