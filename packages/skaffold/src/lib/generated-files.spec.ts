import { createTreeWithEmptyWorkspace } from '@nx/devkit/testing';
import { Tree } from '@nx/devkit';

import { GENERATED_FILE_MARKER } from './framework-adapter';
import {
  createWriter,
  pruneStaleDockerfiles,
  pruneStaleSkaffoldFiles,
} from './generated-files';

describe('createWriter', () => {
  it('writes the given content to the tree', () => {
    const tree = createTreeWithEmptyWorkspace();
    const write = createWriter(tree);

    write('skaffold/skaffold.yaml', 'content');

    expect(tree.read('skaffold/skaffold.yaml', 'utf-8')).toBe('content');
  });

  it('rejects writing the same path twice', () => {
    const tree = createTreeWithEmptyWorkspace();
    const write = createWriter(tree);

    write('skaffold/apps.yaml', 'first');

    expect(() => write('skaffold/apps.yaml', 'second')).toThrow(
      /would be written more than once/,
    );
  });
});

describe('pruneStaleSkaffoldFiles', () => {
  let tree: Tree;

  beforeEach(() => {
    tree = createTreeWithEmptyWorkspace();
  });

  it('deletes a marked file that is no longer expected', () => {
    tree.write(
      'skaffold/staging.yaml',
      GENERATED_FILE_MARKER + 'kind: Config\n',
    );

    pruneStaleSkaffoldFiles(tree, new Set(['skaffold.yaml']));

    expect(tree.exists('skaffold/staging.yaml')).toBe(false);
  });

  it('never deletes a hand-authored file lacking the generated marker', () => {
    tree.write('skaffold/custom.yaml', 'kind: Config\n');

    pruneStaleSkaffoldFiles(tree, new Set(['skaffold.yaml']));

    expect(tree.exists('skaffold/custom.yaml')).toBe(true);
  });

  it('leaves infra.yaml alone even though it is never in expectedFiles', () => {
    tree.write('skaffold/infra.yaml', GENERATED_FILE_MARKER + 'kind: Config\n');

    pruneStaleSkaffoldFiles(tree, new Set(['skaffold.yaml']));

    expect(tree.exists('skaffold/infra.yaml')).toBe(true);
  });

  it('leaves an expected marked file alone', () => {
    tree.write('skaffold/apps.yaml', GENERATED_FILE_MARKER + 'kind: Config\n');

    pruneStaleSkaffoldFiles(tree, new Set(['skaffold.yaml', 'apps.yaml']));

    expect(tree.exists('skaffold/apps.yaml')).toBe(true);
  });
});

describe('pruneStaleDockerfiles', () => {
  let tree: Tree;

  beforeEach(() => {
    tree = createTreeWithEmptyWorkspace();
  });

  it('deletes a generated Dockerfile once its app stops qualifying', () => {
    tree.write(
      'apps/demo/Dockerfile',
      `# syntax=docker/dockerfile:1\n${GENERATED_FILE_MARKER}FROM scratch\n`,
    );

    pruneStaleDockerfiles(tree, [{ name: 'demo', root: 'apps/demo' }], []);

    expect(tree.exists('apps/demo/Dockerfile')).toBe(false);
  });

  it('never deletes a hand-written Dockerfile lacking the generated marker', () => {
    tree.write('apps/demo/Dockerfile', 'FROM scratch\n');

    pruneStaleDockerfiles(tree, [{ name: 'demo', root: 'apps/demo' }], []);

    expect(tree.exists('apps/demo/Dockerfile')).toBe(true);
  });

  it("leaves a still-qualifying app's Dockerfile alone", () => {
    const app = { name: 'demo', root: 'apps/demo' };
    tree.write(
      'apps/demo/Dockerfile',
      `# syntax=docker/dockerfile:1\n${GENERATED_FILE_MARKER}FROM scratch\n`,
    );

    pruneStaleDockerfiles(tree, [app], [app]);

    expect(tree.exists('apps/demo/Dockerfile')).toBe(true);
  });
});
