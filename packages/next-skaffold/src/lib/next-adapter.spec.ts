import { createTreeWithEmptyWorkspace } from '@nx/devkit/testing';
import { Tree } from '@nx/devkit';

import { nextJsAdapter } from './next-adapter.ts';

const demo = { name: 'demo', root: 'apps/demo' };

describe('nextJsAdapter.activates', () => {
  let tree: Tree;

  beforeEach(() => {
    tree = createTreeWithEmptyWorkspace();
  });

  it('detects Next.js via a "next" dependency', () => {
    tree.write(
      'apps/demo/package.json',
      JSON.stringify({ dependencies: { next: '~16.1.6' } }),
    );

    expect(nextJsAdapter.activates(tree, demo)).toBe(true);
  });

  it('detects Next.js via a devDependency too', () => {
    tree.write(
      'apps/demo/package.json',
      JSON.stringify({ devDependencies: { next: '~16.1.6' } }),
    );

    expect(nextJsAdapter.activates(tree, demo)).toBe(true);
  });

  it('does not activate when there is no package.json', () => {
    expect(nextJsAdapter.activates(tree, demo)).toBe(false);
  });

  it('does not activate for a package.json with no "next" dependency', () => {
    tree.write(
      'apps/demo/package.json',
      JSON.stringify({ dependencies: { express: '^4.0.0' } }),
    );

    expect(nextJsAdapter.activates(tree, demo)).toBe(false);
  });
});
