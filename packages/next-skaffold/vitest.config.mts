import { defineConfig } from 'vitest/config';

export default defineConfig(() => ({
  root: import.meta.dirname,
  cacheDir: '../../node_modules/.vite/packages/next-skaffold',
  test: {
    name: 'next-skaffold',
    watch: false,
    globals: true,
    environment: 'node',
    // the sync generator spec partially mocks '@nx/devkit' (vi.mock with
    // importOriginal), which pays a real, one-time cost fully evaluating the
    // actual module the first time a test in the file exercises it - a few
    // seconds locally, more on a loaded/slower CI runner. Not a hang: every
    // stage of the generator itself profiles at low single-digit ms.
    testTimeout: 30000,
    include: ['{src,tests}/**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}'],
    reporters: ['default'],
    coverage: {
      reportsDirectory: './test-output/vitest/coverage',
      provider: 'v8' as const,
    },
  },
}));
