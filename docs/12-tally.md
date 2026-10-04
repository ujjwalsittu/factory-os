# 12 · Tally: Migration, Sync and an Accountant-Friendly UX

Decision 008: **FactoryOS is the books of record.** Tally is supported for (a) importing history and
(b) optional ongoing sync, e.g. while the CA still works in Tally.

## 1. Integration mechanism

TallyPrime exposes an **XML-over-HTTP server** (typically port 9000) that accepts export requests
(masters, vouchers, reports) and import requests (create/alter masters and vouchers). A small
**Tally connector** runs on the machine (or LAN) where Tally runs. It is part of `apps/edge-agent`,
because it has the same on-prem, outbound-only shape.

```
Tally (LAN) ⇄ XML/HTTP ⇄ edge-agent [tally driver] ⇄ HTTPS ⇄ FactoryOS API (sync jobs)
```

## 2. One-time import (opening FactoryOS)

| Step | Imported | Notes |
|---|---|---|
| 1 | Company info, FY, GSTIN details | Mapped to legal entity / GST registration |
| 2 | Groups and ledgers | Tally groups map to FactoryOS account groups (see §4). Party ledgers become customers/suppliers with GSTIN, state, PAN, credit days |
| 3 | Stock groups, stock items, units, godowns | Items, UoM, warehouses. Batches and expiry if Tally batches are enabled |
| 4 | Opening balances as at the cut-over date | Trial balance, bill-wise outstanding (for ageing and MSME 45-day), stock by godown/batch with value |
| 5 | (Optional) historical vouchers | Read-only history for reports and comparisons; marked `source = tally` and never re-posted to GST |

Every import runs as a **dry-run first**, with a reconciliation report: Tally TB vs FactoryOS TB,
party balances, and stock value, all of which must match before commit.

## 3. Ongoing sync (optional, per entity)

| Direction | What | Rule |
|---|---|---|
| FactoryOS → Tally | Submitted vouchers (sales, purchase, payment, receipt, journal, contra, credit/debit notes) and new masters | Default mode. Tally becomes a mirror for the CA |
| Tally → FactoryOS | Journals posted by the CA (adjustments, provisions) | Allowed only for journal-type vouchers, into a review queue; approved entries post normally |
| Conflicts | Same voucher edited on both sides | FactoryOS wins; Tally side is flagged for review. Each synced voucher stores its Tally GUID/master ID |

Sync is idempotent (keyed by FactoryOS ID ↔ Tally GUID), queued, retried, and logged.

## 4. Accountant-friendly UX (the point of this doc)

Accountants who know Tally should be productive on day one.

| Tally habit | FactoryOS equivalent |
|---|---|
| **F4 Contra, F5 Payment, F6 Receipt, F7 Journal, F8 Sales, F9 Purchase**, Ctrl+F8 Credit Note, Ctrl+F9 Debit Note | Same keys in the **Accounts workspace** open voucher entry directly |
| Keyboard-only voucher entry, Enter to move, Ctrl+A to accept | Voucher entry screen is fully keyboard driven; Enter moves to the next field, **Ctrl+Enter / Ctrl+A saves**, Esc goes back |
| Alt+C to create a master inline | Same: create a ledger/party/item from inside any lookup field |
| Gateway → Display → Day Book / Trial Balance / P&L / Balance Sheet | **Reports menu** with the same names and the same drill-down: report → group → ledger → voucher → back with Esc |
| Ledger names and groups (Sundry Debtors, Sundry Creditors, Duties & Taxes, Bank Accounts…) | Default chart of accounts uses **Tally's group names**; renaming is allowed |
| Bill-wise details (new ref / against ref / advance / on account) | Same allocation types on payments and receipts |
| Cost centres, voucher types, narration | Same concepts and names |
| Ctrl+P print, Alt+E export | Same shortcuts; export to Excel/PDF/JSON |
| Period change with Alt+F2 | Same shortcut; period picker shows FY labels |

Indian number formatting (lakh/crore), Dr/Cr notation in ledgers, and `Dr`/`Cr` toggles in entry
are defaults in the Accounts workspace.

## 5. Where FactoryOS goes beyond Tally

- Vouchers are created automatically from operations (GRN, invoices, payroll import, depreciation).
  Accountants review and approve instead of keying everything.
- Live GST, e-invoice and e-way bill status on every voucher.
- Maker-checker, audit trail, and attachments (bills, POs) on every voucher.
- Multi-entity consolidation and inter-company eliminations.

## 6. Questions for the user

1. Cut-over date for opening balances (start of FY 2026-27, or a later month?).
2. TallyPrime version and whether it runs locally or on a Tally-on-cloud host.
3. Does the CA need ongoing sync, or is a one-time import enough?
