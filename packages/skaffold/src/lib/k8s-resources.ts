import { Tree, joinPathFragments } from '@nx/devkit';
import { SyncError } from 'nx/src/utils/sync-generators';
import * as yaml from 'yaml';

export function isYamlFile(file: string): boolean {
  return file.endsWith('.yaml') || file.endsWith('.yml');
}

export function hasYamlFiles(tree: Tree, dir: string): boolean {
  return tree.children(dir).some(isYamlFile);
}

export type K8sResource = {
  file: string;
  resource: {
    kind?: string;
    metadata?: { name?: string; namespace?: string };
    spec?: { ports?: { port?: unknown }[] };
  };
};

export function readK8sResources(tree: Tree, k8sDir: string): K8sResource[] {
  const resources: K8sResource[] = [];

  for (const file of tree.children(k8sDir)) {
    if (!isYamlFile(file)) {
      continue;
    }

    const filePath = joinPathFragments(k8sDir, file);
    const content = tree.read(filePath, 'utf-8');
    if (!content) {
      continue;
    }

    for (const doc of yaml.parseAllDocuments(content)) {
      if (doc.errors.length > 0) {
        throw new SyncError(`Failed to parse ${filePath}`, [
          ...doc.errors.map((error) => error.message),
        ]);
      }

      const resource = doc.toJSON();
      // skip empty documents, e.g. from a trailing "---"
      if (resource) {
        resources.push({ file: filePath, resource });
      }
    }
  }

  return resources;
}

export function getResourceNamespaces(tree: Tree, k8sDir: string): string[] {
  return readK8sResources(tree, k8sDir)
    .map(({ resource }) => resource.metadata?.namespace)
    .filter((namespace): namespace is string => Boolean(namespace));
}

export type PortForward = {
  resourceType: string;
  resourceName: string;
  namespace: string;
  port: number;
  localPort: number;
};

export function getServicePortForwards(
  tree: Tree,
  k8sDir: string,
  namespace: string,
): PortForward[] {
  const portForwards: PortForward[] = [];

  for (const { file, resource } of readK8sResources(tree, k8sDir)) {
    if (resource.kind !== 'Service') {
      continue;
    }

    const resourceName = resource.metadata?.name;
    if (!resourceName) {
      throw new SyncError(`Service in ${file} is missing metadata.name`, [
        `Every Service manifest must declare metadata.name so it can be port-forwarded.`,
      ]);
    }

    for (const port of resource.spec?.ports ?? []) {
      if (typeof port.port !== 'number') {
        throw new SyncError(
          `Service "${resourceName}" in ${file} has a port entry without a numeric "port"`,
          [`Found: ${JSON.stringify(port)}`],
        );
      }

      portForwards.push({
        resourceType: 'service',
        resourceName,
        namespace,
        port: port.port,
        localPort: port.port,
      });
    }
  }

  return portForwards;
}
