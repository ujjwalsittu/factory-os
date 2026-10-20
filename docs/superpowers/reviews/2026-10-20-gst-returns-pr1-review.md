# GST returns PR 1 — GSTR-1 and GSTR-3B from the books — review (decision 074)

Built to the [plan](../plans/2026-10-20-gst-returns-pr1.md) and the [design](../specs/2026-10-20-gst-returns-design.md),
with decision 074a: everything except the GSTR-1 offline-tool JSON, which follows once the tool is pinned.
Migration `0060_gst_returns`. No new permission (`compliance.gst_return.*` already existed).

## What was built

- **Evidence** ([gst-returns-evidence.md](../../compliance/gst-returns-evidence.md)). The rules are pinned to the
  CGST Rules 2017 compilation (SHA-256 recorded). Four rules are not verified and are named in the code:
  - the ₹1 lakh B2CL threshold from 2024-08-01;
  - HSN digits by turnover;
  - the current 3B table-4 labels;
  - the UQC list.
- **Core** (`@factoryos/core/gst-returns`, pure):
  - Places each document in a GSTR-1 section: B2B (with SEZ and deemed-export sub-types and reverse charge), B2CL,
    B2CS, EXP, CDNR, CDNUR, or nil-rated.
  - Builds the B2CS, HSN (B2B/B2C, with UQC) and documents-issued summaries, the documents-issued summary showing
    cancelled numbers and gaps.
  - Fills GSTR-3B 3.1, 3.2, 4, 5 and 6.1 from outward and inward documents.
  - Runs the checks: GSTR-1 against 3.1, document series gaps, and output and input tax against the GST ledgers,
    naming the vouchers behind a difference.
  - Writes CSV sheets for each section.
  - Lists "needs attention" items (a B2B without GSTIN blocks; a short HSN or an export without shipping bill is
    flagged).
- **Data:**
  - `gst_return`: one per GSTIN, month and kind, holding a snapshot and its hash, ARN, and who and when for each
    step. Database checks keep the approver different from the preparer.
  - `gst_return_line`: where each document sits in the return.
  - Triggers freeze a filed return and its lines (no update or delete).
  - `uom.gst_uqc` is mapped for the standard units.
- **API** (`/gst-returns`):
  - **Reading:** the GSTINs, a live preview, the list, and a return with its lines and "changed since filing".
  - **Prepare and re-prepare:** both kinds as drafts, under an advisory lock; an approved or filed return is not
    prepared again.
  - **Workflow:**
    - review;
    - approve: forbidden to the preparer, and re-checks that the books still match the snapshot;
    - record filing with ARN and date.
  - **Export:** a zip of sheets plus a README.
  - **Late documents:** a document dated in a filed month but not in its return goes to the next return, marked
    with its month.
  - **Filed-month warning:**
    - The guarded actions are submit and cancel on sales invoices, purchase invoices, customer notes and supplier
      notes.
    - In a filed month these return 409 `gst_return_filed`, naming the return.
    - With `confirmFiledReturn` and a reason, the action goes ahead and is audited as
      `gst_return.filed_month_change`.
  - **Units:** `PATCH /uoms/:id` sets only the GST unit code.
- **Web:**
  - **Accounts & GST → GST returns:** choose a GSTIN and month; headline figures, needs attention, checks, GSTR-1
    and 3B views; prepare; the list of prepared returns.
  - **The return page:**
    - workflow buttons by permission, "Record filing…", and "Export sheets";
    - changed since filing, and documents from earlier filed months;
    - each GSTR-1 section with links to the documents.
  - **Filed-month confirmation:** one dialog, used by the invoice and note forms on submit and cancel, asks for the
    reason and repeats the call.
  - **Units:** the GST unit code on the unit form and on each row of the units table.

## Verification

- Core: 200 tests pass (12 for GST returns, on invented data).
- `smoke-gst-returns`: passes. It covers:
  - the preview figures;
  - re-prepare keeping the rows;
  - books changed after preparing refusing the review;
  - the preparer refused approval (403);
  - approving a draft refused (409);
  - filing;
  - frozen lines and rows in the database;
  - the filed-month 409 and the confirmed cancel with its audit row;
  - changed since filing on both kinds;
  - the late invoice in the next GSTR-1;
  - the ledger check failing on a stray journal and naming it;
  - the zip export;
  - isolation from another tenant.
- Browser walkthrough `e2e/gst-returns.mjs`: passes, at desktop width and 390 px, with no sideways scroll and no page
  errors. It covers preview, prepare, review, export, approval and filing by a finance controller, the filed-month
  dialog on cancelling an invoice, changed since filing, and the unit code.
  - The first run failed at the start, with the web server freshly started. The second run passed, and so did every
    later one. Not investigated further.
- Regression:
  - API smokes: sales notes lifecycle and guards, supplier notes and tax guards, accounting baseline and imports,
    bank charges, asset items, chart.
  - Browser walkthroughs: selling, buying, sales notes read-only, and the add-new guard.
- UI audit: 204 page views of 102 pages, with no sideways scroll, console errors or failed calls; the add-new guard is
  empty.
- Typecheck and build for API and web.

### Found and fixed while checking

- A filed GSTR-3B recorded only inward documents, so a cancelled sales invoice was shown as "added after filing".
  3B now records every document it read; the smoke asserts the exact change list.

## Not built, or limited

- **GSTR-1 offline-tool JSON** (074a): sheets only until the tool and its UQC list are pinned.
- **Amendments** (9A, 9C, 10) are PR 3; **advances** (table 11) are not built.
- **Exempt and non-GST supplies:** items carry only a GST rate, so a 0% line is nil-rated. 3B 3.1(e) and table 5
  stay zero until items get a taxability field.
- **3B table 4(B) reversals** are zero: FactoryOS records no ITC reversals yet.
- **Payment split in 6.1** (ITC or cash) is left to the portal.
- **Bank charges** have no page of their own; links go to the list.

## Noticed (outside this PR)

- `e2e/invoice-balances.mjs` fails for a reason older than this PR (not re-run on `main`). It looks up "Receipts & payments" in the menu, and since the Recent
  list (UI slice 2) that name appears twice. It needs the locator scoped to the area.
- Running many API smokes back to back hits the sign-up rate limit (429); restarting the API between smokes avoids
  it.
