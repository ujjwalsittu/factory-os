# Tally transactions as FactoryOS documents — design (decision 075)

The user asked (2026-10-20) that transactions imported from Tally feed FactoryOS as real documents, mapped properly,
with Tally or FactoryOS chosen as the book for each month. This changes decision 072, where Day Book vouchers are
read-only history that never reach the general ledger or GST. It is recorded as decision 075, accepted with the
choices below.

## Why

During the move from Tally, invoices may still be raised in Tally for some months. Those months must still appear in
FactoryOS:

- in the books, receivables and payables;
- in stock;
- in the GST returns of decision 074.

Otherwise they would have to be typed in twice.

## The rule for each month: one book

- **A setting per legal entity and month: Tally or FactoryOS.** It is chosen on a "Books by month" page under Tally
  import, with `accounts.tally.import`. Months default to FactoryOS.
- **Only months on or after the cut-over date can be Tally months.** That is the date of the opening balances from
  decision 073. Earlier months are already inside the openings, so posting them again would count them twice. Their
  vouchers stay history.
- **A Tally month:** its imported vouchers become documents. FactoryOS documents dated in that month are refused, with
  a message naming the month as Tally's, so nothing is entered twice.
- **A FactoryOS month:** Tally vouchers dated in it stay history, flagged "Tally voucher in a FactoryOS month" so a
  stray entry is noticed.
- **Switching a month from Tally to FactoryOS** cancels the documents created from Tally in it, by reversal, after a
  warning that lists them. Switching the other way needs the month to have no FactoryOS documents.

## What each voucher becomes

A Tally voucher type is mapped once to a FactoryOS document kind. Tally's own types are preset. Custom types, such as
"Sales GST" or "Export Sales", are asked once at import and then remembered.

| Tally voucher | FactoryOS document | Notes |
|---|---|---|
| Sales (invoice mode) | Sales invoice, submitted | Items, quantities, rates, HSN and tax as in Tally; stock leaves the Tally godown's warehouse by FIFO |
| Sales (accounting mode, services) | Sales invoice with service lines | Lines from the income ledgers; SAC from the ledger or a chosen service item |
| Purchase | Purchase invoice, submitted | Stock received into the godown's warehouse at the invoice rate; ITC eligibility from the ledger's settings |
| Credit Note | Customer credit note against the original invoice | The original found through Tally's bill reference; without one it is a decision |
| Debit Note | Supplier debit note | Same matching |
| Receipt / Payment | Receipt or payment, with the bill allocations from Tally | Bank or cash account from the ledger link |
| Journal / Contra | Journal voucher | Ledgers through their links |
| Stock Journal, Delivery Note, Receipt Note | Stock entries | Only when the item and godown are linked |

**Numbers and dates:**
- Documents keep Tally's voucher number and date. They are numbered outside the FactoryOS series, so the gapless
  series of decision 029 is untouched, and they are marked "From Tally".
- An e-invoice IRN or e-way bill number recorded in Tally is kept as a reference. FactoryOS does not generate them
  again.

## Mapping, checked before anything is created

- **Masters:** parties, items, godowns and ledgers through the links of decision 072. A voucher that names an unlinked
  ledger, party or item stops with a decision: link it, create it, or skip the voucher.
- **Tax:** Tally's tax ledgers are mapped by duty head and side, as for opening balances (CGST, SGST, IGST, cess;
  output and input).
- **Place of supply:** from the voucher, or else the party's state.
- **Supply type:** from the party's GST registration type and the voucher (export, SEZ, reverse charge).
- **Amounts are Tally's, to the paisa.** FactoryOS's GST engine recomputes each document. A difference does not change
  the amounts: the document keeps Tally's figures, because they are what was invoiced, and it is flagged "Tax differs
  from FactoryOS's calculation" with both figures.
- **A voucher that does not balance** is a decision: skip it, or accept it with the difference to a chosen ledger.

## Re-sync

This builds on the history import of PR 3:
- **Same ALTERID:** nothing changes.
- **A newer ALTERID:** the document is reversed and a new one created from the edited voucher. Ledgers stay
  append-only, and both versions stay visible and linked.
- **Missing from a later export:** the voucher is listed, never cancelled on its own. A person cancels it.
- **A Tally month already filed in GSTR-1:** an edit or cancellation from Tally shows the warning of decision 074 and
  appears as "Changed since filing".

## Data

- `tally_book_month`: entity, month, source, who and when.
- `tally_voucher.document_kind` and `document_id` link history to the document it became.
- Each created document gets `source = 'tally'` and the Tally GUID.
- `tally_voucher_type_map`: Tally voucher type to document kind, per entity.

## Built in two PRs

1. **Books by month, voucher-type mapping, and sales, purchases and notes.** Sales and purchase invoices, credit and
   debit notes, with stock. These feed GSTR-1 and 3B.
2. **Receipts, payments, journals and stock journals,** plus switching a month back.

## Verification

- **Core tests:** voucher-to-document mapping for each type; tax heads; the tax-difference flag; and the guard that
  only months after the cut-over can be Tally's.
- **A smoke test, against invented fixtures:**
  - a Tally month creates documents;
  - stock and the trial balance move;
  - FactoryOS entry is refused in that month;
  - a newer ALTERID reverses and recreates;
  - a FactoryOS month keeps history only;
  - switching a month back.
- **The user's real Day Book,** checked in a throwaway workspace the same careful way as before, with aggregates only.
- **A browser walkthrough, regression and UI audit.**

## Choices made (decision 075, 2026-10-20)

- **As real documents, chosen per month:** chosen by the user in place of GST-only or compare-only.
- **Voucher types first:** sales and purchase invoices and credit/debit notes. Receipts, payments, journals and stock
  journals follow in PR 2.
- **Stock:** Tally invoices with items move stock in the warehouse linked to the Tally godown.
- **Tax differences:** the document keeps Tally's amounts and is flagged with both figures.
