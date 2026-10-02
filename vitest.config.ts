import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@': resolve(import.meta.dirname, 'src/renderer/src'),
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'benchmark/**/*.test.ts', 'scripts/**/*.test.ts'],
    testTimeout: 60_000,
  },
});
