# Tally import, PR 2 (opening balances and stock) — review (decisions 072 and 073)

The second of three PRs in the [design](../specs/2026-10-20-tally-import-design.md#pr-2-opening-balances-and-stock).
The user started it on 2026-10-20 and chose the rules for the awkward cases, recorded as decision 073.

## What was built

- **Staging.** A masters export already carries opening balances and opening stock. The import now stages two more
  kinds, which follow the masters' proposals:
  - **Opening balances**, one row per ledger with a balance or bill-wise openings.
  - **Opening stock**, one row per item, with its quantity and value by godown and batch.
  - Migration 0056 widens the staged-kind check; nothing else in the schema changes.
- **Where each balance goes.**
  - A GL ledger's balance goes to the ledger it links to or is created as.
  - A tax ledger that is not imported goes to the posting ledger for its duty head and side: a CGST ledger with a debit
    balance goes to Input CGST, and with a credit balance to Output CGST. SGST, IGST and cess work the same way, TDS
    goes to TDS payable or receivable, and TCS to TCS payable or recoverable. Both of Tally's duty-head spellings are
    read: "CGST" and "Central Tax".
  - Tally's Profit & Loss A/c goes to a "Profit & Loss A/c" ledger under Reserves & Surplus, created if missing.
  - A stock ledger under Stock-in-Hand is proposed as skip when items carry opening stock, so stock is not counted
    twice.
  - A ledger that is not imported and has no tax mapping needs a decision: send its balance to a chosen ledger, or skip
    it.
- **Parties.** Tally's bill-wise openings become outstanding bills. The part of a balance not covered by bills, or the
  whole balance of a party without bill-wise details, becomes an "On account" bill. Each bill is one worksheet line on
  the trade control for its side, which is what the cut-over reconciliation checks. Two Tally ledgers for one party
  merge bills with the same reference.
- **Stock.** One draft stock receipt per godown, dated on the day of the import. Each line is item, batch, quantity and
  rate, where the rate is value ÷ quantity kept to six decimals. The worksheet's Inventory line is the sum of the same
  quantity × rate products, so submitting the drafts reconciles to the paisa. Batch-tracked items keep Tally's batch,
  and Tally's "Primary Batch" means no batch. A later import rewrites a draft that is still a draft. Once a draft is
  submitted, its rows are proposed as skip.
- **Rules from decision 073.**
  - Negative stock is a decision that can only be skipped.
  - An unbalanced opening is booked to "Opening difference (Tally)" under Suspense A/c. The commit names the amount and
    refuses until the user accepts exactly that amount.
  - The import replaces the worksheet's lines and bills, keeps settlements and receipt baselines, and warns first.
- **Closed after activation.** Opening rows are proposed as skip with a note. Forcing one in is refused at commit
  (409).
- **Screens.**
  - The preview has an "Opening balances and stock" card: ledger balances, stock value, the difference, the worksheet
    warning, and after import links to the stock drafts and Accounting setup.
  - Opening rows use Include, To ledger and Skip.
  - The confirm dialog keeps Import off until a non-zero difference is accepted. `FormDialog` gained an optional
    `submitDisabled` for this.

## Verification

- **`smoke-tally.mjs`**, 12 checks; these are new or extended:
  - the worksheet gets the GL, tax and inventory lines, and the bills per party;
  - one draft receipt per godown, with batches and rates;
  - a re-import rewrites the same worksheet and the same drafts;
  - submitting the drafts gives a clean reconciliation, and accounting activates;
  - after activation, openings are refused;
  - negative stock can only be skipped;
  - the Profit & Loss A/c goes to Reserves & Surplus;
  - the difference must be accepted at exactly its amount.
- **`e2e/tally.mjs`**, desktop and 390 px. The openings card shows. An unbalanced export shows the difference and the
  worksheet warning, and Import waits for the checkbox.
- **Core tests** pass (170). `pnpm typecheck` passes (20 tasks).
- **Real export.** The user's real masters export went through the whole cut-over in a throwaway local workspace:
  read, decide, commit, submit the stock draft, reconcile with no differences, and activate. The scripts printed only
  counts and yes/no results. The local database was dropped afterwards, and nothing from the export is in the
  repository. Tally's own openings balance exactly, ledgers plus stock. A difference appears only when the user skips
  something: in this trial, the negative-stock items and a ledger with no mapping.
- **Regression**, run locally against the built API and web app on a fresh database:
  - 13 of 13 API smokes passed: tally, chart, accounting, accounting operations, settlements, bank charges, asset
    items, records, home, preferences, buying, selling and inventory.
  - 10 of 10 browser walkthroughs passed: tally, chart, accounting, walkthrough, selling, buying, records,
    create-from-lists, menu-home and inventory.
  - The UI audit passed: 196 page views of 98 pages, and the add-new guard is clean.

## Not in this PR

- Voucher history and re-sync of history (PR 3).
