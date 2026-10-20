# GST returns PR 3 — amendments to filed months — review (decisions 074 and 074b)

Built to the [plan](../plans/2026-10-20-gst-returns-pr3.md). Migration `0061_gst_amendments`. No new permission:
deciding amendments is part of preparing (`compliance.gst_return.create`). Filing through Adaequare is not in this
PR (074b: no credentials yet).

## What was built

- **Evidence** ([gst-returns-evidence.md](../../compliance/gst-returns-evidence.md), items 5–7). The rules are
  checked against the same pinned CGST Rules file as PR 1:
  - GSTR-1 tables 9A and 9C, with their columns and instruction 13;
  - table 10, with instruction 14;
  - GSTR-3B instruction 3: "Amendment in any details to be adjusted and not shown separately".

  Amending a cancelled invoice to zero is not in that file. It is listed as not verified, and the code says so.
- **Core** (`@factoryos/core/gst-returns`):
  - `entryAmendment` compares what a filed month reported for an invoice or note (or what a later included
    amendment reported) with the document now. It gives a B2BA, B2CLA, EXPA, CDNRA or CDNURA row with the
    original reference, the revised figures and the difference.
    - A cancelled document is revised to zero.
    - Once an amendment has reported the zero, the document is settled and not proposed again.
    - The comparison ignores key order, so figures read back from storage compare equal.
  - `b2csAmendment` gives table 10: the filed month's B2CS re-totalled by place of supply and rate, from the
    documents that return reported. A rate that no longer has sales is revised to zero.
  - `applyAmendments` puts included differences into 3.1(a), or into 3.1(b) for exports and SEZ, and into 6.1 of
    the amending month. Reverse-charge supplies change no tax.
  - The GSTR-1-against-3B check counts included amendments.
  - Sheets: `b2ba`, `b2cla`, `expa`, `cdnra`, `cdnura` and `b2csa.csv`, with included amendments only.
- **Data:** `gst_amendment` holds, for each proposal of a GSTR-1:
  - the key, which is the document id or `b2cs:<month>`;
  - the table and the original month;
  - the last-reported, revised and difference figures;
  - the decision (proposed, included or dropped), with its reason, who and when.

  Database checks require a reason of 5 or more characters to drop, and who and when for every decision. A trigger
  freezes the rows with their return once it is filed.
- **API:**
  - **Proposing:** preparing a GSTR-1 recomputes every filed GSTR-1 of the GSTIN from the start of the previous
    financial year, from the documents each one reported. It proposes an amendment for each change.
  - **Keeping decisions:** a decision stays while its figures are unchanged; a changed proposal goes back to
    "proposed".
  - **Not proposed again:** a key that another open return already carries, and an amendment dropped in a filed
    return (until the document changes again).
  - `POST /gst-returns/:id/amendments/:amendmentId/include|drop` (drop needs a reason). It is audited
    (`gst_amendment.include|drop`), then the month's returns are prepared again on that decision. An approved or
    filed return refuses with 409.
  - Review is refused while any proposal is undecided.
  - An included amendment's document counts as explained in the ledger check, and its difference is expected
    there.
  - "Changed since filing" on a filed GSTR-1 names the later GSTR-1 whose amendment reported each change
    (`amendedIn`).
- **Web:**
  - The GSTR-1 page has "Amendments to filed months":
    - each row shows the table, the original document (linked) and its month;
    - last reported, now and the difference, with any GSTIN change;
    - the decision with its reason;
    - Include and Drop…, where Drop asks for a reason.
  - The preview lists the amendments read-only.

### Found and fixed while building

- **"Changed since filing" (PR 1) listed unchanged invoices as changed.** It compared figures with
  `JSON.stringify` against `jsonb`, and `jsonb` does not keep key order. It now compares canonical JSON. The
  amendments smoke asserts the exact list: only the three documents changed.
- **A cancelled invoice already amended to zero was proposed again** in the following month. That is now settled
  (core test and smoke).
- **The "needs a decision" refusal stayed on screen after every amendment was decided.** A decision now clears it.

## Verification

- Core: 14 GST tests pass. They cover:
  - B2BA to zero, with the 3B difference and the check;
  - a dropped amendment, which changes nothing;
  - unchanged after a storage round-trip;
  - settled once amended;
  - a GSTIN change;
  - EXPA going to 3.1(b);
  - B2CSA with a rate gone to zero;
  - the B2BA sheet row.
- `smoke-gst-amendments`: 63 checks. It covers:
  - nothing proposed before any change;
  - "Changed since filing" listing exactly the changed documents;
  - B2BA, CDNRA and B2CSA proposed with exact differences;
  - undecided amendments changing nothing in 3B, and blocking review;
  - include;
  - drop without a reason refused (400), then with a reason;
  - deciding on a filed return refused (409);
  - 3B 3.1(a) and 6.1 at −1,100 taxable and −99 each for CGST and SGST;
  - the GSTR-1-against-3B check passing;
  - re-preparing keeping the decisions;
  - the audit rows;
  - the export (B2BA revised to zero with its original reference, B2CSA, and no CDNRA because it was dropped);
  - filing, with the frozen rows;
  - `amendedIn` on the October return;
  - December proposing nothing;
  - isolation.
- `smoke-gst-returns` (PR 1): 68 checks, still passing.
- Browser walkthroughs:
  - `e2e/gst-amendments.mjs` passes. It covers proposals, the review refusal, include, drop with a reason (the
    button stays off without one), the refusal clearing, review, export and 390 px with no sideways scroll.
  - `e2e/gst-returns.mjs` passes.
- Regression: sales-note lifecycle, supplier notes, accounting baseline, and the selling walkthrough.
- The UI audit and typecheck and build for core, API and web are in the PR description.

## Limits

- **The ledger check across months is not exercised.** A cancellation's reversal posts on the day it is made. In
  use, the change comes in a later month, and that month's return then carries the amendment, so the check
  matches. The test clock has one day, so the smoke cancels in the filed month itself. The amending month's ledger
  check then shows the difference, as the walkthrough's screenshot does. The smoke asserts the GSTR-1-against-3B
  check, not the ledger check, for that month.
- **The look-back window is a guess.** Amendments look back to the start of the previous financial year; the time
  limit for amending is not pinned.
- **Documents that move between B2CS and B2B after filing** (a GSTIN added or removed) are not proposed as a new
  B2B entry. Only the B2CS revision and the old entry's amendment show.
- **3.2 is not adjusted** for amendments to inter-State sales to unregistered persons.
- **Not in this PR:** filing through Adaequare, and the GSTR-1 offline-tool JSON, including for amendment tables
  (074a).
