# Job work and ITC-04: statutory evidence (manufacturing 2c, task 1)

Retrieved 2026-10-09 from cbic-gst.gov.in, the CBIC GST site, and pinned by SHA-256. The newer
notification site (taxinformation.cbic.gov.in) and the GST portal (tutorial.gst.gov.in,
www.gst.gov.in) were not reachable from the build environment: TLS failure and connection reset
respectively.

| Source | URL | SHA-256 |
|---|---|---|
| CGST Act, consolidated to 30-09-2020 | https://cbic-gst.gov.in/pdf/CGST-Act-Updated-30092020.pdf | `4db47a4ed2af6e61864049facb85b2dad940590df5239967062efd19d2d40fb4` |
| CGST Rules (2017 compilation, includes FORM GST ITC-04) | https://cbic-gst.gov.in/pdf/cgst-rules-01july2017.pdf | `5516a0d93a6b767213bd4b14c297e180fde5db44a9b48db56587fe9c136a94bb` |
| Notification 35/2021-Central Tax (amends rule 45(3)) | https://cbic-gst.gov.in/pdf/central-tax/notfctn-35-central-tax-english-2021.pdf | `0c71eaa187f3cc47c450f414f03e552aaf45c293e028d1c3dd823af6f2fdfd62` |

## Verified, and how the build uses it

1. **Time limits (Sec 143(1)(a)/(b), (3), (4)):**
   - Inputs must be brought back within **one year** of being sent out, and capital goods within
     **three years**.
   - Moulds and dies, jigs and fixtures, and tools are excluded. The exclusion applies to
     **capital goods only**; inputs always have the one-year limit.
   - If goods aren't returned in time, they are deemed supplied by the principal to the job worker
     **on the day they were sent out**.
   - **Build:**
     - `due_by` is the challan date plus 1 year (inputs) or plus 3 years (capital goods);
     - it is null for capital goods that are flagged as tools;
     - the deemed-supply date is the challan date.
2. **Extension (Sec 143(1), second proviso, w.e.f. 01-02-2019):** the Commissioner may extend the
   period by up to **one year** (inputs) or **two years** (capital goods).
   - **Build:** a challan line can record an extension order (reference and new date). The new
     date can't exceed the original date plus 1 or 2 years.
3. **Waste and scrap (Sec 143(5)):** a registered job worker may supply waste directly. This is
   out of scope (spec); we only record waste returned to us.
4. **Challan (rule 45(1)–(2), rule 55(1)(b)):** goods go out under a challan issued by the
   principal, with these rule 55 details:
   - serial number of **at most 16 characters**;
   - date;
   - consigner and consignee name, address and GSTIN;
   - HSN and description;
   - quantity;
   - taxable value;
   - place of supply for interstate movement;
   - signature.

   Tax rate and amount are required only "where the transportation is for supply", so not for job
   work.
   - **Build:**
     - the challan series default is `JW/<FY>/<5 digits>`, for example `JW/26-27/00001`
       (14 characters);
     - every challan number is checked against the 16-character limit, and a series that would
       exceed it is refused;
     - the print carries the listed fields.
5. **Deemed supply reporting (rule 45(4)):** a deemed supply is declared in GSTR-1, and the
   principal pays tax with interest.
   - **Build:** this is an alert and a deemed-supply marker with the invoice number. Accounts
     raises the invoice.
6. **ITC-04 period and due date (rule 45(3) as amended by Notification 35/2021, w.e.f.
   01-10-2021):** the return is furnished "on or before the twenty-fifth day of the month
   succeeding the said period". The "specified period" is:
   - six consecutive months starting 1 April or 1 October, when aggregate turnover in the
     **immediately preceding financial year** exceeds ₹5 crore;
   - otherwise the financial year.

   - **Build:**
     - a per-entity, per-FY frequency setting; the turnover itself isn't computed;
     - half-yearly periods are Apr–Sep (due 25 October) and Oct–Mar (due 25 April);
     - the annual period is Apr–Mar (due 25 April).
7. **FORM GST ITC-04 fields (rule 45(3) form, 2017 compilation):**
   - **Table 4 (sent for job work):** GSTIN, or state if the job worker is unregistered; challan
     number; challan date; description; UQC; quantity; taxable value; type of goods
     (inputs/capital goods); tax rates (central, state/UT, integrated, cess).
   - **Table 5 (received back / sent to another job worker / supplied from the job worker's
     premises):** GSTIN or state; received back / sent on / supplied; original challan number and
     date; onward challan details; invoice details; description; UQC; quantity; taxable value.

   - **Build:**
     - the export follows these fields;
     - the received-back rows include losses and waste quantities;
     - rows for "sent to another job worker" and "supplied from premises" are out of scope.

## Not verified (recorded as limits, not guessed)

- **Offline tool template** (sheet names and exact column headers, and the current form's
  split into 5A/5B/5C): the GST portal wasn't reachable. Secondary sources (cleartax, tallysolutions
  and others, 2026-10-09 search) describe tables 4 and 5A–5C with the same fields as above.
  - **Build:** CSV export in the form's field order, labelled "FORM GST ITC-04 fields". It is not
    presented as the offline-tool upload file. Matching the offline template is a follow-up once
    the template can be retrieved.
- **E-way bill for interstate job work** (rule 138, introduced 2018): not present in the 2017
  compilation, and the current rule text wasn't reachable.
  - **Build:** interstate challans show an e-way bill number field and a warning. Submitting is
    not blocked. Changing this to a hard rule needs the current rule 138 text.
- **Later amendments to Sec 143 after 30-09-2020:** none found in the 2023 amendment Act
  (`pdf/CGST-Amendment-Act-2023.pdf`); not otherwise checked.
