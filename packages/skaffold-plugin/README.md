# @dxs/skaffold

An Nx sync generator (`@dxs/skaffold:sync`) that generates the workspace's
`skaffold/` config from the apps already present in the repo, so you don't
hand-maintain `skaffold.yaml` files as apps are added, moved between
namespaces, or removed.

It runs automatically as part of `nx run @dxs/source:skaffold` (via
`syncGenerators` on the `skaffold` target), and can be run directly with
`nx sync`.

## Conventions an app must follow to be picked up

An Nx **application** project is a *candidate* if it has a
`<project root>/k8s/` folder containing at least one `*.yaml`/`*.yml` file.
No `k8s/` folder, or an empty one, is silently ignored — not an error, just
not deployed by skaffold.

Whether a candidate actually qualifies then depends on its framework (see
"Dockerfile generation" below):

- **Next.js app** (detected via a `next` dependency): always qualifies. No
  `Dockerfile` needs to exist beforehand — the generator writes (and keeps
  overwriting) one itself.
- **Anything else**: only qualifies if `<project root>/Dockerfile` already
  exists. This generator doesn't know how to write a Dockerfile for an
  unrecognized framework, so it requires a hand-written one to build from
  instead of guessing — and never modifies that file once it's there. No
  Dockerfile and no recognized framework → silently ignored, same as having
  no `k8s/` folder.

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
  silently skipping it or producing broken config downstream. The same
  parsing pass backs port-forward detection too (see below).

For every namespace in use, the generator also writes a `Namespace` manifest
(`skaffold/<namespace>-namespace.yaml`) and applies it in the same batch as
the app's own manifests, so `deploy.kubectl.defaultNamespace` never points at
a namespace that doesn't exist yet.

Apps sharing a namespace are grouped into one `skaffold/<namespace>.yaml`
(one `build.artifacts`/`portForward` entry per app, one shared `Namespace`
manifest) rather than one file per app — this is what lets `kubectl apply`
batch things correctly, since a single `kubectl apply -n X` invocation
requires every object in that batch to either have no namespace or match `X`
exactly.

## Port forwarding

A `portForward` entry is generated automatically for every port on every
`kind: Service` resource found across an app's `k8s/` manifests — one entry
per port, not just per Service. Everything else (Deployments, ConfigMaps,
whatever) is ignored for this purpose; only `Service` resources are
considered.

- The Service's `metadata.name` becomes `resourceName`, and is required —
  a `Service` without one fails `nx sync` with a clear error, since there'd
  be nothing to point `kubectl port-forward` at.
- Each `spec.ports[]` entry needs a numeric `port`; a non-numeric one (or one
  missing entirely) also fails `nx sync` rather than producing a forward that
  would fail silently at deploy time.
- `localPort` always matches the Service's `port` — there's no way to
  request a different local port. If two apps (in the same or different
  namespaces) both expose port 3000, that's not a conflict at the config
  level: skaffold's own port-forwarding increments the local port at runtime
  if one it wants is already taken, so nothing needs to be done about it here.

Like `build.artifacts`, every app's entries are combined into one shared
`portForward` array per `skaffold/<namespace>.yaml` — omitted entirely from
that file if none of its apps declare a `Service`. It's untouched by the
`production` profile (see below), since only `build.artifacts` differs
between the two.

## Infrastructure (`infra.yaml`)

`skaffold/infra.yaml` (and anything under `skaffold/infra/`) is entirely
hand-maintained, for components meant to outlive any single dev session —
a namespace today, potentially a database with a persistent volume later.
It's deliberately **not** `requires`-loaded by the generated
`skaffold/skaffold.yaml`: `skaffold dev` tears down everything it deployed
when it exits, and bundling infra into that same lifecycle would mean losing
persistent data on every `Ctrl+C`.

