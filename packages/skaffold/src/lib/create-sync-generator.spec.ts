import { vi } from 'vitest';
import { createTreeWithEmptyWorkspace } from '@nx/devkit/testing';
import { Tree, createProjectGraphAsync } from '@nx/devkit';
import * as yaml from 'yaml';

import { createSkaffoldSyncGenerator } from './create-sync-generator.ts';
import { fakeAdapter } from '../testing/fake-adapter.ts';

// createProjectGraphAsync reads the real, on-disk project graph and is not
// influenced by the in-memory test Tree at all (addProjectConfiguration has no
// effect on it), so it must be mocked to test against fake apps in isolation.
vi.mock('@nx/devkit', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@nx/devkit')>();
  return { ...actual, createProjectGraphAsync: vi.fn() };
});

function mockGraph(
  nodes: { name: string; type?: 'app' | 'lib'; root: string }[],
  dependencies: Record<string, { target: string }[]> = {},
) {
  vi.mocked(createProjectGraphAsync).mockResolvedValue({
    nodes: Object.fromEntries(
      nodes.map((node) => [
        node.name,
        {
          name: node.name,
          type: node.type ?? 'app',
          data: { root: node.root },
        },
      ]),
    ),
    dependencies: Object.fromEntries(
      Object.entries(dependencies).map(([source, edges]) => [
        source,
        edges.map((edge) => ({
          source,
          target: edge.target,
          type: 'static' as const,
        })),
      ]),
    ),
  } as never);
}

function mockApps(apps: { name: string; root: string }[]) {
  mockGraph(apps);
}

