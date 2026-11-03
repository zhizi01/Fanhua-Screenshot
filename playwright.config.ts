import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 60000,
  expect: { timeout: 10000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: { viewport: { width: 1140, height: 820 }, screenshot: 'only-on-failure', actionTimeout: 10000, trace: 'retain-on-failure' },
  projects: [
    { name: 'browser', testMatch: '**/browser.spec.ts', use: { browserName: 'chromium', channel: 'msedge', baseURL: 'http://127.0.0.1:5173' } },
    { name: 'electron', testMatch: '**/electron.spec.ts' },
  ],
  webServer: { command: 'npm run dev:web', url: 'http://127.0.0.1:5173', reuseExistingServer: !process.env.CI, timeout: 30000 },
})
