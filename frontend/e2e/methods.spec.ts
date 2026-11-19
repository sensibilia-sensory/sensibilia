import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const token = 'e2e-researcher-' + 'x'.repeat(32);
const headers = { Authorization: `Bearer ${token}` };
const api = 'http://127.0.0.1:8001';

async function study(page: Page, title: string) {
  await page.goto('./');
  await page.getByLabel('Researcher access key').fill(token);
  await page.getByRole('button', { name: 'Open workspace' }).click();
  await page.getByRole('button', { name: 'New study', exact: true }).click();
  await page.getByLabel('Study title', { exact: true }).fill(title);
  await page.getByRole('button', { name: 'Create draft study' }).click();
  await page.getByRole('button', { name: 'Coded samples', exact: true }).click();
  for (const [code, label] of [
    ['317', 'Product A'],
    ['582', 'Product B'],
  ]) {
    await page.getByLabel('Blind sample code').fill(code);
    await page.getByLabel('Product label', { exact: true }).fill(label);
    await page.getByRole('button', { name: 'Add sample', exact: true }).click();
    await expect(page.getByLabel('Blind sample code')).toHaveValue('');
  }
}

const methods = ['cata', 'rata', 'jar', 'triangle', 'duo-trio', 'flash-profile', 'napping'];

