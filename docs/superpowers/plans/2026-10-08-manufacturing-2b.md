# Manufacturing slice 2b — implementation plan

Design: [spec](../specs/2026-10-08-manufacturing-2b-design.md), decision 046. Status: awaiting
user review of the spec and plan; no product code until both are approved.

| # | Task | Verify |
|---|---|---|
| 1 | Core: equal split of an output value across N serials (exact remainder), serial number formatting, genealogy traversal limits. Unit tests. | `pnpm --filter @factoryos/core test` |
| 2 | Migration `--name serials_remnants`: `batch.kind`, `batch.length_mm`, `item.serial_prefix`, `serial_counter`, `serial_component` (append-only trigger), stock purpose `cut`. | migrate on a fresh DB and on a copy of the current one |
| 3 | Stock engine: serial rules (qty 1, unique in stock, bin 0/1), serial creation on receipt, `cut` direction and value move, no GL for cut. | existing inventory/buying/selling/returns suites stay green; new serial cases |
| 4 | Serials through documents: receipts (typed/scanned), transfers, sales invoice serial lines, sales/supplier returns by serial, landed cost on serial layers. | `smoke-serials.mjs` |
| 5 | Manufacturing: serial items allowed in BOMs/work orders, serial issue, serial output with generated numbers and per-serial cost, as-built picker and rules, cancel frees components. | extend `smoke-manufacturing.mjs` |
| 6 | Remnants: Cut endpoint and dialog, cut-on-issue, remnant search, lengths in issue/stock screens. | `smoke-remnants.mjs` |
| 7 | Genealogy API (recursive SQL, limits, recall list, CSV) and page. New permissions and roles. | `smoke-genealogy.mjs`; `e2e:genealogy` desktop + mobile |
| 8 | Full regression, review notes, STATUS/LOG/MEMORY, PR to `main`. | typecheck, build, all suites |
