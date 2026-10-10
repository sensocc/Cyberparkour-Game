import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Relative base so a production build can be served from any sub-path
  // (GitHub Pages, a file:// share, an itch.io zip, ...).
  base: './',
  build: {
    target: 'es2022',
    outDir: 'dist',
    sourcemap: true,
    chunkSizeWarningLimit: 800,
  },
  server: {
    port: 5173,
    strictPort: false,
    open: false,
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    // **The city is not a unit test.** Building it is sixteen thousand props and as many
    // colliders, and several suites build it more than once - the merge, the broadphase
    // equivalence, the frame budget, the generator's own invariants. On a fast machine that
    // is a second or two each; on a slower CI runner it is more than Vitest's five-second
    // default, which is a default for a unit test and not for this.
    testTimeout: 120_000,
    hookTimeout: 120_000,
    setupFiles: ['tests/setup.ts'],
    clearMocks: true,
    restoreMocks: true,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      // `tools/` ships the texture generator, which is real (and tested) code.
      include: ['src/**/*.ts', 'tools/**/*.ts'],
      exclude: ['src/main.ts', 'src/**/index.ts'],
    },
  },
});
