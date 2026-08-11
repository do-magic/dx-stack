import { vi } from 'vitest';
import { createTreeWithEmptyWorkspace } from '@nx/devkit/testing';
import { Tree, createProjectGraphAsync } from '@nx/devkit';
import * as yaml from 'yaml';

import { syncGenerator } from './sync';

// createProjectGraphAsync reads the real, on-disk Nx project graph and is not
// influenced by the in-memory test Tree at all (addProjectConfiguration has no
// effect on it), so it must be mocked to test against fake apps in isolation.
vi.mock('@nx/devkit', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@nx/devkit')>();
  return { ...actual, createProjectGraphAsync: vi.fn() };
});

function mockApps(apps: { name: string; root: string }[]) {
  vi.mocked(createProjectGraphAsync).mockResolvedValue({
    nodes: Object.fromEntries(
      apps.map((app) => [
        app.name,
        { name: app.name, type: 'app' as const, data: { root: app.root } },
      ]),
    ),
    dependencies: {},
  });
}

function addApp(
  tree: Tree,
  name: string,
  options: { dockerfile?: string; k8s?: Record<string, string> } = {},
): string {
  const root = `apps/${name}`;
  tree.write(
    `${root}/Dockerfile`,
    options.dockerfile ?? 'FROM node:24-alpine AS base\n',
  );

  const k8s = options.k8s ?? {
    'deployment.yaml': yaml.stringify({
      apiVersion: 'apps/v1',
      kind: 'Deployment',
      metadata: { name },
    }),
  };
  for (const [file, content] of Object.entries(k8s)) {
    tree.write(`${root}/k8s/${file}`, content);
  }

  return root;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function readConfig(tree: Tree, path: string): any {
  const content = tree.read(path, 'utf-8');
  if (!content) {
    throw new Error(`${path} was not written`);
  }
  return yaml.parse(content);
}

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

describe('sync generator', () => {
  let tree: Tree;

  beforeEach(() => {
    tree = createTreeWithEmptyWorkspace();
  });

  it('generates a top-level skaffold.yaml requiring only infra when there are no apps', async () => {
    mockApps([]);

    await syncGenerator(tree);

    expect(tree.exists('skaffold/skaffold.yaml')).toBe(true);
    expect(tree.exists('skaffold/default.yaml')).toBe(false);
    expect(readConfig(tree, 'skaffold/skaffold.yaml').requires).toEqual([
      { path: 'infra.yaml' },
    ]);
  });

  describe('namespace assignment', () => {
    it('puts an app with no declared namespace into default.yaml', async () => {
      mockApps([{ name: 'demo', root: 'apps/demo' }]);
      addApp(tree, 'demo');

      await syncGenerator(tree);

      expect(tree.exists('skaffold/default.yaml')).toBe(true);
      expect(tree.exists('skaffold/default-namespace.yaml')).toBe(false);

      const config = readConfig(tree, 'skaffold/default.yaml');
      expect(config.deploy.kubectl.defaultNamespace).toBe('default');
      expect(config.build.artifacts).toHaveLength(1);
      expect(config.build.artifacts[0].image).toBe('demo');
    });

    it('puts an app in its declared namespace and generates a Namespace manifest for it', async () => {
      mockApps([{ name: 'demo', root: 'apps/demo' }]);
      addApp(tree, 'demo', {
        k8s: { 'deployment.yaml': deployment('demo', 'apps') },
      });

      await syncGenerator(tree);

      expect(tree.exists('skaffold/apps.yaml')).toBe(true);
      expect(tree.exists('skaffold/apps-namespace.yaml')).toBe(true);

      const namespaceManifest = readConfig(
        tree,
        'skaffold/apps-namespace.yaml',
      );
      expect(namespaceManifest).toEqual({
        apiVersion: 'v1',
        kind: 'Namespace',
        metadata: { name: 'apps' },
      });

      const config = readConfig(tree, 'skaffold/apps.yaml');
      expect(config.deploy.kubectl.defaultNamespace).toBe('apps');
      expect(config.manifests.rawYaml).toEqual([
        'apps-namespace.yaml',
        '../apps/demo/k8s/*.yaml',
      ]);

      expect(readConfig(tree, 'skaffold/skaffold.yaml').requires).toEqual([
        { path: 'infra.yaml' },
        { path: 'apps.yaml' },
      ]);
    });

    it('groups two apps sharing a namespace into one config file', async () => {
      mockApps([
        { name: 'demo', root: 'apps/demo' },
        { name: 'example', root: 'apps/example' },
      ]);
      addApp(tree, 'demo', {
        k8s: { 'deployment.yaml': deployment('demo', 'apps') },
      });
      addApp(tree, 'example', {
        k8s: { 'deployment.yaml': deployment('example', 'apps') },
      });

      await syncGenerator(tree);

      expect(tree.exists('skaffold/apps.yaml')).toBe(true);
      expect(tree.exists('skaffold/examples.yaml')).toBe(false);

      const config = readConfig(tree, 'skaffold/apps.yaml');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect(config.build.artifacts.map((a: any) => a.image)).toEqual([
        'demo',
        'example',
      ]);
      expect(config.manifests.rawYaml).toEqual([
        'apps-namespace.yaml',
        '../apps/demo/k8s/*.yaml',
        '../apps/example/k8s/*.yaml',
      ]);
    });

    it('rejects an app whose own resources disagree on namespace', async () => {
      mockApps([{ name: 'demo', root: 'apps/demo' }]);
      addApp(tree, 'demo', {
        k8s: {
          'deployment.yaml': deployment('demo', 'apps'),
          'other.yaml': yaml.stringify({
            kind: 'ConfigMap',
            metadata: { name: 'cm', namespace: 'other' },
          }),
        },
      });

      await expect(syncGenerator(tree)).rejects.toThrow(
        /declares more than one namespace/,
      );
    });

    it.each(['infra', 'skaffold'])(
      'rejects the reserved namespace "%s"',
      async (namespace) => {
        mockApps([{ name: 'demo', root: 'apps/demo' }]);
        addApp(tree, 'demo', {
          k8s: { 'deployment.yaml': deployment('demo', namespace) },
        });

        await expect(syncGenerator(tree)).rejects.toThrow(/reserved namespace/);
      },
    );

    it.each(['My_Namespace', '-bad', 'bad-', 'has a space', '../etc'])(
      'rejects the invalid namespace "%s"',
      async (namespace) => {
        mockApps([{ name: 'demo', root: 'apps/demo' }]);
        addApp(tree, 'demo', {
          k8s: { 'deployment.yaml': deployment('demo', namespace) },
        });

        await expect(syncGenerator(tree)).rejects.toThrow(/invalid namespace/);
      },
    );
  });

  describe('dev stage detection', () => {
    it('sets docker.target when the Dockerfile has a "dev" stage', async () => {
      mockApps([{ name: 'demo', root: 'apps/demo' }]);
      addApp(tree, 'demo', {
        dockerfile: 'FROM node AS base\nFROM base AS dev\n',
      });

      await syncGenerator(tree);

      const config = readConfig(tree, 'skaffold/default.yaml');
      expect(config.build.artifacts[0].docker.target).toBe('dev');
    });

    it('detects a "dev" stage even with flags between FROM and the image', async () => {
      mockApps([{ name: 'demo', root: 'apps/demo' }]);
      addApp(tree, 'demo', {
        dockerfile: 'FROM --platform=linux/amd64 node:24-alpine AS dev\n',
      });

      await syncGenerator(tree);

      const config = readConfig(tree, 'skaffold/default.yaml');
      expect(config.build.artifacts[0].docker.target).toBe('dev');
    });

    it('does not match a stage merely containing "dev" as a substring', async () => {
      mockApps([{ name: 'demo', root: 'apps/demo' }]);
      addApp(tree, 'demo', {
        dockerfile: 'FROM node AS development\n',
      });

      await syncGenerator(tree);

      const config = readConfig(tree, 'skaffold/default.yaml');
      expect(config.build.artifacts[0].docker.target).toBeUndefined();
    });

    it('leaves docker.target unset when there is no "dev" stage', async () => {
      mockApps([{ name: 'demo', root: 'apps/demo' }]);
      addApp(tree, 'demo', { dockerfile: 'FROM node AS base\n' });

      await syncGenerator(tree);

      const config = readConfig(tree, 'skaffold/default.yaml');
      expect(config.build.artifacts[0].docker.target).toBeUndefined();
    });
  });

  describe('production profile', () => {
    it('adds a "production" profile overriding build.artifacts', async () => {
      mockApps([{ name: 'demo', root: 'apps/demo' }]);
      addApp(tree, 'demo', {
        dockerfile: 'FROM node AS base\nFROM base AS dev\n',
      });

      await syncGenerator(tree);

      const config = readConfig(tree, 'skaffold/default.yaml');
      expect(config.build.artifacts[0].docker.target).toBe('dev');
      expect(config.build.artifacts[0].sync).toBeDefined();

      expect(config.profiles).toHaveLength(1);
      const profile = config.profiles[0];
      expect(profile.name).toBe('production');
      expect(profile.build.artifacts[0].image).toBe('demo');
      expect(profile.build.artifacts[0].docker.target).toBeUndefined();
      expect(profile.build.artifacts[0].sync).toBeUndefined();
    });

    it('does not generate a separate file per app or namespace', async () => {
      mockApps([{ name: 'demo', root: 'apps/demo' }]);
      addApp(tree, 'demo', {
        k8s: { 'deployment.yaml': deployment('demo', 'apps') },
      });

      await syncGenerator(tree);

      expect(tree.exists('skaffold/apps.prod.yaml')).toBe(false);
      expect(tree.exists('skaffold/skaffold.prod.yaml')).toBe(false);
    });
  });

  describe('app discovery', () => {
    it('ignores an app whose k8s folder has no yaml files', async () => {
      mockApps([{ name: 'demo', root: 'apps/demo' }]);
      tree.write('apps/demo/Dockerfile', 'FROM node\n');
      tree.write('apps/demo/k8s/.gitkeep', '');

      await syncGenerator(tree);

      expect(tree.exists('skaffold/default.yaml')).toBe(false);
      expect(readConfig(tree, 'skaffold/skaffold.yaml').requires).toEqual([
        { path: 'infra.yaml' },
      ]);
    });

    it('ignores an app with no Dockerfile', async () => {
      mockApps([{ name: 'demo', root: 'apps/demo' }]);
      tree.write('apps/demo/k8s/deployment.yaml', deployment('demo'));

      await syncGenerator(tree);

      expect(tree.exists('skaffold/default.yaml')).toBe(false);
    });

    it('rejects a project name that is not a valid Docker image name', async () => {
      mockApps([{ name: 'My_App', root: 'apps/my-app' }]);
      addApp(tree, 'my-app');

      await expect(syncGenerator(tree)).rejects.toThrow(
        /not a valid Docker image name/,
      );
    });
  });

  describe('Service manifests', () => {
    it('generates a portForward entry per Service port', async () => {
      mockApps([{ name: 'demo', root: 'apps/demo' }]);
      addApp(tree, 'demo', {
        k8s: { 'service.yaml': service('demo', { ports: [{ port: 3000 }] }) },
      });

      await syncGenerator(tree);

      const config = readConfig(tree, 'skaffold/default.yaml');
      expect(config.portForward).toEqual([
        {
          resourceType: 'service',
          resourceName: 'demo',
          namespace: 'default',
          port: 3000,
          localPort: 3000,
        },
      ]);
    });

    it('rejects a Service without metadata.name', async () => {
      mockApps([{ name: 'demo', root: 'apps/demo' }]);
      addApp(tree, 'demo', {
        k8s: {
          'service.yaml': yaml.stringify({
            kind: 'Service',
            metadata: {},
            spec: { ports: [{ port: 3000 }] },
          }),
        },
      });

      await expect(syncGenerator(tree)).rejects.toThrow(
        /missing metadata.name/,
      );
    });

    it('rejects a port entry without a numeric port', async () => {
      mockApps([{ name: 'demo', root: 'apps/demo' }]);
      addApp(tree, 'demo', {
        k8s: { 'service.yaml': service('demo', { ports: [{ name: 'web' }] }) },
      });

      await expect(syncGenerator(tree)).rejects.toThrow(
        /port entry without a numeric "port"/,
      );
    });

    it('handles a Deployment and Service in one multi-document yaml file', async () => {
      mockApps([{ name: 'demo', root: 'apps/demo' }]);
      const combined = [
        deployment('demo', 'apps'),
        service('demo', { ports: [{ port: 3000 }] }, 'apps'),
        '', // trailing "---" produces an empty document
      ].join('---\n');

      addApp(tree, 'demo', { k8s: { 'combined.yaml': combined } });

      await syncGenerator(tree);

      const config = readConfig(tree, 'skaffold/apps.yaml');
      expect(config.deploy.kubectl.defaultNamespace).toBe('apps');
      expect(config.portForward).toEqual([
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

  describe('malformed yaml', () => {
    it('rejects a k8s manifest that fails to parse', async () => {
      mockApps([{ name: 'demo', root: 'apps/demo' }]);
      addApp(tree, 'demo', {
        k8s: { 'bad.yaml': 'foo: [unterminated\n  bar: baz' },
      });

      await expect(syncGenerator(tree)).rejects.toThrow(/Failed to parse/);
    });
  });

  describe('stale file pruning', () => {
    it('removes a previously generated namespace file once nothing references it anymore', async () => {
      mockApps([{ name: 'demo', root: 'apps/demo' }]);
      addApp(tree, 'demo', {
        k8s: { 'deployment.yaml': deployment('demo', 'staging') },
      });
      await syncGenerator(tree);
      expect(tree.exists('skaffold/staging.yaml')).toBe(true);

      tree.write(
        'apps/demo/k8s/deployment.yaml',
        deployment('demo', 'production'),
      );
      await syncGenerator(tree);

      expect(tree.exists('skaffold/staging.yaml')).toBe(false);
      expect(tree.exists('skaffold/staging-namespace.yaml')).toBe(false);
      expect(tree.exists('skaffold/production.yaml')).toBe(true);
      expect(readConfig(tree, 'skaffold/skaffold.yaml').requires).toEqual([
        { path: 'infra.yaml' },
        { path: 'production.yaml' },
      ]);
    });

    it('never deletes a hand-authored file lacking the generated marker', async () => {
      mockApps([{ name: 'demo', root: 'apps/demo' }]);
      tree.write('skaffold/custom.yaml', 'kind: Config\n');
      addApp(tree, 'demo');

      await syncGenerator(tree);

      expect(tree.exists('skaffold/custom.yaml')).toBe(true);
    });
  });

  describe('deterministic output', () => {
    it('sorts apps by name regardless of project graph order', async () => {
      mockApps([
        { name: 'zeta', root: 'apps/zeta' },
        { name: 'alpha', root: 'apps/alpha' },
      ]);
      addApp(tree, 'zeta');
      addApp(tree, 'alpha');

      await syncGenerator(tree);

      const config = readConfig(tree, 'skaffold/default.yaml');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect(config.build.artifacts.map((a: any) => a.image)).toEqual([
        'alpha',
        'zeta',
      ]);
    });
  });
});
