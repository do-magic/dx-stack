import { Tree, joinPathFragments } from '@nx/devkit';
import { SyncError } from 'nx/src/utils/sync-generators';
import type {
  FrameworkAdapter,
  SkaffoldAdapters,
  WorkspaceApp,
} from './framework-adapter';
import { hasYamlFiles } from './k8s-resources';

// the project name is used as-is as the Docker image name
const IMAGE_NAME_PATTERN = /^[a-z0-9]+((\.|_|__|-+)[a-z0-9]+)*$/;

export function assertValidImageName(appName: string): void {
  if (!IMAGE_NAME_PATTERN.test(appName)) {
    throw new SyncError(
      `Project "${appName}" is not a valid Docker image name`,
      [
        `Docker image names must be lowercase alphanumeric characters, optionally`,
        `separated by single '.', '_', '__', or one-or-more '-'.`,
        `The project's name is used directly as its built image's name, so rename the project.`,
      ],
    );
  }
}

function resolveActiveAdapter(
  tree: Tree,
  app: WorkspaceApp,
  adapters: SkaffoldAdapters,
): FrameworkAdapter | undefined {
  const activated = adapters.filter((adapter) => adapter.activates(tree, app));

  if (activated.length > 1) {
    throw new SyncError(
      `App "${app.name}" was recognized by more than one framework adapter`,
      [
        `Adapters: ${activated.map((adapter) => adapter.name).join(', ')}.`,
        `Each app must be recognized by at most one adapter.`,
      ],
    );
  }

  return activated[0];
}

export interface DiscoveredApps {
  apps: WorkspaceApp[];
  activeAdapters: Map<string, FrameworkAdapter | undefined>;
}

// step 1: figure out which apps skaffold should manage at all, and which
// (if any) framework adapter owns each one.
export function discoverApps(
  tree: Tree,
  allApps: WorkspaceApp[],
  adapters: SkaffoldAdapters,
): DiscoveredApps {
  const k8sQualifyingApps = allApps.filter((app) => {
    const k8sDir = joinPathFragments(app.root, 'k8s');
    return tree.exists(k8sDir) && hasYamlFiles(tree, k8sDir);
  });

  const activeAdapters = new Map<string, FrameworkAdapter | undefined>(
    k8sQualifyingApps.map((app) => [
      app.name,
      resolveActiveAdapter(tree, app, adapters),
    ]),
  );

  const apps = k8sQualifyingApps
    .filter((app) => {
      // an app a recognized adapter activated for always qualifies — its
      // Dockerfile is adapter-owned, and gets (re)written regardless of
      // what's already there. Anything else only qualifies if a Dockerfile
      // already exists: no adapter knows how to write one for it, and this
      // won't silently skip building the app either — the existing
      // Dockerfile is what makes that app buildable at all.
      return (
        activeAdapters.get(app.name) !== undefined ||
        tree.exists(joinPathFragments(app.root, 'Dockerfile'))
      );
    })
    // deterministic order so regenerating with no actual changes produces
    // byte-identical output, regardless of project graph iteration order
    .sort((a, b) => a.name.localeCompare(b.name));

  for (const app of apps) {
    assertValidImageName(app.name);
  }

  return { apps, activeAdapters };
}
