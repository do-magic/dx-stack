# @dxs/skaffold

The framework-agnostic core behind an Nx monorepo's skaffold sync
generators. It owns everything about assembling and pruning `skaffold/`
config that doesn't depend on which framework an app is built with — app
discovery, namespace assignment/validation, the `production` profile, and
generated-file marker/pruning — and exposes a
small contract, `FrameworkAdapter`, that framework-specific packages
implement to plug into it.
[`@dxs/next-skaffold`](https://www.npmjs.com/package/@dxs/next-skaffold) is
the first (and so far only) implementation, for Next.js apps; a hypothetical
future `@dxs/angular-skaffold` would implement the same contract for Angular
apps.

**This package alone does nothing for you** — it ships no Nx generator of
its own, only the `createSkaffoldSyncGenerator` factory that a
framework-specific package (like `@dxs/next-skaffold`) calls and exports as
its own `sync` generator. If you just want to get skaffold configs generated
for a Next.js monorepo, install `@dxs/next-skaffold` instead — you'll only
need this package directly if you're writing a new framework adapter (see
the contract below).

## Installation

This package is meant to be consumed by a framework adapter package, not
installed directly in most cases. If you're implementing a new adapter:

```sh
npm install @dxs/skaffold
```

It requires `nx` and `@nx/devkit` (peer dependencies) already present in
your workspace, as any Nx workspace running generators would have.

## The `FrameworkAdapter` contract

```ts
interface FrameworkAdapter {
  readonly name: string;
  activates(tree: Tree, app: WorkspaceApp): boolean;
  buildDockerfile(
    app: WorkspaceApp,
    dependencies: WorkspaceDependency[],
  ): string;
  getDependencySyncPaths(dependencies: WorkspaceDependency[]): SyncPath[];
  syncFrameworkConfig?(tree: Tree, app: WorkspaceApp): void;
}
```

