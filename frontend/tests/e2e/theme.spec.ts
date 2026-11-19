import { test, expect, type Page } from '@playwright/test';
import { axeScan } from './audit';
import { researcherHeaders } from './seed';

const signIn = async (page: Page, path: string) => {
  await page.goto(path);
  await page.getByLabel('Access key', { exact: true }).fill('e2e-researcher-' + 'x'.repeat(32));
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
};
const theme = (page: Page) => page.evaluate(() => document.documentElement.dataset.theme);
const background = (page: Page) =>
  page.evaluate(() => getComputedStyle(document.body).backgroundColor);

test('the theme menu changes the researcher theme and is remembered', async ({ page }) => {
  await signIn(page, '/researcher/studies');
  expect(await theme(page)).toBe('light');
  const light = await background(page);

  await page.getByLabel('Theme', { exact: true }).selectOption('dark');
  expect(await theme(page)).toBe('dark');
  expect(await background(page)).not.toBe(light);

  await page.reload();
  expect(await theme(page)).toBe('dark'); // applied before sign-in, no flash of light
  await page.getByLabel('Access key', { exact: true }).fill('e2e-researcher-' + 'x'.repeat(32));
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByLabel('Theme', { exact: true })).toHaveValue('dark');

  await page.getByLabel('Theme', { exact: true }).selectOption('contrast');
  expect(await theme(page)).toBe('contrast');
});

test('"Same as device" follows the operating system setting', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await signIn(page, '/researcher/studies');
  expect(await theme(page)).toBe('dark');
  await page.emulateMedia({ colorScheme: 'light', contrast: 'more' });
  await expect.poll(() => theme(page)).toBe('contrast');
  await page.emulateMedia({ colorScheme: 'light', contrast: 'no-preference' });
  await expect.poll(() => theme(page)).toBe('light');
});

test('the assessor app is never themed', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark', contrast: 'more' });
  await page.addInitScript(() => localStorage.setItem('sensibilia.researcher.theme', 'dark'));
  await page.goto('/assessor/');
  expect(await theme(page)).toBeUndefined();
});

for (const name of ['light', 'dark', 'contrast']) {
  test(`${name} theme meets contrast rules`, { tag: '@audit' }, async ({ page, request }) => {
    const study = await (
      await request.post('/studies', {
        headers: researcherHeaders,
        data: { title: 'Theme ' + name },
      })
    ).json();
    await page.addInitScript(
      (value) => localStorage.setItem('sensibilia.researcher.theme', value),
      name,
    );
    await signIn(page, `/researcher/studies/${study.id}/versions/${study.versions[0].id}/flow`);
    await page.getByRole('button', { name: 'Add step', exact: true }).click();
    await axeScan(page, 'page');
    await page.getByRole('button', { name: /Nine-point hedonic/ }).click();
    await axeScan(page, 'main');
  });
}
