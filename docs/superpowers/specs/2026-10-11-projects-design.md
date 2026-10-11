# Phase 3d — projects with milestones, retention and actual cost (decision 058)

From [04 · Services](../../04-services.md): the **Project** building block ("milestones, deliverables, budget vs
actual (material, machine, labour, cloud)"). It underpins Azeonics flow 4 (the Idea-to-Orbit bundle, "billed by
milestone") and EarthNow flows 2–4 (government project milestones with retention, imagery and cloud cost allocated
to projects, analyst timesheets). It builds on Phase 3a bookings (decision 055) and 3c test campaigns (decision
057).

User choices, 2026-10-11:

1. **Next slice:** projects with milestones, before EarthNow subscriptions (still blocked on B12), CAPA and the skill
   matrix.
2. **Billing:**
   - **Milestones plus retention.**
   - Each milestone invoice is a full tax invoice, with GST on the full value.
   - The project records the retention % the customer withholds, when it falls due (completion plus the defect
     liability period), and when it is received.
   - No second invoice is raised for the retention. The user chose this after being told that invoicing the
     retention separately would defer GST and need a CA's confirmation.
   - Time-and-materials billing is out of scope.
3. **Actual cost:**
   - **Linked documents plus timesheets.**
   - Linked work orders (material, machine and labour absorbed), purchase invoice lines (imagery, cloud/GPU,
     subcontract) and machine bookings.
   - Analyst timesheets valued at a cost rate per person.
4. **Linking:** test campaigns, machine bookings and work orders can belong to a project. Linked campaigns and
   bookings are **billed by the project's milestones**, never on their own.
5. **Cost rates:**
   - One rate per member, effective from a date.
   - Seen and edited only with a **separate permission**.
   - Others see hours, and only a labour total on the project.
6. **Purchase invoices** are tagged to a project **per line**.

## Data model (migration `0039_projects`)

- **`project`** (entity):
  - Identity and customer:
    - `number` (series `PRJ`, `{ENTITY}/PRJ/{FY}/{####}`);
    - `customer_id`, `title`, `description` and `customer_ref` (their PO, work order or LoA);
    - `manager_user_id`.
  - Commercial terms:
    - `service_item_id` (SAC for milestone invoices);
    - `contract_value` (before GST);
    - `retention_pct` (0–50, default 0);
    - `dlp_months` (defect liability period, 0–60, default 0).
  - Dates: `start_date` and `end_date` (planned).
  - `status`: draft → active → completed → closed, or cancelled; with `cancel_reason`, `completed_on` and `closed_at`.
- **`project_budget`**:
  - `project_id`, `category` and `amount`. One row per category.
  - Categories: material, machine, labour, bought_in (imagery, cloud, subcontract) and other.
- **`project_milestone`**:
  - `project_id`, `seq`, `name`, `due_date` and `amount` (before GST);
  - `status`: pending → achieved, with `achieved_on`, `acceptance_ref` and `achieved_by`;
  - `sales_invoice_id`: the milestone counts as invoiced while this invoice is live.
- **`project_retention`**:
  - `project_id`, `milestone_id`, `sales_invoice_id` (unique) and `amount`;
  - `released_on` and `release_ref`.
  - A row whose invoice is deleted or cancelled no longer counts.
- **`project_cost_rate`** (entity):
  - `user_id`, `hourly_rate` and `effective_from`, unique per user and date.
  - It is append-only: a new rate is a new row.
- **`timesheet_entry`** (entity):
  - `user_id`, `project_id`, `milestone_id` (optional), `work_date`, `hours` (0.25–24, in steps of 0.25) and `notes`;
  - `status`: draft → submitted → approved, or rejected back to draft with a reason;
  - `approved_by` and `approved_at`;
  - `cost_rate` and `cost_amount`, snapshotted at approval.
- **Links:** nullable `project_id` on `maas_booking`, `test_campaign`, `work_order` and `purchase_invoice_line`.
- **Attachments** gain owner type `project`, for the contract, LoA, deliverables and acceptance certificates.

## Behaviour

### Life cycle

- **Create** (draft): customer, title, service item and contract value; retention % and the defect liability period
  are optional.
  - Milestones and budget lines can be edited while the project is draft or active.
  - A milestone stops being editable once it is achieved.
- **Activate** (draft → active): needs at least one milestone. The milestone amounts must add up to the contract
  value exactly.
- **Complete** (active → completed):
  - Needs every milestone achieved, and no open linked bookings or campaigns.
  - Sets `completed_on`.
  - Retention falls due `dlp_months` after `completed_on`.
- **Close** (completed → closed): needs every milestone invoiced on a live invoice, all retention released and no
  hours awaiting approval. Hours are not approved on a closed project, so its cost is final.
- **Cancel** (draft or active, with a reason):
  - Needs no live milestone invoice and no open linked bookings.
  - Linked work orders and campaigns are left as they are.

### Milestones and retention

- **Achieve** a milestone, while active: records the date, the customer's acceptance reference and who marked it.
  The acceptance certificate is attached to the project.
- **Invoice** an achieved milestone, once:
  - A draft tax invoice through `createDraftInvoice`: one line on the project's service item for the milestone
    amount. Customer PO is set to `customer_ref`, and the remarks read "Project {number} · milestone {name}".
  - When `retention_pct` > 0, it records `project_retention` = round(retention % × the invoice total including GST,
    2). The retention row is written in the same transaction.
  - As with bookings and campaigns, deleting the draft or cancelling the invoice frees the milestone to be invoiced
    again. The old retention row stops counting.
