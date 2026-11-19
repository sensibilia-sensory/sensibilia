import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const token = 'e2e-researcher-' + 'x'.repeat(32);
const headers = { Authorization: `Bearer ${token}` };
const api = 'http://127.0.0.1:8001';

async function signIn(page: Page) {
  await page.goto('./');
  await page.getByLabel('Researcher access key').fill(token);
  await page.getByRole('button', { name: 'Open workspace' }).click();
  await expect(page.getByRole('heading', { name: 'Study library' })).toBeVisible();
  await expect(page.getByText('Loading studies…', { exact: true })).toHaveCount(0);
}

async function createStudy(page: Page, title: string) {
  await page.getByRole('button', { name: 'New study', exact: true }).click();
  await page.getByLabel('Study title', { exact: true }).fill(title);
  await page.getByLabel('Description', { exact: false }).fill('Researcher browser workflow');
  await page.getByRole('button', { name: 'Create draft study' }).click();
  await expect(page.getByRole('heading', { name: title, exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Add your first test' })).toBeEnabled();
}

async function addTest(page: Page, prompt = 'How much do you like this oat drink?') {
  await page.getByRole('button', { name: 'Add test', exact: true }).click();
  await page
    .getByLabel('Assessor instructions')
    .fill('Taste the sample, then rate your overall liking.');
  await page.getByLabel('Question 1', { exact: true }).fill(prompt);
  await page.getByRole('button', { name: 'Add test to study' }).click();
  await expect(
    page.getByRole('status').filter({ hasText: 'Test configuration saved' }),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Publish study', exact: true })).toBeEnabled();
}

test('configure, preview, publish, and revise a real study', async ({ page, request }) => {
  await signIn(page);
  await createStudy(page, 'Oat drink acceptance');
  await addTest(page);
  await page.getByRole('tab', { name: 'Settings', exact: true }).click();
  await page.getByLabel('Allow assessors to skip questions').check();
  await page.getByRole('tab', { name: 'Questions', exact: true }).click();
  await page.getByRole('button', { name: 'Add question', exact: true }).click();
  await page.getByLabel('Question 2', { exact: true }).fill('How much do you like the aroma?');
  await page.locator('.question-card').nth(1).getByLabel('Answer required').uncheck();
  await page.getByRole('tab', { name: 'Response scale', exact: true }).click();
  await page.getByText('Customize scale labels', { exact: false }).click();
  await page.getByLabel('Rating 9 label').fill('Like extremely — adapted label');
  await page.getByRole('button', { name: 'Save test', exact: true }).click();
  await expect(page.getByText('Unsaved changes', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Preview test', exact: true }).click();
  const preview = page.getByRole('complementary', { name: 'Assessor preview' });
  await expect(preview.getByText('Like extremely — adapted label', { exact: true })).toHaveCount(2);
  await expect(
    preview.getByText('Like extremely — adapted label', { exact: true }).first(),
  ).toBeVisible();
  await preview.getByRole('radio', { name: '7 Like moderately', exact: true }).first().check();
  await expect(preview.getByText('Rating 7 selected')).toBeVisible();
  await preview.getByRole('button', { name: 'Skip this question' }).first().click();
  await expect(preview.getByText('Question skipped')).toBeVisible();

  const id = new URL(page.url()).searchParams.get('study')!;
  const before = await request.get(`${api}/studies/${id}/responses`, { headers });
  expect(await before.json()).toEqual([]);
  const accessibility = await new AxeBuilder({ page }).analyze();
  expect(accessibility.violations).toEqual([]);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: 'test-results/researcher-editor.png', fullPage: true });

  await page
    .getByRole('dialog', { name: 'Preview sensory test' })
    .getByRole('button', { name: 'Close dialog' })
    .click();
  await page.getByRole('tab', { name: 'Questions', exact: true }).click();
  await page.getByRole('button', { name: 'Publish study', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Publish version 1?' })).toBeVisible();
  await page.getByRole('button', { name: 'Publish version', exact: true }).click();
  await expect(page.getByLabel('Assessor instructions')).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Save test', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Create new draft', exact: true }).click();
  await expect(page.getByLabel('Study version')).toHaveValue(/.+/);
  await expect(page.getByLabel('Assessor instructions')).toBeEnabled();
  await page.getByLabel('Assessor instructions').fill('Instructions for version two.');
  await page.getByRole('button', { name: 'Save test', exact: true }).click();
  await page.getByLabel('Study version').selectOption({ label: 'Version 1 · Published' });
  await expect(page.getByLabel('Assessor instructions')).toHaveValue(
    'Taste the sample, then rate your overall liking.',
  );
  await expect(page.getByLabel('Assessor instructions')).toBeDisabled();
  await page.getByRole('button', { name: 'Open current draft', exact: true }).click();
  await expect(page.getByLabel('Assessor instructions')).toHaveValue(
    'Instructions for version two.',
  );

  await page.getByRole('button', { name: 'Study library', exact: true }).click();
  await page.getByLabel('Search studies').fill('Oat drink acceptance');
  await page.getByRole('button', { name: /Oat drink acceptance/ }).click();
  await expect(page.getByLabel('Assessor instructions')).toHaveValue(
    'Instructions for version two.',
  );
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Welcome to your workspace' })).toBeVisible();
  const stored = await page.evaluate(() =>
    [...Object.values(localStorage), ...Object.values(sessionStorage)].join(' '),
  );
  expect(stored).not.toContain(token);
  await page.getByLabel('Researcher access key').fill(token);
  await page.getByRole('button', { name: 'Open workspace' }).click();
  await expect(page.getByLabel('Assessor instructions')).toHaveValue(
    'Instructions for version two.',
  );
});

test('validation, unsaved edits, reordering, and removal stay safe', async ({ page, request }) => {
  await signIn(page);
  await createStudy(page, 'Question ordering');
  await addTest(page, 'Original question');
  await page.getByLabel('Question 1', { exact: true }).fill('Unsaved edit');
  await expect(page.getByRole('button', { name: 'Publish study', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Study details', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Discard unsaved changes?' })).toBeVisible();
  await page.getByRole('button', { name: 'Keep editing', exact: true }).click();
  await expect(page.getByLabel('Question 1', { exact: true })).toHaveValue('Unsaved edit');
  await page.getByRole('button', { name: 'Remove test', exact: true }).click();
  await page.getByRole('button', { name: 'Keep test', exact: true }).click();
  await page.getByRole('button', { name: 'Study details', exact: true }).click();
  await page.getByRole('button', { name: 'Discard changes', exact: true }).click();
  await page.getByRole('button', { name: 'Test 1', exact: true }).click();
  await expect(page.getByLabel('Question 1', { exact: true })).toHaveValue('Original question');
  await page.getByRole('button', { name: 'Add question', exact: true }).click();
  await page.getByLabel('Question 2', { exact: true }).fill('Second question');
  await page.getByRole('button', { name: 'Move question 2 up', exact: true }).click();
  await expect(page.getByLabel('Question 1', { exact: true })).toHaveValue('Second question');
  await page.getByRole('button', { name: 'Save test', exact: true }).click();
  await addTest(page, 'A repeated method');
  await page.getByRole('button', { name: 'Test 1', exact: true }).click();
  await page.getByRole('button', { name: 'Remove test', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Remove test', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Test 2', exact: true })).toHaveCount(0);
  await expect(page.getByLabel('Question 1', { exact: true })).toHaveValue('A repeated method');
  const id = new URL(page.url()).searchParams.get('study')!;
  const body = await (await request.get(`${api}/studies/${id}`, { headers })).json();
  const rows = await (
    await request.get(`${api}/studies/${id}/versions/${body.versions[0].id}/tests`, { headers })
  ).json();
  expect(rows).toHaveLength(1);
  expect(rows[0].position).toBe(0);
});

test('access errors and network failures retain the form', async ({ page }) => {
  await page.goto('./');
  await page.getByLabel('Researcher access key').fill('incorrect');
  await page.getByRole('button', { name: 'Open workspace' }).click();
  await expect(page.getByRole('alert')).toContainText('access key was not accepted');
  await page.getByLabel('Researcher access key').fill(token);
  await page.getByRole('button', { name: 'Open workspace' }).click();
  await expect(page.getByRole('heading', { name: 'Study library' })).toBeVisible();
  await createStudy(page, 'Failed save recovery');
  await addTest(page);
  await page.getByLabel('Assessor instructions').fill('Keep these edits through a failed save.');
  await page.route('**/studies/*/tests/*', (route) =>
    route.request().method() === 'PUT' ? route.abort() : route.continue(),
  );
  await page.getByRole('button', { name: 'Save test', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Cannot reach the laboratory server');
  await expect(page.getByLabel('Assessor instructions')).toHaveValue(
    'Keep these edits through a failed save.',
  );
  await expect(page.getByRole('button', { name: 'Publish study', exact: true })).toBeDisabled();
  await page.unroute('**/studies/*/tests/*');
  await page.getByRole('button', { name: 'Save test', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Publish study', exact: true })).toBeEnabled();
});

test('tablet-width researcher screens remain usable', async ({ page }) => {
  await page.setViewportSize({ width: 768, height: 1024 });
  await signIn(page);
  await createStudy(page, 'Tablet workspace');
  await addTest(page);
  const accessibility = await new AxeBuilder({ page }).analyze();
  expect(accessibility.violations).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.screenshot({ path: 'test-results/researcher-tablet.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Welcome to your workspace' })).toBeVisible();
});

test('study details, method library, and publication review are accessible', async ({
  page,
  request,
}) => {
  await page.goto('./');
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.screenshot({ path: 'test-results/researcher-signin.png', fullPage: true });
  await signIn(page);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.screenshot({ path: 'test-results/researcher-library.png', fullPage: true });
  await page.getByRole('button', { name: 'Method library', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Nine-point hedonic acceptance', exact: true }),
  ).toBeVisible();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page
    .locator('.method-card')
    .filter({
      has: page.getByRole('heading', { name: 'Nine-point hedonic acceptance', exact: true }),
    })
    .getByRole('button', { name: 'Create a study', exact: true })
    .click();
  await page.getByLabel('Study title', { exact: true }).fill('Metadata review');
  await page.getByRole('button', { name: 'Create draft study' }).click();
  await expect(page.getByRole('heading', { name: 'Metadata review', exact: true })).toBeVisible();
  await expect(page.getByLabel('Study title', { exact: true })).toHaveValue('Metadata review');
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.getByLabel('Study title', { exact: true }).fill('Reviewed metadata');
  await page.getByLabel('Description', { exact: true }).fill('Saved from the graphical editor.');
  await page.getByRole('button', { name: 'Save study details', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Reviewed metadata', exact: true })).toBeVisible();
  await addTest(page);
  await page.getByRole('button', { name: 'Publish study', exact: true }).click();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.getByRole('button', { name: 'Publish version', exact: true }).click();
  await page.getByRole('button', { name: 'Study details', exact: true }).click();
  await expect(page.getByLabel('Study title', { exact: true })).toBeDisabled();
  const id = new URL(page.url()).searchParams.get('study')!;
  const body = await (await request.get(`${api}/studies/${id}`, { headers })).json();
  expect(body.versions[0].title).toBe('Reviewed metadata');
  expect(body.versions[0].description).toBe('Saved from the graphical editor.');
});
