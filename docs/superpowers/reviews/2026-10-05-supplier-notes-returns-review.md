# Supplier notes and purchase returns review

Approved decision038, [spec](../specs/2026-10-05-supplier-notes-returns-design.md), [plan](../plans/2026-10-05-supplier-notes-returns.md). Native execution on the requested default branch. Product range e303130..a86d3a1; one fresh independent read-only review. No Critical findings; five Important findings reproduced, all fixed and targeted regressions pass. No second review.

## Important findings and reproduced defects

1. Existing entity mappings: newly required pending/variance controls absent; upgrade regression observed 0 instead of2. Fill missing defaults without replacing chosen mappings or activating books; seed through scoped supplier endpoints.
2. Remapped variance: acceptance-first cancellation left240 in original control rather than0. Compensation now uses the linked dispatch's original variance account, including inactive evidence.
3. Combined dispatch: two lines reused one receipt allocation and posted8 against6; expected409. Stage aggregate receipt-allocation consumption before creating stock evidence.
4. Chronology: backdated acceptance/resolution consumed later dispatch/restoration; both observed201 rather than409. Reject dates before recorded signed return, acceptance, source-note and resolution activity.
5. Saved draft selection: production browser reproduced missing receipt options after submit recreated line UUIDs. Reconcile selection by original invoice-line identity and clear dependent choices/previews.

6. Additional fix-pass browser validation: default manual-credit amount10.000000 received400 from the two-decimal allocation API. Normalize trailing zeros as text and refresh the default after balance changes; no client financial arithmetic.

All six defects have observed RED→GREEN API/browser regressions in the single fix pass, committed as 4e198c6. No second review or fix pass.

## Deferred minors

- A quantity-zero monetary rejection may describe already accepted value. It is an audit observation and does not change books, but can be contradictory.
- Claim labels omit fully accepted/completed resolution states and monetary accepted balances; detailed quantity/pending evidence remains visible.

## Verification

Final API/schema sweep: 52 scenarios pass (33 supplier, 19 existing accounting/settlement/customer-note/inventory/imports/buying regressions). Root build11/typecheck16 and 63 uncached unit tests pass; lint executes0 tasks. All 11 distinct production browser walkthroughs pass: supplier notes, supplier returns, saved supplier draft, default supplier credit, buying, imports, accounting, settlements, customer notes, read-only customer-note approval and customer-note variants. Six supplier PostgreSQL concurrency barriers pass. No live provider calls, supplier notification or shared books activation. Old migrations0011–0013 unchanged; local isolated fixture migrations0014–0017 additive.

## Rulings

- Work in existing cloud checkout on requested default branch — explicit user preference and onboarding isolation — wrong choice could expose unfinished changes; product commits stay local until verified.
- Use equivalent local ledger/brief scripts because remote skill scripts are not installed — preserve required records — less automated enforcement if wrong.
- Native migration CLI needs node --env-file=.env packages/db/dist/migrate.js from root — pnpm db:migrate does not load root env — failing to load could target the wrong database; no URL exposed.
- Supplier duplicate-reference uniqueness applies to submitted notes, matching invoice lifecycle — duplicate drafts are permitted, posting rejects duplicates — drafts could confuse operators until submission.
- Existing buying purchase invoices are /purchase-invoices, not /buying/purchase-invoices — corrected test fixture route — future callers must use existing route.
- API lifecycle test first hit fixture route error; valid absent-policy404 observed after service source was written but before runtime deployment — no original API implementation-first RED claim — weaker TDD evidence for this service; core/roles and explicit defects retain RED→GREEN.
- Policy edit/dispatch race belongs Task3 when dispatch exists — verify there before Task2 final completion record — premature task completion would overstate concurrency coverage.
- Additive0015 records preaccepted dispatch qty/value — applied0014 remains immutable, preserves either-order evidence — omitted evidence would leave pending value double-counted.
- Supplier note reference duplicates detected on posting; registered inward-tax fixtures required — unregistered suppliers correctly carry no supplied GST — misleading fixtures could overstate tax coverage.
- Store exact acceptance-effect qty/cost links in each dispatch — proportional aggregate allocation cannot identify which note covered dispatched goods — omitted attribution understates unresolved carrying after partial cancellation.
- Receive-back stock document owns its actual GL, resolution identity records no-value delegation — lets existing stock guards reverse its own evidence atomically — wrong ownership would refuse legitimate cancellation or duplicate GL.
- Debits may exceed original taxable value, while GST credit ceilings remain independently bounded — debit adjusts consideration, not original quantity — wrong bound rejects legitimate supplier charges.
- Supplier rejection responses use the existing scoped append-only hash-chained audit event rather than a second evidence table — responses have no accounting or inventory effect and retain actor/reason/lines/policy suggestion — querying audit history becomes part of claim availability. Repeated responses are observations, not cumulative consumption.
- A claim spanning multiple historical pending-return controls refuses acceptance/resolution for Finance review — aggregate carrying evidence cannot safely pick one account — legitimate mixed-control claims need a later explicit allocation flow.
- Allocate dispatch-first acceptance carrying in original ledger order and persist exact dispatch links — averaging different dispatch rates violates receive-back carrying evidence — changing allocation ordering changes return variance timing. Legacy acceptance without links refuses for Finance review.
- Backend tasks share controller/stock/GL integration and were verified together before staging task commits — avoids committing a runtime with unavailable dependent providers — task-level commit isolation is weaker than planned.
- Start the one fresh final code review on frozen product commits while the serial regression sweep runs — reviewer is read-only and publishing still waits for every check/fix — the reviewer may lack final runtime results.
- Quantity correction retains original invoice-priced quantities; negotiated consideration uses a separate value adjustment and cannot imply physical acceptance — preserves original printed-component and physical ceilings — negotiated quantity/price combinations need a future explicit workflow.
- Received-back goods do not reopen gross dispatch capacity — spec forbids spending previously dispatched quantities again and preserves gross matching — a legitimate resend after complete return needs an explicit later workflow.
