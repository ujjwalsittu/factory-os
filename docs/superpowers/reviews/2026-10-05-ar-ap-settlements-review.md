# AR/AP settlements: implementation review and verification

Implements decision 036 per `docs/superpowers/specs/2026-10-05-ar-ap-settlements-design.md` and
`docs/superpowers/plans/2026-10-05-ar-ap-settlements.md`. Migration `0011_settlements`.

## What was built

- **Bill subledger** (`trade_bill`, `trade_bill_effect`, append-only by database trigger): opening bills from the
  reviewed worksheet; every GL line on a debtor/creditor control (current or historical mapping) becomes exactly one
  effect keyed by its GL entry, so the subledger reconciles with the GL by construction. Reversal lines negate the
  original effect on the same bill. Manual journal lines adjust an exact, unambiguous INR bill; anything else is a
  visible journal-origin item.
- **Receipts and payments** (`party_settlement`): one party/currency/cash-or-bank account; explicit allocations at each
  bill's INR carrying value (exact proportion, final allocation takes the remainder); exchange difference to the FX
  account; excess held on account as an `advance` bill. Numbers `RCT` / `PAY`.
- **Later allocation** (`settlement_allocation_document`, number `ADJ`): applies on-account money without moving cash;
  same-account, equal-value applications record a no-value disposition instead of an artificial journal.
- **Guards**: an invoice, journal or receipt can't be cancelled while anything still settles against what it created
  (checked inside `GlPostingService.reverseIn`, so every cancel path is covered); cancellation negates recorded values
  at the current business date; settlement submits re-check reconciliation and fail on any GL/subledger difference.
- **Reports**: outstanding (as-of, side, party, currency, overdue, MSME) with ageing buckets, on-account balances,
  CSV export, and per-party GL vs subledger reconciliation. Selling credit checks use the real net position when books
  are active (decision 032 override unchanged); inactive entities keep the old basis.
- **Web**: Accounts → Receipts & payments (list, form with "oldest due first" suggestion, live server preview,
  on-account panel, cancel), Accounts → Outstanding (receivables, payables, reconciliation), ⌘K actions.

## Deviations from the plan (deliberate, for the reviewer)

1. Five tables, not six: allocation evidence lives in `trade_bill_effect` (source, origin key, reversal link) rather
   than a separate `settlement_allocation_effect` table. Same immutability and uniqueness guarantees.
2. Bill effects are derived by an idempotent `syncIn` (under the entity accounting lock) at the start of every
   settlement, report, credit check, journal submit and cancellation, instead of a hook in each invoice lifecycle.
   Because effects come from posted GL lines, a source can't be missed or double-counted. Initialisation is the first
   sync (`trade_subledger_state`).
3. Manual journals have no separate "against / new / on account" selector: the bill reference is the choice. A
   reference that matches one INR bill adjusts it (never below zero); a foreign bill or ambiguous reference is refused;
   any other reference becomes a new journal-origin item. A structured selector can be added in the journal form later.
4. Sub-paisa conversion residue is absorbed in the FX line rather than posted to a separate rounding line.
5. Purchase/sales invoice screens don't yet show their own remaining balance; the Outstanding report does.
6. Upgrade, concurrency and lifecycle cases are in one suite (`smoke-settlements.mjs`) rather than three files.
7. No separate whole-branch reviewer agent was run; this file is a self-review. A fresh review by another agent or
   the user is recommended before production use.

## Verification (2026-10-05, local, API :4000 / web :3000)

- `pnpm test`: 55 unit tests (7 new settlement arithmetic cases). `pnpm build` 11/11. `pnpm typecheck --force` 16/16
  (one earlier cached run reported a transient partial result during a concurrent rebuild; the uncached run is clean).
  `pnpm lint` executes zero tasks (no lint configured).
- `smoke-settlements.mjs`: 91 checks — partly settled USD opening bill (USD 60 / ₹4,800 of 100), receipt FX gain ₹120,
  overpayment to on-account, later allocation ₹8,300 vs ₹8,000 in two steps (₹300 gain), same-value no-journal
  allocation, cancellation dependencies, concurrent submits for the same bill (exactly one wins), journal over-reduction
  and foreign-bill refusal, MSME partial payment, ageing/export, credit exposure from books, zero reconciliation diff.
- All 8 existing accounting suites and 6 operational suites pass unchanged.
- Browser: `e2e:settlements` plus accounting, selling, buying, imports, base, inventory and customer-material walkthroughs
  pass. Two UI defects found and fixed: stale cached bill list in the picker; submitted receipt showing ₹0 allocated.

## Not done (still deferred by decision 036)

TDS/TCS, bank reconciliation and charges, credit/debit notes, cross-party netting, cross-currency allocation,
RCM tax settlement, foreign-currency bank subledger.
