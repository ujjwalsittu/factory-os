# Skill matrix — operator certifications (decision 062)

The second quality follow-up deferred by decision 048. From [03 · Manufacturing and inventory](../../03-manufacturing-inventory.md)
§ quality: "Operator **skill matrix / certifications** (e.g. only certified operators run 5-axis)".

User choices, 2026-10-12:

1. **Next slice:** the skill matrix. IoT metering still waits on B20.
2. **Scope:**
   - a catalogue of **named skills**, such as "5-axis milling" or "Vacuum brazing";
   - machines and work centres list the skills they need;
   - people hold certifications for skills, so one skill covers several similar machines.
3. **Enforcement at job card start:**
   - someone without a valid certification is **refused**;
   - a supervisor with the override permission can **allow it for that one card**, with a reason that is logged and
     shown on the card.
4. **Validity:**
   - levels: **trainee**, **qualified** and **trainer**;
   - each skill sets a **re-certification interval**, and expired certifications stop counting;
   - a trainee runs a card only when a qualified person or trainer **co-signs** it.
5. **Co-sign:**
   - the trainee names the co-signer at start;
   - the card waits "awaiting co-sign" until that person confirms **from their own login**;
   - until then the card can't be paused or stopped.
6. **Certifier:**
   - anyone with the certify permission, **never for themselves**;
   - making someone a **trainer** needs the certifier to be a trainer of that skill, once the skill has any trainer.
7. **Reach:**
   - **Skill matrix** screen: a people × skills grid, the certifications expiring within 30 days, and evidence files;
   - **Inspection plans** can require a skill. Anyone may draft the record, but submitting it needs a qualified person or
     trainer. There is no override;
   - the **schedule** and the **shop-floor dispatch list** show how many certified operators each machine has. This is
     information only, not a scheduling constraint.

## Data model (migration `0044_skill_matrix`)

- **`skill`** (entity):
  - `code` (unique per entity), `name` and `description`;
  - `recertify_months` (1–60);
  - `is_active`.
- **`machine_skill`** and **`work_centre_skill`**: the skills a machine or work centre needs. Each pair is unique.
  - A card on a machine needs the machine's skills **and** its work centre's skills.
  - A card without a machine needs the work centre's skills.
