# GSTR-1 for the GST offline tool: evidence (decision 074c)

Pinned 2026-10-22 from the official GST offline tool zip, which the user supplied after downloading it from
www.gst.gov.in → Downloads → Offline Tools. The build environment still cannot reach tutorial.gst.gov.in
([GST returns evidence](gst-returns-evidence.md)). The zip and its executable are not committed. Only the header
lines of the tool's own section-wise CSV templates are, in [`gstr1-offline-tool/`](gstr1-offline-tool/), and the
core tests compare every export file against them byte for byte.

## Pinned

| File | SHA-256 |
|---|---|
| The zip as supplied | `f0a7d6f66bf71b30e9ecd045a664dda428c8fac239f51127d656e6faac60e312` |
| `GST Offline Tool.exe` (release 3.2.4, per `ReleaseNotes.txt`) | `7b4b89faf1f2ffe17839d6baefd3558fb3ad282f4b5aef764652615fbe9efb0a` |
| `GSTR1_Excel_Workbook_Template_V2.2.xlsx` (its `master` sheet lists the allowed values) | `425084547928a31eab53123b9247bad9ded1ee421fbc9202d009260e5d9b18e5` |
| `Section_wise_CSV_files/GSTR1/b2b,sez,de.csv` | `a80bc9e413797a63d3db93ed54560662f44f652398e065e1d9721766c82db330` |
| `…/b2cl.csv` | `dd9e6b724215026b5e5b23a0758cebe99444d6f79442c4a9a6fcdfdd2c3e1483` |
| `…/b2cs.csv` | `d9c8d10a9661b3e6b49d210ec913cefa5f8eb15d9763f0dd5beb44af0170d482` |
| `…/cdnr.csv` | `9e56d1a39b0b48e8fa336b493bdca422de221a3f5765878739ea034a363c9f1b` |
| `…/cdnur.csv` | `4dbe1aefc9c3ba74eefd16fb3b5c842a64979916eccbdfdbb6d8d59adfe4d29e` |
| `…/exp.csv` | `e46fb007873b92ad01bcc0143576f899ca2eda3623b353639d74eb6fc212dc84` |
| `…/exemp.csv` | `e1ca93bf6fdc2d01a09a4e8e1b2f2fd2cf643fce5bbb49106f7ed20049ca1c06` |
| `…/hsn(b2b).csv`, `…/hsn(b2c).csv` (same bytes) | `056fd0f8027e42a93f2ba05392a36b434abaac654b5b41566d630f946f0c3025` |
| `…/docs.csv` | `47f9f0afeeae3cf7bec62631e24468e8ec4f1d62f23c2bc2c663deccaf09aac4` |
| `…/b2ba.csv` | `723567ee69ccecc6d81100d6f94930ee243445132c4b00aa6fd3c9cfa5db683f` |
| `…/b2cla.csv` | `70b8546a394b38c60489ea30abc57ae765808c682eed541504c6ca9e865cbbac` |
| `…/b2csa.csv` | `455b980878829cb9123e90db0665a5e817edefed88d36465321d46e2d5a14be0` |
| `…/cdnra.csv` | `ebbd18d6313003403df728f928655bdbc98b3b35d51e2004b7acf583f94c4105` |
| `…/cdnura.csv` | `ad3a83a4e821e2af03c306cb7371d4ced66cf8ce4a3b35f90c1c7db1d32af709` |
| `…/expa.csv` | `069c710468d14c8f2c20e3aa39f88c0109ebabc794e1c5b510270c9082f7a8ad` |

## Verified from the pinned files, and how the build uses them

1. **Release notes:**
   - 3.2.2 splits the HSN summary into HSN (B2B) and HSN (B2C). **Build:** `hsn(b2b).csv` and `hsn(b2c).csv`; the old
     combined `hsn.csv` is not written.
   - 3.2.3 adds the 40% rate.
   - 3.2.1 dates the B2CL limit by return period (before and after August 2024), which matches `b2clThreshold`.
2. **File names and headers:** each export file has the template's name and its header line exactly.
3. **Line ends:** the templates use CRLF and no byte-order mark. **Build:** CRLF, UTF-8, no byte-order mark.
4. **Values, from the `master` sheet and the sample rows:**
   - **Dates** are `d-Mon-yy` (`14-Jul-17`, `1-Apr-18`).
   - **Place of supply** is `NN-Name` with the master's spelling (`27-Maharashtra`, `31-Lakshdweep`, `97-Other
     Territory`). **Build:** `OFFLINE_TOOL_POS`. A code the list lacks is written bare, so the tool's own validation
     names it.
   - **Units** are `CODE-NAME` (`NOS-NUMBERS`). **Build:** `OFFLINE_TOOL_UQC`; a unit the list lacks becomes
     `OTH-OTHERS`. Every code the unit form offers (NOS, PCS, SET, PAC, BOX, ROL, KGS, GMS, TON, MTR, CMS, SQM, CBM,
     LTR, MLT, OTH) is in the list.
   - **Rates** come from the master list (0, 0.1, 0.25, 1, 1.5, 3, 5, 6, 7.5, 12, 18, 28, 40). **Build:** written
     without trailing zeros (`18`, `0.25`).
   - **Reverse charge** is Y or N.
   - **Invoice Type and Note Supply Type** are Regular B2B, SEZ supplies with payment, SEZ supplies without
     payment, Deemed Exp, and Intra-State supplies attracting IGST. **Build:** the entry's subtype. "Intra-State
     supplies attracting IGST" is used when IGST is charged on a supply whose place of supply is the GSTIN's own
     State. Credit and debit notes to deemed-export customers are now marked DE.
   - **Export Type** is WPAY or WOPAY. **UR Type** is B2CL, EXPWP or EXPWOP. **B2CS Type** is OE or E. **Build:**
     always OE, because FactoryOS has no e-commerce operator sales.
   - **Note Type** is C or D. The samples carry positive note values. **Build:** a note's value, taxable value and
     cess are written as positive figures with their type.
   - **Nature of Document** includes "Invoices for outward supply", "Credit Note" and "Debit Note".
   - **Financial Year and Original Month** (b2csa) look like `2017-18` and `JULY`.
5. **The nil, exempt and non-GST file** has four fixed rows: inter-State and intra-State, to registered and to
   unregistered persons. **Build:** all four rows when the month has any nil-rated supply. Exempt and non-GST stay 0
   because FactoryOS records only nil-rated supplies.

## Not verified (the build's choice)

- **Blank optional columns.** Receiver Name, Applicable % of Tax Rate, E-Commerce GSTIN and the HSN Description are
  left blank. The samples leave the percentage and the GSTIN blank on some rows. Whether the tool accepts a blank
  receiver name and HSN description is not pinned; the user's first import will show it.
- **Sections with nothing to report** get no file, so they are not imported. The tool's handling of a header-only
  file is not pinned.
- **Tax amounts in B2B, B2CL, B2CS and notes.** The templates have no tax columns. The tool works tax out from the
  rate and place of supply, so a document whose tax was rounded differently can show a small difference in the tool.
- **The JSON the tool generates** is still not pinned. The user uploads it from the tool, as decision 074a expects.
