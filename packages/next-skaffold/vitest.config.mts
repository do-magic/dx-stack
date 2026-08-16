import { defineConfig } from 'vitest/config';

export default defineConfig(() => ({
  root: __dirname,
  cacheDir: '../../node_modules/.vite/packages/next-skaffold',
  // resolves workspace packages (e.g. @dxs/skaffold) to their TS source
  // rather than dist/ — matches the same "@dxs/source" convention Nx's own
  // generator loading already uses for in-repo packages, so tests always
  // run against the latest source, not a possibly-stale build
  resolve: {
    conditions: ['@dxs/source'],
  },
  test: {
    name: '@dxs/next-skaffold',
    watch: false,
    globals: true,
    environment: 'jsdom',
    include: ['{src,tests}/**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}'],
    reporters: ['default'],
    coverage: {
      reportsDirectory: './test-output/vitest/coverage',
      provider: 'v8' as const,
    },
  },
}));
