# @dx-stack/nest-skaffold

The Nest.js implementation of
[`@dx-stack/skaffold`](https://www.npmjs.com/package/@dx-stack/skaffold)'s
`FrameworkAdapter` contract (`nestJsAdapter`, `src/lib/nest-adapter.ts`).
Everything framework-agnostic — app discovery, namespace assignment, port
forwarding, the `production` profile, generated-file pruning — lives in
`@dx-stack/skaffold` and is documented there. This package only covers what's
specific to Nest.js: `activates` (detecting a Nest.js app) and the generated
Dockerfile. Unlike `@dx-stack/next-skaffold`, there's no `syncFrameworkConfig`
here — see "Dockerfile generation" below for why nothing else needs
maintaining.

## Installation

```sh
pnpm nx add @dx-stack/nest-skaffold
```

This installs the package as a dev dependency and, if a matching `init`
generator existed, would run it — it does, so this also runs
`@dx-stack/nest-skaffold:init` automatically, wiring the `minikube`/`skaffold`
targets and seeding `skaffold/infra.yaml` (see
[`@dx-stack/skaffold`'s README](https://www.npmjs.com/package/@dx-stack/skaffold)
for exactly what that does, and how it merges with any other skaffold plugin
already installed). A plain `npm install -D` / `pnpm add -D
@dx-stack/nest-skaffold` plus `nx g @dx-stack/nest-skaffold:init` works
identically if you'd rather not go through `nx add`.

The `sync` generator (`src/generators/sync/sync.ts`) is a one-line wrapper:
`createSkaffoldSyncGenerator([nestJsAdapter])`. Once wired in (by `init`, or
by hand), it runs automatically before the target it's attached to, and can
also be run directly with `nx sync`.

## Detecting a Nest.js app

`nestJsAdapter.activates` reads the app's own `package.json`
`dependencies`/`devDependencies` and checks for a `@nestjs/core` entry —
`@nestjs/common` alone isn't used, since it's at least plausible for
something unrelated to pull that in without actually being a Nest
application. Same rationale as `@dx-stack/next-skaffold`'s own detection:
based on the app's own declared dependencies rather than Nx's project graph
or target commands, since `graph.dependencies` doesn't include `npm:` edges
in this workspace and target executors/commands are a plugin-version-
specific implementation detail, not a stable place to detect a framework
from.

## Dockerfile generation

Assumes an app scaffolded via `@nx/nest` (or `@nx/node`): a `build` target
(webpack, `@nx/webpack/app-plugin`'s `NxAppWebpackPlugin`), a `serve` target
for local dev (`@nx/js:node`, watches and restarts on rebuild), and —
crucially — a `prune` target that `dependsOn` `prune-lockfile` and
`copy-workspace-modules`. Those two produce, alongside the build's own
`main.js`, a **pruned** `package.json`/`pnpm-lock.yaml` scoped to just the
runtime dependencies actually used, plus a `workspace_modules/` directory
holding a copy of any workspace-linked (`workspace:*`) dependency needed at
runtime — everything a fully standalone deploy needs, without shipping the
whole monorepo's `node_modules`.

This matters because — confirmed directly by inspecting a real build's
`main.js` — the webpack build does **not** bundle npm dependencies into it;
`@nestjs/common` and friends stay as literal `require()` calls, i.e.
externals. So unlike `@dx-stack/next-skaffold`'s `.next/standalone` (which
Next.js's own tracing makes fully self-contained, `node_modules` included),
the `runner` stage here has to run `pnpm install --prod --frozen-lockfile`
against that pruned manifest itself before `main.js` can actually run. This
is also why there's no `syncFrameworkConfig` for this adapter: the whole
standalone-build mechanism is driven entirely by the app's own Nx target
graph (`prune` → `prune-lockfile` + `copy-workspace-modules`), not by
anything in `webpack.config.js` this adapter would need to keep in sync.

Stages, mirroring `@dx-stack/next-skaffold`'s template shape:

- `base` → `deps` (pnpm install, scoped to the app and its workspace
  dependencies) → `source` (copies source in) — identical structure and
  rationale to the Next.js adapter's own template.
- `builder`, built from `source`: `nx run <app>:prune --skip-sync`. Since
  `prune` already `dependsOn` `build` transitively, this one command builds
  and prunes in a single step.
- `dev`, a sibling of `builder` also built from `source`: runs `nx serve
<app> --skip-sync` as its `CMD` — the long-running, watch-and-restart dev
  loop, analogous to `next dev`. (Not a `RUN` step: `serve` never exits, so
  it only makes sense as the stage's own entrypoint, invoked once a
  container actually starts from it.)
- `runner`, built fresh from `base` (never from `builder`/`source`, so no
  dev tooling or full source tree ends up in the final image): copies the
  pruned `dist/` in, runs `pnpm install --prod --frozen-lockfile` against
  it, and runs `node main.js` as a non-root user.

`WORKDIR`/`WORKSPACE_DIR` and the `roots.forEach` dependency-copying pattern
are identical to `@dx-stack/next-skaffold` — see that package's README for
the reasoning (container paths mirroring the local monorepo layout, and why
neither a same-ish-looking wrapper directory nor the container's actual
filesystem root works).

## Testing

`src/lib/*.spec.ts` unit-test each piece directly (`buildNestJsDockerfile`,
`nestJsAdapter.activates`) against a plain `Tree`. `src/generators/sync/
sync.spec.ts` and `src/generators/init/init.spec.ts` each have a small
number of true end-to-end tests wiring the real generators, confirming the
adapter and `@dx-stack/skaffold`'s core actually compose correctly — see
`@dx-stack/skaffold`'s own README for how its tests cover the
framework-agnostic behavior in isolation.
