import { createTreeWithEmptyWorkspace } from '@nx/devkit/testing';
import { Tree } from '@nx/devkit';

import { nestJsAdapter } from './nest-adapter';

const svc = { name: 'svc', root: 'apps/svc' };

describe('nestJsAdapter.activates', () => {
  let tree: Tree;

  beforeEach(() => {
    tree = createTreeWithEmptyWorkspace();
  });

  it('detects Nest.js via a "@nestjs/core" dependency', () => {
    tree.write(
      'apps/svc/package.json',
      JSON.stringify({ dependencies: { '@nestjs/core': '^11.0.0' } }),
    );

    expect(nestJsAdapter.activates(tree, svc)).toBe(true);
  });

  it('detects Nest.js via a devDependency too', () => {
    tree.write(
      'apps/svc/package.json',
      JSON.stringify({ devDependencies: { '@nestjs/core': '^11.0.0' } }),
    );

    expect(nestJsAdapter.activates(tree, svc)).toBe(true);
  });

  it('does not activate when there is no package.json', () => {
    expect(nestJsAdapter.activates(tree, svc)).toBe(false);
  });

  it('does not activate for a package.json with no "@nestjs/core" dependency', () => {
    tree.write(
      'apps/svc/package.json',
      JSON.stringify({ dependencies: { express: '^4.0.0' } }),
    );

    expect(nestJsAdapter.activates(tree, svc)).toBe(false);
  });
});
