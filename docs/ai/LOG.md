# Work Log

Append-only. One entry per session: `date · who · what changed · what's next`.

- 2026-10-04 · agent · Wrote plan docs 01–10 and the Turborepo scaffold. Next: user answers.
- 2026-10-04 · agent · Recorded user answers as decisions 001–016; added IoT machine plan (11), Tally (12), UI/UX decisions (13), wireframes (14), tenancy/RBAC/auth (15), deployment (16); commit guard hooks; AGENTS.md contract. Next: build Phase 0.
- 2026-10-04 · agent · Built Phase 0: Drizzle schema + migrations, Better Auth (TOTP 2FA), tenancy/entity/GST model, scoped RBAC with no-escalation, invitations, hash-chained audit, platform console API + CLI seed; Next.js landing, auth, onboarding, app shell, settings, platform UI; design system in packages/ui; Dockerfiles; smoke (26 checks) and browser walkthrough. Next: user review + docs/10 answers, then Coolify deploy and Phase 1.
- 2026-10-04 · agent · Recorded decisions 018–021 from user answers; created Coolify project FactoryOS + healthy Postgres via REST API. Blocked: Coolify GitHub App can't see the repo; web domain needed. Next: finish deploy once unblocked.
- 2026-10-04 · agent · Deployed dev to Coolify: factoryos-web at https://factoryos.azeonics.com, internal factoryos-api, Postgres. Added EXTRA_TRUSTED_ORIGINS and the BOOTSTRAP_SUPERADMIN_EMAIL first-run promotion. Next: user signs up, restart API, create tenant.
- 2026-10-04 · agent · Cloudflare switched to DNS-only; https://factoryos.azeonics.com verified (200s, valid cert). Next: user signs up, restart API for SuperAdmin.
- 2026-10-04 · agent · User signed up on dev; API restarted. Bootstrap already ran in the webhook redeploy at 16:51 UTC (promotion silent on later starts). Noted that pushes auto-redeploy dev.
- 2026-10-04 · agent · Phase 1 slice 1a: masters, warehouses, batches, FIFO stock posting with exact cancel, balance and ledger, plus UI. Fixed two unqualified-subquery bugs and a Next replaceState remount bug found by the walkthrough. Smoke 43/43, e2e green. Next: user review, decision 022, then slice 1b (buying).
- 2026-10-05 · agent · Customer-supplied material: owner on stock rows, return/scrap purposes, waste register with consent rules, printable customer statement (migration 0003). Smoke 36/36 + e2e. Decisions 022 accepted, 024–025 added. Next: user review, then slice 1b (buying).
- 2026-10-05 · agent · Slice 1b backend: GST engine, purchase orders, receipt against PO, incoming inspection, purchase invoices with 3-way match; smoke-buying 60/60 · next: buying web screens + e2e
