# NIC sandbox offline review

Approved decision039, [spec](../specs/2026-10-06-nic-sandbox-design.md), [plan](../plans/2026-10-06-nic-sandbox.md). Native implementation on the requested default branch. One fresh independent read-only review of33181cf..48d2984. No Critical findings; five Important findings reproduced before one fix pass, committed as779a9fc. No second review. NIC protocol and live provider acceptance remain externally blocked, outside the offline completion claim.

## Important findings and corrections

1. Unknown child recovery: child lookup initially returned409, and unknown children blocked all root actions. Reconcile the deepest uncertain child through a linked lookup, including interrupted lookups; resolve uncertain ancestors and project proven evidence onto the original. Persist canonical mock mutation acceptance evidence including the individual mutation ID. A supplemental repeated-identical extension regression reproduced succeeded instead of unknown before adding that correlation; prior acceptance cannot prove a later identical extension. A document match without proof of that particular cancellation/update/extension stays unknown; never resend the mutation. API72 checks cover accepted remote mutation + expired lease, stale completion refusal, interrupted lookup, all three EWB mutations and unaccepted mutation remainingblocked.
2. Source identity authority: invoice mapping substituted changed party identity; note buyer override accepted a different GSTIN; note seller substituted changed registration identity. Three focused assertions reproduced failures. Preserve stored issued buyer fields and note seller fields, including authoritative null unregistered GSTIN. Explicit source inputs fill missing fields only. UI pre-fills invoice/note issued identity; legacy invoice seller has no historical snapshot and is explicitly captured from available registration/entity evidence.
3. Purchase-return IRN bypass: EWB-prepared snapshot was accepted by an IRN enqueue connection. Reproduced expected rejection missing. Recheck source/capability at enqueue before operation creation; purchase returns are EWB-only regardless of preparation connection.
4. Transport completeness: eight lifecycle assertions reproduced missing road vehicle / non-road documents accepted. Share mode completeness between generation, lifecycle and mock: road vehicle; rail/air/ship document number and date. All replacement drafts are revalidated. Exact provider-specific rules remain blocked.
5. Proportional valuation: returned1/3 of3000000 produced999999.00; tiny0.000001/3 at83.123456 produced0.00 rather than83.12. Use exact BigInt rational arithmetic and round each final INR component to paise. Thirds, tiny quantities, large values and foreign rates pass.

The focused source/boundary regressions contain16 assertions and pass after the single fix pass. Runtime validation failures involving readiness, obsolete fixture name, wrong registration/movement route, missing generic row ID and incorrect fixture seller expectation were test invocation/setup issues, corrected without weakening product assertions. A positive actual-return fixture uses a compact isolated stock series; the default17-character number correctly fails the16-character contract rather than being silently truncated.

## Deferred Minor findings

- Same lookup idempotency key can conflict after successful recovery because the parent now supplies an external ID in the derived hash. A new lookup key remains safe; no duplicate generation is permitted.
- List/print omit explicit sample-versus-source provenance and source reference despite sandbox watermarks; persisted snapshot retains provenance.
- Converted snapshots omit original FX currency/rate/pre-conversion components; actual sources retain original documents, synthetic foreign samples have thinner conversion audit evidence.
- Workspace exposes event kinds/dates rather than full attempt/credential-revision/reconciliation evidence; persisted attempts/events remain available to authorized API/database inspection.

These four Minors were deferred, not fixed in the single pass.

## Execution rulings and costs

