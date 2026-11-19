import { defineConfig } from '@playwright/test';
import base from './playwright.config';
import { python } from './tests/python';

export default defineConfig({
  ...base,
  testIgnore: [],
  grep: /production HTTPS|flow foundation: real backend|restricted offline session/,
  testMatch: ['**/deployment.spec.ts', '**/flow-foundation.spec.ts', '**/offline-session.spec.ts'],
  use: {
    ...base.use,
    baseURL: 'https://127.0.0.1:5173',
    // Ephemeral test certificate only. Does not establish laboratory tablet trust.
    ignoreHTTPSErrors: true,
  },
  webServer: {
    command: python + ' ../scripts/serve_e2e.py --production --https',
    url: 'https://127.0.0.1:5173/health',
    ignoreHTTPSErrors: true,
    reuseExistingServer: false,
  },
});
