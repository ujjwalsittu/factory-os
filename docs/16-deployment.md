# 16 · Deployment (development on Coolify)

Decision 012: during development we deploy to the existing Coolify instance at
`https://central.azeonics.com` (on AWS).

> Coolify needs a long-running server (EC2/VM). It can't run on AWS Lambda. If the instance is
> on an EC2 host, everything below applies as-is.

## Services

| Coolify resource | Source | Notes |
|---|---|---|
| `factoryos-db` | PostgreSQL 16 (Coolify one-click) | Daily backups to S3. Later: TimescaleDB image |
| `factoryos-api` | `apps/api/Dockerfile` | Port 4000. Runs migrations on start (`MIGRATE_ON_START=true`) |
| `factoryos-web` | `apps/web/Dockerfile` | Port 3000. `NEXT_PUBLIC_API_URL` points to the API domain |
| `factoryos-worker` | (Phase 1) | Background jobs |
| `factoryos-mqtt` | (Phase 5) EMQX/Mosquitto | mTLS for edge agents |

Suggested domains: `factoryos.azeonics.com` (web) and `api.factoryos.azeonics.com` (API). Same
parent domain so session cookies work across them.

## Environment variables

See `.env.example` in the repo root. Required in Coolify:
`DATABASE_URL`, `BETTER_AUTH_SECRET` (32+ random bytes), `BETTER_AUTH_URL` (API public URL),
`WEB_ORIGIN` (web public URL), `NEXT_PUBLIC_API_URL`.

## Coolify MCP (for agents)

`.mcp.json` registers the Coolify MCP endpoint `https://central.azeonics.com/mcp` with
`Authorization: Bearer ${COOLIFY_API_TOKEN}`. Each developer sets `COOLIFY_API_TOKEN` in their
own environment (Coolify → Security → API Tokens). Tokens are never committed. Agents must not
create or delete Coolify resources unless the user asks (AGENTS.md L8).

## Pipeline (later)

GitHub Actions: typecheck, build, test → build images → Coolify deploy webhook for `staging` on
merge to `main`. Production is a separate Coolify project with manual promotion.
