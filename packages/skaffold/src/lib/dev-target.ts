import { Tree, joinPathFragments } from '@nx/devkit';
import type { WorkspaceApp } from './framework-adapter.ts';

// stage name skaffold's dev-loop build targets. An adapter-built Dockerfile
// always has one by construction (a hard requirement of the FrameworkAdapter
// contract — see buildDockerfile's doc comment); a hand-written Dockerfile
// for an app no adapter activated for only gets `docker.target: dev` set if
// it actually declares a stage named that — otherwise `docker build
// --target dev` would fail outright with an unknown-stage error.
const DEV_STAGE_PATTERN = /^FROM\s+\S+\s+AS\s+dev\s*$/im;

export function getDevTarget(
  tree: Tree,
  app: WorkspaceApp,
  activated: boolean,
): string | undefined {
  if (activated) {
    return 'dev';
  }

  const dockerfilePath = joinPathFragments(app.root, 'Dockerfile');
  const content = tree.read(dockerfilePath, 'utf-8') ?? '';
  return DEV_STAGE_PATTERN.test(content) ? 'dev' : undefined;
}
