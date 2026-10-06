# Configurable withholding tax and bank charges

Status: Proposed written design for user review; no product implementation authorized by this artifact.
Date:2026-10-06 (Asia/Kolkata). Next user-requested slice after verified NIC offline delivery.

## Intent and success criteria

The user requested accounting TDS/TCS, bank charges and bank reconciliation, with configurable workflows and continued Native/default-branch delivery. This first design covers withholding/collection accounting and charges; statement reconciliation is a subsequent design. Finance needs correct tax liabilities/assets, Accountant needs a reviewed settlement preview, and existing invoice, bill, FX, credit-note and inventory behavior must stay exact.

A supplier invoice or advance recognizes applicable TDS at the verified earlier credit/payment event. Later payment never deducts the same base again. A customer receipt can close a gross bill using net bank money plus evidenced customer TDS and charges. Scrap TCS is separately visible and recoverable/collectible without becoming sales revenue or GST taxable value. Finance can configure effective-dated profiles and certificates; submitted documents retain original rules, identities and accounts. No shared books activation, statutory filing, bank connection or NIC sending is authorized here.

Assumption for review: integrate verified resident-business TDS and scrap TCS first; non-resident treaty/gross-up cases use an explicitly reviewed tax-advice workflow until a separate verified rule profile supports them. Payroll, income-tax returns and bank-statement matching are outside this first slice.

## Approaches and recommendation

1. **Recommended: integrated, versioned tax evidence plus settlement components.** Invoice/advance events, threshold counters and typed bill effects share the existing accounting transaction. Cash, tax and charges remain distinct. More implementation work, but it prevents duplicate deduction and incorrect outstanding/FX.
2. **Manual tax journals plus charge fields.** Quick initial screens, but generic journals cannot reliably establish earlier-event consumption, certificate capacity, tax-year totals or invoice/payment deduplication. Not recommended as the sole tax mechanism.
3. **Bank charges first; tax afterward.** Smallest immediate change, but leaves the requested TDS/TCS workflow incomplete. Charges can be an implementation milestone within approach1 without splitting the financial model.

The proposed design selects approach1. These business/data-model choices are Proposed until written approval; decision040 must not be marked Accepted prematurely.

## Current statutory evidence and activation gates

The original compliance notes name194C/194J/194I/194H/194Q/195 and26Q/27Q/16A. Those are historical aliases, not an adequate2026 posting/export profile.

Official CBDT transition guidance retrieved2026-10-06 confirms:

- Earlier credit/payment on or before2026-03-31 uses the1961 Act; on/after2026-04-01 uses the2025 Act. Tax year2026-27 begins2026-04-01.
- Current non-salary TDS references section393 and the applicable table/item; TCS references section394. Keep both current citation and legacy alias, with separate effective dates.
- Current resident non-salary statement Form140 replaces26Q; non-resident Form144 replaces27Q; TCS Form143 replaces27EQ; non-salary certificate Form131 replaces16A. Prior-period corrections retain old forms.
- Certificates spanning the transition require the actual certificate's governing provisions/period, not an automatic relabeling of a197 certificate.

Sources accessed successfully:

