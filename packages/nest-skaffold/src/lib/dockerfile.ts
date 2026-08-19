import {
  GENERATED_FILE_MARKER,
  type WorkspaceApp,
  type WorkspaceDependency,
} from '@dx-stack/skaffold';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// explicit CJS-require form rather than `import ejs from 'ejs'`: this file's
// dependents (Nx's own generator source-loading) run it through whichever
// transpiler is on hand (native TS stripping, swc-node), which don't all
// apply the same default-import interop tsc does when compiling to dist -
// `require()` semantics are unambiguous regardless of which one processes it.
import ejs = require('ejs');

// WORKDIR for the generated Dockerfile, so the container mirrors the local
// monorepo layout beneath it (e.g. /workspace/apps/svc/...) rather than
// nesting it under a same-ish-looking "app" directory (confusable with the
// local "apps/" one). Deliberately not the container's filesystem root: Nx's
// own workspace-root detection breaks there (it special-cases hitting "/"
// while walking up looking for nx.json), and even forcing it via
// NX_WORKSPACE_ROOT_PATH=/ makes the Nx daemon hang calculating the project
// graph across the whole container filesystem (/proc, /sys, etc. included).
export const WORKSPACE_DIR = '/workspace';

// ships alongside this file both in src (Nx generator execution) and dist
// (built package) - see the "assets" glob on this project's build target.
const TEMPLATE_PATH = join(__dirname, 'dockerfile.ejs');

// assumes a Nest.js app built via @nx/nest (or @nx/node): `nx build`/`nx
// serve` targets, and a "prune" target (dependsOn: prune-lockfile +
// copy-workspace-modules) that produces a self-contained dist/ - main.js,
// a pruned package.json/pnpm-lock.yaml scoped to just the runtime deps
// actually used, and workspace_modules/ for any workspace-linked ones. The
// webpack build itself never bundles npm dependencies (confirmed directly:
// the compiled main.js still `require()`s @nestjs/common etc. as externals),
// so the runner stage has to `pnpm install --prod` against that pruned
// manifest to get a real node_modules before it can run.
export function buildNestJsDockerfile(
  app: WorkspaceApp,
  dependencies: WorkspaceDependency[],
): string {
  // sorted (and deduplicated by definition, since dependencies never include
  // the app's own root) for deterministic output across regenerations
  const roots = [app.root, ...dependencies.map((dep) => dep.root)].sort();

  const template = readFileSync(TEMPLATE_PATH, 'utf-8');
  return ejs.render(template, {
    generatedFileMarker: GENERATED_FILE_MARKER,
    workspaceDir: WORKSPACE_DIR,
    appName: app.name,
    appRoot: app.root,
    roots,
  });
}
