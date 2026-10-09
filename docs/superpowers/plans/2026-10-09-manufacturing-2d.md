# Manufacturing slice 2d — implementation plan

Design: [spec](../specs/2026-10-09-manufacturing-2d-design.md), decision 048. Status: awaiting user review of the
spec and plan. No product code until both are approved.

| # | Task | Verify |
|---|---|---|
| 1 | **Storage service:**<br>• `S3Storage` driver (R2) and a dev/test `local` driver, with the size, type and hash rules;<br>• presigned downloads;<br>• env vars in `.env.example`;<br>• `attachment` table and upload/download API. | Unit tests on the driver contract; `smoke-attachments.mjs` against the local driver |
| 2 | **Migration `--name quality`:**<br>• plans, records, results, FAI, NCR, gauges, calibration, item flags;<br>• append-only triggers. | Migrate a fresh DB and a copy of the current one |
| 3 | **Inspection plans:**<br>• API and editor, revisioned like BOMs;<br>• calibration register and gauge-blocking rule. | `smoke-quality-plans.mjs` |
| 4 | **Inspection records:**<br>• incoming (extending 1b, plus job work returns to Quarantine);<br>• in-process;<br>• final (output to Quarantine, pass moves stock, fail raises an NCR). | `smoke-inspections.mjs`; manufacturing, job work and buying suites stay green |
| 5 | **NCR and MRB:**<br>• hold transfer;<br>• the five dispositions with their transactions (release, rework work order, scrap with waste and GL, supplier return claim);<br>• MRB approval; close. | `smoke-ncr.mjs` (books active and inactive) |
| 6 | **FAI:**<br>• requirement rules;<br>• Forms 1–3 assembled from item, genealogy, job work and results;<br>• maker-checker approval;<br>• print;<br>• sales invoice gate. | `smoke-fai.mjs`; selling suites stay green |
| 7 | **Certificate pack:** genealogy walk collecting attachments into a zip. | Extend `smoke-genealogy.mjs` |
| 8 | **Web:**<br>• Quality nav and pages;<br>• item flags;<br>• attachments panel;<br>• inspection entry on mobile;<br>• FAI print;<br>• NCR disposition dialogs. | `e2e:quality` at desktop and 390 px |
| 9 | **Handoff:**<br>• full regression and self-review;<br>• STATUS, LOG, MEMORY updated;<br>• R2 setup steps for the user;<br>• PR to `main`. | typecheck, build, all suites |
