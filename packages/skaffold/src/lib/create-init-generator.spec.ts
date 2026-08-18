import { createTreeWithEmptyWorkspace } from '@nx/devkit/testing';
import { addProjectConfiguration, readJson, type Tree } from '@nx/devkit';
import * as yaml from 'yaml';

import { createSkaffoldInitGenerator } from './create-init-generator';

describe('createSkaffoldInitGenerator', () => {
  let tree: Tree;
  const initGenerator = createSkaffoldInitGenerator(
    '@myorg/some-skaffold:sync',
  );

  beforeEach(() => {
    tree = createTreeWithEmptyWorkspace();
  });

  it('bootstraps the root package.json "nx" field when no root project is registered yet', async () => {
    await initGenerator(tree);

    expect(tree.exists('project.json')).toBe(false);

    const packageJson = readJson(tree, 'package.json');
    expect(packageJson.nx.targets.minikube).toEqual({
      executor: 'nx:run-commands',
      options: { command: 'minikube start' },
    });
    expect(packageJson.nx.targets.skaffold.syncGenerators).toEqual([
      '@myorg/some-skaffold:sync',
    ]);
  });

  it('adds to an already-registered root project instead of creating a new one', async () => {
    addProjectConfiguration(tree, '@proj/source', { root: '.', targets: {} });

    await initGenerator(tree);

    const packageJson = readJson(tree, 'package.json');
    expect(packageJson.nx).toBeUndefined();
    expect(tree.exists('project.json')).toBe(true);
    const projectJson = readJson(tree, 'project.json');
    expect(projectJson.targets.skaffold.syncGenerators).toEqual([
      '@myorg/some-skaffold:sync',
    ]);
  });

  it('is idempotent: running twice does not duplicate the sync generator', async () => {
    await initGenerator(tree);
    await initGenerator(tree);

    const packageJson = readJson(tree, 'package.json');
    expect(packageJson.nx.targets.skaffold.syncGenerators).toEqual([
      '@myorg/some-skaffold:sync',
    ]);
  });

  it("adds its sync generator alongside another plugin's, without touching the rest of the target", async () => {
    addProjectConfiguration(tree, '@proj/source', {
      root: '.',
      targets: {
        skaffold: {
          continuous: true,
          executor: 'nx:run-commands',
          defaultConfiguration: 'development',
          configurations: { development: { commands: ['custom'] } },
          syncGenerators: ['@other-org/other-skaffold:sync'],
        },
      },
    });

    await initGenerator(tree);

    const projectJson = readJson(tree, 'project.json');
    const skaffoldTarget = projectJson.targets.skaffold;
    expect(skaffoldTarget.syncGenerators.sort()).toEqual([
      '@myorg/some-skaffold:sync',
      '@other-org/other-skaffold:sync',
    ]);
    // untouched otherwise
    expect(skaffoldTarget.configurations.development.commands).toEqual([
      'custom',
    ]);
  });

  it('does not overwrite an already-existing "minikube" target', async () => {
    addProjectConfiguration(tree, '@proj/source', {
      root: '.',
      targets: {
        minikube: {
          executor: 'nx:run-commands',
          options: { command: 'custom-start' },
        },
      },
    });

    await initGenerator(tree);

    const projectJson = readJson(tree, 'project.json');
    expect(projectJson.targets.minikube.options.command).toBe('custom-start');
  });

  it('seeds skaffold/infra.yaml and skaffold/infra/infra-namespace.yaml when absent', async () => {
    await initGenerator(tree);

    const infra = yaml.parse(
      tree.read('skaffold/infra.yaml', 'utf-8') as string,
    );
    expect(infra.manifests.rawYaml).toEqual(['skaffold/infra/*.yaml']);

    const namespace = yaml.parse(
      tree.read('skaffold/infra/infra-namespace.yaml', 'utf-8') as string,
    );
    expect(namespace).toEqual({
      apiVersion: 'v1',
      kind: 'Namespace',
      metadata: { name: 'infra' },
    });
  });

  it('never overwrites already-existing infra files, even hand-edited ones', async () => {
    tree.write('skaffold/infra.yaml', '# hand-edited\n');
    tree.write(
      'skaffold/infra/infra-namespace.yaml',
      '# hand-edited namespace\n',
    );

    await initGenerator(tree);

    expect(tree.read('skaffold/infra.yaml', 'utf-8')).toBe('# hand-edited\n');
    expect(tree.read('skaffold/infra/infra-namespace.yaml', 'utf-8')).toBe(
      '# hand-edited namespace\n',
    );
  });

  it('throws a clear error when there is no root package.json at all', async () => {
    tree.delete('package.json');

    await expect(initGenerator(tree)).rejects.toThrow(/root package\.json/);
  });
});
