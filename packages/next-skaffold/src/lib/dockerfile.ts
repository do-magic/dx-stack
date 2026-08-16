import {
  GENERATED_FILE_MARKER,
  type WorkspaceApp,
  type WorkspaceDependency,
} from '@dxs/skaffold';
import { render } from 'ejs';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// WORKDIR for the generated Dockerfile, so the container mirrors the local
// monorepo layout beneath it (e.g. /workspace/apps/demo/...) rather than
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

// assumes a Next.js app built via @nx/next: `nx build`/`nx dev` targets and a
// `.next/standalone` production output.
export function buildNextJsDockerfile(
  app: WorkspaceApp,
  dependencies: WorkspaceDependency[],
): string {
  // sorted (and deduplicated by definition, since dependencies never include
  // the app's own root) for deterministic output across regenerations
  const roots = [app.root, ...dependencies.map((dep) => dep.root)].sort();

  const template = readFileSync(TEMPLATE_PATH, 'utf-8');
  return render(template, {
    generatedFileMarker: GENERATED_FILE_MARKER,
    workspaceDir: WORKSPACE_DIR,
    appName: app.name,
    appRoot: app.root,
    roots,
  });
}
