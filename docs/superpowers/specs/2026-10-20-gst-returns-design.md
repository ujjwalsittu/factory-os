# GST returns: GSTR-1 and GSTR-3B from the books — design (decision 074, proposed)

Builds the returns part of the compliance scope already agreed: decision 004 (GSTR-1/3B, 2B/IMS), decision 007
(maker-checker filing) and decision 020 (returns through a GSP, Adaequare). The general plan is in
[05-india-compliance](../../05-india-compliance.md#2-returns). This design says what to build first, from the data
FactoryOS already holds, and what waits for the GSP.

## The problem

Every outward invoice and note already carries the GSTIN, place of supply, supply type, reverse charge and the tax
split per line. Purchase invoices, supplier notes, bank charges and landed cost (import IGST) carry the input tax.
Today Finance still prepares GSTR-1 and GSTR-3B by hand, outside FactoryOS. The figures should come from the books,
be checked by a second person, and be locked once filed, so the books and the returns cannot drift apart.

## What already exists

| Data | Where | Used for |
|---|---|---|
| Sales invoices (goods, services, MaaS, campaigns, projects, billing runs) | `sales_invoice`, lines with HSN, rate, taxable value, IGST/CGST/SGST/cess | GSTR-1 B2B, B2CL, B2CS, EXP; 3B 3.1 |
| Supply type (regular, SEZ with/without payment, export with payment / under LUT), shipping bill, port | `sales_invoice` | GSTR-1 SEZ and EXP tables; 3B 3.1(b) |
| Customer credit/debit notes, linked to the original invoice | `sales_note`, lines | GSTR-1 CDNR, CDNUR |
| Purchase invoices with reverse charge and ITC eligibility | `purchase_invoice`, lines | 3B 3.1(d) inward RCM, 4(A)(3), 4(A)(5), 4(B) |
| Supplier credit/debit notes | `supplier_note`, lines | 3B 4 (net ITC) |
| Bank charges with GST | `bank_charge_document` | 3B 4(A)(5) |
| Import IGST on the Bill of Entry | `landed_cost_voucher.import_igst` | 3B 4(A)(1) |
| Number series per GSTIN per FY, cancelled documents | series, document status | GSTR-1 document summary (Table 13) |
| The permission `compliance.gst_return` (read, create, approve, file, export) | permissions catalog | the workflow below |

**Missing:**
- A unit's GST UQC code. The HSN summary needs it: `NOS`, `KGS` and so on.
- A place to hold a prepared return, its review and its lock.

## Scope, in three PRs

### PR 1 · GSTR-1 and GSTR-3B prepared from the books

- **A return per GSTIN per month.** It is prepared on demand from submitted documents dated in the month, and it
  never edits them.
  - **GSTR-1 sections:**
    - B2B (with reverse charge and SEZ)
    - B2CL
    - B2CS
    - EXP
    - CDNR
    - CDNUR
    - HSN summary (split B2B / B2C, as the portal now asks)
    - document summary
    - nil-rated, exempt and non-GST, when such supplies exist
  - **GSTR-3B tables:**
    - 3.1 (a–e)
    - 3.2 (inter-state supplies to unregistered persons, by state)
    - 4 (ITC available, reversed, net, ineligible)
    - 5 (exempt / nil / non-GST inward)
    - 6.1 (tax payable, with the cash and credit split left to the person filing)
- **Each figure opens its documents.** Every row in a section links to the invoices or notes behind it, and every
  document shows which section it lands in. A document that cannot be placed is listed under "Needs attention"
  with the reason:
  - a B2B invoice with no customer GSTIN;
  - an export with no port or shipping bill by the filing date;
  - an HSN code missing or of the wrong length for the turnover band.
- **Checks before review:**
  - GSTR-1 total tax equals 3B 3.1 output tax.
  - Output and input tax in the return equal the movements on the GST ledgers in the general ledger for the month,
    when books are active. A difference names the vouchers that cause it.
  - The document summary has no gaps in a series that are not shown as cancelled.
- **Maker-checker (decision 007).** The statuses run Draft → Reviewed → Approved → Filed:
  - **Draft:** the preparer, with `create`;
  - **Reviewed:** Accounts;
  - **Approved:** a different person, with `approve`;
  - **Filed:** recorded with `file`, together with the ARN and the filing date from the portal.

  Re-preparing a draft or reviewed return starts again from the books. Each step is audited.
- **Export for the portal.** GSTR-1 is exported as the GSTN offline-tool JSON, for upload on the portal. GSTR-3B
  is exported as a sheet that matches the portal's tables, because the portal takes 3B as typed or GSP-pushed
  values, not a file. Both exports need `export`.
- **The lock.** Once a period is marked Filed, documents of that period cannot be cancelled or changed. A late
  document dated in a filed month goes into the next open return, flagged as late. Corrections to filed supplies
  are made through credit or debit notes, which the rules require anyway. Amendment tables (B2BA, CDNRA) come in
  PR 3.
- **Data (one migration):**
  - `gst_return` (registration, period, kind, status, prepared-at snapshot hash, ARN, people and times);
  - `gst_return_line` (section, the document, figures) as the frozen snapshot of what was reviewed and filed;
  - `uom.gst_uqc`.

  Snapshots are append-only. A re-prepare replaces a draft's lines; a filed return's lines are never changed.
- **Screens:**
  - **Accounts & GST → GST returns:** periods by registration and status.
  - **The return page:** sections with totals and drill-down, "Needs attention", the checks, the workflow buttons
    and the exports.
  - **The unit form:** gets the UQC code. Standard units are mapped on upgrade (NOS→NOS, KG→KGS and so on); the rest
    are left for a person to choose.

### PR 2 · GSTR-2B and IMS reconciliation from the portal file

- Upload the GSTR-2B JSON downloaded from the portal for the month.
- Match it against purchase invoices and supplier notes by supplier GSTIN, invoice number (normalised), date and
  value within a set tolerance.
- **Statuses:**
  - matched;
  - value mismatch;
  - in 2B but not in the books;
  - in the books but not in 2B.
- **IMS decisions:** accept, reject or pending, recorded in FactoryOS and exported for the portal.
- 3B table 4 then shows ITC as per books next to ITC as per 2B, with the difference named by invoice.

### PR 3 · Filing through the GSP, and amendments

- Push GSTR-1 to the portal and fetch its summary, file 3B values, and download 2B directly, all through the
  Adaequare adapter (decision 020) behind the existing provider-agnostic interface.
- Amendment tables (B2BA, CDNRA, EXPA) for corrections to filed periods.
- Needs Adaequare credentials and API access. Until then PR 1 and PR 2 work with portal uploads and downloads.

## Not in this design

- **Cost centres:** a separate accounting design, written next if you want it.
- QRMP (quarterly filing with monthly IFF), GSTR-9/9C, ISD and TDS/TCS GST returns (GSTR-7/8).
- E-invoice and e-way bill live filing: these stay with decision 020 and the NIC blocker in STATUS.

## Primary sources needed before PR 1 is built

The GSTR-1 offline-tool JSON schema and the current GSTR-3B table definitions, from the GST portal (offline tool
documentation) or provided by you. The same evidence rule as ITC-04 applies: the schema version and source are pinned
in `docs/compliance/` before the export is built, and golden tests use invented data only.

## Verification

- **Core tests:**
  - every section rule: B2CL threshold, intra- versus inter-state, SEZ, exports with and without payment, reverse
    charge, notes against invoices in another month;
  - the HSN summary split;
  - the document summary with cancelled numbers.
- **Golden tests:** a month of invented documents, with the expected GSTR-1 JSON and 3B figures.
- **A smoke test:**
  - prepare, re-prepare and the maker-checker rules (the preparer cannot approve);
  - filing locks the period;
  - a late document flows to the next return;
  - the GL check;
  - permissions and isolation.
- **A browser walkthrough**, on desktop and at 390 px.
- **The usual regression and UI audit.**

## Choices for you (recorded in decision 074 once approved)

1. **First step without the GSP:** prepare, review and export for portal upload now (recommended), or wait for
   Adaequare credentials and build filing first.
2. **Filing frequency:** monthly only for now (recommended if turnover is above ₹5 crore), or QRMP as well.
3. **After filing:** lock the period's documents so changes go through notes (recommended), or only warn.
4. **Where 3B ITC comes from:** documents, with the GL as a cross-check (recommended), or GL ledger balances only.
