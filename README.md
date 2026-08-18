# dx-stack — Developer Experience Stack

Nx plugins that turn deploying an application to Kubernetes into a single
command. The goal is a highly automated deployment pipeline where the only
thing you write by hand is the Kubernetes resources themselves — Dockerfile
generation, image builds, and [Skaffold](https://skaffold.dev/)
configuration are all derived automatically from the workspace's own
project graph.

Today that means a local [minikube](https://minikube.sigs.k8s.io/) cluster
only — no remote cluster, registry push, or CI deployment pipeline yet.

Apps aren't meant to run in isolation, either. Another explicit goal is
running them alongside the supporting infrastructure a real deployment
depends on — databases with persistent volumes, an OpenTelemetry stack,
anything else that needs to outlive any single dev session — in the same
local cluster. That infrastructure is hand-maintained in
`skaffold/infra.yaml`, deliberately kept outside both the generated,
per-app config and the ephemeral `skaffold dev` lifecycle; see
[`@dx-stack/skaffold`'s README](packages/skaffold#infrastructure-infrayaml)
for how the two are kept separate.

## How it works

Wire a framework adapter's `sync` generator into an Nx target (or Nx's
global `syncGenerators`) and run `nx sync`. For every app in the workspace
that has a `k8s/` folder with at least one manifest, it will:

- generate that app's `Dockerfile` (multi-stage: a `dev` stage with live
  file sync, and a production build)
- assign it to a Kubernetes namespace, by convention or by explicit
  `metadata.namespace` on its own manifests
- assemble and prune the right `skaffold/*.yaml` config for that namespace,
  with matching dev and production profiles
- maintain any framework-specific config the build depends on (for Next.js,
  `output`/`outputFileTracingRoot` in `next.config.js`)

An app with no recognized framework is left alone as long as it already has
a hand-written `Dockerfile` — nothing here ever guesses at how to build an
app it doesn't understand.

## Packages

| Package                                             | What it is                                                                                                                                                                                                                                         |
| --------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`@dx-stack/skaffold`](packages/skaffold)           | Framework-agnostic core: app discovery, namespace handling, the production profile, generated-file pruning, and the `FrameworkAdapter` contract that framework packages implement. Ships no generator of its own — not useful installed by itself. |
| [`@dx-stack/next-skaffold`](packages/next-skaffold) | The only framework adapter so far, for Next.js apps (Dockerfile template, `next.config.js` maintenance, framework detection). Install this one if you just want the feature.                                                                       |

More framework adapters (Angular and others) are the intended growth path —
`@dx-stack/skaffold`'s contract exists so a new one is a self-contained package,
not a change to the core. Each package's own README documents its
behavior and conventions in depth; `@dx-stack/skaffold`'s also documents the
`FrameworkAdapter` contract for anyone building a new adapter.

## Demo workspace

- [`apps/demo`](apps/demo) — a small Next.js app used to develop and
  validate the plugins end-to-end. It has its own `k8s/` folder, so it
  doubles as a real, working example of what a consuming app looks like.

## Getting started

Requires minikube, Skaffold, and a BuildKit-capable Docker installed
locally.

```bash
pnpm install

# start (or resume) the local cluster
pnpm nx minikube

# generate configs (Dockerfile, skaffold/*.yaml, next.config.js) and start
# the dev loop: live image rebuilds, file sync, and port-forwarding for
# every k8s Service
pnpm nx skaffold

# same, but building the production stage of each Dockerfile instead
pnpm nx skaffold --configuration=production
```

`nx sync` runs automatically as part of the `skaffold` target. To run it on
its own — e.g. to see what would change without starting Skaffold at all:

```bash
pnpm nx sync
```

To try it against a new app: add one to the workspace, give it a `k8s/`
folder with at least one manifest, and run `nx sync` — its Dockerfile,
namespace, and skaffold config all appear with no further wiring.

## Development

Standard Nx/pnpm monorepo commands:

```bash
pnpm nx run-many -t build lint test typecheck                          # everything
pnpm nx run-many -t build lint test typecheck -p skaffold,next-skaffold # just the plugins
pnpm nx graph                                                           # visualize the project graph
```

## Publishing

Packages are released under the `@dx-stack` npm scope via
[Nx Release](https://nx.dev/docs/features/manage-releases), following
[Nx's recommended CI/CD pattern](https://nx.dev/docs/guides/nx-release/publish-in-ci-cd):
versioning happens locally, publishing happens in CI, triggered by pushing
the version tag `nx release` creates.

```bash
pnpm nx release-commit          # nx release --skip-publish: version + changelog + tag, no publish
git push && git push --tags     # pushing the tag triggers .github/workflows/publish.yml
```

To test a publish without touching the real npm registry, use the local
Verdaccio registry instead:

```bash
pnpm nx local-registry   # start a local registry for the @dx-stack scope
pnpm nx local-publish    # nx release publish against that local registry
```
