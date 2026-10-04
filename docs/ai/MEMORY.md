# Project Memory (durable facts)

Facts every contributor needs and should not have to rediscover. Keep entries short. Add new ones
at the end of the relevant section, with a date.

## Business

- Azeonics Private Limited, Thane West, Maharashtra 400604. Manufacturing at Navi Mumbai.
  Pay-per-use aerospace manufacturing, testing and integration (CNC, metal AM, SMT, sensor lab,
  environmental testing, cleanroom), plus products (Manha Sat Kit) and ground-station services.
- EarthNow is a **separate legal entity**, acquired by Azeonics. Satellite analytics services
  (subscriptions, government projects).
- GST: registered in Maharashtra only today; other states and SEZ units are possible later.
- FY 2026-27 is the first financial year after GST registration. E-invoicing applies from
  **1 Apr 2027** (they are above the turnover threshold).
- Accountants know Tally well. FactoryOS is the books of record, with Tally import + sync.
- Machine register (first batch, ~80% accurate): `docs/11-iot-machine-plan.md`. CNC/EDM/metrology
  vendors are not yet appointed, so connectivity requirements can still go into RFQs.
- Export/import and possibly defence/export-controlled work may start once the software is live.

## User preferences

- Ask before deciding anything significant; offer a recommendation.
- Never use AI vendor/model/assistant names in commits or PRs (hooks enforce this).
- Work must be resumable by anyone using any AI provider: keep `docs/ai/*` current.
- UI quality matters: it must be clearly better than Frappe/ERPNext.

## Environment and gotchas

- Dev hosting: Coolify at `https://central.azeonics.com`. Its MCP endpoint is `/mcp` with a
  Sanctum bearer token (Coolify → Security → API Tokens). Configure it as the env var
  `COOLIFY_API_TOKEN`; never commit it. **A token was pasted in chat on 2026-10-04 and should be
  rotated.**
- `turbo` rewrites a managed block at the bottom of AGENTS.md. Keep it and commit it.
- Force-push is not permitted. The first commit on `claude/zealous-allen-35g1vm` predates the
  message guard and is left as-is.
- Local dev DB: PostgreSQL 16 (`docker compose up -d db`, or a local cluster). See `.env.example`.