- **`skill_certification`** (append-only):
  - `user_id`, `skill_id` and `level` (trainee, qualified or trainer);
  - `certified_on`, `expires_on` (= certified on + the skill's months) and `certified_by`, with an optional `note`;
  - `revoked_at`, `revoked_by` and `revoke_reason`, set once.
  - A trigger refuses any other update, and any delete.
  - A person's **current** certification for a skill is the latest one not revoked. It **counts** on a date when that
    date is on or before `expires_on`.
  - Re-certifying, raising or lowering a level adds a new row; the old rows stay as history.
- **`skill_override`**: a one-time allowance for one person, one work-order operation and one machine (or none).
  - It records the reason, who granted it and when, and the job card that used it.
  - It expires at the end of the business day if unused.
- **`job_card`** gains:
  - `cosign_user_id` and `cosigned_at`;
  - `skill_override_id`.
- **`inspection_plan`** gains `required_skill_id` (optional).
- **Attachments** gain owner type `skill_certification`, for training records and test pieces.

## Behaviour

- **Required skills of a job card:** the active skills of its machine plus those of its work centre.
  - No required skills: nothing changes. Existing shops keep working until they add skills.
- **Start** a job card, for each required skill:
  - **qualified or trainer**, valid today: it starts as before;
  - **trainee** only:
    - the start needs a co-signer;
    - the co-signer must be another active member who is qualified or a trainer in **every** required skill, valid today;
    - the card is created "awaiting co-sign";
  - **missing or expired** in any skill:
    - start is refused, naming the missing skills;
    - if an unused, unexpired override exists for this person, operation and machine, the card starts and uses it.
  - An override covers missing skills only. If the person is a trainee for some skills and missing others, the override
    lets the card start without a co-sign.
- **Co-sign:** the named person confirms from the shop-floor list or the work order. Until then:
  - pause and stop are refused;
  - the minutes still count from the start;
  - the operator may cancel the card as today.
- **Override** (`quality.skill.override`):
  - granted from the work order operation, for a person and a machine, with a reason;
  - not for oneself;
  - listed with the job card ("Started under override by …: reason").
- **Inspection plans:**
  - a plan may name one required skill;
  - submitting an inspection record on that plan needs the submitter to be qualified or a trainer, valid on the
    submission date;
  - drafts and measurements are open as today.
- **Certify** (`quality.skill.certify`):
  - pick a person, skill, level and certification date (today or earlier, within the interval);
  - not for oneself;
  - a trainer level needs the certifier to be a currently valid trainer of the skill, unless the skill has none yet;
  - the expiry is computed from the date.
  - **Revoke** with a reason, with the same permission.
- **Skill matrix screen:**
  - rows are active members, columns are active skills;
  - each cell shows the level and expiry, marked expiring (within 30 days) or expired;
  - filter by skill or person;
  - a list of what expires in the next 30 days.
- **Schedule and dispatch:**
  - each machine shows "N certified", meaning people qualified or trainer, valid today, in all its required skills;
  - a machine with required skills and no certified person is marked.

## API

- **Skills:** GET, POST and PUT `/quality/skills` (also deactivate).
- **Requirements:** PUT `/quality/skills/requirements`, with `{machineId | workCentreId, skillIds[]}`.
- **Certifications:**
  - GET `/quality/skill-matrix` (people × skills, with expiring);
  - GET `/quality/skill-certifications?userId=&skillId=` (history);
  - POST `/quality/skill-certifications`;
  - POST `/quality/skill-certifications/:id/revoke`.
- **Overrides:** POST `/quality/skill-overrides` and GET `/quality/skill-overrides?operationId=`.
- **Job cards:**
  - the start body gains `cosignUserId`;
  - POST `/manufacturing/job-cards/:id/cosign`;
  - the start refusal returns `code: 'skill_missing'` or `'cosign_required'` with the skills and who could co-sign.
- **Certified counts:** GET `/quality/skill-coverage?machineIds=` returns the counts per machine. The schedule and the
  dispatch list use it.

## Permissions and roles

- New: `quality.skill.read|create|update|certify|override`.
- **Quality** gets all of them; it already takes every `quality.*` permission.
- **Production planner** gets `quality.skill.read` and `quality.skill.override`. Planners act as shop supervisors.
- **Operator** gets `quality.skill.read` to see the matrix and who can co-sign. Co-signing uses the operator's own
  `manufacturing.job_card.update`.

## Screens

- **Quality → Skill matrix:** the grid, the expiring list, Certify, and each certification's history, files and revoke.
- **Quality → Skills:** the catalogue, with name, interval, and the machines and work centres that need it.
- **Machines and work centres** (Manufacturing → Work centres): the required skills, as chips.
- **Inspection plans:** a "Required skill" field.
- **Job card start:**
  - the co-signer picker when the operator is a trainee;
  - the refusal names the missing skills and who can override;
  - "Awaiting co-sign by …" and "Co-sign" on the card.
- **Work order operation:** "Allow uncertified start" (override), for supervisors.
- **Schedule and dispatch list:** "N certified" per machine.

## Not in this slice

- Labour availability or shifts as a scheduling constraint.
- Training plans, courses and reminders by email.
- Skill requirements per item or routing operation (only machines and work centres).
- Certifications shared across legal entities.

## Tasks

1. Claim in STATUS, this design and decision 062 to main (docs-only PR).
2. Migration `0044_skill_matrix`, permissions and roles, and the attachment owner type.
3. API:
   - skills, requirements, certifications, overrides and coverage;
   - the job card start, co-sign and the inspection submit gate;
   - smoke `smoke-skill-matrix.mjs`.
4. Web:
   - the skill matrix and skills;
   - requirements on machines, work centres and plans;
   - job card start and co-sign, overrides, and coverage on the schedule and dispatch list;
   - e2e `skill-matrix.mjs` (desktop and 390 px).
5. Regression and wrap-up:
   - manufacturing, scheduling and quality smokes and browsers;
   - root checks;
   - review, STATUS/LOG and the PR.
