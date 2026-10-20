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
  - Upload: up to 20 files of 100 MB each. It reads and stages only.
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

- **Unit tests.** 17 tests for the parser (encodings, zip, control characters, amounts, masters, classification);
  166 tests in core in total.
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
- **Regression.** RESULTS

## Not in this PR

- Opening balances and stock (PR 2), and voucher history and the history screens (PR 3).
- **Real Tally export.** The fixtures are hand-written to Tally's schema. One real export from the user's Tally is
  still needed before merging, to check the parser against their release.
