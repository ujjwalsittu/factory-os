# CAPA — corrective and preventive action (decision 061)

The quality follow-up deferred by decision 048. From [03 · Manufacturing and inventory](../../03-manufacturing-inventory.md)
§ quality: "**CAPA** with root cause (8D/5-Why) and effectiveness checks". It builds on the NCR/MRB of slice 2d.

User choices, 2026-10-11:

1. **Next slice:** CAPA, before the skill matrix and IoT metering (still waiting on B20).
2. **Root cause:**
   - every CAPA has a **5-Why chain** and a root-cause statement;
   - a **major** CAPA also completes the **8D sections**: team, containment, corrective and preventive actions,
     verification and recognition.
3. **Trigger:**
   - raising a CAPA is **optional**, from any NCR ("Raise CAPA");
   - several NCRs can link to one CAPA;
   - a CAPA can also be raised **standalone**, from an audit finding, a customer complaint or other.
4. **Closing:**
   - When every action is done, the CAPA waits for a **verification date**, set as 30–180 days.
   - A **different person from the owner** then records whether it was effective.
   - If it wasn't, the CAPA reopens for new actions.

## Data model (migration `0043_capa`)

- **`capa`** (entity):
  - Identity: `number` (series `CAPA`, `{ENTITY}/CAPA/{FY}/{####}`) and `source` (ncr, audit, complaint, other).
  - The problem: `title`, `problem` (D2, the problem description) and `severity` (minor or major).
  - People and timing: `owner_user_id` and `verify_after_days` (30–180, default 60).
  - Root cause and 8D:
    - `whys` (JSON array, 1–5 steps) and `root_cause`;
    - `team` (D1), `containment` (D3) and `recognition` (D8).
  - `status`: open → in action → verifying → closed, or cancelled.
    - A failed verification returns the CAPA to "in action".
    - Timestamps: `verify_due_on`, `closed_at`; `cancel_reason`.
- **`capa_ncr`**: links a CAPA and an NCR. Each pair is unique, and an NCR can link to more than one CAPA.
- **`capa_action`**:
  - `capa_id`, `kind` (containment, corrective or preventive), `description`, `owner_user_id` and `due_on`;
  - `status`: open, done or cancelled;
  - `done_on`, `done_note`, `done_by`, and `cancel_reason`.
- **`capa_verification`** (append-only): `capa_id`, `effective`, `note`, `verified_by` and `verified_at`.
- **Attachments** gain owner type `capa`, for 8D reports, evidence and photos.

## Behaviour

- **Raise:**
  - From an NCR page ("Raise CAPA") the NCR is linked and its item and description prefill the problem.
  - From Quality → CAPA it is standalone, with a source.
  - Either way: title, problem, severity, owner and the verification wait.
- **Plan** (open), while the CAPA is open:
  - write the 5-Why chain and root-cause statement;
  - for a major CAPA, fill in the team and containment;
  - add actions with an owner and due date;
  - link more NCRs.
- **Start actions** (open → in action) needs:
  - at least two whys and a root-cause statement;
  - at least one corrective action;
  - for a major CAPA, the team and containment as well.
- **Do the actions:** each action is marked done with a date and a note, or cancelled with a reason. Actions and the
  root cause stay editable while the CAPA is in action.
- **Submit for verification** (in action → verifying) needs:
  - every action done or cancelled;
  - at least one corrective action done.
  - It sets `verify_due_on` = today + `verify_after_days`.
- **Verify** (`quality.capa.approve`):
  - only on or after `verify_due_on`, and by someone other than the owner;
  - **effective** closes the CAPA; a major CAPA needs D8 recognition (it may say "none");
  - **not effective** records the note and returns the CAPA to "in action" for new actions;
  - every verification is kept.
- **Cancel** (open or in action), with a reason.
- **Overdue:** the list flags open actions past due and verifications that are due.

## API

`/quality/capas`:

- CAPAs: GET list, with overdue flags and filters by status and owner; POST; GET `:id`; PUT `:id`.
- Status changes: POST `:id/start`, `:id/submit`, `:id/verify` and `:id/cancel`.
- Actions:
  - POST `:id/actions`, PUT `actions/:aid`;
  - POST `actions/:aid/done` and `actions/:aid/cancel`.
- NCR links: POST `:id/ncrs` and DELETE `:id/ncrs/:ncrId`.

The NCR detail lists its linked CAPAs.

## Permissions and roles

- New: `quality.capa.read|create|update|approve|cancel`. `approve` is the effectiveness verification.
- **Quality** gets all of them; its role already includes every `quality.*` permission.
- **Production planner** gets `quality.capa.read`, so action owners on the shop side can see their CAPAs.

## Screens

- **Quality → CAPA:**
  - **List:** number, title, severity, owner, status and next due (an action or verification), with overdue highlighted.
  - **CAPA page:**
    - the problem and linked NCRs;
    - the 5-Why and root cause, and the 8D sections for major CAPAs;
    - actions by kind;
    - verification history, and files.
- **NCR page:** a "CAPA" card with linked CAPAs and "Raise CAPA".

## Not in this slice

- Reminders by email.
- Supplier CAPA (SCAR).
- Ishikawa diagrams.
- Linking audits as records; the audit is the source text only.

## Tasks

1. Claim in STATUS, this design and decision 061 to main (docs-only PR).
2. Migration `0043_capa`, permissions and roles, the `CAPA` series and the attachment owner type.
3. API: CAPAs, actions, NCR links, start, submit, verify and cancel. Smoke `smoke-capa.mjs`.
4. Web: CAPA list and page, and the NCR card. e2e `capa.mjs` (desktop and 390 px).
5. Regression and wrap-up:
   - quality and FAI smokes and browsers;
   - root checks;
   - review, STATUS/LOG and the PR.
