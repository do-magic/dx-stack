import { Tree, createProjectGraphAsync, joinPathFragments } from '@nx/devkit';
import type { SyncGeneratorResult } from 'nx/src/utils/sync-generators';
import * as yaml from 'yaml';

import {
  GENERATED_FILE_MARKER,
  type SkaffoldAdapters,
  type WorkspaceApp,
  type WorkspaceDependency,
} from './framework-adapter';
import { discoverApps } from './app-discovery';
import { DEFAULT_NAMESPACE, getAppNamespace } from './namespace';
import { getWorkspaceDependencies } from './workspace-dependencies';
import {
  buildNamespaceConfig,
  buildNamespaceManifest,
} from './skaffold-config';
import {
  createWriter,
  pruneStaleDockerfiles,
  pruneStaleSkaffoldFiles,
} from './generated-files';

// builds the actual `nx sync` entry point for a given set of framework
// adapters. `@dxs/skaffold` itself ships no generator — each adapter package
// (e.g. `@dxs/next-skaffold`) calls this once with its own adapter(s) and
// exports the result as its own `sync` generator.
export function createSkaffoldSyncGenerator(
  adapters: SkaffoldAdapters,
): (tree: Tree) => Promise<SyncGeneratorResult> {
  return async function syncGenerator(
    tree: Tree,
  ): Promise<SyncGeneratorResult> {
    const graph = await createProjectGraphAsync();

    const allApps: WorkspaceApp[] = Object.values(graph.nodes)
      .filter((node) => node.type === 'app')
      .map((node) => ({ name: node.name, root: node.data.root }));

    const { apps, activeAdapters } = discoverApps(tree, allApps, adapters);

    const appsByNamespace = new Map<string, WorkspaceApp[]>();
    for (const app of apps) {
      const namespace = getAppNamespace(
        tree,
        joinPathFragments(app.root, 'k8s'),
        app.name,
      );
      appsByNamespace.set(namespace, [
        ...(appsByNamespace.get(namespace) ?? []),
        app,
      ]);
    }

    const namespaces = [...appsByNamespace.keys()].sort();

    const expectedSkaffoldFiles = new Set<string>(['skaffold.yaml']);
    for (const namespace of namespaces) {
      expectedSkaffoldFiles.add(`${namespace}.yaml`);
      if (namespace !== DEFAULT_NAMESPACE) {
        expectedSkaffoldFiles.add(`${namespace}-namespace.yaml`);
      }
    }

    pruneStaleSkaffoldFiles(tree, expectedSkaffoldFiles);
    pruneStaleDockerfiles(tree, allApps, apps);

    const write = createWriter(tree);

    // only computed for an app whose adapter activated: that's the only
    // case where buildDockerfile() actually COPYs each dependency's root
    // in, so it's the only case where an adapter's getDependencySyncPaths
    // (syncing that same root's source back out) means anything
    const dependenciesByApp = new Map<string, WorkspaceDependency[]>(
      apps
        .filter((app) => activeAdapters.get(app.name))
        .map((app) => [app.name, getWorkspaceDependencies(graph, app.name)]),
    );

    for (const app of apps) {
      const adapter = activeAdapters.get(app.name);
      if (!adapter) {
        // no adapter activated: qualification above already confirmed a
        // hand-written Dockerfile exists here, so it's left untouched
        continue;
      }

      write(
        joinPathFragments(app.root, 'Dockerfile'),
        adapter.buildDockerfile(app, dependenciesByApp.get(app.name) ?? []),
      );

      adapter.syncFrameworkConfig?.(tree, app);
    }

    for (const namespace of namespaces) {
      const namespaceApps = appsByNamespace.get(namespace) ?? [];

      const namespaceManifest = buildNamespaceManifest(namespace);
      if (namespaceManifest) {
        write(
          `skaffold/${namespaceManifest.path}`,
          GENERATED_FILE_MARKER + namespaceManifest.content,
        );
      }

      write(
        `skaffold/${namespace}.yaml`,
        GENERATED_FILE_MARKER +
          yaml.stringify(
            buildNamespaceConfig(
              tree,
              namespace,
              namespaceApps,
              activeAdapters,
              dependenciesByApp,
            ),
          ),
      );
    }

    write(
      'skaffold/skaffold.yaml',
      GENERATED_FILE_MARKER +
        yaml.stringify({
          apiVersion: 'skaffold/v4beta13',
          kind: 'Config',
          metadata: {
            name: 'dx-stack',
          },
          ...(namespaces.length > 0
            ? {
                requires: namespaces.map((namespace) => ({
                  path: `${namespace}.yaml`,
                })),
              }
            : {}),
        }),
    );

    return {
      outOfSyncMessage: 'skaffold/skaffold.yaml is missing or not in sync',
    };
  };
}
