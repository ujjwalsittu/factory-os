# 13 · UI & UX Decisions

Extends [08-ux-design-system.md](./08-ux-design-system.md). These are binding UI/UX rules for every
screen. Wireframes are in [14-wireframes.md](./14-wireframes.md).

## UI decisions (visual)

| # | Decision |
|---|---|
| U1 | **Stack:** Tailwind CSS v4 + Radix primitives + shadcn-style components owned in `packages/ui`. Icons: Lucide. Charts: one library wrapped by `<Chart>`. |
| U2 | **Typography:** Inter for UI, JetBrains Mono for codes, numbers in tables, GSTINs and serials. Tabular numerals in all numeric columns. Base size 14 px desk, 16 px shop floor. |
| U3 | **Color:** neutral slate surfaces, one brand accent (deep indigo `#3B3BD4`-ish, final value in tokens), semantic colours only for status: green = done/accepted, amber = attention, red = blocked/rejected, blue = in progress, grey = draft. Never colour alone: every status also has a label/icon. |
| U4 | **Themes:** light and dark from day one, via CSS variables; follows OS by default, user override saved. |
| U5 | **Density:** "comfortable" default, "compact" toggle for power users (accountants, stores). |
| U6 | **Layout:** left sidebar (workspaces) + top bar (entity switcher, ⌘K search, notifications, user) + content. Sidebar collapses to icons. Max content width only on forms; grids are full width. |
| U7 | **Indian formats:** `₹1,23,45,678.00`, `04-Oct-2026`, `FY 2026-27`, IST times. Amounts right-aligned. |
| U8 | **Status badges** are the same component everywhere: `Draft`, `Submitted`, `Cancelled`, `Pending approval`, `IRN generated`, `EWB active`, … |
| U9 | **Motion:** 150–200 ms ease-out for panels/menus only; respect `prefers-reduced-motion`. No decorative animation inside the app (the landing page may animate). |
| U10 | **Shop-floor PWA:** min 48 px touch targets, high-contrast mode, one primary action per screen, works with gloves and a scanner. |

## UX decisions (behaviour)

| # | Decision |
|---|---|
| X1 | **Entity context is always visible** in the top bar. Switching entity changes data scope, number series and letterheads. Users with access to several entities can choose "All entities" on reports only. |
| X2 | **⌘K / Ctrl+K command palette** everywhere: navigate, search documents by number/party/serial/heat number, run actions ("New sales invoice"). |
| X3 | **Keyboard first:** every list and form is fully operable by keyboard; `?` shows shortcuts; Tally keys in the Accounts workspace (doc 12). |
| X4 | **List → side peek → full page.** Clicking a row opens a side panel; Enter or "open" goes full page. Linked documents open in the peek without losing the list. |
| X5 | **Forms show the essentials first.** Advanced sections collapse. Field layout per role. Inline validation as you type; server errors map to fields. |
| X6 | **Autosave drafts.** Drafts never lose data. "Submit" is the deliberate, irreversible step and shows what will post (stock, GL, GST). |
| X7 | **Every document has a timeline**: lifecycle, comments/@mentions, approvals, linked docs, audit diff, GSP calls. |
| X8 | **Empty states teach**: explain what the screen is for, show the primary action, link to import. |
| X9 | **Errors are actionable**: what happened, why, what to do. GSP/IRP errors are translated to plain English with the original code shown. |
| X10 | **Bulk actions** on lists (submit, print, e-invoice, export), with a progress drawer and per-row results. |
| X11 | **Saved views** (filters, columns, sort, grouping) per user, shareable by URL, pin to sidebar. |
| X12 | **Approvals inbox**: one place for everything waiting on me, with approve/reject from the list. |
| X13 | **Destructive actions** (cancel, delete draft, revoke access) need confirmation with the document number typed or a reason, never a plain "OK". |
| X14 | **Accessibility:** WCAG 2.2 AA; focus rings visible; labels on every input; screen-reader names on icon buttons. |
| X15 | **Performance budgets:** first app load < 2.5 s on 4G; navigation < 300 ms; list of 10k rows virtualised. |
| X16 | **Onboarding wizard** for a new tenant: company → entities → GSTINs → plants/warehouses → invite users → import from Tally. |

## Information architecture (sidebar workspaces)

```
Home (role dashboard)
Sales · Purchase · Inventory · Manufacturing · Quality · Services · Projects
Accounts · Compliance (GST, TDS, MSME, calendar) · EHS (waste)
Machines (IoT) · Reports
Settings (entity, users & roles, number series, integrations: GSP, Tally, IoT)
── Platform (SuperAdmin only): tenants, plans, feature flags, audit, impersonation
```
