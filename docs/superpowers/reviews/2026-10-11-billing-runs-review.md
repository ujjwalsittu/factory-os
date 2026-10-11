# Phase 3f billing runs — review and evidence (decision 060)

[Design](../specs/2026-10-11-billing-runs-design.md). Migration `0042_billing_runs`.

## What changed

- **One billing contract for every source** (`billables.ts`). Bookings, test campaigns, project milestones and
  subscriptions each expose:
  - **prepare:** the lines, customer, reference and amount;
  - **settle:** inside the invoice transaction, re-check the source under its lock and record the link, or `null`
    when nothing is invoiced, such as hours fully covered by a membership;
  - **due ids:** what is billable now.
  - The single-item buttons now go through the same steps, and their behaviour is unchanged: MaaS, memberships,
    campaigns, projects and subscriptions smokes pass as before.
- **Retention and project revenue** use the milestone's own invoice line. A run's invoice can carry other sources'
  lines, so the whole invoice total no longer stands in for the milestone.
- **DB:**
  - `billing_run` (series `BR`): invoice date, kinds and the groups that failed;
  - `billing_run_invoice`: invoice, customer, reference, items, amount and the Submit-all refusal;
  - new permission `services.billing_run.read|create`;
  - the Services coordinator gets it, and the Accountant reads runs.
- **API (`BillingRunsController`):**
  - **Preview:** groups everything due by customer and reference, and lists what can't be billed now and why.
  - **Run:**
    - one draft invoice per group, dated `asOf` (today or earlier), with remarks "Billing run …";
    - sources are settled in a fixed order (kind, then id), so concurrent runs can't deadlock;
    - a group that fails is recorded on the run and the others go ahead;
    - a group of membership-covered bookings is settled without an invoice.
  - **Submit all:** each draft goes through the normal invoice submit (credit limit, LUT, dates). A refusal stays a
    draft with its reason; nothing is overridden in bulk.
- **Web:** Services → **Billing runs**:
  - the runs list;
  - New run, with the invoice date, sources and the preview grouped by customer and PO;
  - the run page, with invoices and status, Submit all, and what was not billed.

## Review

One adversarial pass over the diff. One finding fixed while building:

- **Fixed:** retention was computed on the invoice's grand total. On a combined run invoice that would have charged
  retention on the subscription and campaign lines too. It is now computed on the milestone's own line (taxable plus
  its GST) everywhere: on settle, the project page, the list and release. The smoke checks it: ₹29,500 on a ₹5,00,000
  milestone sharing an invoice with ₹2,30,000 of other work.
- **Checked:**
  - Two runs at once bill each booking once; the loser's group fails its settle re-check.
  - A covered booking in a group with invoiced items draws hours without linking the invoice.
  - An invoice can't be dated in the future.
  - Submit all stops on a missing permission rather than recording it as a refusal.
  - Another tenant's preview is empty, and its run and submit return 404.
- **Noticed, not changed:**
  - A source skipped before its billable is built is labelled by kind and id. Its message names it, for example "No
    rate card for M04 on …".
  - `dueSubscriptionIds` evaluates each subscription's periods one by one. That is fine at hundreds; batch it if
    subscriptions reach thousands.

## Evidence

| Check | Result |
|---|---|
| `smoke-billing-runs.mjs` (new) | 81 request checks PASS |
| `e2e:billing-runs` (new, desktop + 390 px) | PASS |
| `smoke-maas` / `smoke-maas-memberships` / `smoke-test-campaigns` / `smoke-projects` / `smoke-subscriptions` after the refactor | 93 / 76 / 74 / 141 / 82 PASS |
| `smoke-selling.sh` | PASS |
| `e2e:subscriptions` / `e2e:projects` / `e2e:maas-memberships` / `e2e:maas` / `e2e:test-campaigns` / `e2e:selling` | PASS |
| `pnpm typecheck` / `pnpm build` / `turbo run test --force` | 19 / 12 / 11 tasks PASS |
| `pnpm lint` | 0 configured tasks |
| `git diff --check`, drizzle drift | clean, none |
