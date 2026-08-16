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
    metadata?: { name?: string; namespace?: string };
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
