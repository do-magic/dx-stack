# @dx-stack/next-skaffold

The Next.js implementation of
[`@dx-stack/skaffold`](https://www.npmjs.com/package/@dx-stack/skaffold)'s
`FrameworkAdapter` contract (`nextJsAdapter`, `src/lib/next-adapter.ts`).
Everything framework-agnostic — app discovery, namespace assignment, port
forwarding, the `production` profile, generated-file pruning — lives in
`@dx-stack/skaffold` and is documented there. This package only covers what's
specific to Next.js: `activates` (detecting a Next.js app), the generated
Dockerfile, the dependency sync paths it needs, and `next.config.js`
maintenance.

## Installation

```sh
pnpm nx add @dx-stack/next-skaffold
```

Then add it to your `syncGenerators`, e.g. on whichever Nx target you use to
run skaffold (a plain `nx.json`-level `sync.globalGenerators` array works
too):

```jsonc
{
  "targets": {
    "skaffold": {
      // ... your own executor/commands to run skaffold itself
      "syncGenerators": ["@dx-stack/next-skaffold:sync"],
    },
  },
}
```

The `sync` generator (`src/generators/sync/sync.ts`) is a one-line wrapper:
`createSkaffoldSyncGenerator([nextJsAdapter])`. Once wired in, it runs
automatically before the target it's attached to, and can also be run
directly with `nx sync`.

## Detecting a Next.js app

`nextJsAdapter.activates` reads the app's own `package.json`
`dependencies`/`devDependencies` and checks for a `next` entry. Deliberately
based on the app's own declared dependencies rather than Nx's project graph
or target commands, since `graph.dependencies` doesn't include `npm:` edges
and target executors/commands are a plugin-version-specific implementation
detail, not a stable place to detect a framework from.

## Dockerfile generation

The template itself lives in `src/lib/dockerfile.ejs`, rendered via
[EJS](https://ejs.co/) by `buildNextJsDockerfile` (`src/lib/dockerfile.ts`),
which just reads the file (co-located, resolved via `__dirname` so it works
both from source and from the built `dist/` — see the `assets` glob on this
project's `build` target) and renders it with the app/dependency data. It's a
fixed multi-stage build — `base` → `deps` (install, scoped to the app and its
workspace dependencies) → `source` (copies source) → `builder`
(`nx build <app> --skip-sync`) and, as siblings both built from `source`,
`dev` (`nx dev <app> --skip-sync`, watching for changes — the stage name
`@dx-stack/skaffold`'s core requires every adapter's Dockerfile to have) and
`runner` (the `.next/standalone` production output).

The `runner` stage sets `ENV HOSTNAME="0.0.0.0"` unconditionally — Next.js's
standalone `server.js` otherwise binds to whatever `HOSTNAME` happens to be
set to, and Kubernetes auto-injects one equal to the pod name, which the
server can't actually bind to (breaks `kubectl port-forward` and anything
else expecting the app to listen on all interfaces). Baking the fix into the
image means every app gets it automatically, rather than depending on each
hand-written `k8s/deployment.yaml` remembering to set `HOSTNAME` itself as an
override — easy to forget, and a Deployment that's missing it fails silently
in exactly this way rather than erroring out clearly.

`WORKDIR` is `/workspace`, and every `COPY` mirrors the app's local path
beneath it (e.g. `apps/demo` on disk becomes `/workspace/apps/demo` in the
image) — this is deliberate, so paths inside the container match the
monorepo layout you already know, rather than requiring a mental translation.
Two more literal options were tried and rejected:

- A same-ish-looking wrapper like `/app` (`/app/apps/demo/...`) — works, but
  reads as an easy-to-misread near-duplicate of the local `apps/` directory.
- The container's actual filesystem root (`/`, so `/apps/demo/...` with no
  wrapper at all) — doesn't work: Nx's own workspace-root detection breaks
  the instant `cwd` is `/` (it special-cases hitting the filesystem root
  while walking up looking for `nx.json`, before ever checking `/` itself),
  and forcing it past that via `NX_WORKSPACE_ROOT_PATH=/` just trades that
  error for the Nx daemon hanging while it calculates the project graph
  across the _entire_ container filesystem, `/proc` and `/sys` included.
  Confirmed by direct `docker build`/`docker run` reproduction of both
  failure modes.

`getDependencySyncPaths` contributes one `src/**/*`-style sync entry per
workspace dependency this Dockerfile actually `COPY`s in — core adds the
app's own `src/**/*`/`public/**/*` unconditionally, so this only needs to
cover the extra paths. `next.config.js`, `tsconfig.json`, `package.json`, and
friends are deliberately left out of sync entirely: those either need a
process restart to take effect at all (config) or an actual `pnpm install`
(`package.json`), so falling through to skaffold's default rebuild-the-image
behavior is the correct outcome for those, not a gap.

For the `deps`/`source` stages, only the app's own `package.json`/source and
those of its transitive Nx workspace dependencies (explicit and implicit —
Nx's own `graph.dependencies`, walked once by core and passed in) are copied
in; `npm:` packages have no node in the graph and are skipped, since pnpm
installs those on its own from the lockfile.

A few smaller things the template does throughout, all following Docker's
own [Next.js guide](https://docs.docker.com/guides/nextjs/):

- `base` sets `ENV NEXT_TELEMETRY_DISABLED=1`, inherited by every later
  stage — quieter build/dev/runtime logs, and no telemetry pings from
  ephemeral dev or CI containers.
- `builder`'s `nx build` call gets its own BuildKit cache mount on
  `<project root>/.next/cache` (`id=next-<app>`, one per app to avoid
  collisions), mirroring the `deps` stage's pnpm store cache mount — lets
  Next.js's own incremental compiler cache survive across separate image
  rebuilds (relevant mainly for the `production` profile, since `dev`
  doesn't rebuild the image on every change).

Every generated config's `build.local` sets `useBuildkit: true` (required —
the `deps` stage's `RUN --mount=type=cache` pnpm store cache is a BuildKit
feature) and `useDockerCLI: true` (routes the build through the real `docker`
CLI instead of skaffold's own built-in builder, which is what makes those
BuildKit cache mounts actually work against the local daemon).

## next.config.js maintenance

For every Next.js app, `syncFrameworkConfig` (`syncNextConfig`,
`src/lib/next-config.ts`) maintains two properties in that app's own
`<project root>/next.config.js` — `output` and `outputFileTracingRoot`, the
two settings the runner image's `.next/standalone` build actually depends
on. Unlike the Dockerfile, this file is **never fully generated or
overwritten**: everything else in it (other properties, comments,
formatting) is left exactly as written. If the app has no `next.config.js`
at all yet, a minimal one is created with just these two properties.

- `output` is always set (or corrected) to `'standalone'`.
- `outputFileTracingRoot` is always set to `path.join(__dirname, '<relative
path to the workspace root>')`, computed via `@nx/devkit`'s `workspaceRoot`
  combined with the app's own root — so it stays correct regardless of how
  deeply nested the app is, rather than assuming a fixed directory depth.
  Without this, Next's output file tracing defaults to the app's own
  directory in a monorepo, silently excluding workspace dependencies (and
  pnpm-hoisted `node_modules`) that live outside it — the exact gap this is
  meant to close, matching Next.js's own documented monorepo guidance.
- If neither property already exists, `const path = require('path');` (or
  `import * as path from 'path';`, matching the file's own CommonJS/ES module
  style) is added too, since `outputFileTracingRoot`'s value always needs it.

Both are treated as adapter-managed: an existing, already-correct value is
left untouched (regenerating produces a byte-identical file), but an
existing, _incorrect_ one is overwritten — same philosophy as the Dockerfile,
just scoped to these two properties instead of the whole file. Implemented
via the TypeScript compiler API (parsed as JS, `ts.ScriptKind.JS`) to locate
the exported config object (`module.exports = {...}`, `export default {...}`,
or either via an intermediate `const nextConfig = {...}` binding) and splice
in minimal, targeted text edits at the exact AST node boundaries — rather
than a full reprint, which would risk losing comments or reformatting things
this adapter has no business touching.

## Testing

`src/lib/*.spec.ts` unit-test each piece directly (`buildNextJsDockerfile`,
`syncNextConfig`, `nextJsAdapter.activates`) against a plain `Tree` — none of
them touch the Nx project graph, so no mocking beyond
`createTreeWithEmptyWorkspace()` is needed. `src/generators/sync/sync.spec.ts`
has a small number of true end-to-end tests wiring the real
`createSkaffoldSyncGenerator([nextJsAdapter])`, confirming the adapter and
`@dx-stack/skaffold`'s core actually compose correctly — see `@dx-stack/skaffold`'s own
README for how its tests cover the framework-agnostic behavior in isolation.
