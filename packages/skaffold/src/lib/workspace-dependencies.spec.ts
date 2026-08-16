import type { ProjectGraph } from '@nx/devkit';

import { getWorkspaceDependencies } from './workspace-dependencies';

function graph(
  nodes: { name: string; root: string }[],
  dependencies: Record<string, string[]> = {},
): ProjectGraph {
  return {
    nodes: Object.fromEntries(
      nodes.map((node) => [
        node.name,
        { name: node.name, type: 'lib', data: { root: node.root } },
      ]),
    ),
    dependencies: Object.fromEntries(
      Object.entries(dependencies).map(([source, targets]) => [
        source,
        targets.map((target) => ({
          source,
          target,
          type: 'static' as const,
        })),
      ]),
    ),
  } as ProjectGraph;
}

describe('getWorkspaceDependencies', () => {
  it('copies package.json and source for an explicit or implicit workspace dependency', () => {
    const g = graph(
      [
        { name: 'demo', root: 'apps/demo' },
        { name: 'shared-ui', root: 'packages/shared-ui' },
      ],
      { demo: ['shared-ui'] },
    );

    expect(getWorkspaceDependencies(g, 'demo')).toEqual([
      { name: 'shared-ui', root: 'packages/shared-ui' },
    ]);
  });

  it('follows transitive dependencies', () => {
    const g = graph(
      [
        { name: 'demo', root: 'apps/demo' },
        { name: 'a', root: 'packages/a' },
        { name: 'b', root: 'packages/b' },
      ],
      { demo: ['a'], a: ['b'] },
    );

    expect(getWorkspaceDependencies(g, 'demo').map((d) => d.name)).toEqual([
      'a',
      'b',
    ]);
  });

  it('excludes external (npm:) dependencies from the copy lists', () => {
    const g = graph([{ name: 'demo', root: 'apps/demo' }], {
      demo: ['npm:react'],
    });

    expect(getWorkspaceDependencies(g, 'demo')).toEqual([]);
  });

  it('sorts results by name for deterministic output', () => {
    const g = graph(
      [
        { name: 'demo', root: 'apps/demo' },
        { name: 'zeta', root: 'packages/zeta' },
        { name: 'alpha', root: 'packages/alpha' },
      ],
      { demo: ['zeta', 'alpha'] },
    );

    expect(getWorkspaceDependencies(g, 'demo').map((d) => d.name)).toEqual([
      'alpha',
      'zeta',
    ]);
  });
});