function addApp(
  tree: Tree,
  name: string,
  options: { k8s?: Record<string, string> } = {},
): string {
  const root = `apps/${name}`;

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

describe('createSkaffoldSyncGenerator', () => {
  let tree: Tree;

  beforeEach(() => {
    tree = createTreeWithEmptyWorkspace();
  });

  it('generates a top-level skaffold.yaml with no requires when there are no apps', async () => {
    mockApps([]);
    const syncGenerator = createSkaffoldSyncGenerator([fakeAdapter()]);

    await syncGenerator(tree);

    expect(tree.exists('skaffold/skaffold.yaml')).toBe(true);
    expect(tree.exists('skaffold/default.yaml')).toBe(false);
    expect(readConfig(tree, 'skaffold/skaffold.yaml').requires).toBeUndefined();
  });

  describe('namespace assignment', () => {
    it('puts an app with no declared namespace into default.yaml', async () => {
      mockApps([{ name: 'demo', root: 'apps/demo' }]);
      addApp(tree, 'demo');
      const syncGenerator = createSkaffoldSyncGenerator([fakeAdapter()]);

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
      const syncGenerator = createSkaffoldSyncGenerator([fakeAdapter()]);

      await syncGenerator(tree);

      expect(tree.exists('skaffold/apps.yaml')).toBe(true);
      expect(tree.exists('skaffold/apps-namespace.yaml')).toBe(true);

      expect(readConfig(tree, 'skaffold/skaffold.yaml').requires).toEqual([
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
      const syncGenerator = createSkaffoldSyncGenerator([fakeAdapter()]);

      await syncGenerator(tree);

      expect(tree.exists('skaffold/apps.yaml')).toBe(true);
      expect(tree.exists('skaffold/examples.yaml')).toBe(false);

      const config = readConfig(tree, 'skaffold/apps.yaml');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect(config.build.artifacts.map((a: any) => a.image)).toEqual([
        'demo',
        'example',
      ]);
    });
  });

  describe('adapter-driven Dockerfile generation', () => {
    it('writes the Dockerfile an activated adapter builds', async () => {
      mockApps([{ name: 'demo', root: 'apps/demo' }]);
      addApp(tree, 'demo');
      const buildDockerfile = vi.fn(() => 'FROM scratch AS dev\n');
      const syncGenerator = createSkaffoldSyncGenerator([
        fakeAdapter({ buildDockerfile }),
      ]);

      await syncGenerator(tree);

      expect(tree.read('apps/demo/Dockerfile', 'utf-8')).toBe(
        'FROM scratch AS dev\n',
      );
      expect(buildDockerfile).toHaveBeenCalledWith(
        { name: 'demo', root: 'apps/demo' },
        [],
      );
    });

    it('does not compute or pass dependencies for an app no adapter activated for', async () => {
      mockGraph(
        [
          { name: 'demo', root: 'apps/demo' },
          { name: 'shared-ui', type: 'lib', root: 'packages/shared-ui' },
        ],
        { demo: [{ target: 'shared-ui' }] },
      );
      addApp(tree, 'demo');
      tree.write('apps/demo/Dockerfile', 'FROM node:24-alpine AS dev\n');
      const getDependencySyncPaths = vi.fn(() => []);
      const syncGenerator = createSkaffoldSyncGenerator([
        fakeAdapter({ activates: () => false, getDependencySyncPaths }),
      ]);

      await syncGenerator(tree);

      // the hand-written Dockerfile is left untouched
      expect(tree.read('apps/demo/Dockerfile', 'utf-8')).toBe(
        'FROM node:24-alpine AS dev\n',
      );
      expect(getDependencySyncPaths).not.toHaveBeenCalled();

      const config = readConfig(tree, 'skaffold/default.yaml');
      expect(config.build.artifacts[0].sync.manual).toEqual([
        { src: 'apps/demo/src/**/*', dest: '.' },
        { src: 'apps/demo/public/**/*', dest: '.' },
      ]);
    });

    it('never rewrites a hand-written Dockerfile for an app no adapter activated for', async () => {
      mockApps([{ name: 'demo', root: 'apps/demo' }]);
      addApp(tree, 'demo');
      const handWritten = 'FROM node:24-alpine AS dev\n';
      tree.write('apps/demo/Dockerfile', handWritten);
      const syncGenerator = createSkaffoldSyncGenerator([
        fakeAdapter({ activates: () => false }),
      ]);

      await syncGenerator(tree);

      expect(tree.read('apps/demo/Dockerfile', 'utf-8')).toBe(handWritten);
    });

    it('removes a generated Dockerfile once the app stops qualifying', async () => {
      mockApps([{ name: 'demo', root: 'apps/demo' }]);
      addApp(tree, 'demo');
      const syncGenerator = createSkaffoldSyncGenerator([fakeAdapter()]);
      await syncGenerator(tree);
      expect(tree.exists('apps/demo/Dockerfile')).toBe(true);

      tree.delete('apps/demo/k8s/deployment.yaml');
      tree.write('apps/demo/k8s/.gitkeep', '');
      await syncGenerator(tree);

      expect(tree.exists('apps/demo/Dockerfile')).toBe(false);
    });
  });

  describe('syncFrameworkConfig', () => {
    it('is called for an app the adapter activated for', async () => {
      mockApps([{ name: 'demo', root: 'apps/demo' }]);
      addApp(tree, 'demo');
      const syncFrameworkConfig = vi.fn();
      const syncGenerator = createSkaffoldSyncGenerator([
        fakeAdapter({ syncFrameworkConfig }),
      ]);

      await syncGenerator(tree);

      expect(syncFrameworkConfig).toHaveBeenCalledWith(tree, {
        name: 'demo',
        root: 'apps/demo',
      });
    });

    it('is never called for an app the adapter did not activate for', async () => {
      mockApps([{ name: 'demo', root: 'apps/demo' }]);
      addApp(tree, 'demo');
      tree.write('apps/demo/Dockerfile', 'FROM node:24-alpine AS dev\n');
      const syncFrameworkConfig = vi.fn();
      const syncGenerator = createSkaffoldSyncGenerator([
        fakeAdapter({ activates: () => false, syncFrameworkConfig }),
      ]);

      await syncGenerator(tree);

      expect(syncFrameworkConfig).not.toHaveBeenCalled();
    });
  });

  describe('multiple adapters', () => {
    it('fails clearly when more than one adapter activates for the same app', async () => {
      mockApps([{ name: 'demo', root: 'apps/demo' }]);
      addApp(tree, 'demo');
      const syncGenerator = createSkaffoldSyncGenerator([
        fakeAdapter({ name: 'first' }),
        fakeAdapter({ name: 'second' }),
      ]);

      await expect(syncGenerator(tree)).rejects.toThrow(
        /recognized by more than one framework adapter/,
      );
    });
  });

  describe('production profile', () => {
    it('does not generate a separate file per app or namespace', async () => {
      mockApps([{ name: 'demo', root: 'apps/demo' }]);
      addApp(tree, 'demo', {
        k8s: { 'deployment.yaml': deployment('demo', 'apps') },
      });
      const syncGenerator = createSkaffoldSyncGenerator([fakeAdapter()]);

      await syncGenerator(tree);

      expect(tree.exists('skaffold/apps.prod.yaml')).toBe(false);
      expect(tree.exists('skaffold/skaffold.prod.yaml')).toBe(false);
    });
  });

  describe('stale file pruning', () => {
    it('removes a previously generated namespace file once nothing references it anymore', async () => {
      mockApps([{ name: 'demo', root: 'apps/demo' }]);
      addApp(tree, 'demo', {
        k8s: { 'deployment.yaml': deployment('demo', 'staging') },
      });
      const syncGenerator = createSkaffoldSyncGenerator([fakeAdapter()]);
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
        { path: 'production.yaml' },
      ]);
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
      const syncGenerator = createSkaffoldSyncGenerator([fakeAdapter()]);

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
