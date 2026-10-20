# Tally import and re-sync from XML exports — design (decision 072)

The user asked on 2026-10-20 to import their Tally data, sync all of it, avoid duplicates and handle it carefully.
Decisions 008 and 019 already approve a Tally import and ongoing sync; [doc 12](../../12-tally.md) describes it. The
user chose:

- **Input:** TallyPrime's XML export files, uploaded in FactoryOS. A Tally backup (the company data folder, `.tbk` or
  `.zip`) is a proprietary binary format and cannot be read reliably, so it is not an input.
- **Scope:** masters, opening balances, historical vouchers, and re-sync from later exports.
- **Duplicates:** match first, show a dry-run preview, write nothing until the user confirms. A matched record is
  linked, never copied.

The live connection to Tally's XML server through the edge agent (doc 12 §1) is not in this design. It can feed the
same import engine later.

## What the user exports from Tally

TallyPrime: **Export → Masters** (All Masters) and **Export → Transactions → Day Book** for the period wanted. In
both, choose format **XML (Data Interchange)**. The user uploads the files, or a `.zip` of them, into **Accounts →
Tally import**. A help panel on that page shows these steps.

Tally writes XML as UTF-16 or UTF-8, with an `ENVELOPE` of `TALLYMESSAGE` elements. Each element is one master
(`GROUP`, `LEDGER`, `STOCKGROUP`, `STOCKITEM`, `UNIT`, `GODOWN`, `VOUCHERTYPE`) or one `VOUCHER`. Every object carries
a stable `GUID`, plus an `ALTERID` that grows each time the object is edited.

## How an import runs

1. **Upload.** Files go to the existing storage service. One import belongs to one legal entity (the active one).
2. **Read.** A streaming parser (no full-file DOM, so a few hundred MB fits in memory) reads each object into a
   staging row. Rules:
   - amounts are kept as exact decimal strings;
   - Tally's sign (negative is debit) is turned into a debit/credit side;
   - dates are `YYYYMMDD`.
   Anything the parser does not understand is listed as a warning and never dropped silently.
3. **Match.** Every staged object gets one proposed action: **new**, **link** (an existing FactoryOS record), **update**
   (linked before, with a newer `ALTERID`), **unchanged** (same `ALTERID` as last time) or **conflict** (needs a
   choice). Matching is tried in this order:
   1. The Tally GUID already linked to a FactoryOS record from an earlier import. This makes re-sync idempotent.
   2. For parties: the GSTIN, then the PAN.
   3. An exact name match, ignoring case and extra spaces. For ledgers and items, the code or alias is tried too.

   More than one candidate, or a match whose classification differs (for example a Tally asset ledger against a
   FactoryOS expense ledger), is a **conflict**.
4. **Preview.** The dry run, with nothing written yet:
   - tabs for Masters, Opening balances and History, each listing counts by action;
   - every conflict with its candidates;
   - a reconciliation: the Tally trial balance against the opening worksheet, party totals against bill-wise
     outstanding, and stock value by godown.

   The user can change any proposed action (link to another record, create new, or skip), one by one or in bulk.
5. **Commit.** One database transaction, under the entity's accounting lock. Either all of it is written or none.
   The import records who committed it and when, and every link it made.

Re-importing a newer export repeats the same steps. Linked records with a higher `ALTERID` show as **update**,
unchanged ones are skipped, and new ones are added. Records missing from a newer export are never deleted; they are
listed as "not in this export" for the user to review.

## What each Tally object becomes

