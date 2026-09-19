import { defineConfig, devices } from '@playwright/test';

process.env.PB_URL = 'http://127.0.0.1:18093';
process.env.PB_ADMIN_EMAIL = 'tests@chugalug.invalid';
process.env.PB_ADMIN_PASSWORD = 'local-test-password-only';
process.env.OTP_DEV_CODE = '000000';

export default defineConfig({
  testDir: 'tests/e2e',
  globalSetup: './tests/e2e/global-setup.ts',
  timeout: 30_000,
  workers: 1,
  use: { ...devices['iPhone 13'], browserName: 'chromium', baseURL: 'http://127.0.0.1:15173', trace: 'retain-on-failure' },
  webServer: [
    {
      command: 'node ../scripts/pb-test-server.mjs 18093',
      url: 'http://127.0.0.1:18093/api/health',
      reuseExistingServer: false, timeout: 30_000,
      gracefulShutdown: { signal: 'SIGTERM', timeout: 5000 }
    },
    {
      command: 'npm run dev -- --host 127.0.0.1 --port 15173 --strictPort',
      url: 'http://127.0.0.1:15173/login',
      env: { PUBLIC_PB_URL: 'http://127.0.0.1:18093' },
      reuseExistingServer: false, timeout: 60_000,
      gracefulShutdown: { signal: 'SIGTERM', timeout: 5000 }
    }
  ]
});
