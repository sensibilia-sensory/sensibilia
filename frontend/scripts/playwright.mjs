import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// Prefer an explicitly configured cache. Otherwise use a hermetic installation
// when present, keeping browser downloads within frontend/node_modules.
const env = { ...process.env };
if (
  !env.PLAYWRIGHT_BROWSERS_PATH &&
  existsSync(new URL('../node_modules/playwright-core/.local-browsers', import.meta.url))
) {
  env.PLAYWRIGHT_BROWSERS_PATH = '0';
}
// --tier=fast: behaviour and data-integrity tests without accessibility/density audits
// (what CI runs on push). --tier=audit: the @audit gallery and accessibility tests only.
const args = process.argv.slice(2);
const tierIndex = args.findIndex((a) => a.startsWith('--tier='));
if (tierIndex >= 0) {
  const tier = args.splice(tierIndex, 1)[0].slice('--tier='.length);
  if (tier === 'fast') {
    env.SENSIBILIA_AUDIT = '0';
    args.push('--grep-invert', '@audit');
  } else if (tier === 'audit') args.push('--grep', '@audit');
  else {
    console.error('Unknown tier ' + tier + '; use fast or audit');
    process.exit(2);
  }
}
const result = spawnSync(
  process.execPath,
  [fileURLToPath(import.meta.resolve('@playwright/test/cli')), 'test', ...args],
  { stdio: 'inherit', env },
);
if (result.error) console.error(result.error.message);
process.exit(result.status ?? 1);
