# Skill matrix — review and evidence (decision 062)

[Design](../specs/2026-10-12-skill-matrix-design.md). Migration `0044_skill_matrix`.

## What changed

- **DB:**
  - `skill` (code, name, re-certification interval of 1–60 months, active flag);
  - `machine_skill` and `work_centre_skill`, which say what each one needs;
  - `skill_certification` (trainee, qualified or trainer, dated with an expiry). It is append-only by trigger; the only
    change allowed is a single revocation;
  - `skill_override`, a one-time allowance for one person, operation and machine on one day;
  - co-sign columns on `job_card`, and `required_skill_id` on `inspection_plan`;
  - permission `quality.skill.read|create|update|approve|manage`. Production planners read and manage (override);
    operators read;
  - attachments gain owner type `skill_certification`.
- **API (`SkillsController`, `SkillsService`):**
  - the catalogue, requirements, matrix, history, certify and revoke, overrides, certified counts per machine, and
    co-sign candidates;
  - the **job card start** checks the required skills (machine plus work centre). A trainee needs a co-signer certified
    in all of them, and anyone uncertified needs an unused allowance from today;
  - **co-sign** only by the named person, while still certified; until then pause and stop are refused;
  - **inspection submit** on a plan with a required skill needs a qualified person or trainer.
- **Web:**
  - Quality → **Skill matrix**: the grid, the expiring list, the certify, history and revoke dialogs with evidence
    files, and the skill catalogue;
  - required skills per work centre and machine on **Work centres**, and a required skill on **inspection plans**;
  - the **shop floor** asks a trainee for a co-signer, shows "awaiting co-sign" and a Co-sign card for the co-signer,
    shows allowances on the card, and shows certified counts in the machine picker;
  - the **schedule** (Gantt and phone list) shows certified counts per machine;
  - the **work order** lists allowances and grants one ("Allow uncertified start").

## Deviations from the design, decided while building

- **Permission actions:**
  - The design named `certify` and `override`, but the roles screen only offers ten action columns, so custom roles
    couldn't be granted new actions.
  - The slice reuses **approve** (certify and revoke) and **manage** (allow an uncertified start), and the design now
    says so.
- **Revocation:**
  - A person's standing is their **latest** certification. If that one is revoked, they hold none until certified again.
  - The design first said "the latest not revoked", which would have quietly restored an older certification after a
    revocation for cause. The design now says "latest".
- **Routes:**
  - Requirements are at `/quality/skill-requirements`, because `skills/:id` would have shadowed `skills/requirements`.
  - `/quality/skill-candidates` was added for the co-signer picker.

## Review

One adversarial pass over the diff. Two findings fixed while building:

- **Fixed:** the requirements route was declared after `skills/:id` and would have failed UUID parsing. It was renamed.
- **Fixed:** the revoke dialog closed before showing the revoked record. It now stays open on the updated history.
- **Checked:**
  - Two simultaneous starts can't use one allowance: the row is locked and its unused condition re-checked.
  - The database refuses self-certification and self-allowance, besides the API.
  - Machines and work centres without required skills start cards exactly as before. The manufacturing, scheduling,
    no-time, job work, quality and FAI smokes are unchanged.
  - Another tenant sees an empty catalogue, can't certify our people, and gets 404 on our certifications.
- **Noticed, not changed:**
  - If the named co-signer is unavailable, the card waits. Only someone with work order cancel can cancel it, and the
    trainee then starts again naming someone else.
  - When every trainer of a skill has expired, the skill counts as having none, so any certifier can make a new
    trainer.
  - The co-signer picker uses `quality.skill.read`. A custom shop role without it still gets the API's message, but
    the list is empty.
  - Certified counts consider the tenant's active members, not per-entity access.

## Evidence

| Check | Result |
|---|---|
| `smoke-skill-matrix.mjs` (new) | 82 request checks PASS |
| `e2e:skill-matrix` (new, desktop + 390 px, three users) | PASS |
| Certification trigger: update, delete, re-revoke in psql | all refused |
| `smoke-manufacturing` / `smoke-scheduling` / `smoke-schedule-no-time` / `smoke-job-work` | 104 / 58 / 32 / 101 PASS |
| `smoke-quality` / `smoke-fai` | 112 / 52 PASS |
| `e2e:manufacturing` / `e2e:scheduling` / `e2e:quality` | PASS |
| `pnpm typecheck` / `pnpm build` / `turbo run test --force` | 19 / 12 / 11 tasks PASS |
| `pnpm lint` | 0 configured tasks |
| `git diff --check`, drizzle drift | clean, none |
