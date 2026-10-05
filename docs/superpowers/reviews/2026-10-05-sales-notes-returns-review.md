# Customer notes and sales returns review — 2026-10-05

## Delivered scope

Decision037: original-invoice customer credit/debit notes, GST-adjusting or commercial treatment,
partial company-owned stock returns at recorded original dispatch cost, automatic source-invoice
application and remaining customer credit, later exact bill-ID applications, foreign carrying/FX,
immutable evidence/reversals, dedicated editor/list and statutory printing.
Additive migrations0012/0013 preserve shared0011 and existing settlement identities/rows.
Default-branch execution and normal final push were explicitly requested. Shared books are not activated.

## Independent review and fix pass

One fresh reviewer inspected03d5f93..0bad597 with the approved spec, plan, five deliberate review
focus paths and ledger rulings. Source review found two Important issues, no Critical or Minor.
No reviewer fixture execution or repeated review; implementation verification follows below.

1. Cancelling an unused debit could remove the financial/GST ceiling supporting a surviving credit.
   Reproduced cancellation201 instead409. Under the accounting lock, cancellation now checks surviving
   per-line financial, GST taxable and GST component ceilings before reversing any evidence.
   Commercial and separately isolated GST dependencies pass; cancellation works after releasing credits.
2. A valid zero-cost physical return required nonexistent original dispatch account rows.
   Reproduced submission409 instead201. Verified original posting/no-value evidence now permits a
   no-value return disposition with real quantity/FIFO and immutable return effects. Nonzero costs retain
   the original inventory/expense account requirement. Submit and exact cancel pass.

Other reviewed focus paths: financial vs physical ceilings; recorded delivery value vs later FIFO
rates; nullable old allocation source compatibility; UUID rather than display-reference matching;
atomic rollback after consumed stock. No additional concrete blocker was reported. The reviewer
explicitly set aside approved commercial/GST, declaration, IRN and historical-tax Finance policies;
all are resolved in the rulings below.

## Verification

All thirteen focused API fixture files pass, reporting530 request checks; all configured root checks pass. Eight production browser suites passed; final note replay against the fresh release build also passed.

- Build11, typecheck16 and60 uncached unit tests pass. Lint runs zero tasks and provides no lint coverage.
- Focused note API fixtures cover exact printed component GL, commercial-only base separation,
  fractional quantity/final residual, paid source credits and later applications, debit dependencies,
  original-cost and zero-cost stock, immutable evidence, consumed/landed-cost reversal refusal,
  four PostgreSQL race barriers, scoped roles, seller snapshots, original inactive account corrections,
  exact November30/next-day expiry, inactive/historical source, declaration/date/typed-allocation guards and foreign partial/final FX/LUT/IRN gate.
- Existing settlement93, six accounting suites202 plus review8 and cancellation lock-order barrier,
  inventory43, selling48, buying60 and imports39 passed before the final review fixes.
- Eight production browser suites passed: note workflow, submit-only approval, invoice balances,
  selling, buying, accounting, settlements and physical/commercial/LUT note variants. The note workflow is repeated against the final API fixes.
- Actual additive migrations were applied to the selected local integration database, preserving legacy
  allocations. The schema compatibility check passes;0011 remains byte-identical to the shared base.
- Scripts default toAPI4000/web3000 and accept standard overrides. Local checks usedAPI4001/web3001
  and system Chromium. Fresh authentication fixtures were spaced12 seconds apart.

Observed RED→GREEN: absent note route, missing core helper, printed tax/account precision,
commercial-debit GST dilution, fractional quantity, landed-cost reversal, submit-only draft totals,
and both independent review findings. Original broad stock integration tests were written after the
service implementation; no initial RED cycle is claimed for that broad fixture. Isolated direct DB
fixtures test persisted landed-cost changes, master-data edits and prior-activation cut-over metadata for
  exact statutory expiry boundaries; duplicate references use two real GST registrations;
no shared/deployed data was mutated. UI return costing is additionally covered by API integration;
additional production browser variants cover physical returns, commercial debits and foreign LUT. Production print is browser print/PDF,
not an external PDF service.

## Rulings in execution order

- Ruling: Use this existing cloud checkout on the default branch — explicit user instruction overrides worktree recommendation — no impact outside isolated checkout until authorized normal pushes.
- Ruling: Remote skill scripts are not installed locally; keep equivalent task briefs/progress/tests manually in this plan's ignored workspace — continuity remains explicit — costs loss of helper automation if incorrect.
- Ruling: Refuse ambiguous original custom tax-account evidence rather than guess a component account — original ledger lacks role snapshots for already-remapped custom accounts — those rare sources require Finance review if not identifiable; costs a blocked note instead of misposted tax.
- Ruling: Foreign credit800 applied to receivable830 creates FX loss30, not gain30 as the plan example said — the paired control lines need debit FX30 to balance — incorrect sign would misstate profit.
- Ruling: Commercial-only debit does not enlarge the GST-adjusting supply base — those amounts reverse through commercial credits — tax components remain original-rate and bounded; costs separate notes for mixed commercial/statutory corrections.
- Ruling: Add a second additive migration for seller snapshots rather than alter applied0012 — statutory print must not change with later company/address edits — costs an extra migration but protects existing history.
- Final: Ruling: Approved commercial versus GST treatment stands — the user selects the supported financial/statutory correction required by decision037 — wrong classification could produce an inappropriate GST claim.
- Final: Ruling: Approved eligibility declaration policy stands — user confirms deadline and annual-return status; this slice has no filing-status integration — an incorrect declaration could permit an ineligible GST reduction.
- Final: Ruling: Approved IRN scope stands — GST notes at applicable registrations are refused pending the separate IRN workflow — customers needing those corrections remain blocked until that phase.
- Final: Ruling: Finance handling of ambiguous historical tax-account evidence remains manual — no original role snapshot exists and guessing risks wrong statutory accounts — rare notes can be blocked pending Finance review.
- Ruling: Use existing BadRequest400 for invalid/backdated note inputs, preserving409 for live financial/stock conflicts — the design requires refusal, while the plan guessed409 for every date failure — clients expecting a409 for malformed/invalid dates must handle the documented400 response.
- Ruling: Exercise stock return orchestration through authenticated note API fixtures rather than the plan's preliminary in-process domain harness — this verifies real transaction/accounting/permission boundaries without introducing a posting endpoint — original broad stock tests lack an initial RED cycle, as disclosed in the review.
- Ruling: Pass the freshly calculated server preview lines into the internal return service — the note caller revalidates under the accounting lock and owns the cost evidence — future internal callers must supply verified current preview evidence, not arbitrary/stale values.

## Deferred minors and next scope

None from the independent review. Supplier notes/returns and NIC/e-way bill remain separate written-design
slices. Refunds, filing integration, TDS/TCS, bank charges and shared-entity activation remain outside this
approved customer slice. GST notes requiring IRN are refused until their statutory workflow exists.

Final implementation/review fixes: `8dcab29`; expanded verified coverage: `b14036d`. Final release build11/typecheck16/unit60/lint0 and fresh production note replay pass. Normal final push and remote-head verification complete the handoff.
