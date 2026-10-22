# GST returns: statutory evidence (decision 074, PR 1, task 1)

Retrieved 2026-10-20. Same rule as [ITC-04](itc04-evidence.md): the build follows what is pinned here; anything not
pinned is listed under "Not verified" and named in the code where it is used.

## Hosts tried

| Host | Result on 2026-10-20 |
|---|---|
| cbic-gst.gov.in | Answers; serves the 2017 rules compilation below (current notification links return 404) |
| taxinformation.cbic.gov.in (current notifications) | No answer from the build environment |
| www.gst.gov.in | Answers; its downloads page links the offline tool on tutorial.gst.gov.in |
| tutorial.gst.gov.in (GSTR-1 offline tool, user guides) | TLS connection reset by the remote end, every attempt |
| developer.gst.gov.in (API documentation) | The page shell answers; its scripts and documents reset |

## Pinned

| Source | URL | SHA-256 |
|---|---|---|
| CGST Rules (2017 compilation; rule 59, Form GSTR-1, Form GSTR-3B) | https://cbic-gst.gov.in/pdf/cgst-rules-01july2017.pdf | `5516a0d93a6b767213bd4b14c297e180fde5db44a9b48db56587fe9c136a94bb` |

### Verified from the pinned source, and how the build uses it

1. **Rule 59(2), GSTR-1 contents.** GSTR-1 holds:
   - invoice-wise details of supplies to registered persons;
   - invoice-wise inter-State supplies to unregistered persons above the B2CL threshold;
   - consolidated, rate-wise intra-State supplies to unregistered persons, and State-wise inter-State ones up to the
     threshold;
   - debit and credit notes.

   **Build:** the B2B, B2CL, B2CS, CDNR and CDNUR sections.
2. **Form GSTR-1 tables**, and the sections the build fills from each:
   - 4A and 4B (registered, reverse charge) → **B2B**. 4C (e-commerce TCS) is not applicable.
   - 5 → **B2CL**.
   - 6A → **EXP**, with or without payment. 6B → **B2B with SEZ** supply types. 6C (deemed exports) → B2B with the
     deemed-export flag.
   - 7A and 7B → **B2CS** by place of supply and rate.
   - 8A–8D → the **nil, exempt and non-GST** summary. FactoryOS only knows nil-rated (0%) today.
   - 9B → **CDNR and CDNUR**. Amendments (9A, 9C, 10) are PR 3. Advances (11) are not built.
   - 12 → **HSN summary**, with UQC.
   - 13 → **document summary**.
3. **Form GSTR-3B tables**, and how the build fills each:
   - **3.1:** (a) outward taxable; (b) zero rated; (c) nil and exempt; (d) inward reverse charge; (e) non-GST.
   - **3.2:** inter-State supplies to unregistered persons, by place of supply.
   - **4:**
     - (A)(1) import of goods, from Bill of Entry IGST;
     - (A)(2) import of services;
     - (A)(3) reverse charge;
     - (A)(4) ISD, not applicable;
     - (A)(5) all other ITC;
     - (B) reversed;
     - (C) net;
     - (D) ineligible.
   - **5:** exempt, nil and non-GST inward.
   - **6.1:** tax payable, with the payment split left to the person filing.
   - **Build:** the 3B figures follow this structure.
4. **Form GSTR-3B instruction 1:** the value of taxable supplies is invoices plus debit notes, minus credit notes.
   **Build:** 3.1 nets notes into the month they are dated in.

5. **Form GSTR-1 table 9 (amendments, PR 3, checked 2026-10-20 against the same pinned file).**
   - Each row gives the original document's GSTIN, number and date, then the revised:
     - GSTIN and invoice number and date;
     - shipping bill number and date, for exports only;
     - value, rate and taxable value;
     - integrated, central and State/UT tax, and cess;
     - place of supply, only when it differs from the recipient's location.
   - 9A amends what tables 4, 5 and 6 reported (B2B, B2CL, exports, SEZ and deemed exports), rate-wise.
   - 9C amends debit and credit notes reported earlier; its first columns hold the original note.

   **Build:** B2BA, B2CLA and EXPA rows (9A) and CDNRA and CDNURA rows (9C), one per rate, each with its original
   reference and revised figures.
6. **Form GSTR-1 table 10:** it is "similar to Table 9" for the B2C supplies reported in table 7. It names the tax
   period being revised, then rate-wise intra-State rows (10A) and inter-State rows by place of supply (10B).

   **Build:** B2CSA rows by original month, place of supply and rate.
7. **Form GSTR-3B instruction 3:** "Amendment in any details to be adjusted and not shown separately."

   **Build:** 3.1 of the amending month carries the difference between the revised figures and the figures last
   reported.

## Not verified (named in the code; to check before filing)

- **The B2CL threshold, now ₹1 lakh.** The pinned rules say ₹2.5 lakh. As far as the build environment knows,
  Notification 12/2024-Central Tax lowered it to ₹1 lakh from 1 August 2024. **Build:** ₹2.5 lakh before
  2024-08-01 and ₹1 lakh from then, as a dated rule.
- **HSN digits by turnover** (Notification 78/2020-Central Tax, as known): 4 digits for B2B up to ₹5 crore aggregate
  turnover, 6 digits above. **Build:** a shorter HSN is listed under "Needs attention", not refused.
- **The current Form GSTR-3B layout.** Later notifications re-labelled table 4(B) and 4(D), among them Notification
  14/2022-Central Tax. **Build:** the 3B sheet labels table 4 rows by what they hold (import of goods, reverse
  charge, all other, reversed, ineligible), so they can be keyed into the current portal form.
- **The GSTR-1 offline-tool JSON schema.** It is hosted on tutorial.gst.gov.in. Per decision 074a, no JSON is
  written. Since 2026-10-22 the export is the offline tool 3.2.4's section-wise CSV files instead, and the UQC list is
  pinned with them ([offline tool evidence](gstr1-offline-tool-evidence.md), decision 074c).
- **A cancelled invoice is amended to zero values.** This is common practice when an invoice reported in a filed
  GSTR-1 is cancelled; the pinned rules don't say it. **Build:** the proposal's revised figures are zero, and a
  person can drop it, for example when a credit note in an open month corrects it instead.
