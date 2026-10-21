# Approvals inbox — review (decision 076)

Built to the [design](../specs/2026-10-21-approvals-inbox-design.md). No migration, table or permission.

## What was built

- **API:** `GET /approvals` (tenant-scoped; no entity header needed).
  - It reads the person's role grants once and works out the permissions of every entity they can access.
  - It runs each source the person may approve in that entity, and, for "waiting on others", each source whose
    documents they may read.
  - **Sources and their gates:** the nine kinds in the design, each gated by its own endpoint's approve permission and
    separation-of-duties rule:
    - the preparer of a GST return, the submitter of an FAI, the owner of a CAPA, the technician who signed off a
      maintenance order and the person whose hours they are never see their own item as "needs me";
    - NCR dispositions, return claims, test reports and usage reviews have no such rule, so the sender who may approve
      sees the item once, under "needs me".
  - **Waiting states:**
    - a CAPA counts once its check date is reached; its owner sees it from the start, with the date;
    - a test campaign counts when it is active with at least one step and none pending;
    - timesheets are one row per person and week, carrying the entry ids.
  - **Errors:** each source has an 8-second limit, as Home's tiles do. A failed or slow source is listed in `errors`
    and logged on the server, and the rest still arrive.
- **Web:**
  - **Menu:** "Approvals" sits under "My work" with a count of what needs the person, refreshed on focus and after an
    action.
  - **Page** `/app/approvals`:
    - tabs Needs me and Waiting on others, each with its count;
    - filters by kind (also from `?kind=`) and by entity (shown when there are two or more);
    - rows grouped by kind with the document, entity, sender and how long it has waited.
  - **Actions in the list:**
    - "Approve 7.50 h" approves a person's week, entry by entry, and reports each refusal;
    - "Send back…" asks for a reason;
    - "Verify" verifies a critical machine's maintenance order.
  - **Opening a document:** any other row opens its document after switching to the row's entity.
  - **Home:** the timesheet, NCR-disposition and maintenance-verification tiles open the inbox filtered to their kind.

### Found and fixed while building

- **Subquery column references:** drizzle writes an outer table's columns unqualified inside a select-list subquery.
  - The NCR sender subquery failed: `"id"` was ambiguous.
  - The test campaign's "since" subquery read the step's own id instead of the campaign's, which would have fallen
    silently to an empty time.
  - Both now name the outer table in full.
- **Sideways scroll at 390 px:** the hidden "Action" column label scrolled the whole page. It is absolutely
  positioned, so it escaped the table's scroll box; its cell is now positioned.

## Verification

- `smoke-approvals.mjs`: 56 request checks.
  - **Setup:** two entities and three people:
    - the owner;
    - an approver in entity A only;
    - a technician in entity B only.
  - **Built through the real endpoints:**
    - a week of timesheets;
    - a breakdown on a critical machine signed off;
    - a purchase return claim;
    - both GST returns prepared and reviewed;
    - a breakdown signed off by the technician in entity B.
  - **Seeded in their waiting state in the database:** an NCR disposition, an FAI, two CAPAs (one due, one not), two
    test campaigns (one ready, one with a pending step) and a booking whose usage needs review. Their own smokes cover
    how those states are reached.
  - **Checked:**
    - the approver sees all nine kinds in A and nothing from B;
    - the not-yet-due CAPA and the unready campaign are absent;
    - the owner sees only the kinds without a separation rule, plus B's order from the technician;
    - the owner's own items are under "waiting on others" with the CAPA's due date, never in both tabs;
    - the technician sees their order waiting;
    - approve and verify from the list, then the items leave every tab;
    - send back without a reason is 400;
    - another workspace sees nothing and signed out is 401.
- Browser walkthrough `e2e/approvals.mjs` passes:
  - the menu count of four;
  - the groups and the entity column;
  - approve a week and verify an order in place, after which the count drops to two;
  - filter by kind, then open a GST return in its entity, where Approve is offered;
  - the empty "Waiting on others";
  - 390 px with no sideways scroll.
- Regression:
  - `smoke-home` (55 checks);
  - `e2e/menu-home.mjs`;
  - the add-new guard.
- Repo-wide checks: typecheck (20 packages), tests (15) and build (12).

## Limits

- **Five kinds are seeded in the smoke**, not walked through their own flows. The inbox reads only their stored
  states, and each flow has its own smoke.
- **Row cap:** each source returns at most 200 rows per entity. Timesheets read up to 2,000 entries before grouping.
- **No notifications**, delegation or bulk approval across kinds (as designed).
- **No direct action from the list** for return claims, test reports, usage reviews, NCRs, FAIs, CAPA and GST
  returns. They open the document, because each needs a note or figures read there.
