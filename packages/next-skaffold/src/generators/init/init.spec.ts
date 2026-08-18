import { createTreeWithEmptyWorkspace } from '@nx/devkit/testing';
import { readJson, type Tree } from '@nx/devkit';

import { initGenerator } from './init';

// the framework-agnostic behavior (root project bootstrapping, merging with
// other skaffold plugins, infra file seeding, ...) is covered exhaustively
// by @dx-stack/skaffold's own create-init-generator.spec.ts - this only
// confirms the real '@dx-stack/next-skaffold:sync' generator name is wired
// through correctly.
describe('init generator (end-to-end)', () => {
  let tree: Tree;

  beforeEach(() => {
    tree = createTreeWithEmptyWorkspace();
  });

  it('registers @dx-stack/next-skaffold:sync on the skaffold target', async () => {
    await initGenerator(tree);

    const packageJson = readJson(tree, 'package.json');
    expect(packageJson.nx.targets.skaffold.syncGenerators).toEqual([
      '@dx-stack/next-skaffold:sync',
    ]);
    expect(packageJson.nx.targets.minikube).toBeDefined();
    expect(tree.exists('skaffold/infra.yaml')).toBe(true);
    expect(tree.exists('skaffold/infra/infra-namespace.yaml')).toBe(true);
  });
});
