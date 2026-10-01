import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

// Long-running accuracy benchmarks on external datasets (see benchmark/).
export default defineConfig({
  resolve: {
    alias: {
      '@': resolve(import.meta.dirname, 'src/renderer/src'),
    },
  },
  test: {
    environment: 'node',
    include: ['benchmark/**/*.benchmark.ts'],
    testTimeout: 0,
  },
});
