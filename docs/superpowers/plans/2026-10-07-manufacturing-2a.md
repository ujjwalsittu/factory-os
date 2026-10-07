# Manufacturing slice 2a — implementation plan

Design: [spec](../specs/2026-10-07-manufacturing-2a-design.md), decision 044. Status: in progress.

| # | Task | Verify |
|---|---|---|
| 1 | `packages/core/src/manufacturing.ts`: output valuation, job-card running minutes, absorption value, BOM scaling. Unit tests. | `pnpm --filter @factoryos/core test` |
| 2 | `packages/db/src/schema/manufacturing.ts` + stock purposes `production_issue/return/output` + `stock_entry.work_order_id`; migration `--name manufacturing`; WIP ledger append-only trigger. | `db:generate`, migrate on a fresh DB |
| 3 | Stock engine: directions, availability check for production issue, GL mapping (WIP), account roles `wip`, `overhead_absorbed`, `production_variance`; series `work_order`. | existing smoke suites still pass |
| 4 | API: work centres/machines, BOMs (draft/activate/obsolete, new revision), work orders (create/release/cancel/close/reopen), issue/return/output, job cards (start/pause/resume/stop/cancel), cost card, trace. Permissions + roles. | `apps/api/scripts/smoke-manufacturing.mjs` incl. GL checks on an activated test entity |
| 5 | Web: nav, work centres, BOM list/editor, work order list/new/detail, shop floor, trace. | `apps/web/e2e/manufacturing.mjs` desktop + mobile |
| 6 | Docs, STATUS/LOG/MEMORY, PR to `main`. | typecheck, build, all suites |
