import { test, expect } from '@playwright/test';
import { capture } from './capture';

test('production HTTPS serves scoped deep links, exact assets and restricted APIs', async ({
  page,
  request,
}) => {
  const health = await request.get('/health');
  expect(health.status()).toBe(200);
  expect(await health.json()).toEqual({ status: 'ok' });
  await page.goto('/researcher/studies/example/versions/example/flow');
  await expect(page.getByLabel('Access key', { exact: true })).toBeVisible();
  expect(await page.evaluate(() => isSecureContext)).toBe(true);
  expect(await page.content()).not.toContain('/@vite/client');
  const scripts = await page
    .locator('script[src]')
    .evaluateAll((nodes) => nodes.map((node) => node.getAttribute('src')!));
  expect(scripts.length).toBeGreaterThan(0);
  for (const script of scripts) {
    expect(script).toMatch(/^\/researcher\/assets\//);
    expect((await request.get(script)).status()).toBe(200);
  }
  await page.goto('/researcher/terminals');
  await expect(page.getByLabel('Access key', { exact: true })).toBeVisible();
  expect((await request.get('/terminals')).status()).toBe(401);
  expect((await request.get('/studies')).status()).toBe(401);
  expect((await request.get('/sessions/00000000-0000-4000-8000-000000000001/test')).status()).toBe(
    401,
  );
  expect((await request.get('/researcher/missing.js')).status()).toBe(404);
  const worker = await request.get('/assessor/sw.js');
  expect(worker.status()).toBe(200);
  expect(worker.headers()['cache-control']).toBe('no-cache');
  expect(await worker.text()).toContain('sensibilia-assessor-shell');
  const manifest = await (await request.get('/assessor/manifest.webmanifest')).json();
  expect(manifest.scope).toBe('/assessor/');
  for (const icon of manifest.icons as { src: string; type: string }[]) {
    const response = await request.get(icon.src);
    expect(response.status(), icon.src).toBe(200);
    expect(response.headers()['content-type']).toContain(icon.type);
  }
  expect(manifest.icons.some((i: { sizes: string }) => i.sizes === '192x192')).toBe(true);
  expect(manifest.icons.some((i: { purpose: string }) => i.purpose === 'maskable')).toBe(true);
  await page.goto('/assessor/sessions/00000000-0000-4000-8000-000000000001');
  await expect(page.getByRole('heading', { name: 'Waiting for staff preparation' })).toBeVisible();
  await expect(page.getByLabel('Session token', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('textbox')).toHaveCount(0);
  expect(await page.evaluate(() => isSecureContext)).toBe(true);
  await capture(page, 'slice-11-https-session-entry', 'desktop', 'page');
});
