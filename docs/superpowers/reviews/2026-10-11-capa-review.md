# CAPA — review and evidence (decision 061)

[Design](../specs/2026-10-11-capa-design.md). Migration `0043_capa`.

## What changed

- **DB:**
  - `capa` (series `CAPA`, `{ENTITY}/CAPA/{FY}/{####}`): source, title, problem (D2), severity, owner, the wait
    (30–180 days, checked in the database), the 5-Why, root cause, team (D1), containment (D3), recognition (D8) and the
    status with its dates;
  - `capa_ncr` (unique pairs), `capa_action` (containment, corrective, preventive) and `capa_verification`, which a
    trigger keeps append-only;
  - new permission `quality.capa.read|create|update|approve|cancel`; the Production planner reads CAPAs;
  - attachments gain owner type `capa`.
- **API (`CapaController`, under `/quality`):**
  - list with the next due action or check and overdue flags, filtered by status, owner or NCR; detail with NCRs,
    actions, checks and files;
  - raise (an NCR-sourced CAPA needs its NCR), edit the analysis while open or in action, link and unlink NCRs (an
    NCR-sourced CAPA keeps one);
  - actions: add, edit, done (only once started, no future date) and cancel with a reason;
  - **start** needs two whys, a root cause and an open corrective action, and for a major CAPA the team and containment;
  - **submit** needs no open actions and a done corrective one, and sets the check date;
  - **verify** (`quality.capa.approve`) is refused before the date and for the owner; effective closes it (a major
    CAPA needs D8), not effective returns it to action; every check is kept;
  - **cancel** while open or in action, with a reason.
  - Every change runs under a row lock on the CAPA and writes an audit row.
- **Web:**
  - Quality → **CAPA**: list by status with next due and overdue highlighted, and Raise CAPA;
  - the CAPA page: problem and linked NCRs, root cause and 8D, actions by kind, effectiveness checks and files;
  - the NCR page gains a CAPA card with linked CAPAs and Raise CAPA (the NCR seeds the problem).

## Review

One adversarial pass over the diff. One finding fixed while building:

- **Fixed:** the CAPA page showed the files panel to anyone who could read CAPAs. A verifier without
  `quality.attachment.read` got 403s. It now shows only with that permission, as on projects and campaigns.
- **Checked:**
  - The owner can't record the check, even with `quality.capa.approve`.
  - A closed or cancelled CAPA's analysis, actions and links are fixed; a CAPA waiting for its check is fixed too.
  - Actions can't be marked done before the CAPA starts, or dated in the future.
  - Owners and action owners must be active members of the tenant; another tenant gets 404 and can't name our people.
  - Verifications can't be changed or deleted (trigger).
- **Noticed, not changed:**
  - The owner can be changed while the CAPA is open or in action, so in principle someone could hand the CAPA to
    another person before submitting and then check it themselves. The change is audited. Freezing the owner after
    start would block real hand-overs, so it is left as is.
  - The design names action routes `actions/:aid`; the API uses `capa-actions/:aid`, beside the `capas` routes.

## Evidence

| Check | Result |
|---|---|
| `smoke-capa.mjs` (new) | 58 request checks PASS |
| `e2e:capa` (new, desktop + 390 px, two users) | PASS |
| `smoke-quality` / `smoke-fai` | 112 / 52 PASS |
| `e2e:quality` | PASS |
| `pnpm typecheck` / `pnpm build` / `turbo run test --force` | 19 / 12 / 11 tasks PASS |
| `pnpm lint` | 0 configured tasks |
| `git diff --check`, drizzle drift | clean, none |
