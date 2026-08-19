import { Tree, joinPathFragments } from '@nx/devkit';
import type { FrameworkAdapter, WorkspaceApp } from '@dx-stack/skaffold';
import { buildNestJsDockerfile } from './dockerfile';

// dependency (in the app's own package.json) that identifies a Nest.js app.
// Deliberately based on the app's own declared dependencies rather than Nx's
// project graph or target commands, since `graph.dependencies` doesn't
// include `npm:` edges in this workspace and target executors/commands are a
// plugin-version-specific implementation detail, not a stable place to
// detect a framework from. `@nestjs/core` rather than `@nestjs/common`: it's
// the one dependency every Nest app has that isn't also plausible to pull in
// for unrelated reasons.
const NEST_DEPENDENCY = '@nestjs/core';

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

  return NEST_DEPENDENCY in dependencies;
}

export const nestJsAdapter: FrameworkAdapter = {
  name: 'nestjs',
  activates,
  buildDockerfile: buildNestJsDockerfile,
  getDependencySyncPaths: (dependencies) =>
    dependencies.map((dependency) => ({
      src: `${dependency.root}/src/**/*`,
      dest: '.',
    })),
  // no framework config to maintain: unlike Next.js's next.config.js
  // (output/outputFileTracingRoot), the standalone-build mechanism here is
  // entirely driven by the app's own "prune"/"prune-lockfile"/
  // "copy-workspace-modules" targets (@nx/nest's own convention) - nothing
  // in webpack.config.js needs to change for it to work.
};
