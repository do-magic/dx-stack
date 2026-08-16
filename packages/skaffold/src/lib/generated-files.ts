import { Tree, joinPathFragments } from '@nx/devkit';
import { SyncError } from 'nx/src/utils/sync-generators';
import {
  GENERATED_FILE_MARKER,
  type WorkspaceApp,
} from './framework-adapter.ts';
import { isYamlFile } from './k8s-resources.ts';

// guards against two different namespaces producing the same generated file
// name — a defensive check, not reachable given how namespaces are
// deduplicated today, but cheap insurance against a future change breaking
// that.
export function createWriter(
  tree: Tree,
): (path: string, content: string) => void {
  const written = new Set<string>();

  return function write(path: string, content: string) {
    if (written.has(path)) {
      throw new SyncError(
        `Generated file "${path}" would be written more than once`,
        [`Two different namespaces produced a colliding generated file name.`],
      );
    }
    written.add(path);
    tree.write(path, content);
  };
}

// remove generated skaffold/ files left behind by a previous run that are no
// longer needed (e.g. an app switched namespaces); never touches
// hand-authored files, since only files carrying the generated-file marker
// are eligible
export function pruneStaleSkaffoldFiles(
  tree: Tree,
  expectedFiles: ReadonlySet<string>,
): void {
  for (const file of tree.children('skaffold')) {
    if (expectedFiles.has(file) || file === 'infra.yaml') {
      continue;
    }
    if (!isYamlFile(file)) {
      continue;
    }

    const filePath = `skaffold/${file}`;
    const content = tree.read(filePath, 'utf-8');
    if (content?.includes(GENERATED_FILE_MARKER)) {
      tree.delete(filePath);
    }
  }
}

// same, for a project's own generated Dockerfile, if it stopped qualifying
// (e.g. its k8s/ folder was removed)
export function pruneStaleDockerfiles(
  tree: Tree,
  allApps: readonly WorkspaceApp[],
  qualifyingApps: readonly WorkspaceApp[],
): void {
  const qualifyingRoots = new Set(qualifyingApps.map((app) => app.root));

  for (const app of allApps) {
    if (qualifyingRoots.has(app.root)) {
      continue;
    }

    const dockerfilePath = joinPathFragments(app.root, 'Dockerfile');
    const content = tree.exists(dockerfilePath)
      ? tree.read(dockerfilePath, 'utf-8')
      : null;
    if (content?.includes(GENERATED_FILE_MARKER)) {
      tree.delete(dockerfilePath);
    }
  }
}
