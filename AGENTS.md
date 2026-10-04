# AGENTS.md — operating contract for any AI coding agent or human contributor

This file is **provider-neutral**. Every assistant or agent, from any vendor, and every human,
follows it. Tool-specific files (`CLAUDE.md`, `GEMINI.md`, `.github/copilot-instructions.md`,
`.cursor/rules`) only point here.

## 0. What this repo is

FactoryOS is an India-compliant manufacturing and services ERP for the Azeonics group (Azeonics
Private Limited plus its acquired subsidiary EarthNow). It is a pnpm + Turborepo monorepo:
NestJS API, Drizzle ORM, PostgreSQL, Better Auth, and a Next.js web app. The plan is in
[`docs/README.md`](docs/README.md).

## 1. Start-of-session ritual (do this, and only this, before working)

1. Read this file.
2. Read [`docs/ai/STATUS.md`](docs/ai/STATUS.md): current phase, next tasks, blockers.
3. Read [`docs/ai/MEMORY.md`](docs/ai/MEMORY.md): durable facts and user preferences.
4. Read the last 3 entries of [`docs/ai/LOG.md`](docs/ai/LOG.md).
5. Read [`docs/decisions/DECISIONS.md`](docs/decisions/DECISIONS.md) if your task touches architecture.

Then state in **one line** which task you are taking. Default: the first unchecked item under
"Next" in STATUS.md, unless the user asked for something else.

## 2. Anti-loop and focus rules (binding)

| # | Rule |
|---|---|
| L1 | **One task at a time.** Finish it, or record a blocker, before starting another. |
| L2 | **Same-failure limit: 2.** Never run the same command with the same inputs more than twice after a failure. On the 3rd occurrence of the same error, change approach. If a second approach also fails, **stop** and go to L6. |
| L3 | **Progress checkpoint.** Every ~20 tool actions (or ~30 min) you must have a verifiable result: a passing check, a commit, or a written blocker. If not, stop and go to L6. |
| L4 | **No re-reading.** Do not re-read files that haven't changed since you last read them. Do not re-explore the whole repo; use STATUS/MEMORY and targeted search. |
| L5 | **No scope creep.** Do not refactor, rename, reformat or upgrade anything outside the task. Write unrelated findings under "Noticed" in STATUS.md. |
| L6 | **Blocker protocol.** Write the blocker in STATUS.md (what, what you tried, what you need), commit, and ask the user one specific question with your recommended answer. Do not idle-loop, poll, or "try once more". |
| L7 | **Decisions are binding.** Entries marked *Accepted* in DECISIONS.md are not reopened. To change one, add a *Proposed* entry and ask the user. |
| L8 | **Ask before deciding** anything with business, cost, security or data-model impact that is not already in DECISIONS.md. Give options and a recommendation. |
| L9 | **No speculative work.** Don't build features that aren't in STATUS "Next" or requested by the user. Don't generate long plans that already exist in `docs/`; link to them. |
| L10 | **Verify before claiming.** "Done" means typecheck + lint + tests pass locally and you saw them pass. Report failures as failures. |

## 3. Definition of done (per task)

- [ ] `pnpm typecheck` and `pnpm build` pass; tests for touched packages pass.
- [ ] New env vars added to `.env.example`. No secrets committed.
- [ ] DB changes have a migration (`pnpm --filter @factoryos/db db:generate`).
- [ ] New permissions registered in `packages/auth/src/permissions.ts`.
- [ ] `docs/ai/STATUS.md` updated (move item to Done, refresh Next/Blockers).
- [ ] One line appended to `docs/ai/LOG.md`.
- [ ] Committed with a clean message (section 5) and pushed.

## 4. End-of-session ritual (mandatory, even if unfinished)

1. Update STATUS.md: Done / In progress (with exact stopping point) / Next / Blockers.
2. Append to LOG.md: date · who (human name or "agent") · what changed · what's next.
3. Add any new durable fact or preference to MEMORY.md.
4. Commit and push. Unpushed work is lost: cloud containers are ephemeral.

## 5. Commit and PR rules (enforced by hooks and CI)

- Never name AI vendors, models or assistants in commit messages, PR titles or PR bodies. No
  co-author trailers for tools and no session links. The `commit-msg` hook, the `pre-push` hook
  and the `message-guard` workflow enforce this using `.githooks/forbidden-words.txt`. Hooks are
  enabled by `pnpm install` (`core.hooksPath=.githooks`).
- Do not bypass hooks (`--no-verify`). Do not force-push or rewrite pushed history.
- Message style: imperative subject ≤ 72 chars; body explains *why*.
- One logical change per commit.

## 6. Code conventions

- TypeScript strict everywhere. Zod for every boundary. No `any` without a comment explaining why.
- Every transactional table has `tenant_id`, and `entity_id` where applicable. Every query goes
  through the tenancy context (see `apps/api/src/tenancy`).
- Ledgers are append-only. Corrections are reversals, never updates.
- Permissions are strings of the form `module.resource.action`, declared in one catalog.
- UI uses `@factoryos/ui` components only; no ad-hoc colors (use tokens).
- Money uses decimal strings or `numeric` columns, never JS floats.

## 7. Secrets

Never commit secrets. Local secrets go in `.env` (gitignored). Deployment secrets live in Coolify.
The Coolify MCP endpoint is configured in `.mcp.json` and reads `COOLIFY_API_TOKEN` from the
environment.

<!-- BEGIN:turborepo-agent-rules -->

# This is NOT the Turborepo you know

Turborepo configuration, task behavior, and CLI commands can vary between installed versions and may differ from your training data. Resolve the `turbo` package from this file's directory or relevant workspace; in monorepos, it may not be visible from the repository root. For example, run `node -p "require.resolve('turbo/package.json')"` from a workspace that depends on `turbo`.

Read `docs/README.md` inside that installed package first, then read the relevant pages from its `docs/` directory before changing Turborepo configuration or commands. Heed deprecation notices. These bundled docs match the installed package version and are available without network access.

This block is written and re-added by `turbo` before repository-scoped commands when an AI agent is detected. In the Turborepo source repository, its template is defined in `crates/turborepo-cli/src/cli/agent_guidance.rs`. Removing the managed block while updates are enabled means a later qualifying invocation will add it again. Set `"agentGuidance": false` in the root `turbo.json` or `turbo.jsonc` to opt out; this does not remove an existing block. Keep the block committed with your work to avoid an uncommitted change on the next agent invocation.
<!-- END:turborepo-agent-rules -->
