import { defineConfig } from '@playwright/test';

// End-to-end tests drive the built Electron app (run `npm run build` first; `npm run test:e2e` does).
export default defineConfig({
  testDir: 'e2e',
  timeout: 120_000,
  workers: 1,
  reporter: [['list']],
});
