# FactoryOS

India-compliant manufacturing and services ERP for a multi-entity company group, starting with Azeonics and EarthNow.

**Status:** plan under review. See [docs/README.md](./docs/README.md) and [the open decisions](./docs/10-open-decisions.md).

## Layout

```
apps/      web · api · worker · edge-agent
packages/  ui · db · core · auth · compliance-in · gsp · iot-protocol · sdk · config
docs/      plan
```

## Commands

```sh
pnpm install
pnpm typecheck   # turbo run typecheck
pnpm build       # turbo run build
```

Requires Node 22+ and pnpm 10.
