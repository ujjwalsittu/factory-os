# 08 · UX & Design System — "better than Frappe"

## Where Frappe/ERPNext hurts (and what we do instead)

| Frappe pain | FactoryOS answer |
|---|---|
| Long single-column forms, tabs of fields nobody uses | **Progressive forms**: essentials first, sections collapse, smart defaults, per-role field layouts |
| List views are basic | **Data grid**: saved views, column pinning, grouping, inline edit, bulk actions, keyboard nav, URL-shareable filters |
| Navigation via deep desk menus | **⌘K command palette**: jump to any doc/number/action ("new PO", "WO-0123", "stock of HN-23-4471") |
| Context switching between linked docs | **Split view / side peek**: open a linked doc in a side panel without losing your place |
| Weak visibility of a doc's story | **Timeline** on every doc: lifecycle, linked docs graph, comments/@mentions, audit diff, GSP calls |
| Shop floor UI is the desk UI | **Dedicated shop-floor PWA**: big touch targets, scan-first, offline tolerant, one task per screen |
| Reports feel like spreadsheets bolted on | **Dashboards** per role (plant head, stores, accounts, sales) with drill-through to documents |
| Traceability is buried | **Genealogy explorer**: interactive graph from any batch/serial, forward & backward |
| Scheduling is a form | **Interactive Gantt / resource calendar** for machines, chambers, cleanroom, people |

## Design system (`packages/ui`)

- Foundation: **Tailwind CSS v4 + Radix primitives + shadcn/ui** patterns, owned in-repo.
- Tokens: color, spacing, radius, typography (Inter / IBM Plex Mono for numbers & codes),
  **light + dark**, density modes (comfortable / compact for power users).
- Indian formatting: `₹1,23,45,678.00` lakh/crore grouping, DD-MMM-YYYY dates, FY labels (FY 2026-27).
- Core components: `DataGrid`, `DocForm` (schema-driven from Zod), `LinkField` (typeahead to any
  doc), `ChildTable` (line items with keyboard entry), `StatusBadge`, `Timeline`, `Scanner`,
  `GanttScheduler`, `GenealogyGraph`, `KpiTile`, `Chart` (consistent palette).
- Accessibility: WCAG 2.2 AA, full keyboard operation.
- Performance budget: list view < 300 ms for 10k rows (virtualised), form open < 200 ms.

## Key screens (first wave)

1. Home / role dashboard
2. Item & batch 360 (stock by location, genealogy, certificates, movements)
3. Work order cockpit (operations progress, material status, live machine state)
4. Shop-floor job card (tablet)
5. Stores: issue/receive by scan
6. Machine & resource scheduler (production + MaaS bookings together)
7. Sales invoice with live GST/e-invoice/EWB status
8. GST reconciliation workbench (2B / IMS)
9. Compliance calendar (due dates per entity/GSTIN)