Instead, both the `development` and `production` configurations of the
`skaffold` Nx target run `skaffold run -f skaffold/infra.yaml` *before*
`skaffold dev -f skaffold/skaffold.yaml [...]`. `skaffold run` deploys and
returns immediately — no watch loop, no cleanup-on-exit — so whatever
`infra.yaml` declares stays running (across dev-loop restarts, and across
`minikube stop`/`start`, as long as minikube's own disk persists) while the
apps deployed by the `skaffold dev` step that follows remain exactly as
ephemeral as before.

One consequence worth knowing if you ever edit `infra.yaml` by hand: since
it's always invoked as its *own* entrypoint now (never `requires`-loaded),
its `manifests.rawYaml` paths resolve relative to the invoking working
directory (the workspace root, since that's where the `skaffold` Nx target's
commands run) rather than relative to `skaffold/` itself — hence
`skaffold/infra/*.yaml` rather than the shorter `infra/*.yaml` you'd expect
from a `requires`-loaded module.

## Dockerfile generation

For each candidate app (has a qualifying `k8s/` folder), the generator runs
two steps:

1. **Detect the framework** (`detectFramework`): read the app's own
   `package.json` `dependencies`/`devDependencies` and match against a small
   lookup table (currently just `{ nextjs: 'next' }`). This is deliberately
   based on the app's own declared dependencies rather than Nx's project
   graph or target commands, since `graph.dependencies` doesn't include
   `npm:` edges in this workspace and target executors/commands are a
   plugin-version-specific implementation detail, not a stable place to
   detect a framework from.
2. **Dispatch based on the result**:
   - **Recognized** (currently just Next.js): `<project root>/Dockerfile` is
     fully generated (`buildDockerfile` → `buildNextJsDockerfile`) and, like
     everything else here, regenerated and pruned on every run — see
     "Generated files". Any existing file at that path is overwritten.
   - **Unrecognized**: nothing is generated. The generator instead requires
     `<project root>/Dockerfile` to already exist (that's what makes the app
     qualify at all — see "Conventions" above) and never writes to it; it's
     treated as entirely hand-maintained from here on.

**Only Next.js has generated-Dockerfile support right now.** Adding a second
framework means adding its dependency name to `FRAMEWORK_DEPENDENCY`, writing
a `buildXyzDockerfile()` alongside `buildNextJsDockerfile()`, and adding a
case to `buildDockerfile()`'s dispatch — the detection step and the per-app
dependency-copying logic (below) don't need to change.

The Next.js template is a fixed multi-stage build — `base` → `deps` (install,
scoped to the app and its workspace dependencies) → `source` (copies source)
→ `builder` (`nx build <app> --skip-sync`) and, as siblings both built from
`source`, `dev` (`nx dev <app> --skip-sync`, watching for changes) and
`runner` (the `.next/standalone` production output).

The `runner` stage sets `ENV HOSTNAME="0.0.0.0"` unconditionally — Next.js's
standalone `server.js` otherwise binds to whatever `HOSTNAME` happens to be
set to, and Kubernetes auto-injects one equal to the pod name, which the
server can't actually bind to (breaks `kubectl port-forward` and anything
else expecting the app to listen on all interfaces). Baking the fix into the
image means every app gets it automatically, rather than depending on each
hand-written `k8s/deployment.yaml` remembering to set `HOSTNAME` itself as an
override — a real gap in this workspace before this was added: some apps'
manifests set it, some didn't.

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
  across the *entire* container filesystem, `/proc` and `/sys` included.
  Confirmed by direct `docker build`/`docker run` reproduction of both
  failure modes.

The regular (non-`production`-profile) build artifact sets `docker.target:
dev` — for a generated Next.js Dockerfile that's always safe, since the
template always has that stage. For a hand-written Dockerfile (the
unrecognized-framework case), `target` is only set to `dev` if the file
actually declares a stage named that (`getDevTarget`, a simple `FROM ... AS
dev` scan); otherwise it's left unset, since `docker build --target dev`
against a Dockerfile with no such stage just fails outright. Either way,
skaffold's manual file sync targets that same running `dev` container —
that pairing is what makes `nx run @dxs/source:skaffold`'s hot reload work
at all; without a process actually watching for changes, sync would have
files to copy but nothing to do with them. (For a hand-written Dockerfile
without a `dev` stage, the artifact still builds — via `docker.target` being
left unset entirely — sync just has nothing running that would notice the
synced files.)

