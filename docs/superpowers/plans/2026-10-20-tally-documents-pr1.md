# Tally transactions as documents, PR 1 — plan (decision 075)

Builds PR 1 of the [design](../specs/2026-10-20-tally-transactions-design.md): books by month, the voucher-type
mapping, and Tally sales and purchase invoices and credit/debit notes as submitted FactoryOS documents with stock.
Receipts, payments, journals, stock journals and switching a month back come in PR 2.

## Reuse, not copies

A Tally document is posted by the same code as one entered in FactoryOS:

- **Sales invoices:**
  - stock leaves through `StockPostingService.submitIn` on a system delivery entry;
  - the books and bills come from `OperationalPostings.salesIn`.
- **Purchase invoices:** stock comes in through a system receipt entry; the books come from `purchaseIn`.
- **Notes:** the existing sales-note and supplier-note posting services.

**What differs:**
- The number and amounts are Tally's: no series allocation and no GST recomputation for the stored figures.
- The document carries `source = 'tally'` and the Tally GUID.
- No e-invoice is generated.

Tally's invoice number is the legal number for its GSTIN, so the existing unique index on (GSTIN, number) stays. A
clash with a FactoryOS document means a real duplicate, and it is shown as a conflict.

## Tasks

**T1 · Core (`packages/core/src/tally-documents.ts`), pure and tested.**
- `tallyDocument(v, kind, links)` returns a document draft, or the reasons it cannot be made:
  - **Kind:** from the type map. Tally's base types are preset: Sales → sales invoice, Purchase → purchase invoice,
    Credit Note → customer credit note, Debit Note → supplier debit note.
  - **Lines in invoice mode:** item, quantity, rate and amount, with the godown taken from the batch allocations.
  - **Lines in accounting mode:** income or expense ledgers mapped to service items.
  - **Tax:** split by duty head through the tax-ledger mapping.
  - **Supply type and place of supply:** from the party and the voucher.
  - **Bill reference:** for notes.
  - **Checks:** debit equals credit; line tax against the FactoryOS rate (a difference is a flag); no missing link.
- **Tests:** a fixture Day Book with sales (intra and inter state), a purchase with reverse charge, a credit note
  against a sale, an accounting-mode service sale, an unlinked item, and a tax difference.

**T2 · Migration 0058.**
- `tally_book_month`: entity, month (`yyyy-mm`), source (`tally` or `factoryos`), who and when.
- `tally_voucher_type_map`: entity, Tally voucher type, document kind.
- `tally_voucher.document_kind` and `document_id`.
- `source` and `tally_guid` on `sales_invoice`, `purchase_invoice`, `sales_note` and `supplier_note`; a unique index
  on (entity, `tally_guid`) for live sales and purchase invoices. Notes are kept unique by their number checks.
- A `tax_difference` json on the same four tables.

**T3 · API: books by month and the guard.**
- `GET` and `PUT /tally/books` lists and sets months for the entity. Only months on or after the cut-over date can be
  Tally; switching a Tally month that already has documents back to FactoryOS is refused in PR 1 (it comes in PR 2).
  This needs `accounts.tally.import`.
- **The guard:** creating or submitting a FactoryOS sales or purchase invoice or note dated in a Tally month is
  refused with a message naming the month.

**T4 · API: documents from vouchers.**
- **Staging:** a voucher in a Tally month is proposed as "new document", "update" (newer ALTERID) or "unchanged". An
  unmapped voucher type, a missing link or an unbalanced voucher is a decision. Vouchers in other months stay history.
- **Commit:** creates and submits the documents in the import's transaction, with stock and books, and links the
  history row to the document.
- **Update (moved to PR 2 by 075a):** an edited voucher is a conflict; reversal and recreation come with switching a
  month back.
- **Notes (075a):** value notes with Tally's amounts; the original invoice is linked when it is a FactoryOS document,
  else Tally's bill reference is kept as text. Goods on a note move stock.
- **Voucher-type mapping:** asked once per import for types not yet mapped, then saved.

**T5 · Web.**
- **Tally import → Books by month:** a calendar of months, each set to Tally or FactoryOS, from the cut-over on.
- **The import preview:**
  - a "Documents" card: how many of each kind will be created, updated or skipped;
  - the voucher-type mapping;
  - decisions per voucher.
- **On documents:** a "From Tally" badge, and the tax-difference flag with both figures.
- **Tally history:** a voucher links to the document it became.

**T6 · Checks and PR.**
- **`smoke-tally`, extended:**
  - a Tally month creates documents;
  - stock and the trial balance move by Tally's amounts;
  - FactoryOS entry is refused in that month;
  - a newer ALTERID is a conflict (reversal and recreation come in PR 2, decision 075a);
  - a FactoryOS month keeps history only;
  - months before the cut-over are refused;
  - a duplicate number is a conflict;
  - permissions and isolation.
- **The walkthrough, extended:** set a month, import, see the documents.
- **The user's real Day Book in a throwaway workspace:** aggregates only, then the local database is dropped.
- **Regression, UI audit, review, STATUS and LOG, PR.**
