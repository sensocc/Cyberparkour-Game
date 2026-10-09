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
