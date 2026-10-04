# 05 · India Compliance & GSP Integration

Scope for v1 (as agreed): **GSTR-1 / 3B + 2B (and IMS) reconciliation, e-invoice (IRN), e-way bill,
TDS/TCS, MSME 45-day, HSN/SAC** — behind a **provider-agnostic GSP adapter**, with the provider
selected and credentialed **per legal entity / GSTIN in settings**.

## 1. Tax engine (`packages/compliance-in`)

Pure, deterministic, golden-file tested.

- **Place of supply** rules for goods (Sec 10 IGST) and services (Sec 12/13 — incl. performance-based
  services on goods like testing, and export of services).
- Intra-state → CGST + SGST; inter-state / SEZ / export → IGST; exports & SEZ under **LUT** at 0%.
- **Reverse charge** (notified services, import of services, unregistered-supplier cases).
- HSN/SAC master with **rate history** (effective-dated) + cess.
- Inter-company and inter-GSTIN (same PAN, different state) transfers are taxable supplies.
- Rounding per line/invoice as configured; tolerance-safe totals for IRP validation.
- GSTIN validation (checksum + live lookup via GSP), PAN extraction, state code consistency.

## 2. E-invoice (IRN)

- **Applicability is a date per GST registration** (`einvoice_applicable_from`), not a flag.
  Azeonics: applies from **1 Apr 2027** (FY 2027-28). Before that date invoices are issued without
  IRN, and the UI shows a countdown and readiness checklist (masters complete, test IRNs on sandbox).
- Auto-generate on submit of B2B / export / SEZ invoices, debit & credit notes once applicable.
- Flow: build INV-01 JSON → validate locally (schema + business rules) → GSP → IRN, Ack no,
  **signed QR** → stored immutably → printed on invoice PDF.
- Cancel within 24 h (with reason), else credit note. Bulk generation & retry queue.
- Invoices from a GSTIN can be e-invoiced with **e-way bill Part A/B in the same call**.
- Respect reporting time limit (30 days from invoice date for large taxpayers) — block/warn.

## 3. E-way bill

- Triggered by: sales invoice, **delivery challan** (job-work outward, returnable, inter-GSTIN
  transfer, customer material return), purchase return.
- Part A from document; Part B (vehicle/transporter) from dispatch screen or transporter.
- Update vehicle, extend validity, cancel, reject; consolidated EWB; bulk.
- Distance auto-calc via PIN codes; warn on value threshold rules per state.

## 4. Returns

| Return | FactoryOS behaviour |
|---|---|
| **GSTR-1 / IFF** | Built from submitted invoices/notes/advances; sections B2B, B2CL, B2CS, CDNR, EXP, HSN summary, doc summary; diff against last filed; push and **file via GSP** after the approval workflow below |
| **GSTR-3B** | Auto-computed liability + eligible ITC (net of ineligible / blocked u/s 17(5), reversals); variance vs GSTR-1 / 2B shown before filing |
| **GSTR-2B / IMS** | Download monthly; match engine (GSTIN + invoice no fuzzy + date + value tolerance); statuses: matched / mismatch / missing-in-books / missing-in-2B; **IMS accept/reject/pending** actions pushed back; supplier follow-up emails |
| **ITC-04** | Job-work challans outward/inward per quarter/half-year, auto from challans |
| **GSTR-9 / 9C** | Phase 2 — data workbook |

**Filing workflow (decision 007):** `Draft (preparer) → Reviewed (Accounts) → Approved (Finance
Controller) → Saved to GSTN → Filed (EVC/OTP by the approver)`. Each step needs its own
permission (`compliance.gst_return.create / approve / file`); the preparer can't approve their own
return; every transition and the GSTN acknowledgement are audited.

## 5. TDS / TCS

- Sections configured per party/item/account: **194C, 194J, 194I, 194H, 194Q, 195** (foreign),
  lower-deduction certificates (Sec 197) with limits and validity.
- Threshold tracking per party per FY; PAN-inoperative → higher rate.
- Deduction on invoice or payment (whichever earlier) with GL posting.
- **TCS on scrap sale u/s 206C(1)**.
- Outputs: challan (281) tracking, **Form 26Q / 27Q** data files (for RPU/FVU), Form 16A tracking.
- Receivable side: TDS deducted by customers (EarthNow govt clients) → **26AS / AIS reconciliation**.

## 6. MSME (Sec 43B(h) & MSMED Act)

- Supplier Udyam number + category + verification date.
- Agreed credit days capped at **45**; ageing per invoice from acceptance date.
- Dashboard + alerts before day 15/45; year-end disallowance report; **MSME-1** half-yearly data.

## 7. Audit trail & books

- Companies (Accounts) Rules: **edit log for every change** to books, cannot be disabled — satisfied
  by the append-only audit log (doc 06).
- Number series: ≤16 chars, unique per GSTIN per FY, gapless option for tax invoices.
- Statutory print formats: tax invoice, bill of supply, delivery challan, debit/credit note,
  self-invoice (RCM), payment voucher (RCM), receipt voucher (advances).

## 8. GSP adapter (`packages/gsp`)

```ts
interface GspProvider {
  id: 'masters_india' | 'cleartax' | 'iris' | 'adaequare' | 'cygnet' | 'tera' | 'nic_direct' | 'mock'
  capabilities: Set<'einvoice' | 'ewaybill' | 'gstr1' | 'gstr3b' | 'gstr2b' | 'ims' | 'gstin_lookup'>
  authenticate(creds): Promise<Session>
  einvoice: { generate, cancel, getByIrn, getByDocument }
  ewaybill: { generate, generateFromIrn, updatePartB, extend, cancel, get }
  returns:  { saveGstr1, getGstr1Summary, getGstr2b, imsAction, getReturnStatus }
  lookup:   { gstin, hsn }
}
```

- One adapter per provider; all map to the **same canonical request/response types** (NIC schema as
  the canonical form). Provider is chosen per **GSTIN** (an entity could even use different
  providers for e-invoice and returns).
- Credentials (GSP client id/secret, GSTN username, EWB/IRP API user) stored **envelope-encrypted**;
  never returned to the UI after save; rotation supported.
- Every request/response persisted in `gsp_call_log` (redacted secrets) for audit & support.
- Idempotency: dedupe by `(gstin, doc type, doc no, FY)`; safe retries; circuit breaker per provider.
- **`mock` provider** for dev/CI with deterministic IRNs; **sandbox** mode per provider for staging.
- Adapters ship in this order (decision 005): `mock` → **`nic_direct`** (NIC IRP
  `einvoice1.gst.gov.in` and the NIC e-way bill system) → other IRPs and GSPs, all selectable per GSTIN.
- **Constraints to verify before building `nic_direct`:** NIC grants direct API access only to
  taxpayers meeting its eligibility criteria (registration on the API portal, a static IP
  whitelist, and turnover conditions that NIC revises from time to time). If Azeonics isn't
  eligible, e-invoice and EWB go through an IRP/GSP adapter with the same canonical payloads, and
  the swap is a settings change.
- **GST returns (GSTR-1/3B/2B/IMS) can only be filed through a GSP** (GSTN doesn't open its
  returns APIs to taxpayers directly). So a GSP must be chosen before Phase 4.
