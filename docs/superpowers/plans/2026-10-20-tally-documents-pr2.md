# Tally transactions as documents, PR 2 — plan (decisions 075, 075a, 075b)

Builds PR 2 of the [design](../specs/2026-10-20-tally-transactions-design.md) on top of
[PR 1](2026-10-20-tally-documents-pr1.md): receipts, payments, journals and stock journals from months kept in Tally,
and one reversal of Tally documents, used both to re-sync an edited voucher and to switch a month back to FactoryOS.

## Choices (decision 075b, 2026-10-20)

- **Delivery notes and receipt notes stay history.** The invoice moves the stock, as in PR 1, so goods never move twice.
- **Bill allocations are matched by reference.** An "Agst Ref" on a receipt or payment settles the party's open
  FactoryOS bill with the same reference (an invoice from Tally or an opening bill). Anything unmatched, "New Ref",
  "Advance" and "On Account" stays on account for that party.
- **Switching a month back is refused while a later document depends on it.** The message names each dependent
  document; with none, every Tally document in the month is reversed together, after a warning that lists them.

## Reuse, not copies

- **Receipts and payments:** the settlement service (`partySettlement`), with Tally's number and date. The bank or cash
  account comes from the ledger link and must be a cash or bank ledger.
- **Journals and contra:** the journal voucher service, with ledgers through their links and party lines carrying the
  party and bill reference, so the bills subledger picks them up as it does for a manual journal.
- **Stock journals:** a transfer when every line moves the same items between godowns; otherwise an adjustment out of
  the consumed lines and an adjustment in of the produced lines at Tally's values.
- **Reversal:** the existing GL reversal, `bills.reverseSourceEffects` and stock-entry cancellation, in one place for
  every kind of Tally document.

## Tasks

**T1 · Core.** `tallyDocument` gains the receipt, payment, journal, contra and stock-journal kinds, with tests:
- receipt or payment: party, cash or bank ledger, amount, and allocations from the party line's bills;
- journal and contra: balanced lines by ledger, party lines with their bill;
- stock journal: lines out and in by item, godown, batch, quantity and value; transfer or adjustment.

**T2 · Migration 0059.** `source`, `tally_guid` on `party_settlement`, `journal_voucher` and `stock_entry` (stock
entries already carry `source`); `tally_document_version`; new kinds in the voucher-type map and the staged-kind
check. Tally's own Receipt,
Payment, Journal, Contra and Stock Journal types are preset; Delivery Note and Receipt Note stay history.

**T3 · API: the new documents.** Staging and commit as in PR 1, ordered by date with invoices before the receipts and
payments of the same day.
- **Allocations keep Tally's amounts (decision 036's bill-wise settlement).** Each "Agst Ref" line on the party ledger
  settles that amount, not the whole bill, so a part payment leaves the rest open. A receipt or payment may carry
  several "Agst Ref" lines, each settled on its own.
- **Matching:** the party's open FactoryOS bill on the same side with the same reference (an invoice from Tally or an
  opening bill). When two open bills share the reference, the voucher is a conflict in the preview, naming both.
- **What is left:** an amount above the bill's open balance, an unmatched reference, "New Ref", "Advance" and
  "On Account" stay on account for the party. They are applied later through the existing later-allocation flow
  (decision 036), or by a later Tally voucher that names the bill.

**T4 · API: reversal.**
- One `reverseTallyDocument` for every kind: GL reversal, bill effects, stock entry cancelled, status cancelled with a
  reason. The cancelled document keeps its `tally_guid`; the unique indexes cover live documents only.
- **Versions:** a new `tally_document_version` row records each document a voucher became: GUID, ALTERID, kind,
  document, and the document that replaced it. `tally_voucher.document_id` points at the current document, so a
  re-import finds it and never duplicates, and the history page lists every version.
- **Re-sync:** a newer ALTERID is proposed as "update". At commit the current document is reversed, a new one is
  created from the edited voucher, and the version row of the old one names the new one.
- **Switching a month back:** a preview lists the Tally documents in the month and every dependent outside it:
  - a receipt, payment, allocation or note that settles one of its bills;
  - a stock movement that consumed a FIFO layer its receipts created (decision 028: a consumed layer cannot be
    cancelled from under its consumer).
  With any dependent, the switch is refused, naming each. With none, the month's documents are reversed newest first
  (notes, then receipts, payments and journals, then sales, then purchases and stock receipts), so nothing is
  reversed before what depends on it inside the month. The month then becomes FactoryOS's.

**T5 · Web.** The new kinds in the preview and mappings; "Switch to FactoryOS" on a Tally month with the preview and
confirmation; "Updated from Tally" on a re-synced document, linking its earlier version.

**T6 · Checks and PR.**
- `smoke-tally`: a receipt settles a Tally invoice by reference, and a part payment leaves the rest open; a receipt
  with two references settles both; an unmatched one goes on account; two open bills with one reference are a
  conflict; a payment, a journal,
  a contra and a stock journal post; an edited voucher is reversed and recreated; switching a month back is refused
  while a later receipt or a later issue of its stock depends on it, and goes through once nothing does; bills match the books throughout.
- The browser walkthrough, extended.
- The user's real Day Book in a throwaway workspace, aggregates only, then the local database is dropped.
- Regression, UI audit, review, STATUS and LOG, PR.
