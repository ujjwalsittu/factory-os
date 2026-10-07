# Outstanding work — 2026-10-07

Current requested foundation/accounting/NIC sequence. Completed implementation and live enablement are separate states; roadmap items already delivered are not repeated as pending.

| Item | Current state | Next concrete step |
|---|---|---|
| Google/Microsoft SSO | Software verified; final corrections on completion branch | [Open PR](https://github.com/ujjwalsittu/factory-os/pull/new/sso-completion-20261007) to main (API403 blocked automation), green CI; live enablement separately |
| Passkeys | Native plugin/source discovery complete; proposed scope awaits review; not implemented | Confirm TOTP policy and optional existing-account approach; review written WebAuthn/recovery spec and plan. SSO corrections must merge before dependent implementation |
| Audited impersonation | Not implemented | Separate scoped SuperAdmin/support consent, expiry and audit design |
| PostgreSQL RLS | Not implemented | Separate database role/context/transaction/pool and migration design; app tenancy checks stay authoritative |
| Live SMTP | Email software complete; delivery disabled | Secure existing-service sender/credentials/payload key, DNS/TLS/connectivity and authorized real mailbox acceptance |
| Live Google/Microsoft SSO | Software verified; providers disabled, no apps/credentials registered | Organization's OAuth apps, secure credentials, exact callbacks, Microsoft tenant UUID and local email verification |
| NIC e-invoice/e-way bill wire adapter | Offline encrypted/mock foundation complete; verified protocol and live sandbox acceptance blocked | Reachable official NIC auth/schema/API contracts or authorized exports, then adapter implementation and real sandbox verification |
| Automatic TDS/TCS | Evidence/engine/available charge scope complete; numerical profiles and source workflows blocked | Official GST-base/PAN-operative relief/lower-nil guidance plus applicability; then invoice/advice/advance recognition, settlement/TCS totals, remittances/corrections and tax UI |
| Bank-charge replacement/later GST adjustment | Not implemented; cancelled original references intentionally reserved | Separate replacement provenance and evidence-only GST adjustment workflow design |
| Finance review/cut-over | Shared old books not activated | User/Finance review of completed workflows and deliberate entity opening/cut-over using reviewed previews |

NIC connectivity states are the last recorded observations in STATUS, not a new live recheck. Evidence gate references: [NIC scope and requirements](../superpowers/specs/2026-10-06-nic-sandbox-design.md), [withholding requirements](../compliance/withholding-profile-evidence.md), [current handoff](STATUS.md).

## Deferred minor follow-ups

- Email: reset `?success=1` can falsely display successful reset without credential/access change; response-state success plus one production browser assertion, estimated30–60 minutes. [Review](../superpowers/reviews/2026-10-06-email-delivery-review.md).
- Bank reconciliation: count total physical records and transaction rows separately at10,000 bound; freeze human bank name/masked identity in print while preserving old snapshot compatibility. [Review](../superpowers/reviews/2026-10-06-bank-reconciliation-review.md).
- NIC mock: successful lookup key replay conflict; clearer sample/source provenance in list/print; original FX conversion evidence; fuller attempt/credential revision/reconciliation detail in UI. [Review](../superpowers/reviews/2026-10-06-nic-sandbox-review.md).
- GL UI: clearer original/reversal status labels; remove unusable cancellation action for manual reversal details. [Review](../superpowers/reviews/2026-10-05-gl-core-review.md).
- Supplier claims UI: contradictory quantity-zero monetary rejection observation; complete accepted/resolved labels and accepted monetary balances. [Review](../superpowers/reviews/2026-10-05-supplier-notes-returns-review.md).

No unresolved Critical/Important finding is recorded for the completed email/bank/NIC offline slices. These minors are separately scoped, not silently included in SSO.

## Broader roadmap after current sequence

Manufacturing/quality (BOM/routing/work orders/job cards/genealogy, job work/ITC-04, inspection/calibration, scheduling); services/resources/subscriptions/timesheets; accounting depth (cost centres, inter-company/consolidation) and GST returns/2B-IMS; IoT/edge/OEE and expanded EHS evidence; later maintenance/CAPA/customer portal/analytics/GSTR-9. [Roadmap](../09-roadmap.md) is a broad plan; STATUS and completed reviews override stale pending labels (for example sales/supplier notes, payments and bank reconciliation are already delivered).

## Implemented in the current requested bundles

Verified optional Google/Microsoft SSO software, durable SMTP email software, bank charges and bank reconciliation, tax evidence foundation and NIC offline/mock groundwork. Live provider issuance, automatic numerical withholding and shared book activation have not been claimed.
