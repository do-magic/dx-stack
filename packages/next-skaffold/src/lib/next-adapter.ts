import { Tree, joinPathFragments } from '@nx/devkit';
import type { FrameworkAdapter, WorkspaceApp } from '@dxs/skaffold';
import { buildNextJsDockerfile } from './dockerfile.ts';
import { syncNextConfig } from './next-config.ts';

// dependency (in the app's own package.json) that identifies a Next.js app.
// Deliberately based on the app's own declared dependencies rather than Nx's
// project graph or target commands, since `graph.dependencies` doesn't
// include `npm:` edges in this workspace and target executors/commands are a
// plugin-version-specific implementation detail, not a stable place to
// detect a framework from.
const NEXT_DEPENDENCY = 'next';

function activates(tree: Tree, app: WorkspaceApp): boolean {
  const packageJsonPath = joinPathFragments(app.root, 'package.json');
  const packageJsonContent = tree.exists(packageJsonPath)
    ? tree.read(packageJsonPath, 'utf-8')
    : null;
  const packageJson = packageJsonContent ? JSON.parse(packageJsonContent) : {};
  const dependencies = {
    ...packageJson.dependencies,
    ...packageJson.devDependencies,
  };

  return NEXT_DEPENDENCY in dependencies;
}

export const nextJsAdapter: FrameworkAdapter = {
  name: 'nextjs',
  activates,
  buildDockerfile: buildNextJsDockerfile,
  getDependencySyncPaths: (dependencies) =>
    dependencies.map((dependency) => ({
      src: `${dependency.root}/src/**/*`,
      dest: '.',
    })),
  syncFrameworkConfig: syncNextConfig,
};
