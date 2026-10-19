# Chart of accounts and Accounting setup clean-up — review (decision 071)

Build of the [design](../specs/2026-10-19-chart-and-setup-design.md), approved by the user on 2026-10-19 by merging the
claim (PR 60).

## What was built

- **Standard group tree** (`apps/api/src/modules/accounting/chart.ts`).
  - `STANDARD_GROUPS` lists Tally's groups with their parents.
  - `seedChart` creates any missing standard group from one read of the entity's groups. A new group gets its
    standard parent; an existing group keeps wherever people moved it.
  - Default ledgers move:
    - input GST and RCM-pending ledgers to "Input tax credits" under Current Assets;
    - TDS receivable and TCS recoverable to Loans & Advances (Asset);
    - Service purchases to Purchase Accounts.
- **Migration `0053_chart_groups`** (data only). For each entity that has groups, in this order, it:
  - renames the asset-side "Duties & Taxes" group in place, or merges it into an existing "Input tax credits" group;
  - adds the missing standard groups;
  - sets standard parents on groups that have none;
  - moves default ledgers that are still in their seeded group.
- **Settings read.** `GET /accounts/settings` also returns `roleRoots`, the classification each posting role needs.
- **Chart screen.**
  - One tree under five classifications, with collapsible groups and ledger counts.
  - Search by name, code, group or role, with a classification filter and "Show inactive".
  - "Used for: …" badges in plain words.
  - "Add ledger" and "Add sub-group" on each group, and edit in place.
  - No sideways scroll at 390 px.
- **Setup screen.**
  - Posting accounts in six sections, each role with a plain label and a hint.
  - Options are grouped by group and shown as "Name · CODE". A dropdown offers only active ledgers of the role's
    classification that no other role uses; the current choice is always shown.
  - A loading message replaces the empty grid.
  - The pre-activation note is hidden once books are active.
  - The worksheet cards and buttons are spaced again: the fieldset used `display: contents`, which cancelled the
    spacing.
- **Shared labels.** `apps/web/src/lib/posting-roles.ts` holds the role labels, hints, sections and classification
  names. A role the API adds later still shows, under "Other roles".

## Deviations from the design

- **Before activation.** The design proposed a "ledgers are created at activation" message. The settings read already
  creates the chart before activation; the empty card in the first walkthrough was the loading state. It now shows a
  loading message. The design doc is corrected.
- **Pending supplier returns** stays directly under Current Assets. The design moved only the ledgers it listed.

## Verification

- **`smoke-chart.mjs`**, 8 checks:
  - the tree and default-ledger placement for a new entity;
  - `roleRoots`;
  - a refused shared or wrong-type mapping;
  - receipts through a sub-group of Bank Accounts;
  - migration 0053 on an entity rebuilt to the old flat groups: the same tree as a new entity, with ledger ids,
    mappings and entries unchanged;
  - the collision case, where an existing "Input tax credits" group gets the merged ledgers and the old group stays
    empty;
  - both migration runs are rolled back.
- **Migration on the local database.** 969 entities migrated. A hash of all ledger ids and codes, all mappings, and
  every `gl_entry` id and count is identical before and after. Every entity has at least the 27 groups, and no
  asset-side "Duties & Taxes" remains.
- **`e2e/chart.mjs`**, desktop and 390 px:
  - setup sections, labels, hints and filtered, grouped options;
  - chart classifications, search, filter and collapsing;
  - adding a sub-group and a ledger from a group;
  - no sideways scroll.
- **API smokes, all pass.**
  - accounting: accounting, operations, baseline, opening FX, imports;
  - money and documents: settlements, bank charges, asset items, records, supplier notes, sales notes and returns;
  - other: maintenance, home, buying, selling, inventory.
- **Browser walkthroughs, all pass.** accounting, settlements, bank charges, bank reconciliation, walkthrough, selling,
  buying, imports, records, create-from-lists, menu-home, manufacturing, maintenance.
- **UI audit.** 194 page views, 0 overflow, 0 console errors, 0 failed requests; the add-new guard is clean.
- **Build checks.** Typecheck passes 20 tasks, build passes 12 tasks, and unit tests pass.

## Minor, not fixed

- **Swapping two roles' ledgers.** Swapping needs a spare ledger in between, because each dropdown leaves out ledgers
  the other roles use. The API refuses a shared ledger either way.
- **Ledger codes.** Codes stay as seeded (`INPUT_CGST`). Renaming codes was out of scope in the design.
