# Chart of accounts and Accounting setup clean-up — design (decision 071)

The user reported on 2026-10-19 that Accounting setup and the chart of accounts are "completely messed up". A
walkthrough of a fresh entity, before and after activation, found problems in both the seeded data and the two
screens. This design fixes both. There is no posting change, no new permission and no schema change. One migration
updates existing data only.

## What is wrong today

**Seeded groups** (`apps/api/src/modules/accounting/chart.ts`):

- Groups are created only for the default ledgers, so a new entity has 14 groups. All of them are top level and none
  has a parent.
- "Duties & Taxes" exists twice: once with an asset root (input GST) and once with a liability root (output GST, RCM,
  TDS and TCS payable).
- Tally's standard groups that people expect are missing. These are Purchase Accounts, Direct Incomes, Indirect
  Incomes, Loans (Liability), Provisions, Investments, Deposits, Loans & Advances and Reserves & Surplus. With no
  Purchase Accounts group, "Service purchases" was put under Direct Expenses.

**Chart of accounts screen:**

- About 50 ledgers appear in one flat list sorted by code, with no hierarchy.
- The groups appear in a separate table below the ledgers.
- Codes and roles are shown raw, for example `CUSTOMS_CLEARING` and `input_cgst`.
- There is no search and no filter.

**Accounting setup screen:**

- Before activation, the "Posting accounts" card holds only a Save button, because the chart does not exist yet.
- After activation it shows about 45 dropdowns in no order, labelled with raw role names such as "rcm cess".
- Each dropdown lists every active ledger, including ones of the wrong classification.
- The cut-over text still says "…before activating" after activation.
- The worksheet buttons overlap the last card.

## Data: the standard group tree

`seedChart` first creates the standard groups for the entity, then the default ledgers. The tree below follows Tally.
The root is our classification, and a parent always has the same root as its child, which the API already enforces.

| Root | Primary group | Sub-groups |
|---|---|---|
| equity | Capital Account | Reserves & Surplus |
| liability | Loans (Liability) | Bank OD A/c, Secured Loans, Unsecured Loans |
| liability | Current Liabilities | Duties & Taxes, Provisions, Sundry Creditors |
| liability | Suspense A/c | — |
| asset | Fixed Assets | — |
| asset | Investments | — |
| asset | Current Assets | Bank Accounts, Cash-in-Hand, Deposits (Asset), Loans & Advances (Asset), Stock-in-Hand, Sundry Debtors, **Input tax credits** |
| income | Sales Accounts | — |
| income | Direct Incomes | — |
| income | Indirect Incomes | — |
| expense | Purchase Accounts | — |
| expense | Direct Expenses | — |
| expense | Indirect Expenses | — |

Ledger moves:

- **Asset-side "Duties & Taxes" becomes "Input tax credits"** under Current Assets. In Tally, input GST sits in the
  liability-side Duties & Taxes group with a debit balance. Our model gives a group one root, so the asset ledgers need
  their own group. Input CGST, SGST, IGST and CESS move there. So do the four "RCM credit pending" ledgers, which today
  sit directly under Current Assets.
- **Service purchases** moves to Purchase Accounts.
- TDS receivable and TCS recoverable move to Loans & Advances (Asset), as in Tally practice.
- All other default ledgers keep their group. Their groups get parents, for example Sundry Debtors under Current Assets.

Branch / Divisions and Misc. Expenses (Asset) are left out. Divisions are legal entities here, and the second group is
obsolete under current schedules.

**Existing entities.** Migration `0053_chart_groups` changes data only, and it runs once for each entity that already
has groups. It:

- adds the missing standard groups;
- sets the parent of standard-named groups that have no parent and the right root;
- renames the asset-root "Duties & Taxes" group (key and name) to "Input tax credits";
- moves the default ledgers listed above, matched by their role, only while they are still in the seeded group.

It does not touch groups or ledgers that people created, or any group or ledger they have already moved. The migration
does not change `gl_entry`, mappings or ledger ids.

**Why this is safe.**

- Reports (trial balance, ledger, day book) do not read groups.
- Cash and bank checks walk up the parents by group name ("Bank Accounts", "Cash-in-Hand"), so nesting keeps them
  working.
- The bank-charge tax check refuses ledgers under the control groups, and it walks the parents the same way.

## Chart of accounts screen

- **One tree.** It has five sections (Assets, Liabilities, Equity, Income, Expenses), with groups nested under each
  and ledgers under their group. Every group shows its ledger count and collapses.
- **Ledger rows.** Each row shows the name, with the code in muted text. A ledger that a posting role uses shows a
  plain-language badge, for example "Used for: Input CGST" or "Used for: Goods received not invoiced". A short note
  explains that these ledgers receive automatic postings.
- **Search and filters.** A search box matches name, code or group and keeps the matching path open. There are root
  filter chips and a "Show inactive" toggle.
- **Actions.** "Add ledger" and "Add sub-group" on each group pre-fill the group or parent. The existing edit dialogs
  are kept.
- **Phone.** At 390 px the same tree shows without sideways scrolling.

## Accounting setup screen

- **Posting accounts in sections.**
  - Cash and bank
  - Sales and receivables
  - Purchases and payables
  - GST and other taxes
  - Stock and production
  - Other adjustments
  - Each role has a plain label and a one-line hint.
- **Dropdown options.**
  - Each role's dropdown lists only active ledgers of the classification the role requires; the API already refuses
    other ledgers.
  - Options are grouped by group and show as "Name · CODE".
  - The settings read returns each role's required classification, so the web does not keep its own copy.
- **Before activation:** the card explains that the default ledgers are created at activation, and that roles can then
  be changed.
- **Status text and layout.**
  - After activation, the cut-over card shows only the activation line.
  - The worksheet actions get their own row and no longer overlap the cards.

## Not changed

- Posting logic and the role list.
- Permissions, and the five-root classification.
- Ledger codes and journal screens. A future change could rename the raw codes; this one doesn't.

## Verification

- A new `smoke-chart.mjs` script checks:
  - the tree for a new entity;
  - that the migration's backfill on an entity with the old flat groups keeps ledger ids, mappings and entries;
  - that cash, bank and bank-charge checks still pass and fail as before.
- `e2e/accounting.mjs` is updated for the tree.
- A new walkthrough covers the chart and setup on desktop and at 390 px, including search, filters and sections.
- The usual regression:
  - accounting, settlement and bank-charge smokes;
  - the UI audit and the add-new guard;
  - typecheck, build and tests.
