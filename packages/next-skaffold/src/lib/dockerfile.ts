import {
  GENERATED_FILE_MARKER,
  type WorkspaceApp,
  type WorkspaceDependency,
} from '@dxs/skaffold';

// WORKDIR for the generated Dockerfile, so the container mirrors the local
// monorepo layout beneath it (e.g. /workspace/apps/demo/...) rather than
// nesting it under a same-ish-looking "app" directory (confusable with the
// local "apps/" one). Deliberately not the container's filesystem root: Nx's
// own workspace-root detection breaks there (it special-cases hitting "/"
// while walking up looking for nx.json), and even forcing it via
// NX_WORKSPACE_ROOT_PATH=/ makes the Nx daemon hang calculating the project
// graph across the whole container filesystem (/proc, /sys, etc. included).
export const WORKSPACE_DIR = '/workspace';

// assumes a Next.js app built via @nx/next: `nx build`/`nx dev` targets and a
// `.next/standalone` production output.
export function buildNextJsDockerfile(
  app: WorkspaceApp,
  dependencies: WorkspaceDependency[],
): string {
  // sorted (and deduplicated by definition, since dependencies never include
  // the app's own root) for deterministic output across regenerations
  const roots = [app.root, ...dependencies.map((dep) => dep.root)].sort();

  const packageJsonCopies = roots
    .map((root) => `COPY ${root}/package.json ${root}/package.json`)
    .join('\n');
  const sourceCopies = roots.map((root) => `COPY ${root} ${root}`).join('\n');

  return `# syntax=docker/dockerfile:1
${GENERATED_FILE_MARKER}
FROM node:24-alpine AS base
RUN corepack enable && corepack prepare pnpm@11.21.0 --activate
WORKDIR ${WORKSPACE_DIR}
ENV NEXT_TELEMETRY_DISABLED=1

FROM base AS deps
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
${packageJsonCopies}
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \\
    pnpm install --frozen-lockfile

FROM deps AS source
COPY nx.json tsconfig.base.json ./
${sourceCopies}

FROM source AS builder
RUN --mount=type=cache,id=next-${app.name},target=${WORKSPACE_DIR}/${app.root}/.next/cache \\
    pnpm exec nx build ${app.name} --skip-sync

FROM source AS dev
ENV NODE_ENV=development
EXPOSE 3000
CMD ["pnpm", "exec", "nx", "dev", "${app.name}", "--skip-sync"]

FROM base AS runner
ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"
RUN addgroup --system --gid 1001 nodejs \\
    && adduser --system --uid 1001 nextjs

COPY --from=builder --chown=nextjs:nodejs ${WORKSPACE_DIR}/${app.root}/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs ${WORKSPACE_DIR}/${app.root}/.next/static ./${app.root}/.next/static
COPY --from=builder --chown=nextjs:nodejs ${WORKSPACE_DIR}/${app.root}/public ./${app.root}/public

USER nextjs
EXPOSE 3000

CMD ["node", "${app.root}/server.js"]
`;
}
