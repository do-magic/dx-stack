import { Tree } from '@nx/devkit';
import type {
  FrameworkAdapter,
  WorkspaceApp,
  WorkspaceDependency,
} from './framework-adapter';
import { getDevTarget } from './dev-target';

export function buildArtifact(
  tree: Tree,
  app: WorkspaceApp,
  // the adapter that activated for this app, or undefined if none did (the
  // hand-written-Dockerfile fallback case) — `dependencies` is only ever
  // non-empty when an adapter activated (see create-sync-generator.ts), so
  // `getDependencySyncPaths` is only meaningful, and only called, then
  activeAdapter: FrameworkAdapter | undefined,
  dependencies: WorkspaceDependency[],
) {
  const target = getDevTarget(tree, app, activeAdapter !== undefined);
  const dependencySyncPaths = activeAdapter
    ? activeAdapter.getDependencySyncPaths(dependencies)
    : [];

  return {
    image: app.name,
    // relative to this file's own directory (skaffold/), since this config
    // is always loaded as a `requires` module, never as the entrypoint
    context: '..',
    docker: {
      dockerfile: `${app.root}/Dockerfile`,
      ...(target ? { target } : {}),
    },
    sync: {
      // the app's own src/**/* and public/**/* are always synced,
      // regardless of framework — only the dependency paths (above) are
      // adapter-specific
      manual: [
        { src: `${app.root}/src/**/*`, dest: '.' },
        { src: `${app.root}/public/**/*`, dest: '.' },
        ...dependencySyncPaths,
      ],
    },
  };
}

export function buildProductionArtifact(app: WorkspaceApp) {
  return {
    image: app.name,
    context: '..',
    docker: {
      dockerfile: `${app.root}/Dockerfile`,
      // no target: builds the Dockerfile's last stage (the real production build)
    },
    // no sync: nothing in a production image is watching for file changes
  };
}
