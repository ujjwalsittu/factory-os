# Inspection plans on purchase-receipt inspections — design (decision 052)

Follow-up 1 from the [2d review](../reviews/2026-10-09-manufacturing-2d-review.md): the 1b purchase-receipt
inspection (`quality_inspection`) does not use inspection plans yet. User choices, 2026-10-11:

1. **Plan required.** When a received item has an *active incoming* inspection plan, its receipt inspection records
   the plan's characteristics (every planned sample, calibrated gauges) before it can be submitted. Items without an
   active incoming plan keep today's quick accept/reject form.
2. **NCR for plan-based rejections only.** A plan-based inspection raises an NCR for the rejected quantity (stock held
   in MRB, all five dispositions including return to vendor), like in-process and final inspections. The quick form
   keeps moving rejected stock to the MRB warehouse without an NCR.

## How it works

- **Pending list** (`GET /inspections/pending`) adds, per receipt line, whether the item has an active incoming plan
  and the quantity already in open (draft) plan inspections. Pending = received − submitted − open drafts.
- **Start** (`POST /quality/inspections/receipt`, `quality.inspection.create`): for a company-owned, submitted receipt
  line in quarantine whose item has an active incoming plan. Takes the quantity (≤ pending) and an optional stores
  warehouse (default: first active stores warehouse). Opens a draft `inspection_record` (stage `incoming`, source
  `receipt`, source id = receipt line, hold = the quarantine warehouse, accept = stores, the active plan frozen on
  it). The UI then opens the existing inspection page (`/app/quality/inspections/[id]`).
- **Results and submit** use the existing inspection endpoints: results are appended with gauge checks; submit needs
  every planned sample, moves accepted stock from quarantine to stores and raises an NCR for the rejected quantity
  (stock to MRB). In the same transaction it writes the 1b `quality_inspection` row (its own QI number, quantities,
  result, the record link, the transfer and the MRB warehouse), so receipt pending quantities, the incoming inspection
  list, attachments on the receipt inspection and the "receipt has been inspected" cancel guard keep working.
- **Quick form refused** (`POST /inspections`) when the item has an active incoming plan and the line is company-owned:
  "This item has an incoming inspection plan; record its results".
- **Cancelling:** a draft plan inspection can be cancelled (stock stays in quarantine). A submitted plan-based
  inspection stands, as in 2d: corrections go through its NCR. Cancelling the receipt withdraws open drafts and is
  refused once any inspection is submitted (existing rule).
- **Customer-owned material** (a receipt line with an owner) keeps the quick form even when a plan exists: quality
  transfers and NCR dispositions do not carry stock ownership, and return to vendor does not apply to customer
  property. Recorded as a scope limit.

No migration: `inspection_record` already has source `receipt`, and `quality_inspection.inspection_record_id` exists.

## Tasks

1. Claim in STATUS, this design and decision 052 to main (docs-only PR).
2. API: pending fields, plan-record start, quick-form refusal, submit hook writing the 1b row, draft cancel for
   receipt-sourced records, receipt cancel withdrawing drafts. Smoke `smoke-receipt-inspection-plans.mjs`.
3. Web: incoming inspection page shows the plan and open drafts, "Inspect against plan" opens the record; the
   inspection page shows the receipt it came from. E2E `receipt-inspection-plans.mjs` desktop and 390 px.
4. Regression (buying, quality, FAI smokes; buying and quality browsers), root checks, review, STATUS/LOG, PR.