test('a mixed-method flow gates Continue and clears answers on restart', async ({ page }) => {
  await study(page, 'Mixed methods');
  for (const method of ['triangle', 'jar']) {
    await page.getByRole('button', { name: 'Add test', exact: true }).click();
    await page.getByLabel('Test method', { exact: true }).selectOption(`${method}-v1`);
    if (method === 'jar') await page.getByLabel('Attribute 1', { exact: true }).fill('Sweetness');
    await page.getByRole('button', { name: 'Add test to study' }).click();
    await expect(page.getByRole('status')).toContainText('Test configuration saved');
  }
  await page.getByRole('button', { name: 'Session flow', exact: true }).click();
  await expect(page.getByLabel('Question presentation')).toHaveCount(0);
  await page.getByRole('button', { name: 'Preview session', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Preview session flow' });
  const next = dialog.getByRole('button', { name: 'Continue', exact: true });
  await expect(next).toBeDisabled();
  await dialog.getByRole('radio').first().check();
  await expect(next).toBeEnabled();
  await dialog.getByRole('button', { name: 'Restart preview' }).click();
  await expect(next).toBeDisabled();
  await expect(dialog.getByRole('radio').first()).not.toBeChecked();
  await dialog.getByRole('radio').first().check();
  await next.click();
  await expect(next).toBeDisabled();
  await dialog.getByRole('radio', { name: '317: Sweetness: Just about right' }).check();
  await expect(next).toBeDisabled();
  await dialog.getByRole('radio', { name: '582: Sweetness: Just about right' }).check();
  await next.click();
  await expect(dialog.getByRole('status')).toContainText('FINISHED');
});

for (const method of methods) {
  test(`configure, rehearse, publish and revise ${method}`, async ({ page, request }) => {
    const title = `New method ${method}`;
    await study(page, title);
    await page.getByRole('button', { name: 'Add test', exact: true }).click();
    await page.getByLabel('Test method', { exact: true }).selectOption(`${method}-v1`);
    await page.getByLabel('Assessor instructions').fill('Evaluate the coded samples carefully.');
    if (['cata', 'rata', 'jar'].includes(method)) {
      await page.getByLabel('Attribute 1', { exact: true }).fill('Sweetness');
    }
    if (method === 'rata') {
      await page.getByRole('tab', { name: 'Settings', exact: true }).click();
      await page.getByLabel('First scale value').selectOption('0');
    }
    if (method === 'napping') {
      await page.getByRole('tab', { name: 'Settings', exact: true }).click();
      await page.getByLabel('Collect optional sample descriptions after mapping').check();
    }
    await page.getByRole('button', { name: 'Add test to study', exact: true }).click();
    await expect(page.getByRole('status')).toContainText('Test configuration saved');
    await page.getByRole('button', { name: 'Preview test', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Preview sensory test' });
    if (method === 'cata') {
      await expect(dialog.getByText('Required answers complete', { exact: true })).toBeVisible();
      await dialog.getByRole('checkbox', { name: '317: Sweetness', exact: true }).check();
    } else if (method === 'rata') {
      await dialog.getByRole('checkbox', { name: '317: Sweetness', exact: true }).check();
      await expect(
        dialog.getByText('Complete the required answers', { exact: true }),
      ).toBeVisible();
      await dialog.getByRole('radio', { name: '317: Sweetness: Low', exact: true }).check();
    } else if (method === 'jar') {
      await expect(
        dialog.getByText('Complete the required answers', { exact: true }),
      ).toBeVisible();
      await dialog
        .getByRole('radio', { name: '317: Sweetness: Just about right', exact: true })
        .check();
      await dialog.getByRole('radio', { name: '582: Sweetness: Too little', exact: true }).check();
    } else if (['triangle', 'duo-trio'].includes(method)) {
      await expect(
        dialog.getByText('Complete the required answers', { exact: true }),
      ).toBeVisible();
      await expect(dialog.getByRole('radio')).toHaveCount(method === 'triangle' ? 3 : 2);
      await dialog.getByRole('radio').first().check();
    } else if (method === 'flash-profile') {
      await expect(dialog.getByRole('button', { name: 'Rank the samples' })).toBeDisabled();
      await dialog.getByLabel('Descriptor 1', { exact: true }).fill('Toasted cereal');
      await dialog.getByRole('button', { name: 'Rank the samples' }).click();
      await dialog.getByLabel('Toasted cereal: sample 317 rank').selectOption('1');
      await expect(
        dialog.getByText('Complete the required answers', { exact: true }),
      ).toBeVisible();
      await dialog.getByLabel('Toasted cereal: sample 582 rank').selectOption('1');
    } else {
      await dialog.getByRole('button', { name: '317', exact: true }).focus();
      await page.keyboard.press('Enter');
      await expect(
        dialog.getByRole('button', { name: 'Move sample 317', exact: true }),
      ).toBeVisible();
      await dialog.getByRole('button', { name: '582', exact: true }).click();
      await dialog
        .getByRole('group', { name: 'Sample similarity map' })
        .click({ position: { x: 80, y: 70 } });
      await dialog.getByLabel('Description for sample 317').fill('Similar aromas');
      const marker = dialog.getByRole('button', { name: 'Move sample 317', exact: true });
      await marker.focus();
      await page.keyboard.press('ArrowRight');
      await expect(marker).toHaveAttribute('style', /left: 50.8333/);
      await page.screenshot({ path: 'test-results/napping-desktop.png', fullPage: true });
    }
    await expect(dialog.getByText('Required answers complete', { exact: true })).toBeVisible();
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    await dialog.getByRole('button', { name: 'Reset preview answers' }).click();
    if (!['cata', 'rata'].includes(method)) {
      await expect(
        dialog.getByText('Complete the required answers', { exact: true }),
      ).toBeVisible();
    }
    await dialog.getByRole('button', { name: 'Close dialog' }).click();
    const studies = await (await request.get(`${api}/studies`, { headers })).json();
    const record = studies.find((item: { title: string }) => item.title === title);
    expect(
      await (await request.get(`${api}/studies/${record.id}/responses`, { headers })).json(),
    ).toEqual([]);
    await page.getByRole('button', { name: 'Publish study', exact: true }).click();
    await page
      .getByRole('dialog')
      .getByRole('button', { name: 'Publish version', exact: true })
      .click();
    await expect(page.getByText('Published configuration', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Create new draft', exact: true }).click();
    await expect(page.getByLabel('Assessor instructions')).toBeEnabled();
    const refreshed = await (await request.get(`${api}/studies/${record.id}`, { headers })).json();
    const draft = refreshed.versions.find((v: { published_at: string | null }) => !v.published_at);
    const tests = await (
      await request.get(`${api}/studies/${record.id}/versions/${draft.id}/tests`, { headers })
    ).json();
    const samples = await (
      await request.get(`${api}/studies/${record.id}/versions/${draft.id}/samples`, { headers })
    ).json();
    expect(tests[0].test_type_id).toBe(`${method}-v1`);
    expect(new Set(tests[0].configuration.sample_ids)).toEqual(
      new Set(samples.map((s: { id: string }) => s.id)),
    );
  });
}

test('Napping touch placement keeps the map geometry and works at tablet and phone widths', async ({
  browser,
}) => {
  const context = await browser.newContext({
    viewport: { width: 800, height: 1100 },
    hasTouch: true,
  });
  const page = await context.newPage();
  await study(page, 'Touch mapping');
  await page.getByRole('button', { name: 'Add test', exact: true }).click();
  await page.getByLabel('Test method', { exact: true }).selectOption('napping-v1');
  await page.getByRole('button', { name: 'Preview test' }).click();
  const dialog = page.getByRole('dialog', { name: 'Preview sensory test' });
  for (const width of [800, 390]) {
    await page.setViewportSize({ width, height: 1100 });
    await dialog.getByRole('button', { name: 'Reset preview answers' }).click();
    const map = dialog.getByRole('group', { name: 'Sample similarity map' });
    const box = (await map.boundingBox())!;
    expect(box.width / box.height).toBeCloseTo(1.5, 1);
    for (const [code, fraction] of [
      ['317', 0.25],
      ['582', 0.75],
    ] as const) {
      await dialog.getByRole('button', { name: code, exact: true }).tap();
      await page.touchscreen.tap(box.x + box.width * fraction, box.y + box.height / 2);
    }
    await expect(dialog.getByText('Required answers complete', { exact: true })).toBeVisible();
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
    await page.screenshot({ path: `test-results/napping-touch-${width}.png`, fullPage: true });
  }
  await context.close();
});
