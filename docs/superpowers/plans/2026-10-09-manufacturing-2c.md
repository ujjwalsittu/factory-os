# Manufacturing slice 2c — implementation plan

Design: [spec](../specs/2026-10-09-manufacturing-2c-design.md), decision 047. Status: awaiting
user review of the spec and plan. No product code until both are approved.

| # | Task | Verify |
|---|---|---|
| 1 | **Statutory evidence:**<br>• ITC-04 frequency threshold, due dates, Sec 143 time limits and tool exemption, Rule 55 challan fields, and the ITC-04 offline-tool column layout, each checked against primary sources;<br>• results recorded in `docs/compliance/itc04-evidence.md`;<br>• anything that can't be checked becomes a STATUS blocker. | Evidence file with source URLs and retrieval dates |
| 2 | **Core:**<br>• due-by date from the challan date, item class and exemption;<br>• ITC-04 period and due date from frequency and date;<br>• allocation of receipt quantity to challan lines (oldest first, exact). | `pnpm --filter @factoryos/core test` |
| 3 | **Migration `--name job_work`:** the tables and columns in the spec's data section, append-only triggers for receipts and consumption, the nullable work-centre check, and the new enum values. | Migrate a fresh DB and a copy of the current one; existing suites stay green |
| 4 | **Masters and routing:**<br>• job-worker flag and auto "At vendor" warehouse;<br>• tool-exemption flag on items;<br>• outsourced operations in the BOM API and editor, frozen onto the work order at release;<br>• job cards refused on outsourced operations. | Extend `smoke-manufacturing.mjs` |
| 5 | **Conversion orders:**<br>• order API;<br>• challan (`job_work_out` transfer, `JWC` series, interstate e-way bill rule, cancel guard);<br>• receipt (`job_work_in` consume-and-recreate at exact value, loss, scrap, consumption rows);<br>• genealogy edge. | `smoke-job-work.mjs` (conversion and same-item cases, values exact to the paisa) |
| 6 | **Operation orders:**<br>• send and receive from the work order, with the challan value from WIP;<br>• rejected pieces;<br>• output gate. | `smoke-job-work.mjs` (operation cases); `smoke-manufacturing.mjs` still passes |
| 7 | **Processing charge:**<br>• purchase invoice line linked to a job-work receipt;<br>• WIP `job_work` row or acquisition-cost application;<br>• GL roles with books active, FIFO/WIP only with books inactive;<br>• exact reversal on cancel. | `smoke-job-work.mjs` (active and inactive books); buying and accounting suites stay green |
| 8 | **ITC-04:**<br>• return API per GSTIN and period, CSV export;<br>• deadline list, deemed-supply marking, dashboard count;<br>• permissions and roles. | `smoke-itc04.mjs` |
| 9 | **Web:**<br>• Job work list, form, view and challan print;<br>• work-order send and receive;<br>• BOM outsourced toggle;<br>• invoice link;<br>• ITC-04 page;<br>• master checkboxes. | `e2e:job-work` at desktop and 390 px |
| 10 | **Handoff:**<br>• full regression and self-review in `docs/superpowers/reviews/`;<br>• STATUS, LOG and MEMORY updated;<br>• PR to `main`. | typecheck, build, all suites |
