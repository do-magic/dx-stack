import { createTreeWithEmptyWorkspace } from '@nx/devkit/testing';
import { Tree } from '@nx/devkit';
import * as yaml from 'yaml';

import { assertValidImageName, discoverApps } from './app-discovery.ts';
import { fakeAdapter } from '../testing/fake-adapter.ts';

function addK8s(tree: Tree, root: string) {
  tree.write(
    `${root}/k8s/deployment.yaml`,
    yaml.stringify({ kind: 'Deployment', metadata: { name: 'demo' } }),
  );
}

describe('assertValidImageName', () => {
  it('rejects a name that is not a valid Docker image name', () => {
    expect(() => assertValidImageName('My_App')).toThrow(
      /not a valid Docker image name/,
    );
  });

  it('accepts a valid name', () => {
    expect(() => assertValidImageName('demo-app')).not.toThrow();
  });
});

describe('discoverApps', () => {
  let tree: Tree;

  beforeEach(() => {
    tree = createTreeWithEmptyWorkspace();
  });

  it('ignores an app with no k8s folder at all', () => {
    const { apps } = discoverApps(
      tree,
      [{ name: 'demo', root: 'apps/demo' }],
      [fakeAdapter()],
    );

    expect(apps).toEqual([]);
  });

  it('ignores an app whose k8s folder has no yaml files', () => {
    tree.write('apps/demo/k8s/.gitkeep', '');

    const { apps } = discoverApps(
      tree,
      [{ name: 'demo', root: 'apps/demo' }],
      [fakeAdapter()],
    );

    expect(apps).toEqual([]);
  });

  it('includes an app an adapter activates for, with no Dockerfile required', () => {
    addK8s(tree, 'apps/demo');

    const { apps, activeAdapters } = discoverApps(
      tree,
      [{ name: 'demo', root: 'apps/demo' }],
      [fakeAdapter()],
    );

    expect(apps).toEqual([{ name: 'demo', root: 'apps/demo' }]);
    expect(activeAdapters.get('demo')?.name).toBe('fake');
  });

  it('excludes an app no adapter activates for and with no existing Dockerfile', () => {
    addK8s(tree, 'apps/demo');

    const { apps } = discoverApps(
      tree,
      [{ name: 'demo', root: 'apps/demo' }],
      [fakeAdapter({ activates: () => false })],
    );

    expect(apps).toEqual([]);
  });

  it('includes an app no adapter activates for as long as it already has a Dockerfile', () => {
    addK8s(tree, 'apps/demo');
    tree.write('apps/demo/Dockerfile', 'FROM node:24-alpine\n');

    const { apps, activeAdapters } = discoverApps(
      tree,
      [{ name: 'demo', root: 'apps/demo' }],
      [fakeAdapter({ activates: () => false })],
    );

    expect(apps).toEqual([{ name: 'demo', root: 'apps/demo' }]);
    expect(activeAdapters.get('demo')).toBeUndefined();
  });

  it('rejects a project name that is not a valid Docker image name', () => {
    addK8s(tree, 'apps/my-app');

    expect(() =>
      discoverApps(
        tree,
        [{ name: 'My_App', root: 'apps/my-app' }],
        [fakeAdapter()],
      ),
    ).toThrow(/not a valid Docker image name/);
  });

  it('fails clearly when more than one adapter activates for the same app', () => {
    addK8s(tree, 'apps/demo');

    expect(() =>
      discoverApps(
        tree,
        [{ name: 'demo', root: 'apps/demo' }],
        [fakeAdapter({ name: 'first' }), fakeAdapter({ name: 'second' })],
      ),
    ).toThrow(/recognized by more than one framework adapter/);
  });

  it('sorts apps by name regardless of input order', () => {
    addK8s(tree, 'apps/zeta');
    addK8s(tree, 'apps/alpha');

    const { apps } = discoverApps(
      tree,
      [
        { name: 'zeta', root: 'apps/zeta' },
        { name: 'alpha', root: 'apps/alpha' },
      ],
      [fakeAdapter()],
    );

    expect(apps.map((app) => app.name)).toEqual(['alpha', 'zeta']);
  });
});
