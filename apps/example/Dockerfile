# syntax=docker/dockerfile:1

FROM node:24-alpine AS base
RUN corepack enable && corepack prepare pnpm@11.21.0 --activate
WORKDIR /app

FROM base AS deps
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY apps/example/package.json apps/example/package.json
COPY packages/skaffold-plugin/package.json packages/skaffold-plugin/package.json
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile

FROM deps AS source
COPY nx.json tsconfig.base.json ./
COPY apps/example apps/example

FROM source AS builder
RUN pnpm exec nx build example --skip-sync

FROM source AS dev
ENV NODE_ENV=development
EXPOSE 3000
CMD ["pnpm", "exec", "nx", "dev", "example", "--skip-sync"]

FROM base AS runner
ENV NODE_ENV=production
ENV PORT=3000
RUN addgroup --system --gid 1001 nodejs \
    && adduser --system --uid 1001 nextjs

COPY --from=builder --chown=nextjs:nodejs /app/apps/example/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/apps/example/.next/static ./apps/example/.next/static
COPY --from=builder --chown=nextjs:nodejs /app/apps/example/public ./apps/example/public

USER nextjs
EXPOSE 3000

CMD ["node", "apps/example/server.js"]
