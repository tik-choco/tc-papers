import { defineConfig } from '@playwright/test'
export default defineConfig({
  testDir: './tests',
  fullyParallel: false,
  workers: 1,
  use: { baseURL: 'http://127.0.0.1:5126', headless: true, launchOptions: { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE }, viewport: { width: 1440, height: 1000 } },
  webServer: { command: 'npm run dev -- --port 5126 --strictPort', url: 'http://127.0.0.1:5126', reuseExistingServer: !process.env.CI },
})