| Tally | FactoryOS | Notes |
|---|---|---|
| Company, GSTIN, state | checked against the legal entity and GST registration | A mismatch is a warning on the preview |
| Group | account group | Tally's reserved groups map to the standard tree (decision 071) by name and parent. Custom groups are created under their parent |
| Ledger under Sundry Debtors or Creditors | party (customer or supplier), with GSTIN, PAN, state, address, credit days | Parties share one control ledger with a bill-wise sub-ledger (decision 036), so no GL ledger is created per party |
| Bank, cash and other ledgers | GL ledger in the matched group | |
| GST and TDS ledgers (Duties & Taxes) | matched to the posting-role ledgers by tax type and side | Tally often uses one CGST ledger for input and output. The preview asks which FactoryOS ledger takes its opening balance |
| Stock group, unit, godown | item category, unit, warehouse | |
| Stock item | item, with HSN, GST rate, unit and batch tracking | |
| Ledger opening balances and bill-wise details | opening worksheet lines and outstanding bills | Only while accounting is not yet active. The existing cut-over reconciliation still has to pass before activation |
| Item opening stock by godown and batch | an opening stock entry per godown, saved as draft | Pre-activation only, like today's manual opening stock |
| Vouchers (Day Book) | read-only Tally history: voucher and lines | Kept apart from the general ledger, as in doc 12 §2. Never posted, never sent to GST or e-invoicing |

After accounting is active, an import can still add and update masters and history. Opening balances and opening
stock are refused, with a message saying the cut-over is closed.

## Data (migration 0054)

- `tally_import`: tenant, entity, files, Tally company and period, status (`read`, `previewed`, `committed`,
  `failed`), counts, created and committed by and when.
- `tally_staged`: one row per object in an import. It holds the kind, Tally GUID, `ALTERID`, name, parsed payload
  (JSONB), proposed and chosen action, matched FactoryOS id, and warnings. Rows are kept for the audit trail.
- `tally_link`: entity, kind, Tally GUID (unique per entity and kind), FactoryOS record id, last `ALTERID`, and the
  import that made the link. This is what prevents duplicates across imports.
- `tally_voucher` and `tally_voucher_line`: the history. Each voucher holds GUID, `ALTERID`, type, number, date,
  narration, party and amounts. Each line holds the ledger name and its linked FactoryOS ledger when known, the side,
  the amount and any bill allocations. A newer `ALTERID` replaces a voucher's lines inside the commit; the replaced
  version stays in `tally_staged`.

Every table carries `tenant_id` and `entity_id`.

## Permissions

| Permission | Allows |
|---|---|
| `accounts.tally.import` | Upload, preview, change actions and commit (Finance by default) |
| `accounts.tally.read` | View past imports and the Tally history (Finance and Accountant by default) |

## Screens

- **Accounts → Tally import.**
  - The export steps and an upload area.
  - Past imports with their status and counts.
  - An import's preview, with filters, bulk actions and the reconciliation.
- **Tally history.**
  - A Day Book of imported vouchers, by period and voucher type.
  - Each voucher's lines.
  - Linked from the ledger and party pages: "History from Tally".

## Built in three PRs, each verified on its own

1. **Masters.** Parser, staging, matching, preview, commit and links, for groups, ledgers, parties, units, godowns,
   stock groups and items.
2. **Opening balances and stock.** Into the opening worksheet and draft opening stock entries, with the
   reconciliation in the preview.
3. **History and re-sync.** Vouchers, the update and "not in this export" handling, and the Tally history screens.

## PR 2: opening balances and stock

Decision 073 records the user's choices for the awkward cases. Opening balances and stock are imported only while
accounting is not active; afterwards their rows are proposed as skip with a note, and only skip is allowed.

- **Ledger balances** become opening worksheet lines.
  - A GL ledger's balance goes to the ledger it was linked to or created as.
  - A tax ledger that FactoryOS skipped as a master goes to a posting ledger chosen by duty head and side: a CGST
    ledger with a debit balance goes to Input CGST, with a credit balance to Output CGST, and the same for SGST, IGST
    and cess. A TDS ledger goes to TDS payable or TDS receivable. Anything else needs a decision: pick a ledger or
    skip.
  - Tally's Profit & Loss A/c goes to a "Profit & Loss A/c" ledger under Reserves & Surplus, created if missing.
  - A ledger whose master was skipped needs a decision: pick a ledger to take its balance, or skip it.
