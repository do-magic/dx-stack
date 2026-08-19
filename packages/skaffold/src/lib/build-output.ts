import type { ProjectGraph } from '@nx/devkit';
import { SyncError } from 'nx/src/utils/sync-generators';
import type { WorkspaceApp } from './framework-adapter';

// characters that only ever appear in Nx's own inferred `outputs` glob
// patterns (e.g. Next.js: "{workspaceRoot}/apps/demo/.next/!(cache)/**/*") -
// a path segment containing any of these isn't a real directory, so
// everything from the first one onward is dropped to recover the actual
// output root the build writes to.
const GLOB_CHARS = /[*?{}()!]/;

// the app's own "build" target is the single source of truth for where its
// build actually writes output - Nx's own webpack/Next.js inference plugins
// already populate this from the real, independently-configurable setting
// (webpack's own `output.path`, Next's `distDir`), confirmed directly via
// `nx show project <app> --json`. Reusing it beats assuming a framework's
// conventional default directory name, which can silently diverge from it.
export function getBuildOutputDir(
  graph: ProjectGraph,
  app: WorkspaceApp,
): string {
  const output = graph.nodes[app.name]?.data.targets?.build?.outputs?.[0];

  if (!output) {
    throw new SyncError(
      `App "${app.name}" has no "build" target output configured`,
      [
        `@dx-stack/skaffold needs to know where "${app.name}"'s build`,
        `actually writes its output (e.g. a custom webpack "output.path" or`,
        `Next.js "distDir") to generate a correct Dockerfile.`,
        `Add an "outputs" entry (or an "outputPath"/"outputDir" option) to`,
        `its "build" target.`,
      ],
    );
  }

  const relative = output.replace(/^\{workspaceRoot\}\/?/, '');
  const segments: string[] = [];
  for (const segment of relative.split('/')) {
    if (GLOB_CHARS.test(segment)) {
      break;
    }
    segments.push(segment);
  }
  return segments.join('/');
}
