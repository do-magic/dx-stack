import type { ProjectGraph } from '@nx/devkit';
import { getBuildOutputDir } from './build-output';

function graphWithOutputs(name: string, outputs: string[]): ProjectGraph {
  return {
    nodes: {
      [name]: {
        name,
        type: 'app',
        data: { root: `apps/${name}`, targets: { build: { outputs } } },
      },
    },
    dependencies: {},
  } as unknown as ProjectGraph;
}

describe('getBuildOutputDir', () => {
  it('strips the {workspaceRoot} token from a literal output path', () => {
    const graph = graphWithOutputs('svc', ['{workspaceRoot}/apps/svc/dist']);

    expect(getBuildOutputDir(graph, { name: 'svc', root: 'apps/svc' })).toBe(
      'apps/svc/dist',
    );
  });

  it('strips a glob suffix down to the real output directory', () => {
    const graph = graphWithOutputs('demo', [
      '{workspaceRoot}/apps/demo/.next/!(cache)/**/*',
    ]);

    expect(getBuildOutputDir(graph, { name: 'demo', root: 'apps/demo' })).toBe(
      'apps/demo/.next',
    );
  });

  it('respects a custom output directory, not just the framework default', () => {
    const graph = graphWithOutputs('svc', ['{workspaceRoot}/apps/svc/build']);

    expect(getBuildOutputDir(graph, { name: 'svc', root: 'apps/svc' })).toBe(
      'apps/svc/build',
    );
  });

  it('throws a clear error when the app has no "build" target outputs', () => {
    const graph: ProjectGraph = {
      nodes: {
        svc: { name: 'svc', type: 'app', data: { root: 'apps/svc' } },
      },
      dependencies: {},
    } as unknown as ProjectGraph;

    expect(() =>
      getBuildOutputDir(graph, { name: 'svc', root: 'apps/svc' }),
    ).toThrow(/has no "build" target output configured/);
  });
});
