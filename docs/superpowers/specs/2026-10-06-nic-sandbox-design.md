# NIC sandbox e-invoicing and e-way bills

Status: written design approved by the user on 2026-10-06; decision039 accepted. Implementation awaits written-plan review.
Date: 2026-10-06 (Asia/Kolkata).

## Intent and sequence

The user requested NIC sandbox design and implementation, then accounting depth
(TDS/TCS, bank charges and reconciliation), then foundation leftovers (email,
SSO, passkeys, impersonation and PostgreSQL RLS). Execute these as separate
reviewable slices, starting here. Continue Native execution on the default branch.
Preserve accepted decisions005/006/020/030/034 and all existing migrations.
No shared entity activation, production statutory submission or taxpayer notification.

Success means an authorized operator can preview a canonical outward document,
register it against a mock or configured NIC sandbox, reconcile an uncertain
result, cancel within the applicable sandbox rules, and inspect immutable evidence.
Real sandbox access is a separate verification requirement, never inferred from
mock tests. This slice establishes a reusable integration boundary without making
sandbox IRNs legal evidence for real invoices.

## Approaches and recommendation

1. Recommended: durable sandbox operations and deterministic mock first, plus a
   NIC sandbox adapter verified against official contracts and real access when
   available. Small, inspectable operations; credentials do not block offline work.
2. NIC-only implementation first: provides immediate external proof if credentials
   exist, but development and failure testing depend on portal access/whitelisting.
3. Full production compliance rollout now: would include legal issuance, dispatch
   release, provider approval and operational cancellation. Too broad for the
   requested sandbox phase; keep it a later explicitly approved slice.

The first approach is approved. It does not choose a different production provider:
NIC remains primary and Adaequare the accepted fallback if NIC access is denied.

## Scope

Include canonical INV-01 validation/mapping for sales invoices and outward GST
credit/debit notes; IRN generation, lookup/reconciliation and cancellation;
e-way-bill generation independently or from an IRN, lookup, Part B updates,
extension and cancellation. Include purchase-return dispatch as an EWB source.
Include mock outcomes, scoped connections, encrypted credentials, audit, request
history, durable retries, role gates and clearly marked sandbox print views.

Start with separate IRN and EWB operations, avoiding an ambiguous combined
response. Do not enable combined generation until both remote outcomes can be
independently reconciled. Consolidated EWB, transporter rejection, bulk operation
screens, GST filing, job-work/delivery-challan generation and live GSTIN lookup
remain outside this slice. Existing stock returns provide movement evidence;
this slice does not create a new inventory or accounting posting.

## Current integration boundaries

`packages/gsp/src/index.ts` is a draft type-only provider interface. It lacks
typed payloads, operation outcomes and document/EWB lookup needed for uncertain
responses. The worker is also a placeholder; do not claim it already runs jobs.
GST registrations contain applicability dates and provider/credential references.
Sales invoice submission currently posts delivery/GL in one transaction; outward
GST notes requiring IRN are currently refused. Existing invoice prints use some
live master data. Sandbox registration must not loosen that statutory note guard,
change invoice shipment semantics or rewrite any financial effect.

Sandbox source preview works from existing submitted invoices/notes where they
exist. To test future-applicable outward notes, use an explicit sandbox sample
document snapshot with no GL/stock/source submission effect; do not create a
real note that bypasses the current applicability guard. Clearly distinguish
source-linked exercises from sample documents in lists, audit and print.

## Environment and connection isolation

Every connection belongs to a tenant/entity/GST registration, capability and
environment. IRP and EWB credentials may differ; preserve separate references.
This implementation permits `mock` and `nic_direct` sandbox only. Server-side
endpoint allowlists exclude production and arbitrary URLs; persisted environment
must be checked again immediately before every send. UI cannot enable production.
Changing a connection affects new operations only; existing operations retain
provider/environment/configuration revision and their own document identity.

Credentials are envelope encrypted using a deployment-held master key and
versioned data keys. No auth-secret reuse, secret values in audit, or credential
readback. Masked metadata supports replacement/rotation; pending operations keep
their configuration revision but use an explicitly rotated credential revision
for a new attempt, recorded in history. Authentication tokens and NIC session
keys remain encrypted and excluded from client responses and request logs.
Finance can configure connections; operators cannot read or replace secrets.

Access status is pending user input. No NIC/GSP credential variables were found
in the current local configuration. Ask for credentials through secure environment
settings only after portal access, outbound static IP and whitelist are confirmed.

## Payload and immutable source evidence

Build payloads from a frozen snapshot of seller, buyer, GSTIN, addresses/PINs,
document number/date/type, supply category, HSN, UQC, quantities and stored tax
components. Persist a versioned payload hash and the source ID/revision. Never
re-read changed party masters during retry. INR statutory representation of a
foreign-currency source uses its original exchange rate and explicit rounding;
no JS floating-point money arithmetic. Validate stored component totals rather
than recomputing GST under today's rates.

Do not silently truncate invalid document numbers or invent missing dispatch,
transporter, vehicle, UQC, address or PIN information. Show field-level errors and
require preparation before sending. Once an attempt may have reached NIC, the
identity/payload is immutable; corrections need a new explicit exercise after
resolving or cancelling the old one. Pre-send validation failures can create a
replacement revision with an audit reason, never overwrite earlier evidence.

Pin official IRP/EWB schema versions, authentication/encryption requirements,
allowed enum values and provider error fixtures before implementing the adapter.
Check current official cancellation/reporting/extension rules rather than adopting
old roadmap figures as current law. Attach retrieved source URLs/version dates to
the implementation plan; unverified thresholds are not production defaults.

