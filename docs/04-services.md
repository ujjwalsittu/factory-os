# 04 · Services (Azeonics MaaS + EarthNow)

Services are a first-class half of FactoryOS, not "items with is_stock=false".

## Shared building blocks

| Block | Purpose |
|---|---|
| **Resource** | Anything bookable: a machine (5-axis M-03), a chamber (TVAC-1), a cleanroom bay, a lab, a ground-station antenna, a person/role |
| **Rate card** | Price per unit of a resource/service: per hour, per day, per pass, per hectare, per board; member vs non-member; academic/startup discounts; validity dates |
| **Booking** | Calendar reservation of resources (tentative → confirmed → in-use → completed); clashes with production work orders visible on the same scheduler |
| **Usage record** | Metered consumption: from IoT (spindle-on hours, chamber run hours), from job cards, from timesheets, or manual — the single input to billing |
| **Service order** | Commercial container: customer, scope, resources, rate card, customer-owned items received |
| **Project** | Milestones, tasks, deliverables, budget vs actual (material, machine, labour, cloud), WBS |
| **Contract / subscription** | Recurring billing plan with included allowances, overage, renewals, price escalations |
| **Billing run** | Usage + milestones + subscriptions → draft invoices per entity, reviewed, submitted → e-invoice |

## Azeonics flows

1. **Hourly machine time**: customer books M-03 for 6 h → arrives → IoT meters 5.4 spindle-hours +
   setup recorded on job card → usage records → invoice at rate card (min-billing rules).
2. **Test campaign**: service order "TVAC qualification, 5 days" → chamber booking → customer
   payload received under **inward challan** (custody, not stock) → test logs from chamber sensors
   attached → test report (templated, signed) → invoice → payload returned with outward challan.
3. **Studio membership**: annual plan (e.g. 100 machine-hours + 10 lab-days) → usage draws down
   credits → overage invoiced monthly → renewal reminders.
4. **Idea-to-Orbit bundle**: a project template that spawns service orders, work orders and
   bookings, billed by milestone.
5. **Ground station**: pass schedule (from mission ops) → pass usage records → monthly invoice.

## EarthNow flows

1. **Subscription**: customer × solution (e.g. crop health) × AOI (area in ha) × cadence → monthly
   / quarterly invoices; AOI changes prorated.
2. **Government project**: tender → bid (EMD paid, tracked as a receivable deposit) → award →
   **performance bank guarantee** register (expiry alerts) → milestone deliverables → invoices with
   **retention** held → TDS 194J deducted by customer → reconcile with 26AS/AIS.
3. **Cost of delivery**: imagery purchases (often from foreign vendors → RCM IGST on import of
   services) and cloud/GPU bills allocated to projects → project margin.
4. **Timesheets** for analysts against projects → labour cost and T&M billing where applicable.

## Customer portal (later phase)

Customers see bookings, campaign status, test reports, invoices, certificates, membership balance,
and EarthNow deliverables — a real differentiator against Frappe for a MaaS business.