- [Official2025 Act hub](https://www.incometaxindia.gov.in/income-tax-act-202511), [Act detail](https://www.incometaxindia.gov.in/income-tax-act-2025), [Rules2026](https://www.incometaxindia.gov.in/income-tax-rule-2026), [Forms2026](https://www.incometaxindia.gov.in/income-tax-forms-2026).
- [CBDT updated interplay/transition guidance, version2](https://www.incometaxindia.gov.in/documents/20117/43120/Updated-FQAs-on-Interplay%26Transitions.pdf/dda21cfd-28be-d931-ad5c-6459ecbd2ea7?version=2.0&t=1775128133037&download=true), SHA256`cf1d4ad8e7c7bc144dae8102f0418b2b8bbf4e2789e9a10dabf296fe8c43b62a`; Q2.3–2.6, Q6.10, Q6.14–6.15.
- [CBDT transition provisions guidance](https://www.incometaxindia.gov.in/documents/20117/43120/FAQs-on-Transition-Provisions.pdf/2d93bf1c-70d8-faa0-e14a-5bdcde2474c6?version=1.0&t=1783337846336&download=true), SHA256`2c21e2daa355b8e1d145761ce0556533ba8d4d90da009b851500a0eb5fc5934c`; Q21–23 on certificates.

These sources verify the transition, not every rate/threshold/base/exemption or a current filing serializer. Before any enabled automatic profile ships, verify its actual section/table/item, applicable Finance Act/rules/circulars, rates, payer/payee categories, thresholds, GST treatment, timing and certificate compatibility. Retain source revision/digest and test vectors. Unverified templates stay draft and cannot calculate/post as statutory defaults. No guessed current rate, deprecated general-sale TCS or obsolete form exporter is seeded as active.

## Configurable policy and Finance activation

Tax settings are scoped per legal entity/deductor, with TAN/PAN, tax-year boundary and jurisdiction evidence. Activation is deliberate Finance action on the current business date, independent of accounting activation. Active books are required; adding defaults never activates any entity.

Finance configures immutable effective-dated profile revisions: tax category, current statutory citation and historical alias, residence/person/payment nature, rate, base inclusions/exclusions, single-event/cumulative threshold, whole-base-versus-excess behavior, timing, rounding, higher-rate conditions, applicability exceptions, TDS/TCS precedence, account mappings and source authority. Profile selectors may default from party, item or expense account; ambiguous/conflicting selectors require explicit reviewed choice. A party default never establishes statutory eligibility by itself.

PAN status and eligibility are dated evidence supplied by Finance; no live PAN lookup is implied. Counter identity aggregates the same payee PAN across duplicate party masters within the legal entity and tax year. Missing-PAN cases require the profile's verified treatment and a reviewed identity; they cannot be split across party IDs to evade thresholds. Existing cumulative base, deducted/collected tax, deposits and advance base are imported as a reviewed tax opening register. Opening tax liabilities/assets must reconcile to existing GL; imported history is evidence, not a second GL posting.

Finance also reviews each pre-activation open bill/advance's tax history and remaining untaxed base. Unknown history blocks automatic tax application to that source. No historical invoice replay, retrospective rewriting, silently assumed zero deduction or retroactive profile changes. New-source posting uses the active revision and atomically revalidates all conditions.

Certificates store number, issuing authority/Act, payee and deductor identity, category, rate, validity, base/tax limits and documentary reference. Aggregate utilization and reversal are append-only, protected by the entity accounting lock. Certificate expiry or a new PAN status does not rewrite a submitted event.

## Posting model and earlier-event consumption

Use a tax calculation engine in the existing compliance package; the API supplies scoped stored evidence and cumulative state. Amounts are decimal strings and exact fixed-point/rational arithmetic. The profile defines final rounding explicitly; residuals use a reviewed rounding mapping, never an unexplained balance plug.

Supplier invoice: preserve the existing gross purchase/GST/FIFO posting, then recognize TDS in the same transaction as a linked tax voucher: debit original payable control, credit TDS payable. Synchronize/identify the gross invoice bill before appending the typed negative tax bill effect. Purchase matching, GST taxable values and printed supplier gross amounts stay intact; the payable balance reflects the deduction.

Supplier payment after invoice: pay its remaining bill balance. Previously taxed base contributes no second TDS. Supplier advance: distinguish gross party advance, actual net cash and TDS payable; capture the base consumed before invoice credit. Later invoice/application links that evidence to the same obligation and consumes remaining eligible base only. Duplicate clicks and competing invoice/payment submissions cannot consume base twice. Finance reviews unallocated advances' nature/profile; no automatic deduction from an unidentified payment merely because a supplier has a default.

Customer TDS: record documentary deduction advice and exact bill allocations, independent of statutory tax payable to our government. Debit TDS receivable, credit original AR control; receipt may create this advice atomically. A standalone advice closes only its evidenced bill portion and moves no bank money. Reconciliation/import from26AS/AIS is later; recording advice does not claim government credit confirmation.

Scrap-sale TCS: a verified profile adds a separate TCS collectible component: debit AR, credit TCS payable. It is excluded from revenue and GST taxable components. Capture its source and invoice print separately: preserve GST invoice subtotal/grand-total components and show TCS plus total payable as distinct stored amounts. The payable print total includes collectible TCS without adding it to GST taxable value. Supplier-collected TCS, when supported/evidenced, debits TCS recoverable and credits AP. TDS/TCS overlap follows the verified profile's explicit precedence; never charge both by independent defaults.

Typed tax sources are registered as self-recorded in BillService so GL reference matching cannot add a second effect. GL/trade-bill reconciliation must pass after every event. Tax events preserve exact original account IDs; reversals of historical/remapped accounts need original-source evidence, not current mappings or blanket permission to post to inactive accounts.

## Settlement and charge components

Retain existing settlement API meaning for legacy documents: `amount` is actual principal transferred to/from the party, excluding separately modeled bank charges. With no new components, existing postings and later allocations remain unchanged. Present new fields explicitly as principal cash, tax advice, bill settlement value, charges and actual bank movement; do not overload an invoice's gross amount into the cash field.

For a customer receipt, bill settlement value = principal cash + newly recognized customer TDS. Bank net credit = principal cash − entity-borne charge. For supplier payment, bill settlement value = principal cash + newly recognized payment-stage TDS; bank debit = principal cash + entity-borne charge. Invoice-stage TDS has already reduced AP and is not included again. Existing credit-note/on-account applications remain separate linked effects.

All bill allocations equal bill settlement value, not net bank movement. Unallocated balance must identify its cash-versus-tax source; tax cannot become an unexplained on-account cash advance. New tax advice requires exact bill/source allocation, while supported supplier advances carry explicit advance tax identity. Tax-only cases use an independent advice/event document; existing settlement `amount>0` is preserved. Charges cannot exceed receipt principal unless a separately approved bank-only document handles the difference.

Illustrative arithmetic, not statutory defaults:

- Customer bill100000, evidenced customer TDS10000 and bank charge100: principal receipt90000; bank89900. DrBank89900 + DrTDS receivable10000 + DrCharges100 = CrAR100000.
- Supplier invoice118000 including separately recorded GST, illustrative TDS1000 already recognized: net AP117000. Payment117000 plus charge50 debits AP117000 + Charges50 and credits Bank117050; it creates no second tax liability.
- Reviewed supplier advance gross100000, illustrative TDS1000: DrSupplier advance100000, CrBank99000, CrTDS payable1000. Its base links to later invoice evidence and is not deducted again.

This release supports INR tax-bearing events and INR charges. Legacy foreign settlements continue exactly; mixed FX tax, treaty/gross-up and charge currencies are refused through the new component path until separately designed. Never force INR tax into a foreign amount or book the difference as FX. Future extension must preserve original bill carrying, source tax conversion and actual bank conversion separately.

Charges support an explicit expense account, base amount, optional documented GST split, eligibility confirmation, bank invoice/reference/date and source linkage. ITC defaults to unavailable without qualifying documentary evidence and Finance confirmation; statement debit alone is insufficient. Eligible tax uses existing input-tax mappings, ineligible tax remains expense. Avoid duplicate posting if the same bank invoice/charge was already recorded elsewhere. Separate bank-only charge vouchers support charges discovered later and expose their bank GL line for future reconciliation. No charge source changes inventory/FIFO or a party bill unless it actually represents a reviewed party adjustment.

## Corrections, chronology and remittance

Submitted calculation/effect rows are append-only. Cancel by exact reversal under the existing entity accounting lock. Once a tax event is remitted, certified, externally reported or consumed by later advance/invoice linkage, destructive cancellation is refused; Finance uses a dated correction document with reason and original evidence. Notes/returns never silently reclaim already remitted withholding. A proposed note requiring tax-base correction presents the separate tax adjustment and dependency before submit; unsupported adjustment is refused rather than corrupting counters or creating a negative hidden balance.

Cumulative/certificate counters include opening evidence and signed reversals. Backdated events before the latest affected counter event are refused until a reviewed recalculation workflow exists; a same-day correction is explicit. Preview returns a revision/hash incorporating applicable profile/certificate/counter/source balances, and submit revalidates under the lock. A stale preview cannot choose a different tax profile or consume a depleted certificate.

Remittance records identify deductor/TAN, Act/tax year, category/period, challan/reference, paid date/amount and linked tax-event allocations. A submitted remittance debits the original tax liability and credits the selected bank, with immutable allocation evidence and duplicate-reference guards. Do not use a supplier payment to settle statutory liabilities. Certificate/reference tracking and categorized registers support CA review; actual portal filing and validated statutory/RPU/FVU serialization require their own verified current format. Initial exports are labeled accounting review data, not submission-ready forms.

## Additive schema and API boundaries

Implementation adds migrations after0018; preserve0011–0018 byte-for-byte. Proposed scoped tables: tax configuration/profile revisions, payee identity/evidence, certificates, reviewed tax openings, source tax assessments, append-only recognition/base-consumption/certificate-utilization effects, deduction advice, remittances/allocations and bank-charge documents. Settlement components are additive, revisioned and immutable on submit; legacy rows have zero/default new components.

Every transactional reference uses tenant/entity scope and composite FKs where possible. Source IDs are validated against actual submitted sources; cross-entity/tenant IDs fail. Unique source/purpose/recognition keys prevent duplicate deductions, and unique source GL/bill effects protect reconciliation. Scoped source snapshots freeze profile, calculation basis, identity, certificate, accounts, source document currency/rate and original components. UI never supplies authoritative computed amounts for automatic profiles.

Retain existing module boundaries: pure compliance calculations, API tax services, shared DB schema; extend operational invoice and settlement hooks narrowly. Tax recognition, bill effects and source submission all commit or all roll back. Lock order stays accounting → source/item. No independent queue, supplier messaging or external provider dependency.

## UI and permissions

Accounts gains Withholding/TCS registers, deduction advice, remittances and bank charges. Settings gains effective-dated tax profiles, certificates, source mappings and activation/opening review. Settlement preview shows original gross bill, previously recognized tax, newly recognized tax, principal cash, charges, net bank and remaining balance. Invoice preview shows tax separately and names the active source/profile revision. Export/print uses source snapshots, correct Act/tax-year aliases and an explicit accounting-review label until official formats are validated.

Accountant reads/prepares/previews/submits routine documents under approved profiles. Finance configures/enables profiles, approves openings/certificates/adjustments, submits protected corrections and manages sensitive tax overrides. Auditor reads/exports only; Stores has no new accounting mutation permissions. Record every activation, revision, exemption/override, advice, deposit and reversal in the append-only audit. Overrides require documentary reason/evidence and permission; they cannot disable ledger balancing or erase tax history.

## Verification gates

- Exact calculation fixtures: base/GST treatment, positive/zero/certificate rates, single/cumulative threshold crossing, whole/excess base, missing/inoperative PAN, certificate expiry/capacity, current/legacy Act references and final rounding. Each enabled profile has verified statutory vectors.
- Real PostgreSQL barriers: two payments cross one threshold, duplicate invoice/payment event, advance consumed concurrently, certificate cap, profile change during preview and cancel versus remittance. One consistent winner; no duplicate bill/GL/counter effects.
- Invoice-before-payment and advance-before-invoice at matching source/partial allocations; each eligible base taxed once. Unknown pre-activation source history blocks automation.
- Customer receipt/deduction advice and supplier TDS: net bank versus gross clearing, bank fees, zero-cash advice, no false FX, exact GL-to-bill reconciliation and unchanged legacy/foreign settlement behavior.
- Scrap TCS exclusions/precedence; credit/debit-note dependencies, remitted-tax correction, original inactive/remapped account reversal and counter chronology.
- Source financial/stock invariance outside deliberate new tax/charge postings; purchase matching and FIFO unchanged. Isolated entities only, no shared activation.
- Role/cross-scope API and production browsers for Finance setup, Accountant preview/submit, Auditor evidence, mobile and snapshot print. Re-run existing accounting/settlement/customer/supplier/stock regressions; root build/typecheck/tests and actual lint-task count.
- Native inline implementation with one fresh independent final review; reproduce Important findings before one fix pass and preserve rulings. STATUS/MEMORY/LOG and normal default-branch delivery.

## Subsequent slice: bank reconciliation

After this slice, write a separate design for scoped bank accounts, statement CSV mapping, exact signed amounts/dates/currency, stable row identities and duplicate detection, explicit matching to existing bank GL movements, partial/group matching, reviewed exception postings and reversal dependencies. Matching alone creates no GL entry. Settlement/charge/remittance links from this slice become eligible candidates. No bank feed, credentials, OFX promise, fuzzy auto-posting or closed-period rule is implicitly accepted here.

## Review status

Inline self-review: proposed business choices and assumptions explicit; original-versus-current statutory references separated; no unverified rates/forms represented as enabled defaults; gross party, principal cash and net bank defined separately; legacy/FX compatibility, counter openings, advance deduplication and remittance dependencies specified. Bank reconciliation and foundation remain separate designs. User written-spec review precedes the Native implementation plan and product claim.
