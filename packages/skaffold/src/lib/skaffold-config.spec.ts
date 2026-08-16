import { createTreeWithEmptyWorkspace } from '@nx/devkit/testing';
import { Tree } from '@nx/devkit';
import * as yaml from 'yaml';

import { fakeAdapter } from '../testing/fake-adapter.ts';
import {
  buildNamespaceConfig,
  buildNamespaceManifest,
} from './skaffold-config.ts';

describe('buildNamespaceManifest', () => {
  it('returns undefined for the default namespace', () => {
    expect(buildNamespaceManifest('default')).toBeUndefined();
  });

  it('returns a Namespace manifest for any other namespace', () => {
    const manifest = buildNamespaceManifest('apps');

    expect(manifest?.path).toBe('apps-namespace.yaml');
    expect(yaml.parse(manifest?.content ?? '')).toEqual({
      apiVersion: 'v1',
      kind: 'Namespace',
      metadata: { name: 'apps' },
    });
  });
});

describe('buildNamespaceConfig', () => {
  let tree: Tree;

  beforeEach(() => {
    tree = createTreeWithEmptyWorkspace();
  });

  it('assembles artifacts, manifests, and the production profile for every app', () => {
    const demo = { name: 'demo', root: 'apps/demo' };
    const example = { name: 'example', root: 'apps/example' };

    const config = buildNamespaceConfig(
      tree,
      'apps',
      [demo, example],
      new Map([
        ['demo', fakeAdapter()],
        ['example', fakeAdapter()],
      ]),
      new Map(),
    );

    expect(config.deploy.kubectl.defaultNamespace).toBe('apps');
    expect(config.build.artifacts.map((a) => a.image)).toEqual([
      'demo',
      'example',
    ]);
    expect(config.manifests.rawYaml).toEqual([
      'apps-namespace.yaml',
      '../apps/demo/k8s/*.yaml',
      '../apps/example/k8s/*.yaml',
    ]);
    expect(config.profiles).toHaveLength(1);
    expect(config.profiles[0].name).toBe('production');
    expect(config.profiles[0].build.artifacts[0].docker).not.toHaveProperty(
      'target',
    );
  });

  it("omits manifests.rawYaml's namespace entry and portForward for the default namespace with no Services", () => {
    const demo = { name: 'demo', root: 'apps/demo' };

    const config = buildNamespaceConfig(
      tree,
      'default',
      [demo],
      new Map([['demo', fakeAdapter()]]),
      new Map(),
    );

    expect(config.manifests.rawYaml).toEqual(['../apps/demo/k8s/*.yaml']);
    expect(config).not.toHaveProperty('portForward');
  });
});
