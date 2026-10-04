# 14 · Wireframes (low fidelity)

Low-fidelity layouts for Phase 0 screens and the key Phase 1–2 screens. Built screens in
`apps/web` follow these. Spacing, colour and type come from the tokens in `packages/ui`.

## W1 · Landing page (public, `/`)

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ ◆ FactoryOS     Product  Compliance  IoT  Pricing  Docs        [Sign in] [Book demo] │
├──────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│   The operating system for precision                ┌──────────────────────┐ │
│   manufacturing and services in India.              │ product screenshot:  │ │
│                                                     │ work order cockpit + │ │
│   Batches to balance sheet. GST, e-invoice          │ live machine status  │ │
│   and e-way bill built in. Machines connected.      └──────────────────────┘ │
│   [Book a demo]  [Sign in →]                                                 │
├──────────────────────────────────────────────────────────────────────────────┤
│ Trust row: AS9100-ready traceability · GST/IRP/EWB · Multi-entity · Data in India │
├──────────────────────────────────────────────────────────────────────────────┤
│  ┌ Manufacturing ┐ ┌ Services & MaaS ┐ ┌ India compliance ┐ ┌ Machines & IoT ┐  │
│  │ BOM, routing, │ │ machine-hours,  │ │ GSTR-1/3B, 2B,   │ │ CFX, MTConnect,│  │
│  │ heat-number   │ │ test campaigns, │ │ IRN, EWB, TDS,   │ │ OPC UA, OEE,   │  │
│  │ genealogy     │ │ memberships     │ │ MSME, ITC-04     │ │ metering       │  │
│  └───────────────┘ └─────────────────┘ └──────────────────┘ └────────────────┘  │
├──────────────────────────────────────────────────────────────────────────────┤
│ "Trace any part from heat number to delivered serial"  [genealogy graph image] │
├──────────────────────────────────────────────────────────────────────────────┤
│ For accountants: Tally keys, Tally import & sync           [screenshot]        │
├──────────────────────────────────────────────────────────────────────────────┤
│ Security: MFA, role-based access, audit trail, data in India                  │
├──────────────────────────────────────────────────────────────────────────────┤
│ CTA band: Ready to run your factory on FactoryOS?   [Book a demo]             │
│ Footer: Product · Company · Legal (Privacy, Terms, DPDP) · © Azeonics          │
└──────────────────────────────────────────────────────────────────────────────┘
```

## W2 · Sign in (`/sign-in`) and MFA

```
┌───────────────────────────────┬──────────────────────────────────┐
│ ◆ FactoryOS                   │                                  │
│                               │   brand panel: product imagery,  │
│ Sign in                       │   one-line value statement       │
│ Email     [________________]  │                                  │
│ Password  [________________]  │                                  │
│ [ Sign in ]                   │                                  │
│ ─────────── or ───────────    │                                  │
│ [ Continue with Google ]      │                                  │
│ [ Continue with Microsoft ]   │                                  │
│ Forgot password? · Create account (only if invited / self-serve on) │
└───────────────────────────────┴──────────────────────────────────┘
MFA step:  "Enter the 6-digit code from your authenticator"  [_ _ _ _ _ _]  [Verify]
           Use a passkey instead · Use a backup code
