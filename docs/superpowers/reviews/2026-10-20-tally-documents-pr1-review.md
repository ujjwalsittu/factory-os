# Tally months as FactoryOS documents, PR 1 — review (decisions 075 and 075a)

Builds PR 1 of the [design](../specs/2026-10-20-tally-transactions-design.md) to the
[plan](../plans/2026-10-20-tally-documents-pr1.md). Migration `0058_tally_documents`.

## What is built

- **Books by month:** `GET`/`PUT /tally/books` and Accounts → Tally import → Books by month.
  - Months run from the cut-over to today. Months before the cut-over are refused.
  - A month with FactoryOS documents cannot become Tally's. A month with Tally documents cannot go back to FactoryOS
    yet; that comes in PR 2.
  - FactoryOS submit of sales and purchase invoices and customer and supplier notes is refused in a Tally month.
- **Mappings:** `GET /tally/mappings`, `PUT /tally/mappings/voucher-types`, `PUT /tally/mappings/ledgers`.
  - A voucher type maps to a document kind or "stays history". Tally's own types are preset.
  - A ledger maps to the service item it is booked as. Only service items are allowed.
  - Types waiting in an open import are listed, so they can be mapped before the first commit.
  - Every change re-checks all open imports. `POST /tally/imports/:id/recheck` does the same for one import.
- **Staging:**
  - A voucher in a Tally month becomes a `document` row: new, unchanged, a conflict naming why, or skip for an
    unmapped type.
  - When the upload also carries masters, only missing-link problems wait for commit; everything else is a conflict
    straight away.
- **Commit:** in the import's transaction, oldest first, with purchases before sales and notes last on a day.
  - **Sales invoices:** submitted with Tally's number, date and amounts. Goods leave stock on a system delivery
    entry, and the books come from the same `salesIn` as a FactoryOS invoice.
  - **Purchase invoices:** goods arrive on a system receipt (source `tally`) that credits GRNI. The invoice
    (`tallyPurchaseIn`) clears GRNI by the receipt value and posts input tax and creditors. The supplier invoice
    number comes from Tally's reference.
  - **Credit notes from Tally (075a):** value notes against the FactoryOS invoice when there is one, else with Tally's
    bill reference. Tally's lines are kept on the note (`tally_lines`). Goods come back at their carrying cost and
    their GRNI clears to cost of sales.
  - **Debit notes on suppliers (075a):** these lower what is owed. Goods leave on an adjustment, which the note
    clears; any gap to Tally's value goes to purchases.
  - Each note records its own open item, as the note services do.
  - **Tax:** Tally's tax stands. A difference of more than ₹1 on a head is flagged with both figures, and only when
    FactoryOS knows every line's rate.
- **Guards:**
  - Documents from Tally cannot be cancelled or edited here: invoices and notes return 409.
  - Normal note paths reach a note's original invoice through `originalInvoiceOf`.
- **Web:**
  - the Books by month page, including voucher types and ledgers;
  - a link from the import page;
  - a Documents note in the preview, "Check again", and "Open the document" on created rows;
  - a From Tally banner with any tax difference on invoices;
  - a read-only view for notes from Tally;
  - a history voucher links to its document.

## Verification

- **Core:** 180 tests, including mapping, the tax-difference flag and the unknown-rate case.
- **`smoke-tally`:** 15 checks, 145 requests. It covers:
  - months before the cut-over refused;
  - the custom type mapped, the ledger mapped, and a stock item refused for a ledger;
  - a sale, a service sale, a purchase, a credit note with goods returned, and a debit note against a bill from
    before the cut-over;
  - the trial balance moves, and bills match the books for every party;
  - a re-upload is unchanged, and an edited voucher is a conflict;
  - FactoryOS entry and cancel are refused in the month, and switching back is refused.
- **Regression:**
  - selling and buying shell smokes;
  - the sales-note smokes: lifecycle, returns;
  - the supplier-note smokes: notes, acceptance, cancel, returns stock;
  - accounting baseline.
- **Browser walkthrough `e2e/tally-documents.mjs`, desktop and 390 px:** set the month, upload, map type and
  ledger, import, From Tally banner, history link.
- **UI audit and add-new guard:** see the PR.
- **The user's real masters and Day Book**, in a throwaway workspace with aggregates only. The local database was
  dropped afterwards and nothing from the export is committed.
  - Sales and purchase invoices were created.
  - Unmapped voucher types stayed history; most of them are receipts, payments and journals for PR 2.
  - Bills matched the books and the GL balanced.
  - It found one gap, now fixed: a Day Book carrying masters deferred every problem to commit.
  - It also showed that sales of goods need the opening stock in first: the check activated accounting before the
    masters, so a few sales could not ship.

## Open points and limits

- **Re-sync:** an edited voucher (newer ALTERID) is a conflict until PR 2 builds the reversal (075a).
- **Several GSTINs** for one entity are refused for now: a document from Tally needs the entity's one GSTIN.
- **Debit notes we raise on a supplier** are stored as a supplier note of kind `credit`: the supplier's side, same
  effect on what is owed.
- **Customer returns** come back at average carrying cost, not the original sale's FIFO layers; a Tally note may have
  no FactoryOS sale to trace.
- **E-invoice sandbox:** "Prepare sandbox registration" still shows on invoices from Tally. The design says FactoryOS
  does not generate e-invoices for them; hiding it is a small follow-up.
- **GST returns (074)** must read notes from Tally from `tally_lines`, since they have no FactoryOS note lines.
