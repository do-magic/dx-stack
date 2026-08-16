import type { ProjectGraph } from '@nx/devkit';
import type { WorkspaceDependency } from './framework-adapter.ts';

// transitive closure of an app's workspace-internal dependencies, both
// explicit (detected imports, TS project references) and implicit
// (`implicitDependencies` in project.json) — Nx's own graph doesn't
// distinguish these in a way that matters here, so every edge is followed.
// npm: external packages have no node in the graph and are skipped, since
// pnpm installs those on its own from the lockfile.
export function getWorkspaceDependencies(
  graph: ProjectGraph,
  projectName: string,
): WorkspaceDependency[] {
  const visited = new Set<string>([projectName]);
  const queue = [projectName];
  const dependencies: WorkspaceDependency[] = [];

  while (queue.length > 0) {
    const current = queue.shift() as string;

    for (const edge of graph.dependencies[current] ?? []) {
      if (visited.has(edge.target)) {
        continue;
      }
      visited.add(edge.target);

      const node = graph.nodes[edge.target];
      if (!node) {
        continue;
      }

      dependencies.push({ name: edge.target, root: node.data.root });
      queue.push(edge.target);
    }
  }

  return dependencies.sort((a, b) => a.name.localeCompare(b.name));
}
