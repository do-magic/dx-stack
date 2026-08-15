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
  });
}

function mockApps(apps: { name: string; root: string }[]) {
  mockGraph(apps);
}

function addApp(
  tree: Tree,
  name: string,
  options: {
    k8s?: Record<string, string>;
    packageJson?: Record<string, unknown> | null;
  } = {},
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

  // matches every real app in this workspace: a Next.js app, detected via a
  // "next" dependency. Pass packageJson: null to omit it entirely.
  const packageJson =
    options.packageJson === null
      ? null
      : (options.packageJson ?? { dependencies: { next: '~16.1.6' } });
  if (packageJson) {
    tree.write(`${root}/package.json`, JSON.stringify(packageJson));
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

function readDockerfile(tree: Tree, root: string): string {
  const content = tree.read(`${root}/Dockerfile`, 'utf-8');
  if (!content) {
    throw new Error(`${root}/Dockerfile was not written`);
  }
  return content;
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

  it('generates a top-level skaffold.yaml with no requires when there are no apps', async () => {
    mockApps([]);

    await syncGenerator(tree);

    expect(tree.exists('skaffold/skaffold.yaml')).toBe(true);
    expect(tree.exists('skaffold/default.yaml')).toBe(false);
    expect(readConfig(tree, 'skaffold/skaffold.yaml').requires).toBeUndefined();
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

  describe('Dockerfile generation', () => {
    it('generates a Dockerfile with the expected stages, with no pre-existing file', async () => {
      mockApps([{ name: 'demo', root: 'apps/demo' }]);
      addApp(tree, 'demo');

      expect(tree.exists('apps/demo/Dockerfile')).toBe(false);

      await syncGenerator(tree);

      const dockerfile = readDockerfile(tree, 'apps/demo');
      expect(dockerfile).toMatch(/^FROM node:24-alpine@sha256:[a-f0-9]{64} AS base$/m);
      expect(dockerfile).toContain('FROM base AS deps');
      expect(dockerfile).toContain('FROM deps AS source');
      expect(dockerfile).toContain('FROM source AS builder');
      expect(dockerfile).toContain('FROM source AS dev');
      expect(dockerfile).toContain('FROM base AS runner');
      expect(dockerfile).toContain(
        'COPY apps/demo/package.json apps/demo/package.json',
      );
      expect(dockerfile).toContain('COPY apps/demo apps/demo');
      expect(dockerfile).toContain('nx build demo --skip-sync');
      expect(dockerfile).toContain('"nx", "dev", "demo", "--skip-sync"');
      expect(dockerfile).toContain('ENV HOSTNAME="0.0.0.0"');
      expect(dockerfile).toContain('ENV NEXT_TELEMETRY_DISABLED=1');
      expect(dockerfile).toContain(
        '--mount=type=cache,id=next-demo,target=/workspace/apps/demo/.next/cache',
      );
    });

    it('places the marker comment after the syntax directive, never before it', async () => {
      mockApps([{ name: 'demo', root: 'apps/demo' }]);
      addApp(tree, 'demo');

      await syncGenerator(tree);

      const lines = readDockerfile(tree, 'apps/demo').split('\n');
      expect(lines[0]).toBe('# syntax=docker/dockerfile:1');
      expect(lines[1]).toContain('Generated by @dxs/skaffold:sync');
    });

    it('copies package.json and source for an explicit or implicit workspace dependency', async () => {
      mockGraph(
        [
          { name: 'demo', root: 'apps/demo' },
          { name: 'shared-ui', type: 'lib', root: 'packages/shared-ui' },
        ],
        { demo: [{ target: 'shared-ui' }] },
      );
      addApp(tree, 'demo');

      await syncGenerator(tree);

      const dockerfile = readDockerfile(tree, 'apps/demo');
      expect(dockerfile).toContain(
        'COPY packages/shared-ui/package.json packages/shared-ui/package.json',
      );
      expect(dockerfile).toContain(
        'COPY packages/shared-ui packages/shared-ui',
      );
    });

    it('also live-syncs a workspace dependency\'s source, not just src/ and public/ of the app itself', async () => {
      mockGraph(
        [
          { name: 'demo', root: 'apps/demo' },
          { name: 'shared-ui', type: 'lib', root: 'packages/shared-ui' },
        ],
        { demo: [{ target: 'shared-ui' }] },
      );
      addApp(tree, 'demo');

      await syncGenerator(tree);

      const config = readConfig(tree, 'skaffold/default.yaml');
      expect(config.build.artifacts[0].sync.manual).toEqual(
        expect.arrayContaining([
          { src: 'packages/shared-ui/src/**/*', dest: '.' },
        ]),
      );
    });

    it('does not add dependency sync entries for an unrecognized-framework app with a hand-written Dockerfile', async () => {
      mockGraph(
        [
          { name: 'demo', root: 'apps/demo' },
          { name: 'shared-ui', type: 'lib', root: 'packages/shared-ui' },
        ],
        { demo: [{ target: 'shared-ui' }] },
      );
      addApp(tree, 'demo', {
        packageJson: { dependencies: { express: '^4.0.0' } },
      });
      tree.write(
        'apps/demo/Dockerfile',
        '# syntax=docker/dockerfile:1\nFROM node:24-alpine\n',
      );

      await syncGenerator(tree);

      const config = readConfig(tree, 'skaffold/default.yaml');
      expect(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        config.build.artifacts[0].sync.manual.some((entry: any) =>
          entry.src.startsWith('packages/shared-ui'),
        ),
      ).toBe(false);
    });

    it('follows transitive dependencies', async () => {
      mockGraph(
        [
          { name: 'demo', root: 'apps/demo' },
          { name: 'a', type: 'lib', root: 'packages/a' },
          { name: 'b', type: 'lib', root: 'packages/b' },
        ],
        { demo: [{ target: 'a' }], a: [{ target: 'b' }] },
      );
      addApp(tree, 'demo');

      await syncGenerator(tree);

      const dockerfile = readDockerfile(tree, 'apps/demo');
      expect(dockerfile).toContain('COPY packages/a packages/a');
      expect(dockerfile).toContain('COPY packages/b packages/b');
    });

    it('excludes external (npm:) dependencies from the copy lists', async () => {
      mockGraph([{ name: 'demo', root: 'apps/demo' }], {
        demo: [{ target: 'npm:react' }],
      });
      addApp(tree, 'demo');

      await syncGenerator(tree);

      const dockerfile = readDockerfile(tree, 'apps/demo');
      expect(dockerfile).not.toContain('npm:');
    });

    it('removes a generated Dockerfile once the app stops qualifying', async () => {
      mockApps([{ name: 'demo', root: 'apps/demo' }]);
      addApp(tree, 'demo');
      await syncGenerator(tree);
      expect(tree.exists('apps/demo/Dockerfile')).toBe(true);

      tree.delete('apps/demo/k8s/deployment.yaml');
      tree.write('apps/demo/k8s/.gitkeep', '');
      await syncGenerator(tree);

      expect(tree.exists('apps/demo/Dockerfile')).toBe(false);
    });
  });

  describe('production profile', () => {
    it('adds a "production" profile overriding build.artifacts', async () => {
      mockApps([{ name: 'demo', root: 'apps/demo' }]);
      addApp(tree, 'demo');

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

  describe('framework detection', () => {
    it('detects Next.js via a "next" dependency and generates its Dockerfile', async () => {
      mockApps([{ name: 'demo', root: 'apps/demo' }]);
      addApp(tree, 'demo');

      await syncGenerator(tree);

      expect(readDockerfile(tree, 'apps/demo')).toContain(
        'nx build demo --skip-sync',
      );
    });

    it('detects Next.js via a devDependency too', async () => {
      mockApps([{ name: 'demo', root: 'apps/demo' }]);
      addApp(tree, 'demo', {
        packageJson: { devDependencies: { next: '~16.1.6' } },
      });

      await syncGenerator(tree);

      expect(tree.exists('apps/demo/Dockerfile')).toBe(true);
    });

    it('excludes an app with no package.json and no existing Dockerfile', async () => {
      mockApps([{ name: 'demo', root: 'apps/demo' }]);
      addApp(tree, 'demo', { packageJson: null });

      await syncGenerator(tree);

      expect(tree.exists('skaffold/default.yaml')).toBe(false);
      expect(
        readConfig(tree, 'skaffold/skaffold.yaml').requires,
      ).toBeUndefined();
    });

    it('excludes an app with an unrecognized framework and no existing Dockerfile', async () => {
      mockApps([{ name: 'demo', root: 'apps/demo' }]);
      addApp(tree, 'demo', {
        packageJson: { dependencies: { express: '^4.0.0' } },
      });

      await syncGenerator(tree);

      expect(tree.exists('skaffold/default.yaml')).toBe(false);
      expect(
        readConfig(tree, 'skaffold/skaffold.yaml').requires,
      ).toBeUndefined();
    });

    it('includes an app with an unrecognized framework if it already has a Dockerfile, and never touches it', async () => {
      mockApps([{ name: 'demo', root: 'apps/demo' }]);
      addApp(tree, 'demo', {
        packageJson: { dependencies: { express: '^4.0.0' } },
      });
      const handWritten = '# syntax=docker/dockerfile:1\nFROM node:24-alpine\n';
      tree.write('apps/demo/Dockerfile', handWritten);

      await syncGenerator(tree);

      expect(tree.read('apps/demo/Dockerfile', 'utf-8')).toBe(handWritten);
      const config = readConfig(tree, 'skaffold/default.yaml');
      expect(config.build.artifacts[0].image).toBe('demo');
      expect(config.build.artifacts[0].docker.dockerfile).toBe(
        'apps/demo/Dockerfile',
      );
    });

    it('does not set docker.target for a hand-written Dockerfile with no "dev" stage', async () => {
      mockApps([{ name: 'demo', root: 'apps/demo' }]);
      addApp(tree, 'demo', {
        packageJson: { dependencies: { express: '^4.0.0' } },
      });
      tree.write(
        'apps/demo/Dockerfile',
        '# syntax=docker/dockerfile:1\nFROM node:24-alpine\n',
      );

      await syncGenerator(tree);

      const config = readConfig(tree, 'skaffold/default.yaml');
      expect(config.build.artifacts[0].docker.target).toBeUndefined();
    });

    it('sets docker.target to "dev" for a hand-written Dockerfile that declares a "dev" stage', async () => {
      mockApps([{ name: 'demo', root: 'apps/demo' }]);
      addApp(tree, 'demo', {
        packageJson: { dependencies: { express: '^4.0.0' } },
      });
      tree.write(
        'apps/demo/Dockerfile',
        '# syntax=docker/dockerfile:1\nFROM node:24-alpine AS base\nFROM base AS dev\n',
      );

      await syncGenerator(tree);

      const config = readConfig(tree, 'skaffold/default.yaml');
      expect(config.build.artifacts[0].docker.target).toBe('dev');
    });

    it('never deletes a hand-written Dockerfile even after the app stops qualifying', async () => {
      mockApps([{ name: 'demo', root: 'apps/demo' }]);
      addApp(tree, 'demo', {
        packageJson: { dependencies: { express: '^4.0.0' } },
      });
      const handWritten = '# syntax=docker/dockerfile:1\nFROM node:24-alpine\n';
      tree.write('apps/demo/Dockerfile', handWritten);
      await syncGenerator(tree);

      tree.delete('apps/demo/k8s/deployment.yaml');
      tree.write('apps/demo/k8s/.gitkeep', '');
      await syncGenerator(tree);

      expect(tree.read('apps/demo/Dockerfile', 'utf-8')).toBe(handWritten);
    });
  });

  describe('app discovery', () => {
    it('ignores an app whose k8s folder has no yaml files', async () => {
      mockApps([{ name: 'demo', root: 'apps/demo' }]);
      tree.write('apps/demo/k8s/.gitkeep', '');

      await syncGenerator(tree);

      expect(tree.exists('skaffold/default.yaml')).toBe(false);
      expect(tree.exists('apps/demo/Dockerfile')).toBe(false);
      expect(
        readConfig(tree, 'skaffold/skaffold.yaml').requires,
      ).toBeUndefined();
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
