import { defineConfig, devices } from '@playwright/test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

process.env.PB_URL = 'http://127.0.0.1:18093';
process.env.PB_ADMIN_EMAIL = 'tests@chugalug.invalid';
process.env.PB_ADMIN_PASSWORD = 'local-test-password-only';
process.env.CREW_PASSWORD = 'crew-test-password';
process.env.ADMIN_PASSWORD = 'admin-test-password';

process.env.GTFS_URL = pathToFileURL(resolve('tests/fixtures/gtfs.zip')).href;
process.env.DATA_DIR = mkdtempSync(join(tmpdir(), 'chugalug-e2e-'));
process.env.INTERNAL_SECRET = 'e2e-secret';
process.env.WEB_INTERNAL_URL = 'http://127.0.0.1:15173';
process.env.GOOGLE_PLACES_KEY = '';
process.env.OVERPASS_URL = 'http://127.0.0.1:9/';

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
