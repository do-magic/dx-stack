import { createTreeWithEmptyWorkspace } from '@nx/devkit/testing';
import { Tree } from '@nx/devkit';

import { getDevTarget } from './dev-target';

describe('getDevTarget', () => {
  let tree: Tree;

  beforeEach(() => {
    tree = createTreeWithEmptyWorkspace();
  });

  it('returns "dev" when an adapter activated, regardless of Dockerfile content', () => {
    tree.write('apps/demo/Dockerfile', 'FROM node:24-alpine\n');

    expect(getDevTarget(tree, { name: 'demo', root: 'apps/demo' }, true)).toBe(
      'dev',
    );
  });

  it('returns "dev" for a hand-written Dockerfile that declares a "dev" stage', () => {
    tree.write(
      'apps/demo/Dockerfile',
      'FROM node:24-alpine AS base\nFROM base AS dev\n',
    );

    expect(getDevTarget(tree, { name: 'demo', root: 'apps/demo' }, false)).toBe(
      'dev',
    );
  });

  it('returns undefined for a hand-written Dockerfile with no "dev" stage', () => {
    tree.write('apps/demo/Dockerfile', 'FROM node:24-alpine\n');

    expect(
      getDevTarget(tree, { name: 'demo', root: 'apps/demo' }, false),
    ).toBeUndefined();
  });
});
