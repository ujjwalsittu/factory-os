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
| `factoryos-web` | `apps/web/Dockerfile` | Port 3000. `API_INTERNAL_URL` points to the API on the internal network |
| `factoryos-worker` | (Phase 1) | Background jobs |
| `factoryos-mqtt` | (Phase 5) EMQX/Mosquitto | mTLS for edge agents |

Dev is live at `https://factoryos.azeonics.com` (web only). The API has no public domain: the web
app proxies `/api` to it over Coolify's `coolify` network using the alias `factoryos-api`
(`API_INTERNAL_URL=http://factoryos-api:4000`).

## What deploys when

Both apps build branch `main` (the default branch). A merge to `main` triggers Coolify's GitHub
webhook, and each app rebuilds only if the merge touched one of its watch paths:

| App | Watch paths |
|---|---|
| `factoryos-api` | `apps/api/**`, `packages/{auth,compliance-in,core,db,email,gsp,config}/**` |
| `factoryos-web` | `apps/web/**`, `packages/{auth,ui,gsp,core,config}/**` |
| both | `package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`, `turbo.json`, `.dockerignore` |

Coolify stores one glob per line (no braces); the table groups them for reading. Docs-only merges
deploy nothing. When an app gains a workspace dependency (its own or a transitive one), add that
package to the app's watch paths in Coolify and in this table.

## Environment variables

See `.env.example` in the repo root. Required in Coolify (all runtime-only):
- API: `DATABASE_URL`, `BETTER_AUTH_SECRET` (32+ random bytes), `BETTER_AUTH_URL` and `WEB_ORIGIN`
  (both the public web URL), `MIGRATE_ON_START`; optional `EXTRA_TRUSTED_ORIGINS`,
  `ALLOW_SELF_SERVE_TENANTS` (false on shared hosts), `BOOTSTRAP_SUPERADMIN_EMAIL`.
- Attachments storage (decision 051): set `STORAGE_CREDENTIAL_KEY_V1` on the API (`openssl rand -base64 32`), then a
  SuperAdmin enters the Cloudflare R2 endpoint, bucket and API token on **Platform → Storage**; saving tests the
  bucket first. Leave `STORAGE_DRIVER` unset: when set, it and the `S3_*` variables override the saved settings.
- Web: `API_INTERNAL_URL`.
- DNS: keep the Cloudflare record **DNS-only** (grey cloud). Proxied mode returned 526 because
  Cloudflare rejected the origin certificate.

## Coolify MCP (for agents)

`.mcp.json` registers the Coolify MCP endpoint `https://central.azeonics.com/mcp` with
`Authorization: Bearer ${COOLIFY_API_TOKEN}`. Each developer sets `COOLIFY_API_TOKEN` in their
own environment (Coolify → Security → API Tokens). Tokens are never committed. Agents must not
create or delete Coolify resources unless the user asks (AGENTS.md L8).

## Image notes

- Build both images from the repo root: `docker build -f apps/api/Dockerfile .` and
  `docker build -f apps/web/Dockerfile .`. In Coolify, set the Dockerfile location accordingly and
  keep the build context at `/`.
- The API image is a `pnpm deploy` bundle (only production dependencies) and includes the SQL
  migrations; set `MIGRATE_ON_START=true` for dev.
- The web image runs the Next.js standalone server. `API_INTERNAL_URL` is read at runtime, so the
  API can move without rebuilding the web image.
- First SuperAdmin on a host: set `BOOTSTRAP_SUPERADMIN_EMAIL`, sign up with that email, restart
  the API. (Or run `node dist/cli/seed-superadmin.js …` in the API container's terminal.)
- Set every runtime variable with "Build variable" off; secrets must not be build args.

## Pipeline (later)

GitHub Actions: typecheck, build, test → build images → Coolify deploy webhook for `staging` on
merge to `main`. Production is a separate Coolify project with manual promotion.