```

## W3 · App shell

```
┌────────┬─────────────────────────────────────────────────────────────────────┐
│ ◆      │ [Azeonics Pvt Ltd ▾]   [⌘K Search or jump to…        ]   🔔  (PK) ▾ │
│ Home   ├─────────────────────────────────────────────────────────────────────┤
│ Sales  │ Breadcrumb / Page title                          [Secondary] [Primary] │
│ Purch. │                                                                     │
│ Inven. │                       content                                       │
│ Mfg    │                                                                     │
│ Qual.  │                                                                     │
│ Serv.  │                                                                     │
│ Accts  │                                                                     │
│ Compl. │                                                                     │
│ ⚙ Set. │                                                                     │
│ ⛨ Plat.│  (Platform appears only for SuperAdmin)                             │
└────────┴─────────────────────────────────────────────────────────────────────┘
```

## W4 · Home dashboard (role-based)

```
 Good morning, Prachi · Azeonics Pvt Ltd · FY 2026-27
 ┌ Waiting on me (7) ┐ ┌ Receivables ┐ ┌ GST due ┐ ┌ Machines now ┐
 │ 3 POs to approve  │ │ ₹42.3 L     │ │ 3B in 6d│ │ 4 run 1 idle │
 │ 2 NCRs, 2 GRNs    │ │ 31% overdue │ │ 1 IRN ✖ │ │ 1 alarm      │
 └───────────────────┘ └─────────────┘ └─────────┘ └──────────────┘
 [Work orders by status chart]     [Today's bookings: machines, chambers]
 Recent activity timeline
```

## W5 · List view (any doctype)

```
 Sales invoices                                   [Import] [Export] [+ New  F8]
 [Saved view: My open ▾] [Search…] [Status ▾] [Party ▾] [Date ▾] [+ Filter]  ⚙ Columns
 ┌──┬────────────┬────────────┬──────────────┬──────────┬───────────┬────────────┐
 │☐ │ Number     │ Date       │ Customer     │ Amount ₹ │ Status    │ IRN / EWB  │
 ├──┼────────────┼────────────┼──────────────┼──────────┼───────────┼────────────┤
 │☐ │ AZ/26/0041 │ 04-Oct-26  │ ISRO SAC     │ 4,12,000 │ Submitted │ ✓ IRN ✓ EWB│
 │☐ │ AZ/26/0040 │ 03-Oct-26  │ Skyroot      │   86,500 │ Draft     │ —          │
 └──┴────────────┴────────────┴──────────────┴──────────┴───────────┴────────────┘
 Selected 2 → [Submit] [Print] [Generate IRN] [Export]          1–50 of 1,240  ‹ ›
 Click a row → side peek panel (W6) slides in from the right.
```

## W6 · Document page (form + timeline)

```
 Sales invoice AZ/26/0041   [Submitted] [IRN ✓]          [Print] [Cancel] [⋯]
 ┌────────────────────────────────────────────────┬──────────────────────────┐
 │ Customer [ISRO SAC ▾]  GSTIN 24AAAG…  POS Gujarat│ Timeline                 │
 │ Date 04-Oct-26  Due 03-Nov-26  Series AZ/26/    │ ● Created by Rahul       │
 │ ┌ Items ───────────────────────────────────────┐│ ● Submitted              │
 │ │ Item        HSN    Qty  Rate     Tax   Amount ││ ● IRN 1a2b… generated    │
 │ │ Bracket C   8803   10   41,200   IGST18 …     ││ ● EWB 3110… Part B added │
 │ └───────────────────────────────────────────────┘│ 💬 Add comment…          │
 │ Taxable 4,12,000 · IGST 74,160 · Total 4,86,160 │ Linked: SO-0019, DN-0033 │
 │ ▸ Shipping & transport   ▸ Terms   ▸ Attachments │                          │
 └────────────────────────────────────────────────┴──────────────────────────┘
```

## W7 · Settings → Users & roles (Phase 0)

```
 Settings / Users                                            [Invite user]
 ┌──────────────┬──────────────────────┬─────────────────────┬────────┬──────┐
 │ Name         │ Email                │ Roles (scope)        │ MFA    │      │
 │ Prachi K.    │ prachi@azeonics.com  │ Owner (all)          │ ✓      │ ⋯    │
 │ Rahul S.     │ rahul@azeonics.com   │ Accountant (Azeonics)│ ✓      │ ⋯    │
 │ Priya M.     │ priya@earthnow.tech  │ Sales (EarthNow)     │ ✖ ⚠    │ ⋯    │
 └──────────────┴──────────────────────┴─────────────────────┴────────┴──────┘

 Settings / Roles / Accountant                                   [Save]
 Permission matrix:            Read  Create  Submit  Cancel  Approve  Export
   accounts.voucher             ☑      ☑       ☑       ☐       ☐        ☑
   compliance.gst_return        ☑      ☑       ☐       ☐       ☐        ☑
   inventory.stock_entry        ☑      ☐       ☐       ☐       ☐        ☐
```

## W8 · Settings → Entities & GST registrations (Phase 0)

```
 Settings / Legal entities                                    [+ Add entity]
 ┌ Azeonics Private Limited ─────────────────────────────── Parent ┐
 │ PAN AAxCA1234x · CIN U…  · FY Apr–Mar · Base INR              │
 │ GST registrations: 27AAxCA1234x1Z5 (Maharashtra, Regular)      │
 │   E-invoice from 01-Apr-2027 · IRP: NIC direct · EWB: NIC      │
 │ Plants: Navi Mumbai                                    [Edit]  │
 └────────────────────────────────────────────────────────────────┘
 ┌ EarthNow ─────────────────────────────── Subsidiary of Azeonics ┐
 │ …                                                              │
 └────────────────────────────────────────────────────────────────┘
```

## W9 · Platform console (SuperAdmin, `/platform`)

```
 Platform / Tenants                                           [+ New tenant]
 ┌───────────────┬──────────┬────────┬──────────┬───────────┬─────────────┐
 │ Tenant        │ Plan     │ Users  │ Entities │ Status    │             │
 │ Azeonics Group│ Internal │ 24     │ 2        │ Active    │ [Open] [⋯]  │
 └───────────────┴──────────┴────────┴──────────┴───────────┴─────────────┘
 Tabs: Tenants · Feature flags · Platform admins · Audit log · System health
 Impersonate → requires reason, time-boxed (30 min), banner shown, fully audited.
```

## W10 · Shop-floor job card (tablet PWA, Phase 2)

```
 ┌──────────────────────────────────────────────┐
 │ M-03 · 5-axis Mazak          ● RUNNING 01:12 │
 │ WO-0123 · Bracket rev C · OP20 Finish mill   │
 │ Qty 4 / 10 good · 0 scrap                    │
 │ Material: Ti-6Al-4V  heat HN-23-4471 ✓       │
 │                                              │
 │  [ PAUSE ]      [ +1 GOOD ]     [ SCRAP ]    │
 │                                              │
 │  [ Report issue ]          [ Complete op ]   │
 └──────────────────────────────────────────────┘
```
