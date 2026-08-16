import { createTreeWithEmptyWorkspace } from '@nx/devkit/testing';
import { Tree } from '@nx/devkit';
import * as yaml from 'yaml';

import { getAppNamespace } from './namespace';

function deployment(name: string, namespace?: string) {
  return yaml.stringify({
    apiVersion: 'apps/v1',
    kind: 'Deployment',
    metadata: { name, ...(namespace ? { namespace } : {}) },
  });
}

describe('getAppNamespace', () => {
  let tree: Tree;

  beforeEach(() => {
    tree = createTreeWithEmptyWorkspace();
  });

  it('returns "default" when no resource declares a namespace', () => {
    tree.write('apps/demo/k8s/deployment.yaml', deployment('demo'));

    expect(getAppNamespace(tree, 'apps/demo/k8s', 'demo')).toBe('default');
  });

  it('returns the declared namespace when every resource agrees', () => {
    tree.write('apps/demo/k8s/deployment.yaml', deployment('demo', 'apps'));

    expect(getAppNamespace(tree, 'apps/demo/k8s', 'demo')).toBe('apps');
  });

  it('rejects an app whose own resources disagree on namespace', () => {
    tree.write('apps/demo/k8s/deployment.yaml', deployment('demo', 'apps'));
    tree.write(
      'apps/demo/k8s/other.yaml',
      yaml.stringify({
        kind: 'ConfigMap',
        metadata: { name: 'cm', namespace: 'other' },
      }),
    );

    expect(() => getAppNamespace(tree, 'apps/demo/k8s', 'demo')).toThrow(
      /declares more than one namespace/,
    );
  });

  it.each(['infra', 'skaffold'])(
    'rejects the reserved namespace "%s"',
    (namespace) => {
      tree.write(
        'apps/demo/k8s/deployment.yaml',
        deployment('demo', namespace),
      );

      expect(() => getAppNamespace(tree, 'apps/demo/k8s', 'demo')).toThrow(
        /reserved namespace/,
      );
    },
  );

  it.each(['My_Namespace', '-bad', 'bad-', 'has a space', '../etc'])(
    'rejects the invalid namespace "%s"',
    (namespace) => {
      tree.write(
        'apps/demo/k8s/deployment.yaml',
        deployment('demo', namespace),
      );

      expect(() => getAppNamespace(tree, 'apps/demo/k8s', 'demo')).toThrow(
        /invalid namespace/,
      );
    },
  );
});