The synced paths are the app's own `src/**/*` and `public/**/*`, plus —
for a recognized framework only — `src/**/*` for each workspace dependency
the Dockerfile actually `COPY`s in (`getWorkspaceDependencies`, the same set
`buildNextJsDockerfile` uses). Everything else in an app's root (`next.config.js`,
`tsconfig.json`, `package.json`, ...) is deliberately left out of sync: those
either need a process restart to take effect at all (config) or an actual
`pnpm install` (`package.json`), so falling through to skaffold's default
rebuild-the-image behavior is the correct outcome for those, not a gap. For a
hand-written Dockerfile, no dependency paths are added — the generator has no
way to know if or where that Dockerfile copies a dependency's root in.

For the `deps`/`source` stages, only the app's own `package.json`/source and
those of its transitive Nx workspace dependencies (explicit and implicit —
`getWorkspaceDependencies`, walking `graph.dependencies`) are copied in;
`npm:` packages have no node in the graph and are skipped, since pnpm
installs those on its own from the lockfile.

A few smaller things the template does throughout, all following Docker's
own [Next.js guide](https://docs.docker.com/guides/nextjs/):

- `base` is pinned to a specific `node:24-alpine` **digest** (`BASE_IMAGE`),
  not just the floating tag — reproducible across rebuilds, at the cost of
  needing a deliberate bump (tag *and* digest together) to pick up a newer
  patch release; nothing renews this automatically.
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

## Production mode

Every generated `skaffold/<namespace>.yaml` also carries a `production`
[profile](https://skaffold.dev/docs/environment/profiles/) that overrides
just `build.artifacts` for that namespace's apps: no `docker.target` (so the
Dockerfile's _last_ stage — the real production build — is what gets built)
and no file sync. Everything else (manifests, namespace, `portForward`) is
unaffected, since only the build differs between dev and production.

Run it with `nx run @dxs/source:skaffold:production` — the `skaffold` target
has `development` (default) and `production`
[configurations](https://nx.dev/concepts/executors-and-configurations);
`nx run @dxs/source:skaffold` (no configuration) is equivalent to
`nx run @dxs/source:skaffold:development`. The `production` configuration
runs `skaffold dev -f skaffold/skaffold.yaml -p production`. Skaffold propagates an activated profile name to every
`requires`-loaded config that defines a matching one, so the single
`-p production` flag on the top-level entrypoint reaches every namespace's
config — no separate production file tree to keep in sync.

It still targets minikube, same as `development` — there's no registry push
or remote cluster/context involved, so this proves the production image
builds and deploys correctly without conflating that with an actual release
pipeline (image tagging, registry auth, a remote kubeconfig) that hasn't
been designed yet.

## Generated files

Everything under `skaffold/` except `infra.yaml`/`infra/` (hand-maintained),
plus a qualifying app's own `<project root>/Dockerfile` *if its framework was
recognized*, is generated and carries a `# Generated by @dxs/skaffold:sync`
marker comment (as the second line in a Dockerfile, after the required
`# syntax=` directive — putting it first would stop BuildKit from
recognizing that directive at all). On every run, any such marked file
that's no longer needed (an app moved to a different namespace, or stopped
qualifying entirely) is deleted — a file without the marker is never
touched, so hand-authored files (including every unrecognized-framework
Dockerfile) are always safe.

`skaffold/skaffold.yaml` is the one entrypoint, `requires`-ing one file per
namespace in use (dev and production both go through it — see Production
mode above; `requires` is omitted entirely if there are no apps at all).
`infra.yaml` is deliberately not part of this — see "Infrastructure" above.

As a last-resort safety net, writing any generated file twice in the same run
(e.g. two namespaces somehow producing the same file name) fails `nx sync`
with a clear error instead of silently letting the second write clobber the
first — not something reachable given how namespaces are deduplicated today,
but cheap insurance against a future change accidentally breaking that.

## Testing

`sync.spec.ts` mocks `@nx/devkit`'s `createProjectGraphAsync` — it reads the
_real_ on-disk project graph and isn't affected by the in-memory test
`Tree` at all (`addProjectConfiguration` has no effect on it), so fake apps
for tests are built by mocking that function's return value directly and
writing the corresponding fixture files into the test `Tree`.
