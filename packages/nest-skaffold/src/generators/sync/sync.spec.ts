import { vi } from 'vitest';
import { createTreeWithEmptyWorkspace } from '@nx/devkit/testing';
import { Tree, createProjectGraphAsync } from '@nx/devkit';
import * as yaml from 'yaml';

import { syncGenerator } from './sync';

// createProjectGraphAsync reads the real, on-disk project graph and is not
// influenced by the in-memory test Tree at all (addProjectConfiguration has
// no effect on it), so it must be mocked to test against fake apps in
// isolation. See @dx-stack/skaffold's own create-sync-generator.spec.ts for
// the framework-agnostic behavior this composes with (namespaces, port
// forwarding, pruning, ...) — these tests only cover that the Nest.js
// adapter and the core generator actually wire together correctly.
vi.mock('@nx/devkit', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@nx/devkit')>();
  return { ...actual, createProjectGraphAsync: vi.fn() };
});

function mockApps(apps: { name: string; root: string }[]) {
  vi.mocked(createProjectGraphAsync).mockResolvedValue({
    nodes: Object.fromEntries(
      apps.map((app) => [
        app.name,
        { name: app.name, type: 'app', data: { root: app.root } },
      ]),
    ),
    dependencies: {},
  } as never);
}

describe('sync generator (end-to-end)', () => {
  let tree: Tree;

  beforeEach(() => {
    tree = createTreeWithEmptyWorkspace();
  });

  it('generates a Dockerfile for a Nest.js app', async () => {
    mockApps([{ name: 'svc', root: 'apps/svc' }]);
    tree.write(
      'apps/svc/k8s/deployment.yaml',
      yaml.stringify({
        apiVersion: 'apps/v1',
        kind: 'Deployment',
        metadata: { name: 'svc' },
      }),
    );
    tree.write(
      'apps/svc/package.json',
      JSON.stringify({ dependencies: { '@nestjs/core': '^11.0.0' } }),
    );

    await syncGenerator(tree);

    const dockerfile = tree.read('apps/svc/Dockerfile', 'utf-8');
    expect(dockerfile).toContain('FROM source AS dev');
    expect(dockerfile).toContain('FROM base AS runner');

    const config = yaml.parse(
      tree.read('skaffold/default.yaml', 'utf-8') as string,
    );
    expect(config.build.artifacts[0].image).toBe('svc');
    expect(config.build.artifacts[0].docker.target).toBe('dev');
  });

  it('leaves an unrecognized-framework app with a hand-written Dockerfile alone', async () => {
    mockApps([{ name: 'svc', root: 'apps/svc' }]);
    tree.write(
      'apps/svc/k8s/deployment.yaml',
      yaml.stringify({
        apiVersion: 'apps/v1',
        kind: 'Deployment',
        metadata: { name: 'svc' },
      }),
    );
    tree.write(
      'apps/svc/package.json',
      JSON.stringify({ dependencies: { express: '^4.0.0' } }),
    );
    const handWritten = '# syntax=docker/dockerfile:1\nFROM node:24-alpine\n';
    tree.write('apps/svc/Dockerfile', handWritten);

    await syncGenerator(tree);

    expect(tree.read('apps/svc/Dockerfile', 'utf-8')).toBe(handWritten);
  });

  it('ignores an app with no k8s folder', async () => {
    mockApps([{ name: 'svc', root: 'apps/svc' }]);
    tree.write(
      'apps/svc/package.json',
      JSON.stringify({ dependencies: { '@nestjs/core': '^11.0.0' } }),
    );

    await syncGenerator(tree);

    expect(tree.exists('apps/svc/Dockerfile')).toBe(false);
    expect(tree.exists('skaffold/default.yaml')).toBe(false);
  });
});
