import nextEslintPluginNext from '@next/eslint-plugin-next';
import nx from '@nx/eslint-plugin';
import baseConfig from '../../eslint.config.mjs';

export default [
  { plugins: { '@next/next': nextEslintPluginNext } },
  ...nx.configs['flat/react-typescript'],
  ...baseConfig,
  {
    files: ['**/*.json'],
    rules: {
      '@nx/dependency-checks': [
        'error',
        {
          ignoredFiles: ['{projectRoot}/eslint.config.{js,cjs,mjs,ts,cts,mts}'],
          // '@dxs/demo-lib' is a non-buildable sibling (no `build` target),
          // which this rule's own workspace-dependency resolution excludes by
          // design ("otherwise it cannot be a dependency in package.json").
          // 'next'/'react'/'react-dom' are only ever used implicitly - JSX
          // runtime, next-env.d.ts, next.config.js conventions - never via an
          // explicit import statement this rule's static analysis can
          // attribute to a source file.
          ignoredDependencies: ['@dxs/demo-lib', 'next', 'react', 'react-dom'],
        },
      ],
    },
    languageOptions: {
      parser: await import('jsonc-eslint-parser'),
    },
  },
  {
    ignores: ['.next/**/*', '**/out-tsc'],
  },
];
