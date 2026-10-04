# Build from the repo root: docker build -f apps/api/Dockerfile .
FROM node:22-alpine AS base
RUN corepack enable
WORKDIR /repo

FROM base AS build
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm turbo run build --filter=@factoryos/api...
# Self-contained production folder with only runtime dependencies.
RUN pnpm --filter=@factoryos/api deploy --legacy --prod /out

FROM node:22-alpine AS run
ENV NODE_ENV=production PORT=4000
WORKDIR /app
COPY --from=build /out .
USER node
EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=5s CMD wget -qO- http://127.0.0.1:4000/api/health || exit 1
CMD ["node", "dist/main.js"]
