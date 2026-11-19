import { defineConfig } from '@playwright/test';
import { python } from './tests/python';
import { timeoutScale } from './tests/timeouts';
import { evidenceDir } from './tests/e2e/evidence';

// Pin the resolved directory so web servers (serve_e2e.py) write to the same place.
process.env.EVIDENCE_DIR = evidenceDir;
export default defineConfig({
  testDir: './tests/e2e',
  testIgnore: '**/deployment.spec.ts',
  fullyParallel: false,
  workers: 1,
  timeout: 30000 * timeoutScale,
  use: {
    baseURL: 'http://127.0.0.1:' + (process.env.E2E_PORT ?? '5173'),
    trace: 'retain-on-failure',
    // A missing element should fail in seconds, not at the end of a long workflow timeout.
    actionTimeout: 20000,
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'chromium', use: { browserName: 'chromium', viewport: { width: 1440, height: 900 } } },
  ],
  webServer: [
    {
      command: python + ' ../scripts/serve_e2e.py',
      url: 'http://127.0.0.1:' + (process.env.E2E_API_PORT ?? '8001') + '/health',
      reuseExistingServer: false,
    },
    {
      command: 'npm run dev',
      url: 'http://127.0.0.1:' + (process.env.E2E_PORT ?? '5173'),
      reuseExistingServer: false,
    },
  ],
});
