import { createTreeWithEmptyWorkspace } from '@nx/devkit/testing';
import { Tree } from '@nx/devkit';

import { buildArtifact, buildProductionArtifact } from './artifacts';
import { fakeAdapter } from '../testing/fake-adapter';

describe('buildArtifact', () => {
  let tree: Tree;

  beforeEach(() => {
    tree = createTreeWithEmptyWorkspace();
  });

  it('sets docker.target to "dev" and includes sync when an adapter activated', () => {
    tree.write('apps/demo/public/favicon.ico', '');

    const artifact = buildArtifact(
      tree,
      { name: 'demo', root: 'apps/demo' },
      fakeAdapter(),
      [],
    );

    expect(artifact.image).toBe('demo');
    expect(artifact.docker.dockerfile).toBe('apps/demo/Dockerfile');
    expect(artifact.docker.target).toBe('dev');
    expect(artifact.sync.manual).toEqual([
      { src: 'apps/demo/src/**/*', dest: '.' },
      { src: 'apps/demo/public/**/*', dest: '.' },
    ]);
  });

  it('omits the public/**/* sync path for an app with no public folder', () => {
    const artifact = buildArtifact(
      tree,
      { name: 'svc', root: 'apps/svc' },
      fakeAdapter(),
      [],
    );

    expect(artifact.sync.manual).toEqual([
      { src: 'apps/svc/src/**/*', dest: '.' },
    ]);
  });

  it("includes the adapter's dependency sync paths when dependencies are given", () => {
    const artifact = buildArtifact(
      tree,
      { name: 'demo', root: 'apps/demo' },
      fakeAdapter(),
      [{ name: 'shared-ui', root: 'packages/shared-ui' }],
    );

    expect(artifact.sync.manual).toContainEqual({
      src: 'packages/shared-ui/src/**/*',
      dest: '.',
    });
  });

  it('has no docker.target for a hand-written Dockerfile with no "dev" stage', () => {
    tree.write('apps/demo/Dockerfile', 'FROM node:24-alpine\n');
    tree.write('apps/demo/public/favicon.ico', '');

    const artifact = buildArtifact(
      tree,
      { name: 'demo', root: 'apps/demo' },
      undefined,
      [],
    );

    expect(artifact.docker.target).toBeUndefined();
    // still synced: the app's own src/**/* is unconditional
    expect(artifact.sync.manual).toEqual([
      { src: 'apps/demo/src/**/*', dest: '.' },
      { src: 'apps/demo/public/**/*', dest: '.' },
    ]);
  });

  it('sets docker.target to "dev" for a hand-written Dockerfile that declares one', () => {
    tree.write(
      'apps/demo/Dockerfile',
      'FROM node:24-alpine AS base\nFROM base AS dev\n',
    );

    const artifact = buildArtifact(
      tree,
      { name: 'demo', root: 'apps/demo' },
      undefined,
      [],
    );

    expect(artifact.docker.target).toBe('dev');
  });
});

describe('buildProductionArtifact', () => {
  it('has no docker.target and no sync', () => {
    const artifact = buildProductionArtifact({
      name: 'demo',
      root: 'apps/demo',
    });

    expect(artifact).toEqual({
      image: 'demo',
      context: '..',
      docker: { dockerfile: 'apps/demo/Dockerfile' },
    });
  });
});
