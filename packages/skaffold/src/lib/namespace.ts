import { Tree } from '@nx/devkit';
import { SyncError } from 'nx/src/utils/sync-generators';
import { getResourceNamespaces } from './k8s-resources';

export const DEFAULT_NAMESPACE = 'default';

// namespace values become file names (skaffold/<namespace>.yaml) and are
// used as-is in kubectl operations, so they must be safe on both fronts
export const NAMESPACE_PATTERN = /^[a-z0-9]([-a-z0-9]{0,61}[a-z0-9])?$/;

// these names are already claimed by hand-maintained top-level files
export const RESERVED_NAMESPACES = new Set(['infra', 'skaffold']);

export function getAppNamespace(
  tree: Tree,
  k8sDir: string,
  appName: string,
): string {
  const namespaces = new Set(getResourceNamespaces(tree, k8sDir));

  if (namespaces.size > 1) {
    throw new SyncError(`App "${appName}" declares more than one namespace`, [
      `Found namespaces: ${[...namespaces].join(', ')} across resources in ${k8sDir}.`,
      `Each app must target exactly one namespace across all of its k8s manifests.`,
    ]);
  }

  const namespace =
    namespaces.size === 1 ? [...namespaces][0] : DEFAULT_NAMESPACE;

  if (namespace !== DEFAULT_NAMESPACE && !NAMESPACE_PATTERN.test(namespace)) {
    throw new SyncError(
      `App "${appName}" declares an invalid namespace "${namespace}"`,
      [
        `Kubernetes namespace names must be lowercase alphanumeric characters or '-',`,
        `must start and end with an alphanumeric character, and be at most 63 characters long.`,
        `Found in ${k8sDir}.`,
      ],
    );
  }

  if (RESERVED_NAMESPACES.has(namespace)) {
    throw new SyncError(
      `App "${appName}" cannot use the reserved namespace "${namespace}"`,
      [
        `"${namespace}" is reserved for the hand-maintained skaffold/${namespace}.yaml.`,
        `Choose a different namespace for this app.`,
      ],
    );
  }

  return namespace;
}
