import { createTreeWithEmptyWorkspace } from '@nx/devkit/testing';
import { Tree } from '@nx/devkit';
import * as yaml from 'yaml';

import { readK8sResources } from './k8s-resources';

function deployment(name: string, namespace?: string) {
  return yaml.stringify({
    apiVersion: 'apps/v1',
    kind: 'Deployment',
    metadata: { name, ...(namespace ? { namespace } : {}) },
  });
}

describe('k8s-resources', () => {
  let tree: Tree;

  beforeEach(() => {
    tree = createTreeWithEmptyWorkspace();
  });

  describe('readK8sResources', () => {
    it('rejects a k8s manifest that fails to parse', () => {
      tree.write('apps/demo/k8s/bad.yaml', 'foo: [unterminated\n  bar: baz');

      expect(() => readK8sResources(tree, 'apps/demo/k8s')).toThrow(
        /Failed to parse/,
      );
    });

    it('ignores non-yaml files in the k8s directory', () => {
      tree.write('apps/demo/k8s/README.md', '# not yaml');
      tree.write('apps/demo/k8s/deployment.yaml', deployment('demo'));

      expect(readK8sResources(tree, 'apps/demo/k8s')).toHaveLength(1);
    });

    it('reads every document in a multi-document yaml file, skipping empty ones from a trailing separator', () => {
      const combined = [
        deployment('demo', 'apps'),
        deployment('demo-worker', 'apps'),
        '', // trailing "---" produces an empty document
      ].join('---\n');
      tree.write('apps/demo/k8s/combined.yaml', combined);

      const resources = readK8sResources(tree, 'apps/demo/k8s');

      expect(resources).toHaveLength(2);
      expect(resources.map(({ resource }) => resource.metadata?.name)).toEqual([
        'demo',
        'demo-worker',
      ]);
    });
  });
});