1. Existing isolated default checkout and manual ledger replace unavailable remote skill scripts, following the user's Native/default-branch choice. Cost: less automated task bookkeeping.
2. Inject durable storage into the mock provider instead of relying on process memory, so acceptance survives a worker restart. Cost if misconfigured: reconciliation could lose or fabricate remote acceptance evidence.
3. Move generated composite unique indexes before foreign keys in unapplied0018; PostgreSQL otherwise refuses referenced uniqueness. Cost if wrong: upgrade blocks. Previously applied migrations remain unchanged.
4. Register exported sandbox providers/controllers in the existing application DI instead of an unrelated module refactor. Cost: weaker module isolation.
5. Disable automatic resend for all rejected/unknown outcomes until verified safe provider policy exists. Cost: legitimate rejected exercises may need another preparation; uncertainty cannot be bypassed.
6. Commit dependent source/EWB services together around the shared immutable enqueue/action interface. Cost: weaker task-level commit isolation.
7. Use an explicitly simulated one-hour EWB validity in mock evidence, not a statutory calculation. Cost: misleading if simulation labels disappear; current UI/print retain them.
8. Initial preparation UI supports one-line INR samples and road movement; typed API maps stored multi-line/foreign documents and other modes. Cost: advanced samples/modes require API assistance.
9. Independent review template resource was unavailable; equivalent fresh read-only severity/spec package used. Cost: weaker template enforcement; independence and one-review rule retained.
10. Record canonical mock mutation acceptance hash including individual mutation ID and require exact proof for uncertain child recovery. Cost: NIC must supply equivalent authoritative proof before enabling this recovery; older pre-release local mutations without correlation stayblocked, and mock proof is not a NIC wire contract.
11. Treat issued fields, including null GSTIN, as authoritative; explicit inputs fill missing values only. Cost: legacy missing addresses require entry; historical invoice seller identity cannot be reconstructed from absent snapshots.
12. Require mode-complete evidence at generation and lifecycle; full transport replacements are allowed and revalidated. Cost: exact NIC action-specific restrictions remain unverified.
13. Finance preparation itself is audited offline sample/return valuation review; later queue is a separate permission/action. Cost: no mandatory second approval click and no valuation override workflow. These are simulated exercises under decision039, not legal filings or maker-checker changes.
14. Finance/Accountant prepare source-linked evidence; Stores update existing Part B subject to existing source-read and purchase-return Finance gates. Cost: Stores cannot independently prepare every source-linked movement.
15. Accountant-to-Finance approval handoff is API-assisted using captured snapshot ID. Cost: no pending-snapshot review inbox.
16. Never truncate/replace issued document identity to fit16 characters. Cost: standard17+ character stock numbers are refused; future configurable statutory transport identity needs a separately reviewed workflow. Positive return fixture changes only its isolated series before dispatch.

## Verification status

Final root build11/typecheck17 and74 uncached unit tests pass; lint executes0 tasks. Sixteen final API/regression suites pass, followed by nine post-correlation sandbox suites. Distinct focused coverage: schema7 tables, connections10 checks, source/boundary16 assertions, original recovery/two-worker/stale lease, child recovery72 checks, actual invoice/note/purchase-return76, all-mode/fromIRN52, frozen source/cancellation29, sample19, EWB16, real role/approval/scope42. Three actual PostgreSQL advisory-lock barriers cover duplicate clicks and both source-cancellation/enqueue winners. Existing selling48, customer notes50, supplier stock38/cancel42, inventory43, accounting31 and settlements93 checks pass. Actual-source fixture confirms GL, stock ledger, FIFO and trade bill row invariance; seven prior migrations0011–0017 byte unchanged. All six final production browsers pass: sandbox prepare/queue/worker/print/mobile, sandbox readonly, invoice/note source shortcuts and issued identity prefill, selling/statutory print, customer notes/application/reversal, supplier returns/claim print/mobile. Single fix commit779a9fc. Normal default-branch delivery follows this verified handoff; no second review.

Official NIC sandbox/API help/schema, IRP1 and EWB portal still had503 upstream timeouts after allowed-domain restart; EWB docs403 CDN denial, another IRP public KB200. No guessed adapter, provider credentials, real provider acceptance, production statutory calls or shared-books activation. Task5 and real-provider portion of Task8 remain blocked pending accessible official NIC contracts and then whitelisted access/secure credentials.