- **Party balances** become outstanding bills, one worksheet line per bill on the trade control that matches the
  bill's side (debit bills on Trade receivables, credit bills on Trade payables), which is what the cut-over
  reconciliation checks. Tally's bill-wise openings give the bills; any part of the balance not covered by bills, and
  the whole balance of a party without bill-wise details, becomes an "On account" bill.
- **Opening stock** becomes one draft stock receipt per godown, dated on the day of the import, with a line per item
  and batch at Tally's value (rate = value ÷ quantity, kept to six decimals). The user reviews and submits the drafts;
  submitting them is what the cut-over's inventory check counts. The worksheet's Inventory line is the total of those
  lines. Negative quantities need a decision (skip). On a later import, a draft that is still a draft is rewritten;
  one already submitted is left alone, and its rows are proposed as skip with a note.
- **The difference.** Ledger balances plus stock should balance. If they do not, the preview shows the amount, and the
  commit asks the user to accept it. It is booked to "Opening difference (Tally)" under Suspense A/c.
- **The worksheet.** An import with opening balances replaces the worksheet's lines and bills. Settlements and receipt
  baselines are kept. The preview warns when the worksheet already has lines.
- **Data.** Migration 0056 adds the staged kinds `opening` and `stock`. Nothing else changes in the schema.

## PR 3: voucher history and re-sync

- **What is read.** Tally's Day Book export, which may also carry masters. Each voucher keeps its GUID, ALTERID,
  type, number, date, narration, party, cancelled and optional flags, ledger lines with bill allocations, and stock
  lines with godown and batch. Invoice-mode vouchers carry their ledger amounts inside the inventory entries; those
  are read as ledger lines. Tally's empty inventory shells are dropped. Side comes from the amount's sign.
- **Staging.** A voucher row is proposed as new, update (newer ALTERID), unchanged (same ALTERID) or skip (deleted, or
  no GUID or date). An unbalanced voucher is a conflict that can only be skipped. Cancelled and optional vouchers are
  kept and noted.
- **Data (migration 0057).** `tally_voucher` (unique per entity and GUID) and `tally_voucher_line`, both tenant- and
  entity-scoped. Lines link to the FactoryOS account or party that the Tally ledger was linked to, by the link table
  and by names used in earlier imports (so a renamed party still links). An update replaces the voucher's lines.
- **Never posted.** History never reaches the general ledger, GST, e-invoicing or stock. Nothing is deleted.
- **Not in this export.** The preview lists linked masters of the kinds in the upload that the upload lacks, and
  history vouchers within the upload's dates that it lacks. They are shown, never deleted.
- **Screens.** Accounts → Tally history: the Day Book with date, type and text filters, and a voucher page with its
  ledger lines and stock. Ledger and party pages show "History from Tally" with their latest vouchers.

## Verification

- **Hand-written fixtures** following Tally's XML schema: UTF-8 and UTF-16, reserved and custom groups, parties with
  and without GSTIN, a CGST ledger used for both sides, batches, bill-wise openings, and voucher types.
- **Real export check.** The user is asked for one real export, which can be anonymised, before PR 1 is merged.
- **Smoke tests:**
  - importing the same files twice creates nothing the second time;
  - a newer `ALTERID` updates;
  - conflicts block commit until resolved;
  - a failed commit leaves nothing;
  - opening balances are refused after activation;
  - history never reaches the general ledger or GST.
- **Browser walkthrough** on desktop and at 390 px. The usual regression and UI audit.

## New dependency

A small streaming XML parser (`saxes`, MIT, no dependencies). Node has no built-in XML parser.

## Not in this design

- The live link to Tally through the edge agent.
- FactoryOS → Tally export, and the CA journal review queue (doc 12 §3).
- Payroll, cost centres and order vouchers. Order vouchers are kept as history only.
