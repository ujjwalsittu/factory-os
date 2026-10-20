# Tally import, PR 3 (voucher history and re-sync) — review (decision 072)

The last of three PRs in the [design](../specs/2026-10-20-tally-import-design.md#pr-3-voucher-history-and-re-sync).

## What was built

- **Reading vouchers.** Core reads vouchers from a Day Book export: type, number, date, narration, party, flags, ledger
  lines with bills, and stock lines with godown and batch.
  - Invoice-mode vouchers keep their ledger amounts inside the inventory entries; these become ledger lines.
  - Empty inventory shells that Tally writes are dropped, keeping their accounting allocations.
  - The party comes from the party line when the voucher has no party name.
  - Side comes from the amount's sign, which Tally keeps reliable, rather than `ISDEEMEDPOSITIVE`.
- **Staging and re-sync.** Voucher rows are matched by GUID:
  - same ALTERID → unchanged;
  - newer ALTERID → update, replacing the voucher's lines;
  - deleted, or no GUID or date → skip;
  - unbalanced → a conflict that can only be skipped;
  - cancelled and optional vouchers are kept with a note.
- **History tables (migration 0057).** `tally_voucher` and `tally_voucher_line`, scoped by tenant and entity, unique
  by entity and GUID. Lines link to the account or party their Tally ledger was linked to, including by names used in
  earlier imports, so a party renamed in Tally still links. Inserts run in chunks of 500, and the commit writes an
  audit entry.
- **Never posted.** Nothing reaches the general ledger, GST, e-invoicing or stock, and nothing is ever deleted.
- **Not in this export.** The preview lists linked masters of the kinds in the upload that it lacks, and history
  vouchers in the upload's date range that it lacks, with a sample of each.
- **API.** `GET /tally/vouchers` (dates, type, text, account, party, paging, and the list of types) and
  `GET /tally/vouchers/:id`, under `accounts.tally.read`.
- **Screens.**
  - Accounts → Tally history: the Day Book and a voucher page with ledger lines (linked to FactoryOS or "Not linked")
    and stock.
  - "History from Tally" on ledger and party pages.
  - The import page explains the Day Book export, shows what is not in this export, says in the confirm dialog how many
    vouchers become history, and links to the history after import.
  - The preview shows each voucher's debit total, summed on the server.

## Verification

- **Core tests** pass (172), including two for vouchers: invoice-mode lines, shells, bills, batches, the party line,
  cancelled vouchers and the balance check.
- **`smoke-tally.mjs`**, 14 checks. The new check covers:
  - the trial balance is unchanged by history;
  - lines link to their party and account;
  - the date, type, text, ledger and party filters;
  - a re-import is unchanged;
  - a newer ALTERID updates the lines;
  - a missing voucher and a missing ledger are listed and nothing is deleted;
  - another workspace cannot read the history.
- **`e2e/tally.mjs`**, desktop and 390 px. A Day Book upload is imported, the history and the voucher page show,
  the voucher links its party, and the party page shows its Tally history. The history fits a phone.
- **Real export.** The user's real masters and Day Book went through in a throwaway local workspace. The scripts
  printed only counts and yes/no results; the local database was dropped afterwards, and nothing from the exports is
  in the repository.
  - Every voucher read balanced and was proposed as new. The only note was one optional voucher.
  - Reading and committing each took about a second.
  - The general ledger was unchanged.
  - 93% of lines linked to FactoryOS. The rest are Tally ledgers that were not imported as masters: skipped in the
    trial, or tax ledgers that FactoryOS maps by duty head.
  - Vouchers whose party is a real party linked it in all but two cases, both from masters the trial skipped. Where
    Tally names a bank or cash ledger as the party, it links as an account.
  - A second import of the same Day Book was all unchanged, with nothing missing.
- **Regression**, run locally against the built API and web app on a fresh database:
  - 13 of 13 API smokes passed: tally, chart, accounting, accounting operations, settlements, bank charges, asset
    items, records, home, preferences, buying, selling and inventory.
  - 10 of 10 browser walkthroughs passed: tally, chart, accounting, walkthrough, selling, buying, records,
    create-from-lists, menu-home and inventory.
  - The UI audit passed.
  - `pnpm typecheck` and `pnpm build` pass.

## Not in this PR

- Posting history into the books. History is for reference; the books start at the cut-over.
- Pulling from Tally over its HTTP port. Re-sync is by uploading a newer export.