- **Release retention:** any time after its invoice is submitted. It records the date received and a reference,
  such as the receipt number. The receipt itself is entered in AR as usual.
- The project page shows retention held, retention due (once completed) and retention released.

### Linked work

- **Machine bookings and test campaigns** can be created for a project, or linked while still open.
  - The customer must match the project's.
  - A project booking or campaign is **not billed on its own**. Hourly billing and membership draws are refused with
    "Billed through project PRJ/…", and so is the campaign invoice.
  - A project campaign closes without an invoice.
  - A booking made for a project campaign takes the campaign's project.
- **Work orders** can carry a project, set while draft or released. The project counts their cost; the output is not
  billed separately by the project.
- **Purchase invoice lines** can carry a project. They can be set on a draft purchase invoice, and later by
  `services.project.update` without changing the invoice. Only submitted invoices count as cost.

### Actual cost (read model, computed)

| Category | Source |
|---|---|
| Material | Linked work orders: `work_order_cost` issue + return |
| Machine | Linked work orders: absorption; linked bookings (direct or via campaign): used hours × the work centre hourly rate |
| Bought-in | Purchase invoice lines tagged to the project: taxable value × exchange rate, plus the line's GST when the invoice is not ITC-eligible; linked work orders: job_work |
| Labour | Approved timesheets: `cost_amount` |
| Other | Budget only in this slice |

- Each category shows budget, actual, variance and the source documents.
- Revenue is the sum of the live milestone invoices before GST. Margin = revenue − actual.
- Labour shows **hours per person to everyone with `services.project.read`**, but rates and per-person cost only
  with `services.cost_rate.read`.

### Timesheets

- A member with `services.timesheet.create` records their **own** hours against an active project, as drafts.
  A person's total across all projects is capped at 24 hours per day.
- **Submit** a week's drafts. **Approve** or **reject**, with a reason, with `services.timesheet.approve`; nobody
  approves their own hours.
- Approval snapshots the person's cost rate effective on the work date. It is refused when the person has no rate
  ("Set a cost rate for … first").
- Approved entries are frozen. A correction is a reversal entry with negative hours, made by an approver.

## API

`/services/projects`:

- Projects: GET list, POST, GET `:id` (with actuals), PUT `:id`.
- Status changes: POST `:id/activate`, `:id/complete`, `:id/close`, `:id/cancel`.
- Budget: PUT `:id/budget`.
- Milestones:
  - POST `:id/milestones`, PUT `milestones/:mid`, DELETE `milestones/:mid` (pending only);
  - POST `milestones/:mid/achieve` and `milestones/:mid/invoice`.
- Retention: POST `retention/:rid/release`.
- Links: POST `:id/links` with `{ kind: booking | campaign | work_order | purchase_invoice_line, id }`, and DELETE
  for unlinking while allowed.

`/services/timesheets`:

- Entries: GET (own, or all with approve), POST, PUT `:id`, DELETE `:id` (draft only).
- Approval: POST `submit` (by week), `:id/approve`, `:id/reject` and `:id/reverse`.

`/services/cost-rates`: GET and POST.

Booking, campaign, work order and purchase invoice create/update accept an optional `projectId`.

## Permissions and roles

- New permissions:
  - `services.project.read|create|update|approve`. `approve` covers activate, complete, close and releasing
    retention.
  - `services.timesheet.read|create|approve`.
  - `services.cost_rate.read|update`.
- Milestone invoicing uses `services.billing.create` together with `selling.sales_invoice.create`.
- Role changes:
  - **Services coordinator:** project read/create/update, timesheet read/create/approve.
  - **Finance controller:** project read/approve and cost rates read/update.
  - **New role "Project member":** project read, timesheet create.
  - **Auditor:** reads projects and timesheets, but not cost rates.

## Screens

- **Services → Projects:**
  - **List:** number, customer, title, contract value, invoiced, retention held, status.
  - **Project page:**
    - header actions per status;
    - milestones (achieve, invoice), retention and budget vs actual by category, with drill-down to sources;
    - linked bookings, campaigns, work orders and purchase lines;
    - the team's hours and files.
- **Services → Timesheets:** my week (grid of projects × days, submit), and Approvals for approvers.
- **Services → Cost rates** (with `services.cost_rate.read`).
- A "Project" choice in the new-campaign dialog, and "Book machine" from the project page.
- Work orders, purchase invoice lines, existing bookings and campaigns are linked from the project page ("Link
  document"), so the work order and purchase invoice forms are unchanged. *(Changed while building: one place to
  link, and purchase lines can be tagged after the invoice is submitted without touching it.)*

## Not in this slice

- Time-and-materials billing from timesheets, tasks/WBS and Gantt for projects.
- Cloud bill import, retention receivable split in AR ageing, EMD and performance bank guarantees, and project
  templates (Idea-to-Orbit).
- Separately invoiced retention (GST deferral) is not modelled, per the user's choice.

## Tasks

1. Claim in STATUS, this design and decision 058 to main (docs-only PR).
2. Migration `0039_projects` and its additions:
   - permissions and roles;
   - the `PRJ` series;
   - the attachment owner type;
   - the link columns.
3. API work, with smoke `smoke-projects.mjs`:
   - projects, milestones, retention, budget and links, with billing refusals on linked bookings and campaigns;
   - actuals;
   - timesheets and cost rates.
4. Web: projects list and page, timesheets, cost rates and project selectors; e2e `projects.mjs` (desktop and
   390 px).
5. Regression and wrap-up:
   - MaaS, memberships, campaigns, manufacturing, buying and selling smokes and browsers;
   - root checks;
   - review, STATUS/LOG and the PR.
