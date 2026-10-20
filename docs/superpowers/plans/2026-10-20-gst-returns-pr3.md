# GST returns PR 3 — amendments — plan (decisions 074 and 074b)

Builds the amendment half of PR 3 of the [design](../specs/2026-10-20-gst-returns-design.md). By decision 074b,
filing through the GSP (Adaequare, decision 020) is its own PR once credentials and API access exist. This PR builds:

- the GSTR-1 amendment tables for corrections to filed months;
- proposals that a person confirms;
- the sheets.

PR 1 ([review](../reviews/2026-10-20-gst-returns-pr1-review.md)) already shows "Changed since filing" on a filed return.
This PR turns those changes into amendment rows in the next open GSTR-1.

## Choices (decision 074b, the user's answers on 2026-10-20)

- **Amendments now, GSP filing later.** No Adaequare credentials or API documentation exist yet, so the GSP half
  waits.
- **A person confirms each amendment.** Preparing a GSTR-1 proposes one amendment row for each outward document
  that changed after its month was filed:
  - a cancellation;
  - changed figures;
  - a changed buyer GSTIN or place of supply.

  Each proposal is **included** or **dropped with a reason** before the return can be reviewed. Dropping covers a
  change already corrected another way, for example by a credit note in an open month.

## Rules (checked against the pinned source in T1)

- **GSTR-1 tables:**
  - 9A amends B2B, B2CL and exports (B2BA, B2CLA, EXPA);
  - 9C amends credit and debit notes (CDNRA, CDNURA);
  - 10 amends B2CS for an earlier month, by place of supply and rate (B2CSA).
- **The amending row** carries:
  - the original document's number, date and month (the month of the filed return);
  - the revised figures.

  A cancelled document is amended to zero values. **To verify in T1:** this is the common practice, and the pinned
  rules may not say it. If it cannot be verified, it is named as unverified in the evidence file and in the code.
- **A document amended once and changed again** is proposed again. The new proposal is measured against the last
  amended figures, not the first filed ones.
- **GSTR-3B of the amending month** carries the difference (revised minus last reported) in 3.1. **To verify in T1**
  against the 3B instructions in the pinned source.

## Tasks

**T1 · Evidence.** Add to [gst-returns-evidence.md](../../compliance/gst-returns-evidence.md):
- the GSTR-1 table 9A, 9C and 10 layout from the pinned CGST Rules compilation;
- what the pinned source says about amending to zero and about 3B differences;
- anything not found there, listed as unverified.

**T2 · Core.** In `packages/core/src/gst-returns.ts`:
- `amendmentProposals(filed, now)`. For each outward document it gives:
  - the amendment table;
  - the original reference;
  - the last reported figures and the revised figures;
  - the difference.
- B2CSA rows by original month, place of supply and rate.
- 3.1 differences in `buildGstr3b` from the included amendments.
- Sheets for B2BA, B2CLA, B2CSA, EXPA, CDNRA and CDNURA.
- Tests on invented data.

**T3 · Migration `0061_gst_amendments`.** Table `gst_amendment`:
- the amending return;
- the original return and line;
- the document;
- the table;
- the last reported and revised figures (jsonb);
- the decision (proposed, included or dropped), with its reason, who and when.

Frozen with its return once that return is filed, by the same triggers as PR 1.

**T4 · API.**
- Preparing a GSTR-1 also proposes amendments:
  - kept decisions survive a re-prepare while the figures are unchanged;
  - a changed proposal goes back to proposed.
- `POST /gst-returns/:id/amendments/:amendmentId/include` and `/drop` (with a reason), under
  `compliance.gst_return.create`, audited.
- Review is refused while a proposal is undecided.
- Included amendments go into the snapshot, the 3B difference and the export.
- "Changed since filing" on the filed return names the amendment that reported each change.

**T5 · Web.** On the GSTR-1 page:
- "Amendments to filed months", with original and revised figures side by side;
- include and drop (drop asks for a reason);
- a link to the original filed return;
- the counts in the summary;
- the new sheets in the export.

**T6 · Checks and PR.**
- **`smoke-gst-returns` gains:**
  - a cancelled filed invoice proposed as a B2BA amendment to zero;
  - review refused until it is decided;
  - drop with a reason;
  - include then re-prepare keeping the decision;
  - the 3B difference;
  - a second change proposed against the amended figures;
  - B2CSA for a small sale;
  - a credit note amendment (CDNRA);
  - isolation.
- **Also:** the browser walkthrough (desktop and 390 px), regression, UI audit, review, STATUS and LOG, PR.

## Not in this PR

- Filing through Adaequare (GSTR-1 push and summary, 3B filing, 2B download): its own PR after credentials.
- The GSTR-1 offline-tool JSON (074a), including for amendment tables.
- Amending 3B itself: the portal has no 3B amendment; differences go into a later 3B, as above.
