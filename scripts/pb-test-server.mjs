// Disposable test service: never inherits production credentials.
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const port = process.argv[2] || '18090';
if (!/^\d+$/.test(port) || +port < 1024 || +port > 65535) throw new Error('Invalid test port');
const directory = await mkdtemp(join(tmpdir(), 'chugalug-pb-test-'));
const child = spawn('bash', ['scripts/pb-dev.sh', directory], {
  cwd: root, stdio: 'inherit',
  env: {
    ...process.env, PB_SKIP_ENV: '1', PB_AUTOMIGRATE: 'false', PB_HTTP: `127.0.0.1:${port}`,
    PB_ADMIN_EMAIL: 'tests@chugalug.invalid', PB_ADMIN_PASSWORD: 'local-test-password-only',
    CREW_PASSWORD: 'crew-test-password', ADMIN_PASSWORD: 'admin-test-password',
    CONDUCTOR_EMAIL: 'conductor@test.invalid', APP_URL: 'http://127.0.0.1:15173', MAIL_FROM: 'crew@test.invalid',
    SMTP_HOST: '127.0.0.1', SMTP_PORT: '12525', TURNSTILE_SECRET: 'test-turnstile-secret',
    TURNSTILE_VERIFY_URL: 'http://127.0.0.1:12527/siteverify', PB_RATE_LIMITS: 'off', NOTIFY_INTERVAL_SECONDS: '0'
  }
});
for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => child.kill(signal));
child.on('exit', async (code) => {
  await rm(directory, { recursive: true, force: true });
  process.exit(code ?? 0);
});
child.on('error', async (error) => {
  console.error(error.message);
  await rm(directory, { recursive: true, force: true });
  process.exit(1);
});
