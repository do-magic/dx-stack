import { Tree, joinPathFragments } from '@nx/devkit';
import * as yaml from 'yaml';
import type {
  FrameworkAdapter,
  WorkspaceApp,
  WorkspaceDependency,
} from './framework-adapter.ts';
import { buildArtifact, buildProductionArtifact } from './artifacts.ts';
import { DEFAULT_NAMESPACE } from './namespace.ts';
import { getServicePortForwards } from './k8s-resources.ts';

export function buildNamespaceManifest(namespace: string) {
  if (namespace === DEFAULT_NAMESPACE) {
    // the "default" namespace always exists; every other namespace referenced
    // by deploy.kubectl.defaultNamespace must be created before it's deployed into
    return undefined;
  }

  return {
    path: `${namespace}-namespace.yaml`,
    content: yaml.stringify({
      apiVersion: 'v1',
      kind: 'Namespace',
      metadata: { name: namespace },
    }),
  };
}

export function buildNamespaceConfig(
  tree: Tree,
  namespace: string,
  apps: WorkspaceApp[],
  activeAdapters: Map<string, FrameworkAdapter | undefined>,
  dependenciesByApp: Map<string, WorkspaceDependency[]>,
) {
  const portForward = apps.flatMap((app) =>
    getServicePortForwards(tree, joinPathFragments(app.root, 'k8s'), namespace),
  );

  const namespaceManifestPath =
    namespace !== DEFAULT_NAMESPACE ? `${namespace}-namespace.yaml` : undefined;

  return {
    apiVersion: 'skaffold/v4beta13',
    kind: 'Config',
    metadata: {
      name: `dx-stack-${namespace}`,
    },
    build: {
      artifacts: apps.map((app) =>
        buildArtifact(
          tree,
          app,
          activeAdapters.get(app.name),
          dependenciesByApp.get(app.name) ?? [],
        ),
      ),
      local: {
        useDockerCLI: true,
        useBuildkit: true,
      },
    },
    manifests: {
      // relative to this file's own directory (skaffold/), since this config
      // is always loaded as a `requires` module, never as the entrypoint
      rawYaml: [
        ...(namespaceManifestPath ? [namespaceManifestPath] : []),
        ...apps.map((app) => `../${app.root}/k8s/*.yaml`),
      ],
    },
    deploy: {
      kubectl: {
        defaultNamespace: namespace,
        flags: {
          global: ['--context=minikube'],
        },
      },
    },
    ...(portForward.length > 0 ? { portForward } : {}),
    // activated with `-p production`; skaffold propagates an activated
    // profile name to every required config that defines a matching one, so
    // `-p production` on the top-level skaffold.yaml reaches this file too
    profiles: [
      {
        name: 'production',
        build: {
          artifacts: apps.map((app) => buildProductionArtifact(app)),
          local: {
            useDockerCLI: true,
            useBuildkit: true,
          },
        },
      },
    ],
  };
}
