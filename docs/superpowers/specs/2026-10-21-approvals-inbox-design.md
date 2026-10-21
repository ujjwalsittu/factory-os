# Approvals inbox — design (decision 076)

Builds UX decision X12 ([13-ui-ux-decisions](../../13-ui-ux-decisions.md)): one place for everything waiting on me,
with approve and reject from the list. The user chose it on 2026-10-21 and answered three questions (below).

## The problem

Nine kinds of document already wait for a second person: a GST return to approve, NCR dispositions for the material
review board, an FAI, a CAPA's effectiveness check, a maintenance order on a critical machine, timesheets, a purchase
return claim, a test campaign report and a booking whose metered usage needs review. Each is approved on its own page.
Home shows three of them as tiles, only for the active entity. A Finance Controller who approves for both Azeonics and
EarthNow has to visit every page in every entity to know what is waiting, and the person who sent something has no
way to see that it is still waiting.

## Decisions taken with the user

| Question | Answer |
|---|---|
| Which entities? | **All entities the person can access.** Each row names its entity; acting on it runs in that entity's scope. |
| Where can items be approved? | **Simple ones in the list.** Timesheets (approve, send back with a reason) and maintenance verification act from the list. Everything else opens the document, because it needs figures read or a note typed. |
| Show what I sent? | **Yes, a second tab**, "Waiting on others": what I prepared or submitted that waits on someone else. |

## Sources

No new tables and no migration: the inbox reads the same rows as each document's page. Each source is gated by the
permission its own approve endpoint already requires, evaluated per entity, and by the same separation-of-duties rule
the endpoint enforces, so the inbox never offers what the endpoint would refuse.

| Kind | Waiting when | Approver needs | Approver cannot be | In the list |
|---|---|---|---|---|
| GST return | status `reviewed` | `compliance.gst_return.approve` | the preparer | open |
| NCR dispositions | NCR `open` with a `proposed` disposition | `quality.ncr.approve` | — | open |
| First article (FAI) | status `submitted` | `quality.fai.approve` | the submitter | open |
| CAPA effectiveness check | status `verifying`, check date reached | `quality.capa.approve` | the owner | open |
| Maintenance verification | order `done`, machine critical | `maintenance.order.approve` | the technician who signed it off | **verify** |
| Timesheet hours | entry `submitted` | `services.timesheet.approve` | the person whose hours they are | **approve, send back** |
| Purchase return claim | `submitted`, not yet approved | `buying.return_claim.approve` | — | open |
| Test campaign report | `active`, every step has a result | `services.campaign.approve` | — | open |
| Booking usage review | meter status `review` | `services.usage.approve` | — | open |

Two cases are left out on purpose:
- **Bank reconciliation:** a period is approved by whoever reviews it, so nothing waits.
- **GST sandbox valuations:** test-only.

A CAPA before its check date is not waiting yet. "Waiting on others" lists it with the date it becomes due.

**Waiting on others** uses the same sources, reversed: rows where I am the preparer, submitter, owner, technician or
the person whose hours they are, and the row is in the waiting state above. Return claims, test reports and meter
reviews have no single sender recorded, so they show on this tab for the person who submitted or created them, where
the row records it, and are otherwise left out.

## API

`GET /approvals` (tenant-scoped, no entity header needed). For each entity the person can access, it computes that
entity's effective permissions from the role grants and runs the sources the person may approve there.
It returns:
- `needsMe`: rows, oldest first;
- `waitingOnOthers`: rows, oldest first;
- `counts` per kind;
- an `error` flag per source that failed, as on Home, so one failing source does not hide the others.

A row holds:
- kind, entity (id and short name), document number and title;
- who sent it and since when, as a waiting time;
- the link to the document;
- for list actions, the ids the existing endpoints take.

No new permission: reading the inbox needs only membership; each source needs its approve permission (or, for
"waiting on others", the read permission of that document).

List actions call the **existing** endpoints with the row's entity in the `x-entity-id` header:
- `POST /maintenance/orders/:id/verify`;
- `POST /timesheets/:id/approve`;
- `POST /timesheets/:id/reject` (with a reason).

Timesheet rows are grouped by person and week. "Approve week" calls approve per entry and shows each entry's result,
so one refusal (a closed project) does not hide the others.

## Web

- **Menu:** "Approvals" directly under "My work", with a count of `needsMe`. The count comes from the same read,
  refreshed when the page regains focus and after any approval.
- **Page** `/app/approvals`:
  - tabs **Needs me** and **Waiting on others**;
  - a filter by kind and by entity;
  - rows grouped by kind, each with the entity, number, title, who and how long, and its action or "Open";
  - empty states "Nothing waiting on you" and "Nothing waiting on others".
- **Home:** the "Needs me" tiles that duplicate the inbox (timesheets, NCR dispositions, maintenance verification)
  link to the inbox filtered to that kind; "My drafts" and "My job cards" stay as they are.
- Works at 390 px with no sideways scroll; actions keep the existing confirmation and reason rules (X13).

## Tests

- **API smoke** `smoke-approvals.mjs`. It covers:
  - two entities and three people;
  - one item of each kind built through the real endpoints;
  - the inbox shows each to the approver, in the right entity, and never to the sender;
  - "waiting on others" shows each to the sender;
  - a person without the approve permission in one entity sees nothing from that entity;
  - verify and approve from the list, then the item leaves both tabs;
  - send back with and without a reason (400);
  - another tenant sees nothing.
- **Browser walkthrough** `e2e/approvals.mjs`:
  - the menu count;
  - both tabs;
  - approve a week of timesheets;
  - verify a maintenance order;
  - open an FAI;
  - 390 px.
- **Regression:** the Home smoke and the source modules' smokes (GST returns, quality, maintenance, timesheets,
  supplier returns, MaaS, campaigns).

## Not in this design

- Email or push notifications.
- Approval chains, delegation and out-of-office.
- Bulk approval across kinds.
- Approving documents that need input from the list.
- Approvals for TDS/TCS or GST filing, which are not built.
