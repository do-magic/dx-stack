import {
  GENERATED_FILE_MARKER,
  type FrameworkAdapter,
} from '../lib/framework-adapter';

// a minimal, always-activating FrameworkAdapter for testing the
// framework-agnostic orchestration in isolation, without depending on any
// real framework package. Its Dockerfile intentionally satisfies the
// contract (a `dev` stage, the generated-file marker) so core's own
// dev-target/pruning logic behaves exactly as it would for a real adapter.
export function fakeAdapter(
  overrides: Partial<FrameworkAdapter> = {},
): FrameworkAdapter {
  return {
    name: 'fake',
    activates: () => true,
    buildDockerfile: () =>
      `# syntax=docker/dockerfile:1\n${GENERATED_FILE_MARKER}FROM scratch AS dev\n`,
    getDependencySyncPaths: (dependencies) =>
      dependencies.map((dependency) => ({
        src: `${dependency.root}/src/**/*`,
        dest: '.',
      })),
    ...overrides,
  };
}
