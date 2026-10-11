# Phase 3d projects — review and evidence (decision 058)

[Design](../specs/2026-10-11-projects-design.md). Builds on Phase 3a bookings (decision 055) and 3c test campaigns
(decision 057). Migration `0039_projects`.

## What changed

- **DB:**
  - `project` (series `PRJ`): customer, contract value before GST, service item, retention %, defect liability months,
    status draft → active → completed → closed, or cancelled.
  - `project_budget` per cost category; `project_milestone` with achievement and its invoice.
  - `project_retention` per milestone invoice: it counts while the invoice is live, and its amount freezes at release.
  - `project_cost_rate`: append-only, one row per person and date.
  - `timesheet_entry`: quarter hours, draft → submitted → approved, with the cost snapshotted at approval. A
    correction is a negative reversal row.
  - `project_id` on bookings, campaigns, work orders and purchase invoice lines; the last two get their foreign keys by
    hand in the migration.
  - New permissions:
    - `services.project.read|create|update|approve`;
    - `services.timesheet.read|create|approve`;
    - `services.cost_rate.read|update`.
  - Roles:
    - a new "Project member" role;
    - the Finance controller approves projects and manages cost rates;
    - the Services coordinator gets neither of those;
    - the Auditor doesn't see cost rates.
- **API (`ProjectsController`, `TimesheetsController`):**
  - **Activation:** needs milestones adding up to the contract value. Milestones never exceed it.
  - **Milestone invoice:** a draft tax invoice for the full milestone, with the customer reference as PO and the
    retention noted in the remarks. The retention row is written in the same transaction. Deleting the draft frees the
    milestone.
  - **Retention release:** only on a submitted invoice.
  - **Complete:** every milestone must be achieved and linked bookings and campaigns finished. Retention then falls
    due after the defect liability period.
  - **Close:**
    - needs every milestone invoiced, all retention released and no hours awaiting approval;
    - after closing, hours can't be approved or reversed.
  - **Links:**
    - Bookings and campaigns must be for the same customer and not billed on their own.
    - A campaign's bookings follow it.
    - Work orders can be linked while draft or released, and purchase lines while their invoice isn't cancelled.
  - **Billing refusals:** a project booking can't be billed by the hour or drawn from a membership; a project
    campaign isn't invoiced and closes without an invoice.
  - **Actual cost**, per category:
    - material, absorbed machine time and job work from work orders;
    - booking minutes at the work centre rate;
    - submitted purchase lines (taxable value × exchange rate, plus GST when no ITC);
    - approved timesheet cost.
  - **Timesheets:**
    - own hours only, on active projects, up to 24 h a day across projects (serialised per person and day);
    - nobody approves, sends back or reverses their own hours;
    - approval needs a cost rate on the work date;
    - rates and per-person cost are hidden without `services.cost_rate.read`.
- **Web:**
  - Services → **Projects**:
    - the list;
    - the project page: milestones, retention, budget vs actual with its sources, linked work, hours and files.
  - Services → **Timesheets**: my week with Submit week; approvals; approved hours with Reverse.
  - Services → **Cost rates**.
  - "Project" in the new-campaign dialog, and "Book machine" from the project.
  - Campaign and booking pages say when they are billed through a project.

## Review

One adversarial pass over the diff. Three findings fixed:

- **Fixed:** hours submitted before a project closed could still be approved afterwards, changing a closed project's
  cost. Close now waits for pending hours, and approval is refused on a closed project.
- **Fixed:** unlinking a booking or campaign after milestones were invoiced would let the same work be billed again
  on its own. Unlinking them is refused once any milestone has a live invoice.
- **Fixed (design wording):** work orders and purchase lines are linked from the project page rather than from
  their own forms, and cost rates sit under Services. The design records both.
- **Checked:**
  - A milestone is invoiced once: a live-invoice check runs under the project and milestone locks.
  - Retention is never counted for a deleted or cancelled invoice. Its amount follows a draft invoice that is edited,
    and freezes at release.
  - The audit trail of timesheet approvals keeps hours, not rates or cost.
  - Every lookup is entity-scoped, including the link candidates.
  - Another tenant gets 404.
  - The 3a–3c flows (bookings, memberships, campaigns) pass unchanged.
- **Noticed, not changed:**
  - Retention isn't split out in AR ageing. The receipt is entered in receivables as usual, and the project records
    the release.
  - Unlinking a work order or purchase line removes its cost from the project; that is deliberate and audited.

## Evidence

| Check | Result |
|---|---|
| `smoke-projects.mjs` (new) | 141 request checks PASS |
| `smoke-test-campaigns` / `smoke-maas` / `smoke-maas-memberships` | 74 / 93 / 76 PASS |
| `smoke-manufacturing` / `smoke-scheduling` / `smoke-buying.sh` / `smoke-selling.sh` | 104 / 58 / PASS / PASS |
| `e2e:projects` (new, desktop + 390 px) | PASS |
| `e2e:test-campaigns` / `e2e:maas` / `e2e:maas-memberships` / `e2e:manufacturing` / `e2e:selling` / `e2e:buying` | PASS |
| `pnpm typecheck` / `pnpm build` / `turbo run test --force` | 19 / 12 / 11 tasks PASS |
| `pnpm lint` | 0 configured tasks |
| `git diff --check`, drizzle drift | clean, none |
