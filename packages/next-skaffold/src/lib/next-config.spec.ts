import { createTreeWithEmptyWorkspace } from '@nx/devkit/testing';
import { Tree } from '@nx/devkit';

import { syncNextConfig } from './next-config';

const demo = { name: 'demo', root: 'apps/demo' };

describe('syncNextConfig', () => {
  let tree: Tree;

  beforeEach(() => {
    tree = createTreeWithEmptyWorkspace();
  });

  it('creates a minimal next.config.js when the app has none', () => {
    syncNextConfig(tree, demo);

    const content = tree.read('apps/demo/next.config.js', 'utf-8');
    expect(content).toContain(`output: 'standalone'`);
    expect(content).toContain(
      `outputFileTracingRoot: path.join(__dirname, '../..')`,
    );
    expect(content).toContain(`require('path')`);
  });

  it('adds both properties to an existing config, preserving everything else', () => {
    tree.write(
      'apps/demo/next.config.js',
      `//@ts-check

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // a user comment
};

module.exports = nextConfig;
`,
    );

    syncNextConfig(tree, demo);

    const content = tree.read('apps/demo/next.config.js', 'utf-8') as string;
    expect(content).toContain('reactStrictMode: true');
    expect(content).toContain('// a user comment');
    expect(content).toContain(`output: 'standalone'`);
    expect(content).toContain(
      `outputFileTracingRoot: path.join(__dirname, '../..')`,
    );
    expect(content).toContain(`const path = require('path');`);
  });

  it('overwrites an incorrect value but leaves unrelated properties untouched', () => {
    tree.write(
      'apps/demo/next.config.js',
      `const path = require('path');

const nextConfig = {
  output: 'export',
  outputFileTracingRoot: '/some/hardcoded/path',
  reactStrictMode: true,
};

module.exports = nextConfig;
`,
    );

    syncNextConfig(tree, demo);

    const content = tree.read('apps/demo/next.config.js', 'utf-8') as string;
    expect(content).toContain(`output: 'standalone'`);
    expect(content).toContain(
      `outputFileTracingRoot: path.join(__dirname, '../..')`,
    );
    expect(content).toContain('reactStrictMode: true');
    expect(content).not.toContain('/some/hardcoded/path');
    expect(content).not.toContain(`output: 'export'`);
  });

  it('regenerates valid syntax when updating an existing last property while inserting a new one right after it', () => {
    // regression test: `outputFileTracingRoot` here is both (a) the last
    // property, so `output`'s insertion point sits right at its end, and
    // (b) getting its value replaced — two edits with touching
    // boundaries, which previously corrupted the output (dropped/doubled
    // commas) when edits were applied by mutating the string cumulatively
    // instead of walking the original text once
    tree.write(
      'apps/demo/next.config.js',
      `const path = require('path');

const nextConfig = {
  reactStrictMode: true,
  outputFileTracingRoot: path.join(__dirname, '../../'),
  // a trailing comment
};

module.exports = nextConfig;
`,
    );

    syncNextConfig(tree, demo);

    const content = tree.read('apps/demo/next.config.js', 'utf-8') as string;
    // new Function() throws SyntaxError on genuinely invalid JS (e.g. the
    // dropped/doubled commas this test guards against), without needing
    // to actually run the body (which would need __dirname/require shims)
    expect(() => new Function(content)).not.toThrow();
    expect(content).not.toMatch(/,\s*,/);
    expect(content).toContain('reactStrictMode: true');
    expect(content).toContain('// a trailing comment');
    expect(content).toContain(`output: 'standalone'`);
    expect(content).toContain(
      `outputFileTracingRoot: path.join(__dirname, '../..')`,
    );
  });

  it('leaves an already-correct config byte-for-byte unchanged', () => {
    const original = `const path = require('path');

const nextConfig = {
  output: 'standalone',
  outputFileTracingRoot: path.join(__dirname, '../..'),
  reactStrictMode: true,
};

module.exports = nextConfig;
`;
    tree.write('apps/demo/next.config.js', original);

    syncNextConfig(tree, demo);

    expect(tree.read('apps/demo/next.config.js', 'utf-8')).toBe(original);
  });

  it('does not duplicate an existing path import', () => {
    tree.write(
      'apps/demo/next.config.js',
      `const path = require('path');

const nextConfig = {};

module.exports = nextConfig;
`,
    );

    syncNextConfig(tree, demo);

    const content = tree.read('apps/demo/next.config.js', 'utf-8') as string;
    expect(content.match(/require\('path'\)/g)).toHaveLength(1);
  });

  it('handles an inline module.exports object literal', () => {
    tree.write(
      'apps/demo/next.config.js',
      `module.exports = {
  reactStrictMode: true,
};
`,
    );

    syncNextConfig(tree, demo);

    const content = tree.read('apps/demo/next.config.js', 'utf-8') as string;
    expect(content).toContain('reactStrictMode: true');
    expect(content).toContain(`output: 'standalone'`);
    expect(content).toContain(
      `outputFileTracingRoot: path.join(__dirname, '../..')`,
    );
  });

  it('handles an ES module "export default" config', () => {
    tree.write(
      'apps/demo/next.config.js',
      `const nextConfig = {
  reactStrictMode: true,
};

export default nextConfig;
`,
    );

    syncNextConfig(tree, demo);

    const content = tree.read('apps/demo/next.config.js', 'utf-8') as string;
    expect(content).toContain('reactStrictMode: true');
    expect(content).toContain(`output: 'standalone'`);
    expect(content).toContain(
      `outputFileTracingRoot: path.join(__dirname, '../..')`,
    );
    expect(content).toContain(`import * as path from 'path';`);
  });

  it('rejects a next.config.js whose exported shape is not recognized', () => {
    tree.write(
      'apps/demo/next.config.js',
      `module.exports = require('./actual-config');\n`,
    );

    expect(() => syncNextConfig(tree, demo)).toThrow(
      /Could not find the exported Next.js config object/,
    );
  });
});
