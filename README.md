# FactoryOS

India-compliant manufacturing and services ERP for a multi-entity company group, starting with
Azeonics and its subsidiary EarthNow.

- **Plan and decisions:** [docs/README.md](./docs/README.md) · [decision register](./docs/decisions/DECISIONS.md)
- **Current status / next steps:** [docs/ai/STATUS.md](./docs/ai/STATUS.md)
- **Working rules for any contributor or AI agent:** [AGENTS.md](./AGENTS.md)

## Layout

```
apps/
  api/         NestJS API: Better Auth, tenancy, RBAC, entities/GST, members, roles, audit, platform
  web/         Next.js: landing, sign-in/up + 2FA, onboarding, app shell, settings, platform console
  worker/      (Phase 1) background jobs
  edge-agent/  (Phase 5) plant IoT agent
packages/
  db/            Drizzle schema + SQL migrations
  auth/          permission catalog, system roles, scoped evaluation (unit tested)
  compliance-in/ GSTIN/PAN validation (unit tested); GST engine to come
  ui/            design system (tokens, components)
  gsp/           GSP/IRP adapter contract (draft)
  core, iot-protocol, sdk, config
docs/          plan, decisions, wireframes, handoff state
```

## Run locally

Requires Node 22+, pnpm 10, PostgreSQL 16.

```sh
pnpm install                      # also enables the git hooks
cp .env.example .env              # then set BETTER_AUTH_SECRET (openssl rand -base64 32)
docker compose up -d db           # or use any local Postgres matching DATABASE_URL
pnpm build
pnpm --filter @factoryos/db db:migrate

# Terminal 1: API on :4000 (applies migrations on start when MIGRATE_ON_START=true)
pnpm --filter @factoryos/api start
# Terminal 2: web on :3000 (proxies /api to API_INTERNAL_URL)
pnpm --filter @factoryos/web start

# Create the first platform SuperAdmin (there is no HTTP endpoint for this)
pnpm --filter @factoryos/api seed:superadmin -- --email you@example.com --name "Your Name" --password '...'
```

Open http://localhost:3000, create an account, and set up your workspace.

## Checks

```sh
pnpm typecheck && pnpm build && pnpm test       # all workspaces via Turborepo
apps/api/scripts/smoke.sh                       # 26 API end-to-end checks (API running)
pnpm --filter @factoryos/web e2e                # browser walkthrough (web + API running)
```

Supplier notes and purchase returns: [approved scope](docs/superpowers/specs/2026-10-05-supplier-notes-returns-design.md), [implementation plan](docs/superpowers/plans/2026-10-05-supplier-notes-returns.md), and [review/verification](docs/superpowers/reviews/2026-10-05-supplier-notes-returns-review.md). Focused API fixtures live in `apps/api/scripts/smoke-supplier-*.mjs`; production browsers in `apps/web/e2e/supplier-*.mjs` accept the standard API/web port overrides.

## Deploy

Dockerfiles: `apps/api/Dockerfile`, `apps/web/Dockerfile` (build from the repo root).
Coolify setup and environment variables: [docs/16-deployment.md](./docs/16-deployment.md).
