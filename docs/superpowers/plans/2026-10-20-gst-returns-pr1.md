# GST returns PR 1 — plan (decisions 074 and 074a)

Builds PR 1 of the [design](../specs/2026-10-20-gst-returns-design.md): GSTR-1 and GSTR-3B prepared per GSTIN per
month from submitted documents, reviewed under maker-checker, and exported for the portal. By decision 074a the
GSTR-1 offline-tool JSON comes later. The portal host for the offline tool resets connections from the build
environment, so its schema cannot be pinned yet. Until then GSTR-1 is exported as a sheet, like 3B.

## Choices

- **074a (2026-10-20): GSTR-1 JSON export later.** Everything else in PR 1 is built now. The JSON export follows as
  its own small PR once the offline tool is pinned in `docs/compliance/`, uploaded by the user or fetched when the
  host is reachable. Nothing in the data model depends on it.
- **Rules come from pinned primary sources** (the ITC-04 evidence rule). The build pins in T1:
  - the B2CL threshold;
  - HSN digits by turnover;
  - the GSTR-3B tables.

  A rule whose source cannot be pinned is listed in the evidence file as unverified, and the code names it.

## Tasks

**T1 · Evidence.** `docs/compliance/gst-returns-evidence.md`: sources with URLs and SHA-256, retrieved from
cbic-gst.gov.in or other official hosts that answer. It records:
- the B2CL threshold and its effective date;
- HSN digits required for each turnover band;
- the Form GSTR-3B tables used (3.1, 3.2, 4, 5, 6.1);
- the GSTR-1 sections and their keys.

**T2 · Core.** `packages/core/src/gst-returns.ts`, pure, with tests on invented data:
- **Classification.** A document line becomes one of:
  - GSTR-1: B2B (with reverse charge and SEZ), B2CL, B2CS, EXP (with or without payment), CDNR, CDNUR, or
    nil/exempt/non-GST;
  - a "needs attention" reason instead: B2B with no GSTIN, an export with no port or shipping bill, a bad HSN.
- **Summaries:** B2CS by place of supply and rate; HSN summary split B2B/B2C with UQC; the document summary by
  series with cancelled numbers and gaps.
- **GSTR-3B:**
  - 3.1 (a–e) from outward documents and inward reverse charge;
  - 3.2 by state for unregistered persons;
  - 4 from purchase invoices, supplier notes, bank charges and import IGST, eligible against ineligible;
  - 5 from inward exempt or nil;
  - 6.1 as tax payable.
- **Checks:** GSTR-1 tax against 3B 3.1; return tax against GL movements, naming the vouchers behind a difference.

**T3 · Migration `0060_gst_returns`, permissions.**
- `gst_return`: entity, registration, period, kind, status, snapshot hash, ARN, filed date, and who and when for each
  step.
- `gst_return_line`: section, document type and id, the figures, append-only by trigger once filed.
- `uom.gst_uqc`: standard units mapped in the migration.
- `compliance.gst_return.*` already exists.

**T4 · API.** `apps/api/src/modules/gst-returns/`:
- **Prepare and re-prepare** a draft per GSTIN and month, from submitted documents dated in it. Late documents (dated
  in a filed month) go to the next open return, flagged.
- **Read** the return with sections, drill-down, needs attention and the checks.
- **Workflow:** review, approve (a different person from the preparer), and file with ARN and date. Each step is
  audited.
- **Exports:** GSTR-1 and 3B as sheets (CSV per section, in one zip).
- **Changed since filing:** each filed line compared with its document's current figures.
- **Warn, don't lock:** cancelling or submitting a document in a filed month needs `confirmFiledReturn` and a
  reason. Without them, a 409 names the return. Applies to sales invoices, notes, purchase invoices and supplier
  notes.

**T5 · Web.** Accounts & GST → GST returns:
- the list by registration and month;
- the return page with sections, drill-down, needs attention, checks, workflow and exports, and "Changed since
  filing";
- the UQC on the unit form;
- the filed-month warning dialog on the cancel and submit actions of those documents.

**T6 · Checks and PR.**
- **`smoke-gst-returns`:**
  - prepare and re-prepare;
  - the preparer cannot approve;
  - a change in a filed month needs a reason and shows as changed;
  - a late document flows to the next return;
  - the GL check;
  - isolation.
- **Golden test:** a month of invented documents with expected sections and 3B figures.
- **Also:** the browser walkthrough (desktop and 390 px), regression, UI audit, review, STATUS and LOG, PR.

## Open points carried into the build

- **Exempt and non-GST supplies:** items carry only a GST rate, so a 0% line is reported as nil-rated. Exempt and
  non-GST need an item taxability field; the review says so if no such field is added.
- **Notes from Tally (075a)** are read from `tally_lines`.
