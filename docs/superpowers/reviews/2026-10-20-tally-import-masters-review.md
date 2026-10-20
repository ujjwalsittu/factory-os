# Tally import, PR 1 (masters) — review (decision 072)

Build of the first of three PRs in the [design](../specs/2026-10-20-tally-import-design.md), approved by the user on
2026-10-20 by merging the claim (PR 62).

## What was built

- **Parser** (`packages/core/src/tally.ts`, exported as `@factoryos/core/tally`).
  - Streams TallyPrime's Data Interchange XML: UTF-16 with or without a byte-order mark, UTF-8, and `.zip` uploads.
  - Removes the control characters Tally writes, including `&#4;`.
  - Returns typed masters for groups, ledgers (party details, GST details, opening balance and bill-wise openings),
    units, godowns, stock groups and stock items (HSN, GST rate, batches, opening stock).
  - Amounts stay exact decimal strings, with Tally's negative-for-debit sign turned into a side.
  - It sits in core, under its own export, so the web bundle never loads it and the deploy watch paths do not change.
- **Data.** Migration 0054 adds `tally_import`, `tally_staged` and `tally_link`. The history tables arrive with PR 3,
  in their own migration.
- **Permissions.** `accounts.tally.read` and `accounts.tally.import`, with a new `import` action.
  - Finance Controller has both.
  - Accountant, auditor and the other read-only roles have `read`.
- **API** (`/tally/imports`).
  - Upload: up to 10 files of 50 MB each. A zip may expand to at most 200 MB per XML file and 400 MB in all, checked
    before anything is decompressed. It reads and stages only.
  - Read the import, its rows (filtered and paged), and set decisions.
  - Commit and discard.
- **Matching** proposes an action for each record, tried in this order:
  - the Tally GUID linked by an earlier import (unchanged, or update when the ALTERID is newer);
  - for parties, the GSTIN, then the PAN, then the exact name;
  - for other masters, the exact name or code, with common unit spellings treated as one (Kgs = KG).

  It also handles these cases:
  - **Ambiguity or a different classification:** a conflict, which blocks commit until decided.
  - **Tax ledgers:** proposed as skip, because PR 2 maps them to the posting ledgers.
  - **An invalid GSTIN:** a conflict; choosing Create makes the party without it.
- **Commit.**
  - One transaction under the accounting lock, so either everything is written or nothing is.
  - Groups are created under their parents, and party ledgers become customers or suppliers on the bill-wise
    sub-ledger.
  - A link marks the party with its new role, and fills a missing GSTIN, PAN, credit days or email. It never
    overwrites them.
  - Every GUID is recorded.
- **Screens.**
  - Accounts → Tally import explains the export steps and takes the upload.
  - The preview has summary cards by kind, filters, search and a decision for each record (create, link to a
    candidate or any record, skip).
  - Import stays disabled while conflicts are open.

## Deviations from the design

- **No raw files kept.** Uploaded files are not copied to storage. Each import keeps the file names, sizes and
  SHA-256 hashes, plus every parsed object in `tally_staged`, which is the audit trail.
- **Seeding the chart.** The read and the commit now seed the standard chart. The browser walkthrough found a new
  workspace had no groups until Accounting setup was opened.
- **Stock groups.** They are recorded but not created, because FactoryOS has no item groups. New items are created as
  raw material, with a note.

## Verification

- **Unit tests.** 19 tests for the parser (encodings, zip and its size limit, control characters, amounts, masters,
  negative stock, classification); 168 tests in core in total.
- **Permission tests.** Updated in `packages/auth`.
- **`smoke-tally.mjs`**, 8 checks over 45 requests:
  - staging writes nothing;
  - the proposals, and the commit's results;
  - re-importing the same export changes nothing;
  - a newer ALTERID updates and a new ledger is added;
  - a GSTIN link, with no duplicate;
  - an invalid GSTIN and same-name parties are conflicts, and decisions are validated;
  - a failed commit leaves nothing and the import stays open;
  - another workspace sees nothing, and closed imports stay closed.
