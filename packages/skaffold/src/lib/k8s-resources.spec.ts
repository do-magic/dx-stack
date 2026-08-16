import { createTreeWithEmptyWorkspace } from '@nx/devkit/testing';
import { Tree } from '@nx/devkit';
import * as yaml from 'yaml';

import { getServicePortForwards, readK8sResources } from './k8s-resources.ts';

function deployment(name: string, namespace?: string) {
  return yaml.stringify({
    apiVersion: 'apps/v1',
    kind: 'Deployment',
    metadata: { name, ...(namespace ? { namespace } : {}) },
  });
}

function service(
  name: string,
  spec: Record<string, unknown>,
  namespace?: string,
) {
  return yaml.stringify({
    apiVersion: 'v1',
    kind: 'Service',
    metadata: { name, ...(namespace ? { namespace } : {}) },
    spec,
  });
}

describe('k8s-resources', () => {
  let tree: Tree;

  beforeEach(() => {
    tree = createTreeWithEmptyWorkspace();
  });

  describe('getServicePortForwards', () => {
    it('generates a portForward entry per Service port', () => {
      tree.write(
        'apps/demo/k8s/service.yaml',
        service('demo', { ports: [{ port: 3000 }] }),
      );

      expect(getServicePortForwards(tree, 'apps/demo/k8s', 'default')).toEqual([
        {
          resourceType: 'service',
          resourceName: 'demo',
          namespace: 'default',
          port: 3000,
          localPort: 3000,
        },
      ]);
    });

    it('rejects a Service without metadata.name', () => {
      tree.write(
        'apps/demo/k8s/service.yaml',
        yaml.stringify({
          kind: 'Service',
          metadata: {},
          spec: { ports: [{ port: 3000 }] },
        }),
      );

      expect(() =>
        getServicePortForwards(tree, 'apps/demo/k8s', 'default'),
      ).toThrow(/missing metadata.name/);
    });

    it('rejects a port entry without a numeric port', () => {
      tree.write(
        'apps/demo/k8s/service.yaml',
        service('demo', { ports: [{ name: 'web' }] }),
      );

      expect(() =>
        getServicePortForwards(tree, 'apps/demo/k8s', 'default'),
      ).toThrow(/port entry without a numeric "port"/);
    });

    it('handles a Deployment and Service in one multi-document yaml file', () => {
      const combined = [
        deployment('demo', 'apps'),
        service('demo', { ports: [{ port: 3000 }] }, 'apps'),
        '', // trailing "---" produces an empty document
      ].join('---\n');
      tree.write('apps/demo/k8s/combined.yaml', combined);

      expect(getServicePortForwards(tree, 'apps/demo/k8s', 'apps')).toEqual([
        {
          resourceType: 'service',
          resourceName: 'demo',
          namespace: 'apps',
          port: 3000,
          localPort: 3000,
        },
      ]);
    });
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
  });
});
