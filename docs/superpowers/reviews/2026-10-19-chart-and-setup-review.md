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

RESULTS

## Minor, not fixed

- **Swapping two roles' ledgers.** Swapping needs a spare ledger in between, because each dropdown leaves out ledgers
  the other roles use. The API refuses a shared ledger either way.
- **Ledger codes.** Codes stay as seeded (`INPUT_CGST`). Renaming codes was out of scope in the design.