## Durable state and concurrency

Add additive tables for connections/credential revisions, source snapshots,
operations, append-only attempts and results. Tenant/entity-scoped foreign keys
and permissions apply to every lookup. An operation records registration,
environment, capability, action, business identity, payload hash, source revision,
requesting actor, attempt sequence and reconciliation outcome.

Generation uniqueness includes tenant, registration, environment, document type,
document number and FY. A separate logical operation key identifies each intended
Part B update/extension/cancellation, allowing a later legitimate update without
replaying an earlier request. Repeated clicks return the existing operation;
different payloads for the same generation identity produce a conflict.

States: prepared, queued, sending, succeeded, rejected, unknown and cancelled.
Append-only events justify transitions; current state is a projection. `unknown`
means a timeout, connection loss or expired sending lease that may have reached
NIC. It is never treated as rejected or retried with generate blindly. Look up
the external document/EWB and compare identity/payload evidence first; mismatches
require Finance review. No operator may manually label an unknown operation as
succeeded without retrieved provider evidence.

Use a small durable database outbox with bounded polling/lease recovery in the
worker for this slice. This does not accept proposed decision017 (pg-boss) or
introduce Redis. Submit/enqueue/snapshot/audit commit together; no network call
inside a document/accounting transaction. Claim with `FOR UPDATE SKIP LOCKED`,
lease token and guarded result writes. A stale worker cannot overwrite a newer
result. Remote exactly-once cannot be promised: an uncertain attempt is reconciled
before resend, and unsupported lookup leaves it blocked for Finance review.
Bound retries/backoff for confirmed safe failures; respect provider rate limits.

## EWB source and transport rules

Sales goods sources and actual purchase-return dispatches require an explicit
transport draft: dispatch/ship-to addresses, movement reason, distance, mode,
transporter and mode-specific vehicle/document details. Service-only invoices
cannot generate EWB. Goods values and quantities come from the selected source;
carrying value of a purchase return is not automatically its statutory EWB value.
Require explicit Finance-reviewed valuation where source evidence does not
determine the statutory value. Refuse unsupported source types rather than
pretend a future challan or customer-owned return is an ordinary sale.

Persist provider issue/validity timestamps with their timezone. Part B update,
extension and cancellation create new operation evidence referencing the original
EWB. Verify provider confirmation rather than infer a new validity period locally.
Local cancellation of a source is blocked while a sandbox operation is queued,
sending or unknown; confirmed success requires an explicit sandbox cancellation
or Finance-recorded detachment of the exercise. This guard prevents misleading
source-linked evidence and does not pretend to satisfy production law.

## UI, roles and printing

Provide Settings → GST integrations and Compliance → Sandbox operations, plus
source-page shortcuts. Preview shows errors, mapped totals and environment before
the explicit send action. Lists distinguish queued, unknown, rejected and confirmed
results; detail shows source snapshot, redacted attempts, reconciliation and action
eligibility. Unknown outcomes prominently explain the blocked retry.

Split connection manage, IRN prepare/send/reconcile/cancel and EWB
prepare/send/update/extend/reconcile/cancel permissions. Finance handles connection
and cancellation; Accountant prepares/sends/reconciles within assigned entities;
Stores prepares transport and updates Part B with explicit permissions; Auditor
reads/exports redacted evidence. Custom roles cannot gain secret visibility.
Sandbox mutation does not imply source invoice/note submit permission.

Sandbox print is a separate clearly watermarked page. Store signed invoice/QR
payload as provider evidence; verify signatures where official keys/contracts
permit. Invalid evidence is quarantined and never represented as verified.
Render provider-signed QR only on the sandbox exercise print, not the legal invoice
print. Existing legal invoice and note PDFs never gain a sandbox IRN or QR.

## Verification and delivery gates

Unit/golden fixtures: mapping, schemas, exact foreign conversion, component
rounding, rule profiles, crypto vectors, response validation and secret redaction.
Mock: generation/cancellation, duplicate success, definite rejection, timeout
after success, token expiry, mismatched lookup, unsupported lookup, EWB update and
extension, no production endpoint access, and frozen source-master changes.
Database barriers: two workers, duplicate clicks, source cancellation vs enqueue,
credential rotation and stale lease completion. Cross-tenant/entity IDs must fail.
API/browser: role separation, source previews, read-only evidence, unknown recovery,
secret write-only settings, mobile and watermarked print. Re-run selling, customer
notes, supplier returns, stock and accounting compatibility; old migrations stay
byte unchanged and shared books inactive.

Run root build/typecheck/tests/lint and report actual counts, including zero lint
tasks. One independent final review under Native, reproduce Important findings
before fixing, then update STATUS/MEMORY/LOG and normal default-branch delivery.
Mock-green is offline verification only. Real NIC sandbox acceptance requires
credentialed generation, lookup and cancellation plus EWB lifecycle evidence on
whitelisted access; absent access is recorded as an external verification blocker,
not a passing provider test. Production rollout is a later reviewed decision.

## Following authorized slices

After this slice: design TDS/TCS and bank-charge postings before bank reconciliation.
Use effective-dated verified tax rules, preserve settled bill carrying and avoid
double deduction at invoice/payment. Reconciliation then imports statements with
duplicate protection, matches existing entries and separately approves postings.
Foundation work follows in separate slices: real email delivery, SSO provider
configuration, passkeys, guarded 30-minute audited impersonation, then RLS with
pooled-connection transaction context and explicit auth/platform/worker exceptions.
Provider credentials, tax rules and RLS role design need their own written designs;
this document does not pre-approve their business/security choices.
