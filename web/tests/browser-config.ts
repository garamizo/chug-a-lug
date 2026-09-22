import { defineConfig, devices } from '@playwright/test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export function browserConfig(sim = false, production = false) {
  process.env.SIM = sim ? '1' : '0';
  process.env.PUBLIC_SIM = sim ? '1' : '0';
  process.env.SIM_RUN_ID = sim ? 'browser-fixture' : '';
  process.env.SIM_RECORDINGS_DIR = resolve('tests/fixtures/sim');
  process.env.METRA_API_TOKEN = sim ? 'sentinel-not-a-real-token' : '';
  process.env.METRA_RT_BASE = 'http://127.0.0.1:18096';
  process.env.PB_URL = 'http://127.0.0.1:18093';
  process.env.PB_ADMIN_EMAIL = 'tests@chugalug.invalid';
  process.env.PB_ADMIN_PASSWORD = 'local-test-password-only';
  process.env.CREW_PASSWORD = 'crew-test-password';
  process.env.ADMIN_PASSWORD = 'admin-test-password';

  process.env.GTFS_URL = pathToFileURL(resolve('tests/fixtures/gtfs.zip')).href;
  // Playwright evaluates config again in workers; preserve this invocation's disposable paths.
  process.env.CHUG_TEST_DATA_DIR ??= mkdtempSync(join(tmpdir(), 'chugalug-e2e-'));
  process.env.DATA_DIR = process.env.CHUG_TEST_DATA_DIR;
  process.env.SIM_WEB_CONTROL = join(process.env.DATA_DIR, 'web-control.json');
  process.env.INTERNAL_SECRET = 'e2e-secret';
  process.env.WEB_INTERNAL_URL = 'http://127.0.0.1:15173';
  process.env.GOOGLE_PLACES_KEY = '';
  process.env.OVERPASS_URL = 'http://127.0.0.1:9/';
  // The whole suite runs from one loopback address and shares the login endpoint's per-IP rate
  // limit (20/15min by default, sized for one shared crew password in production). Raised here only
  // — nowhere else sets this — so the production default stays untouched everywhere but this harness.
  process.env.LOGIN_RATE_LIMIT = '500';

  return defineConfig({
    outputDir: sim ? (production ? 'test-results/sim-offline' : 'test-results/sim') : 'test-results/ordinary',
    testDir: sim ? 'tests/sim' : 'tests/e2e',
    testMatch: sim ? (production ? '**/offline.spec.ts' : '**/{rehearsal,restart}.spec.ts') : '**/*.spec.ts',
    globalSetup: sim ? './tests/sim/global-setup.ts' : './tests/e2e/global-setup.ts',
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
        command: sim ? `node scripts/sim-test-web.mjs${production ? ' --production' : ''}` : 'npm run dev -- --host 127.0.0.1 --port 15173 --strictPort',
        url: 'http://127.0.0.1:15173/login',
        env: { PUBLIC_PB_URL: 'http://127.0.0.1:18093', HOST: '127.0.0.1', PORT: '15173', ORIGIN: 'http://127.0.0.1:15173' },
        reuseExistingServer: false, timeout: 60_000,
        gracefulShutdown: { signal: 'SIGTERM', timeout: 5000 }
      }
    ]
  });

}