- **`activates`**: does this app use the framework this adapter handles
  (typically checked via a dependency in the app's own `package.json`)? Only
  ever called for apps that already qualify as candidates (see
  "Conventions" below) — never for every app in the workspace. If more than
  one adapter activates for the same app, `nx sync` fails with a clear error
  naming every adapter involved; this isn't resolved automatically.
- **`buildDockerfile`**: builds the app's full `Dockerfile` content — fully
  generated and adapter-owned, (re)written on every run. Two hard
  requirements on the returned content: it **must** declare a build stage
  named exactly `dev` (core unconditionally sets `docker.target: 'dev'` for
  any app an adapter built the Dockerfile for — never delegated per-adapter),
  and it **must** embed this package's exported `GENERATED_FILE_MARKER`
  somewhere after any required leading directive (e.g. Docker's `# syntax=`)
  — that's what lets core safely prune it later if the app stops qualifying.
  Pure function of `app`/`dependencies` — never touches the `Tree`.
- **`getDependencySyncPaths`**: extra `sync.manual` paths beyond the app's
  own default paths (`src/**/*`, `public/**/*` — unconditional for every
  qualifying app, regardless of adapter) — typically one entry per workspace
  dependency the adapter's Dockerfile actually `COPY`s in. Only called for
  dependencies of an app this same adapter activated for. Pure function.
- **`syncFrameworkConfig`** (optional): maintain framework-specific config
  file(s) the build depends on (e.g. Next.js's `output`/`outputFileTracingRoot`
  in `next.config.js`). Unlike the Dockerfile, typically _not_ a fully
  generated/overwritten file — just specific properties within an otherwise
  hand-maintained file — and never marker-tracked/pruned. Only called for
  apps this adapter activated for.

`WorkspaceApp`/`WorkspaceDependency` (`{ name, root }`) are flattened off the
raw Nx project-graph node shape — adapters are separate packages that
shouldn't need to know anything about Nx's `ProjectGraph`.

## Conventions an app must follow to be picked up

An Nx **application** project is a _candidate_ if it has a
`<project root>/k8s/` folder containing at least one `*.yaml`/`*.yml` file.
No `k8s/` folder, or an empty one, is silently ignored — not an error, just
not deployed by skaffold.

Whether a candidate actually qualifies then depends on whether some adapter
recognizes it:

- **An adapter activates for it**: always qualifies. No `Dockerfile` needs to
  exist beforehand — that adapter writes (and keeps overwriting) one itself.
- **No adapter activates**: only qualifies if `<project root>/Dockerfile`
  already exists. No adapter knows how to write one for an unrecognized
  framework, so a hand-written one is required instead of guessing — and
  it's never modified once it's there. No Dockerfile and no recognized
  framework → silently ignored, same as having no `k8s/` folder.

The project's Nx name is used directly as the built Docker image name, so it
must be a valid Docker repository name component (lowercase alphanumeric,
optionally separated by `.`, `_`, `__`, or `-`) — an invalid name fails
`nx sync` with a clear error rather than a confusing Docker error later.

## Namespace

Declare a namespace by setting `metadata.namespace` on the app's own k8s
resources (`Deployment`, `Service`, whatever). All of an app's resources
(across every file in `k8s/`, and across every document in a multi-document
`---`-separated file) must agree on the same namespace — an app can only ever
target one namespace.

- No resource declares a namespace → the app is deployed into the literal
  Kubernetes `default` namespace.
- `infra` and `skaffold` are reserved (they're claimed by the hand-maintained
  `skaffold/infra.yaml` and the generated `skaffold/skaffold.yaml`) and can't
  be used as an app's namespace.
- Namespace values are validated against the Kubernetes DNS-1123 label rules
  (lowercase alphanumeric and `-`, must start/end alphanumeric, ≤63 chars) —
  this also happens to rule out anything that could be used for a path
  traversal, since the value is used directly as a generated file name.
- A `k8s/` YAML file that fails to parse at all (invalid YAML) fails
  `nx sync` immediately with a clear error naming the file, rather than
  silently skipping it or producing broken config downstream.

For every namespace in use, the generator also writes a `Namespace` manifest
(`skaffold/<namespace>-namespace.yaml`) and applies it in the same batch as
the app's own manifests, so `deploy.kubectl.defaultNamespace` never points at
a namespace that doesn't exist yet.

Apps sharing a namespace are grouped into one `skaffold/<namespace>.yaml`
(one `build.artifacts` entry per app, one shared `Namespace` manifest)
rather than one file per app — this is what lets `kubectl apply` batch
things correctly, since a single `kubectl apply -n X` invocation requires
every object in that batch to either have no namespace or match `X` exactly.

## Port forwarding

Not generated at all — this package deliberately leaves port-forwarding
entirely to
[Skaffold's own `--port-forward=services` mode](https://skaffold.dev/docs/port-forwarding/),
which auto-forwards every `kind: Service`'s ports with zero config, the same
thing a hand-written `portForward` stanza would give you. Pass
`--port-forward=services` (or the bare `--port-forward` flag, which enables
it alongside `user` mode) to `skaffold dev`/`skaffold run`; without it,
Skaffold's default is `user` mode only, which forwards nothing unless you
declare it explicitly.

## Infrastructure (`infra.yaml`)

`skaffold/infra.yaml` (and anything under `skaffold/infra/`) is entirely
hand-maintained, for components meant to outlive any single dev session —
a namespace today, potentially a database with a persistent volume later.
It's deliberately **not** `requires`-loaded by the generated
`skaffold/skaffold.yaml`: `skaffold dev` tears down everything it deployed
when it exits, and bundling infra into that same lifecycle would mean losing
persistent data on every `Ctrl+C`.

Instead, both the `development` and `production` configurations of the
`skaffold` Nx target run `skaffold run -f skaffold/infra.yaml` _before_
`skaffold dev -f skaffold/skaffold.yaml [...]`. `skaffold run` deploys and
returns immediately — no watch loop, no cleanup-on-exit — so whatever
`infra.yaml` declares stays running (across dev-loop restarts, and across
`minikube stop`/`start`, as long as minikube's own disk persists) while the
apps deployed by the `skaffold dev` step that follows remain exactly as
ephemeral as before.

One consequence worth knowing if you ever edit `infra.yaml` by hand: since
it's always invoked as its _own_ entrypoint now (never `requires`-loaded),
its `manifests.rawYaml` paths resolve relative to the invoking working
directory (the workspace root, since that's where the `skaffold` Nx target's
commands run) rather than relative to `skaffold/` itself — hence
`skaffold/infra/*.yaml` rather than the shorter `infra/*.yaml` you'd expect
from a `requires`-loaded module.

## Production mode

Every generated `skaffold/<namespace>.yaml` also carries a `production`
[profile](https://skaffold.dev/docs/environment/profiles/) that overrides
just `build.artifacts` for that namespace's apps: no `docker.target` (so the
Dockerfile's _last_ stage — the real production build — is what gets built)
and no file sync. Everything else (manifests, namespace) is unaffected,
since only the build differs between dev and production.

It still targets minikube, same as development — there's no registry push
or remote cluster/context involved, so this proves the production image
builds and deploys correctly without conflating that with an actual release
pipeline (image tagging, registry auth, a remote kubeconfig) that hasn't
been designed yet.

## Generated files

Everything under `skaffold/` except `infra.yaml`/`infra/` (hand-maintained),
plus a qualifying app's own `<project root>/Dockerfile` _if an adapter
activated for it_, is generated and carries a `GENERATED_FILE_MARKER`
comment. On every run, any such marked file that's no longer needed (an app
moved to a different namespace, or stopped qualifying entirely) is deleted —
a file without the marker is never touched, so hand-authored files
(including every unrecognized-framework Dockerfile) are always safe.

`skaffold/skaffold.yaml` is the one entrypoint, `requires`-ing one file per
namespace in use (dev and production both go through it; `requires` is
omitted entirely if there are no apps at all). `infra.yaml` is deliberately
not part of this — see "Infrastructure" above.

As a last-resort safety net, writing any generated file twice in the same run
(e.g. two namespaces somehow producing the same file name) fails `nx sync`
with a clear error instead of silently letting the second write clobber the
first — not something reachable given how namespaces are deduplicated today,
but cheap insurance against a future change accidentally breaking that.

## Testing

Tests use a minimal, always-activating fake `FrameworkAdapter`
(`src/testing/fake-adapter.ts`) to exercise the framework-agnostic
orchestration without depending on any real framework package.
`create-sync-generator.spec.ts` mocks `@nx/devkit`'s `createProjectGraphAsync`
— it reads the _real_ on-disk project graph and isn't affected by the
in-memory test `Tree` at all — so fake apps are built by mocking that
function's return value directly and writing the corresponding fixture files
into the test `Tree`. Most other modules (namespace validation, artifact
assembly, pruning, ...) are pure enough to unit-test directly against a
`Tree`, with no project-graph mocking needed at all.
