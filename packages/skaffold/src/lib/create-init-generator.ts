import {
  formatFiles,
  getProjects,
  readProjectConfiguration,
  updateJson,
  updateProjectConfiguration,
  type TargetConfiguration,
  type Tree,
} from '@nx/devkit';
import * as yaml from 'yaml';

// hand-maintained, seeded once and never regenerated afterward - see
// @dx-stack/skaffold's own README ("Infrastructure") for why this is
// deliberately kept out of the sync generator's fully-managed files.
const INFRA_CONFIG =
  yaml.stringify({
    apiVersion: 'skaffold/v4beta13',
    kind: 'Config',
    metadata: { name: 'dx-stack-infra' },
    manifests: { rawYaml: ['skaffold/infra/*.yaml'] },
    deploy: {
      helm: null,
      kubectl: { flags: { global: ['--context=minikube'] } },
    },
  }) + '\n';

const INFRA_NAMESPACE_MANIFEST =
  yaml.stringify({
    apiVersion: 'v1',
    kind: 'Namespace',
    metadata: { name: 'infra' },
  }) + '\n';

function findRootProjectName(tree: Tree): string | undefined {
  for (const [name, project] of getProjects(tree)) {
    if (project.root === '.' || project.root === '') {
      return name;
    }
  }
  return undefined;
}

// mutates `targets` in place: adds "minikube" if absent (identical
// regardless of which skaffold plugin's init ran), and either creates the
// full "skaffold" target or - if some other skaffold plugin's init already
// created it - just adds this plugin's sync generator to its
// syncGenerators, leaving everything else about it untouched.
function addSkaffoldTargets(
  targets: Record<string, TargetConfiguration>,
  syncGenerator: string,
): void {
  targets['minikube'] ??= {
    executor: 'nx:run-commands',
    options: {
      command: 'minikube start',
    },
  };

  const skaffoldTarget = targets['skaffold'];
  if (!skaffoldTarget) {
    targets['skaffold'] = {
      continuous: true,
      executor: 'nx:run-commands',
      defaultConfiguration: 'development',
      configurations: {
        development: {
          commands: [
            'eval $(minikube docker-env)',
            'skaffold run -f skaffold/infra.yaml',
            'skaffold dev -f skaffold/skaffold.yaml --port-forward=services',
          ],
          parallel: false,
        },
        production: {
          commands: [
            'eval $(minikube docker-env)',
            'skaffold run -f skaffold/infra.yaml',
            'skaffold dev -f skaffold/skaffold.yaml -p production --port-forward=services',
          ],
          parallel: false,
        },
      },
      syncGenerators: [syncGenerator],
    };
  } else {
    const syncGenerators = new Set(skaffoldTarget.syncGenerators ?? []);
    syncGenerators.add(syncGenerator);
    skaffoldTarget.syncGenerators = [...syncGenerators];
  }
}

/**
 * Builds the `init` generator shared by every framework-specific skaffold
 * package - each one only differs in which `sync` generator it registers.
 * Wires the workspace root project's `minikube`/`skaffold` targets (adding
 * to an already-existing `skaffold` target's `syncGenerators` rather than
 * replacing it, so multiple skaffold plugins can coexist) and seeds
 * `skaffold/infra.yaml`/`skaffold/infra/infra-namespace.yaml` if neither
 * exists yet - never overwriting them once they're there, since they're
 * meant to be hand-maintained afterward.
 */
export function createSkaffoldInitGenerator(
  syncGenerator: string,
): (tree: Tree) => Promise<void> {
  return async function initGenerator(tree: Tree): Promise<void> {
    const rootProjectName = findRootProjectName(tree);

    if (rootProjectName) {
      const rootProject = readProjectConfiguration(tree, rootProjectName);
      rootProject.targets ??= {};
      addSkaffoldTargets(rootProject.targets, syncGenerator);
      updateProjectConfiguration(tree, rootProjectName, rootProject);
    } else {
      // No project is registered at the workspace root yet. Bootstrap one
      // the same way Nx's own package-based convention does, directly via
      // the root package.json's "nx" field - NOT addProjectConfiguration,
      // which defaults to creating a separate root project.json instead of
      // writing into an already-existing package.json.
      if (!tree.exists('package.json')) {
        throw new Error(
          'Could not find a root package.json to register the "minikube"/"skaffold" targets on.',
        );
      }
      updateJson(tree, 'package.json', (packageJson) => {
        packageJson.nx ??= {};
        packageJson.nx.targets ??= {};
        addSkaffoldTargets(packageJson.nx.targets, syncGenerator);
        return packageJson;
      });
    }

    if (!tree.exists('skaffold/infra.yaml')) {
      tree.write('skaffold/infra.yaml', INFRA_CONFIG);
    }
    if (!tree.exists('skaffold/infra/infra-namespace.yaml')) {
      tree.write(
        'skaffold/infra/infra-namespace.yaml',
        INFRA_NAMESPACE_MANIFEST,
      );
    }

    await formatFiles(tree);
  };
}
