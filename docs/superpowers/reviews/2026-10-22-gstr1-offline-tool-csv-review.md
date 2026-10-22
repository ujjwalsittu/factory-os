# GSTR-1 export for the GST offline tool: review (decision 074c)

Built to the [evidence](../../compliance/gstr1-offline-tool-evidence.md). No migration, table or permission.

## What was built

- **Core (`gstr1Sheets`):** the GSTR-1 export now writes the offline tool 3.2.4's section-wise CSV files.
  - **Files:** `b2b,sez,de.csv`, `b2cl.csv`, `b2cs.csv`, `cdnr.csv`, `cdnur.csv`, `exp.csv`, `exemp.csv`,
    `hsn(b2b).csv`, `hsn(b2c).csv` and `docs.csv`, plus the amendment files `b2ba.csv`, `b2cla.csv`, `cdnra.csv`,
    `cdnura.csv`, `expa.csv` and `b2csa.csv` for included amendments. Each file uses the template's header exactly.
    A section with nothing to report has no file.
  - **Format:** CRLF line ends; dates as `5-Nov-26`; places of supply as `27-Maharashtra`; units as `NOS-NUMBERS`
    (`OTH-OTHERS` for any unit not in the tool's list); rates as `18` or `0.25`.
  - **Labels:** Regular B2B, SEZ with or without payment, Deemed Exp, or Intra-State supplies attracting IGST
    (decided with the GSTIN's State); OE for B2CS; C or D for notes, with positive figures.
  - **Other files:** the HSN summary is split into B2B and B2C with total value; the nil-rated file has four rows;
    the documents file names the nature as the tool does; b2csa gives the financial year and month name.
- **Engine:** credit and debit notes to deemed-export customers now carry the DE subtype, so they are labelled Deemed
  Exp in `cdnr.csv`.
- **API:** the export passes the GSTIN's State to the sheets, and its README explains the import into the tool.
- **Web:** the GSTR-1 page explains the same in one line.
- **Pinned:** the header lines of the tool's templates in `docs/compliance/gstr1-offline-tool/`, kept byte for byte by
  a `.gitattributes` file.

## Verification

- **Core tests** (`gst-returns.test.ts`, 16 tests; core 205 in all):
  - every file in a month with each section has the template's exact header and CRLF only;
  - each section's rows are checked, among them an intra-State IGST invoice, a deemed export, a credit note and a
    debit note, an unknown unit, the nil file's four rows and the documents file;
  - an empty month writes no files;
  - included B2CLA, CDNRA, EXPA and B2CSA rows are checked; January 2026 is financial year 2025-26.
- **`smoke-gst-returns`** (68 checks): the zip holds the tool file names and no old ones; the B2B header and a row are
  checked.
- **`smoke-gst-amendments`** (64 checks): the B2BA row in the tool format.
- **Browser walkthroughs:** `e2e/gst-returns.mjs` and `e2e/gst-amendments.mjs` pass.
- **Build:** typecheck and build pass.

## Limits

- **Not yet imported into the real tool.** The tool runs on Windows only, so the user's first import is the real
  test. The [evidence](../../compliance/gstr1-offline-tool-evidence.md) lists what is not pinned: blank receiver
  names and HSN descriptions, missing files for empty sections, and tax worked out by the tool from the rate.
- **No receiver names.** Gstr1 entries do not carry the party name. Adding it would change every return's snapshot
  hash, which would mark prepared returns as changed.
- **Prepared returns and deemed-export notes.** A prepared but unfiled return with a credit or debit note to a
  deemed-export customer will show as changed and must be prepared again, because the note's subtype changed. Filed
  returns keep their snapshot.
- **No JSON.** FactoryOS still writes no JSON itself (decision 074a); the tool generates it.
