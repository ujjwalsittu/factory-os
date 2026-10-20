# Tally months as FactoryOS documents, PR 2 — review (decisions 075, 075a and 075b)

Builds PR 2 of the [design](../specs/2026-10-20-tally-transactions-design.md) to the
[plan](../plans/2026-10-20-tally-documents-pr2.md), on top of [PR 1](2026-10-20-tally-documents-pr1-review.md).
Migration `0059_tally_entries`.

## What is built

- **New kinds** (`apps/api/src/modules/tally/tally-entries.ts`, mapping in `packages/core/src/tally-entries.ts`):
  - Tally's Receipt, Payment, Journal, Contra and Stock Journal types are preset. A custom type can be mapped to any of
    them. Delivery and receipt notes stay history (075b): the invoice moves the stock.
  - **Receipts and payments:**
    - One party against one cash or bank ledger becomes a receipt or payment through the settlement service, with
      Tally's number and date. The cash or bank account comes from the ledger link and must sit under Cash-in-Hand or
      Bank Accounts.
    - Each "Agst Ref" settles its own amount of the party's open FactoryOS bill with that reference (an invoice from
      Tally or an opening bill), up to what is open.
    - An unmatched reference, "New Ref", "Advance", "On Account" and any excess stay on account for the party.
    - Anything else becomes a journal, so it still reaches the books: several parties, TDS or charges, a refund booked
      as a receipt, a receipt from a party that is not a customer. The preview says so.
  - **Journals and contra:**
    - Posted through the GL posting service as source `tally_journal`, keeping Tally's number as the source number.
    - A party line goes to the party's control account with its bill reference. A line settling a bill settles at most
      what is open; the rest is on account under `Tally <number>`.
    - The party's side comes from its Tally group (under Sundry Creditors is a payable), else from whether it is a
      customer or a supplier.
    - A journal posting to an inventory or GRNI account is a conflict: stock value moves only with stock.
    - **Tax ledgers** (GST, TDS, TCS) are not linked by the masters import. They post to the tax account of their role.
      The direction comes from the name (Input/ITC or Output, Receivable or Payable), else from the side of the opening
      balance. A tax ledger that says neither is named as a problem to link. Found by the real Day Book check.
  - **Stock journals:**
    - Same items moved between godowns is a transfer.
    - Anything else is one adjustment: consumed lines out at FIFO cost, produced lines in at Tally's value, and the
      difference to the adjustment account. Tally adjustment-in entries no longer credit GRNI.
  - **Order on a day:** purchases, stock journals, sales, notes, then receipts, payments and journals.
- **Guards:**
  - A receipt or payment entered here is refused in a Tally month, and one from Tally cannot be cancelled here (409).
  - Receipts and payments count as FactoryOS documents when a month is set to Tally.
- **Versions** (`tally_document_version`):
  - Every created document gets a row with GUID, ALTERID, kind, document, the stock entries it made (`parts`), and the
    document that replaced it.
  - Documents from PR 1 get their first version in the migration.
- **Re-sync** (075a):
  - A newer ALTERID is proposed as "Update". At commit the current document is reversed and created again from the
    edited voucher, and the old version names its replacement. `tally_voucher.document_id` follows the current one.
  - An edited document that a later document depends on stays a conflict naming the dependents. Edited vouchers in
    one upload are reversed together, so they do not block each other.
  - Number indexes for sales invoices, sales notes and purchase invoices now cover FactoryOS documents and live Tally
    documents, so an edited Tally invoice keeps its number. FactoryOS series stay gapless.
- **Reversal** (`tally-reversal.ts`): one function for every kind, through the same GL reversal, bill effects, stock
  cancellation and settlement cancel as a cancel here.
- **Switching a month back** (075b):
  - `GET /tally/books/:month/switch-back` lists the month's documents from Tally and every dependent outside them:
    - receipts, payments, allocations, journals and notes settling their bills;
    - notes against their invoices;
    - stock issued from FIFO layers their stock created.
  - `PUT /tally/books` with `confirm` reverses them: notes first, then money and journals, sales, stock journals,
    purchases. It is refused while any dependent exists. The vouchers stay history.
- **Web:**
  - Mappings offer the new kinds.
  - "FactoryOS" on a Tally month opens a preview dialog that names the blockers and confirms.
  - The preview and commit dialog count documents edited in Tally.
  - An edited document links its earlier version, and a reversed one links its replacement.
  - A receipt or payment from Tally shows the From Tally banner and no Cancel.
  - History and preview links open receipts, journals and stock entries.

## Verification

- **Core:** 189 tests (9 new for receipts, payments, journals and stock journals).
- **`smoke-tally`:** 18 checks, 185 requests. It covers:
  - an edited voucher replacing its invoice;
  - a part payment, two references on one receipt, and an unmatched reference on account;
  - a payment, a journal opening a bill, a contra, and a stock transfer;
  - bills matching the books throughout;
  - a re-upload unchanged;
  - a FactoryOS receipt refused in the month, and a Tally receipt refused for cancel;
  - switching back refused while a later allocation and a stock issue depend on the month, then reversing every
    document.
- **Browser walkthrough `e2e/tally-documents.mjs`, desktop and 390 px:**
  - the PR 1 path;
  - an edited voucher, following the links between the reversed and the edited invoice;
  - a receipt from Tally;
  - switching the month back through the preview.
- **Regression:** all pass:
  - settlements and settlement improvements;
  - bank charges;
  - accounting baseline and operations;
  - customer note lifecycle and returns;
  - supplier notes and supplier return cancel;
  - the selling and buying shell smokes.
- **UI audit:** 202 page views, no problems. The add-new guard passes.
- **The user's real masters and Day Book**, in a throwaway workspace with aggregates only. The local database was
  dropped afterwards and nothing from the export is committed.
  - Every voucher month was kept in Tally. Receipts, payments and journals were most of the document rows.
  - **First run:** 16 unlinked tax ledgers stopped about 90 journals and payments. Fixed with the tax-ledger rule
    above.
  - **After the fix:** 448 documents came in. Most receipts and payments became journals: expenses paid straight from
    the bank, and several ledgers on one voucher.
  - **Still skipped:**
    - vouchers naming 2 ledgers that cannot be resolved (Profit & Loss, and a GST ledger with no direction);
    - a few sales that could not ship, because the check has no opening stock. This is an artefact of the check.
  - **Allocations:** most payments stayed on account, because the check imports no opening bills to match.
  - **Checks:** the GL balanced and bills matched the books. A re-upload proposed the committed documents unchanged.
  - **Switching back:** the latest month switched back (76 documents reversed, no dependents), and the books still
    balanced.

## Open points and limits

- **Two open bills with one reference** are found at commit, not in the preview. Bills from invoices in the same upload
  exist only once the commit creates them. The commit stops and names the voucher.
- **A party ledger first seen in the same upload** takes its side from whether it is a customer or a supplier. Its
  Tally group is read only from committed imports.
- **Reversals post on today's date**, as cancels do. A month switched back nets to zero in the books, but its
  reversals sit in the current month.
- **Two stock journals on one day**, where the second consumes what the first produced, are reversed in voucher
  order within the day. If that order is wrong, the reversal stops with the stock message and nothing changes.
- **Delivery and receipt notes** stay history, by decision 075b.