- **`e2e/tally.mjs`**, desktop and 390 px:
  - upload and preview;
  - a conflict blocks Import until decided, then Import;
  - re-uploading proposes nothing new;
  - no sideways scroll.
- **Regression**, run locally against the built API and web app (`node --env-file=.env apps/api/scripts/<smoke>` and
  `node e2e/<name>.mjs` from `apps/web`):
  - 13 of 13 API smokes passed: tally, chart, accounting, accounting operations, settlements, bank charges, asset
    items, records, home, preferences, buying, selling and inventory.
  - 10 of 10 browser walkthroughs passed: tally, chart, accounting, walkthrough, selling, buying, records,
    create-from-lists, menu-home and inventory.
  - The UI audit covered 196 page views of 98 pages and found no layout problems. Its add-new guard flagged the Tally
    link-target lists in `lib/tally.ts`. These lists pick an existing record to link to, and creating a new one is
    the row's own Create action, so they are now allowed by name in `e2e/add-new-allow.json`. The guard passes.
  - After the review fixes (upload and zip limits, unit codes, the GSTIN lock, negative stock, the preview's page
    clamp), the core tests (168), `smoke-tally` and `e2e/tally` were run again on the rebuilt code, and all passed.

## Check against a real export (follow-up)

The user supplied a masters export and a Day Book export from their TallyPrime. These files are company-confidential.
They were read only inside the session's container, with throwaway scripts kept outside the repository that printed
counts and shapes, never names, GSTINs or amounts. Afterwards the local database that held the trial imports was
dropped and recreated. Neither the files nor any figures from them are in the repository. The fixtures reproduce only
the shapes found.

- **What worked as built:**
  - UTF-16 with a byte-order mark;
  - every object read with no warnings;
  - a valid GSTIN check on every party;
  - unit synonyms (Kgs, Nos, Sqm link to KG, NOS, SQM);
  - the invalid-GSTIN party offered as a decision;
  - re-import proposes nothing new.
- **Fixed, each with a test:**
  - **A primary group the company created** (empty parent) was unclassifiable, so everything under it needed a
    decision. Its classification now comes from Tally's `ISREVENUE` and `ISDEEMEDPOSITIVE` flags.
  - **Input tax ledgers under Duties & Taxes.** Tally files Input CGST and SGST under Duties & Taxes (a liability);
    FactoryOS keeps them under Input tax credits (an asset). A tax ledger with the same name now links instead of
    asking.
  - **Two party ledgers with one GSTIN.** The commit failed: FactoryOS keeps one party per GSTIN, but the link table
    allowed one Tally ledger per FactoryOS record. Migration 0055 lifts that rule for parties only, so both ledgers link
    to the one party (their balances and vouchers need it in PR 2 and PR 3). The other kinds keep it. The preview
    notes the shared GSTIN.
  - **An item with Tally's "Not Applicable" unit** was proposed as new and then failed at commit. It now reads as no
    unit and needs a decision. Create is refused for it, and an item whose unit is neither in the export nor in
    FactoryOS is flagged in the preview.
  - **Masters repeated within one export** were already handled. The warning no longer says they came from more than
    one file.
- **After the fixes**, the real masters export staged with the invalid-GSTIN party and the unit-less item as the only
  decisions. It committed in about a second, and a re-import proposed nothing new.
- **Day Book, for PR 3.** The vouchers read without warnings. Every ledger and stock item they use is in the masters
  export, and every voucher balances to the paisa. In invoice-mode vouchers the sales or purchase ledger amount sits
  inside the inventory lines (`ACCOUNTINGALLOCATIONS.LIST`), not in the ledger lines; PR 3 must read both.
- The `.001` file the user sent is a Tally backup segment, which is not readable, as the design says.

## Not in this PR

- Opening balances and stock (PR 2), and voucher history and the history screens (PR 3).
