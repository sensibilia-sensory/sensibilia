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
}

async function study(page: Page, title: string, addTest = true) {
  await signIn(page);
  await page.getByRole('button', { name: 'New study', exact: true }).click();
  await page.getByLabel('Study title', { exact: true }).fill(title);
  await page.getByRole('button', { name: 'Create draft study' }).click();
  await expect(page.getByRole('heading', { name: title, exact: true })).toBeVisible();
  if (addTest) {
    await page.getByRole('button', { name: 'Add test', exact: true }).click();
    await page.getByLabel('Assessor instructions').fill('Taste the sample and rate your liking.');
    await page.getByLabel('Question 1', { exact: true }).fill('Overall liking');
    await page.getByRole('button', { name: 'Add test to study' }).click();
    await expect(page.getByRole('status')).toContainText('Test configuration saved');
  }
  await page.getByRole('button', { name: 'Session flow', exact: true }).click();
  await expect(page.getByRole('heading', { name: /Session flow/ })).toBeVisible();
}

async function save(page: Page) {
  await page.getByRole('button', { name: 'Save flow', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Session flow saved' })).toBeVisible();
  await expect(page.getByText('Unsaved changes', { exact: true })).toHaveCount(0);
}

test('build consent, acknowledged instructions, shared-scale battery, and publish the flow', async ({
  page,
  request,
}) => {
  await study(page, 'Consent and attitudes');
  await page.getByText('Add block', { exact: true }).click();
  await page.getByRole('button', { name: 'Add consent', exact: true }).click();
  await page
    .getByLabel('Introductory text')
    .fill('Participant information reviewed by the researcher.');
  await page.getByText('Add block', { exact: true }).click();
  await page.getByRole('button', { name: 'Add instructions', exact: true }).click();
  await page
    .getByLabel('Instruction text')
    .fill('Read this information carefully. Ask the researcher if anything is unclear.');
  await page.getByRole('tab', { name: 'Settings', exact: true }).click();
  await page.getByLabel('Require acknowledgment before continuing').check();
  await page.getByLabel('Continue button label').fill('I understand — continue');
  await page.getByRole('button', { name: 'Preview block', exact: true }).click();
  const blockPreview = page.getByRole('complementary', { name: 'Form block preview' });
  await expect(
    blockPreview.getByRole('button', { name: 'I understand — continue' }),
  ).toBeDisabled();
  await blockPreview.getByLabel('I have read and understood these instructions.').check();
  await expect(blockPreview.getByRole('button', { name: 'I understand — continue' })).toBeEnabled();

  await page
    .getByRole('dialog', { name: 'Preview form block' })
    .getByRole('button', { name: 'Close dialog' })
    .click();
  await page.getByText('Add block', { exact: true }).click();
  await page.getByRole('button', { name: 'Add question battery', exact: true }).click();
  await page.getByLabel('Block title', { exact: true }).fill('Food attitudes');
  await page
    .getByLabel('Battery instructions')
    .fill('Please state your agreement with each statement.');
  await page.getByLabel('Row 1', { exact: true }).fill('Contains natural ingredients');
  await page.getByText('Add several rows at once', { exact: true }).click();
  await page.getByLabel('One statement per line').fill('Minimal processing\nNo additives');
  await page.getByRole('button', { name: 'Add statements', exact: true }).click();
  await expect(page.getByLabel('Row 3', { exact: true })).toHaveValue('No additives');
  await page.getByRole('tab', { name: 'Response scale', exact: true }).click();
  await page.getByLabel('Option 1 score', { exact: true }).fill('0');
  await page.getByRole('tab', { name: 'Settings', exact: true }).click();
  await page.getByLabel('Allow explicit skips for matrix rows').check();
  await page.getByRole('button', { name: 'Session endings', exact: true }).click();
  await page
    .getByLabel('Screen-out message')
    .fill('Thank you. Your session ends here without tasting.');
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await page.getByRole('tab', { name: 'Content', exact: true }).click();
  await save(page);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.screenshot({ path: 'test-results/session-flow-editor.png', fullPage: true });

  await page.getByRole('button', { name: 'Preview session', exact: true }).click();
  const preview = page.getByRole('dialog', { name: 'Preview session flow' });
  await expect(preview.getByRole('button', { name: 'Continue', exact: true })).toBeDisabled();
  await preview.getByRole('radio', { name: 'I do not agree', exact: true }).check();
  await preview.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(preview.getByRole('status')).toContainText('SCREENED OUT');
  await expect(preview.getByRole('status')).toContainText('without tasting');
  await preview.getByRole('button', { name: 'Restart preview' }).click();
  await preview.getByRole('radio', { name: 'I agree', exact: true }).check();
  await preview.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(preview.getByRole('button', { name: 'I understand — continue' })).toBeDisabled();
  await preview.getByLabel('I have read and understood these instructions.').check();
  await preview.getByRole('button', { name: 'I understand — continue' }).click();
  await expect(preview.getByRole('heading', { name: 'Food attitudes' })).toBeVisible();
  await preview
    .getByRole('radio', { name: 'Contains natural ingredients: Disagree strongly', exact: true })
    .check();
  await preview.getByRole('radio', { name: 'Minimal processing: Agree', exact: true }).check();
  await expect(preview.getByRole('button', { name: 'Continue', exact: true })).toBeDisabled();
  await preview.getByRole('radio', { name: 'No additives: Skip', exact: true }).check();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.screenshot({ path: 'test-results/session-matrix-preview.png' });
  await preview.getByRole('button', { name: 'Continue', exact: true }).click();
  await preview.getByRole('radio', { name: /7 Like moderately/ }).check();
  await preview.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(preview.getByRole('status')).toContainText('FINISHED');
  await expect(preview.locator('.preview-path li')).toHaveText([
    'Consent',
    'Instructions',
    'Food attitudes',
    'Test 1',
  ]);
  await preview.getByRole('button', { name: 'Close dialog' }).click();

  const id = new URL(page.url()).searchParams.get('study')!;
  expect(await (await request.get(`${api}/studies/${id}/responses`, { headers })).json()).toEqual(
    [],
  );
  expect(
    await (await request.get(`${api}/studies/${id}/form-responses`, { headers })).json(),
  ).toEqual([]);
  await page.getByRole('button', { name: 'Publish study', exact: true }).click();
  await page.getByRole('button', { name: 'Publish version', exact: true }).click();
  await expect(page.getByLabel('Block title', { exact: true })).toBeDisabled();
  const published = await (await request.get(`${api}/studies/${id}`, { headers })).json();
  const original = published.versions[0].form;
  expect(original.steps.map((step: { kind: string }) => step.kind)).toEqual([
    'choice',
    'instruction',
    'matrix',
    'test',
  ]);
  expect(original.steps[2].scale[0].score).toBe(0);
  await page.getByRole('button', { name: 'Create new draft', exact: true }).click();
  await page.getByRole('button', { name: 'Session flow', exact: true }).click();
  const revised = await (await request.get(`${api}/studies/${id}`, { headers })).json();
  expect(revised.versions[1].form.steps[3].study_test_id).not.toEqual(
    original.steps[3].study_test_id,
  );
  await page.getByRole('button', { name: /Food attitudes.*3 rows/ }).click();
  await expect(page.getByLabel('Block title', { exact: true })).toHaveValue('Food attitudes');
  await page.getByLabel('Study version').selectOption({ label: 'Version 1 · Published' });
  await page.getByRole('button', { name: 'Session flow', exact: true }).click();
  await expect(page.getByLabel('Block title', { exact: true })).toBeDisabled();
});

test('configure allergy choices and explicit if / else destinations', async ({ page }) => {
  await study(page, 'Restriction routes', false);
  await page.getByText('Add block', { exact: true }).click();
  await page.getByRole('button', { name: 'Add choice', exact: true }).click();
  await page.getByLabel('Block title', { exact: true }).fill('Allergies');
  await page.getByLabel('Choice question').fill('Which ingredients can you not consume?');
  await page.getByLabel('Allow multiple selections', { exact: true }).check();
  await page.getByLabel('Choice option 1', { exact: true }).fill('Milk');
  await page.getByLabel('Choice option 2', { exact: true }).fill('Soy');
  await page.getByRole('button', { name: 'Add choice option', exact: true }).click();
  await page.getByLabel('Choice option 3', { exact: true }).fill('None');
  await page.locator('.choice-editor-option').nth(2).getByLabel('Exclusive answer').check();
  await page.getByText('Add block', { exact: true }).click();
  await page.getByRole('button', { name: 'Add instructions', exact: true }).click();
  await page.getByLabel('Block title', { exact: true }).fill('Restriction notice');
  await page.getByLabel('Instruction text').fill('Please contact the researcher before tasting.');
  await page.getByRole('tab', { name: 'Routing', exact: true }).click();
  await page.getByLabel('Continue to', { exact: true }).selectOption('screen_out');
  await page.getByText('Add block', { exact: true }).click();
  await page.getByRole('button', { name: 'Add instructions', exact: true }).click();
  await page.getByLabel('Block title', { exact: true }).fill('Ready to start');
  await page.getByLabel('Instruction text').fill('You can now start your evaluation.');
  await page.getByRole('button', { name: /Allergies.*Choice/ }).click();
  await page.getByRole('tab', { name: 'Routing', exact: true }).click();
  await page.getByLabel('Use an if / else rule').check();
  await page
    .getByRole('group', { name: 'Options to match' })
    .getByLabel('Soy', { exact: true })
    .check();
  await page.getByLabel('Then go to').selectOption({ label: 'Restriction notice' });
  await page.getByLabel('Else go to').selectOption({ label: 'Ready to start' });
  await save(page);
  await page.getByRole('button', { name: 'Preview session', exact: true }).click();
  const preview = page.getByRole('dialog');
  await preview.getByRole('checkbox', { name: 'Milk', exact: true }).check();
  await preview.getByRole('checkbox', { name: 'Soy', exact: true }).check();
  await preview.getByRole('checkbox', { name: 'None', exact: true }).check();
  await expect(preview.getByRole('checkbox', { name: 'Milk', exact: true })).not.toBeChecked();
  await expect(preview.getByRole('checkbox', { name: 'Soy', exact: true })).not.toBeChecked();
  await preview.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(preview.getByRole('heading', { name: 'Ready to start', exact: true })).toBeVisible();
  await preview.getByRole('button', { name: 'Restart preview' }).click();
  await preview.getByRole('checkbox', { name: 'Soy', exact: true }).check();
  await preview.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(
    preview.getByRole('heading', { name: 'Restriction notice', exact: true }),
  ).toBeVisible();
  await preview.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(preview.getByRole('status')).toContainText('SCREENED OUT');
});

test('invalid references and failed saves retain edits', async ({ page }) => {
  await study(page, 'Flow recovery', false);
  await page.getByText('Add block', { exact: true }).click();
  await page.getByRole('button', { name: 'Add consent', exact: true }).click();
  await page.getByText('Add block', { exact: true }).click();
  await page.getByRole('button', { name: 'Add instructions', exact: true }).click();
  await page.getByLabel('Instruction text').fill('Instructions that must survive a failed save.');
  await page.getByRole('tab', { name: 'Routing', exact: true }).click();
  await page.getByLabel('Use an if / else rule').check();
  await page.getByRole('group', { name: 'Options to match' }).getByLabel('I agree').uncheck();
  await page.getByRole('button', { name: 'Save flow', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('select existing options');
  await page.getByRole('group', { name: 'Options to match' }).getByLabel('I agree').check();
  await page.route('**/studies/*/versions/*/form', (route) => route.abort());
  await page.getByRole('button', { name: 'Save flow', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Cannot reach');
  await page.getByRole('tab', { name: 'Content', exact: true }).click();
  await expect(page.getByLabel('Instruction text')).toHaveValue(
    'Instructions that must survive a failed save.',
  );
  await page.unroute('**/studies/*/versions/*/form');
  await save(page);
  // A condition remains explicit if its source is deleted; no automatic fallback to tasting.
  await page.getByRole('button', { name: /Consent.*Choice/ }).click();
  await page.getByRole('button', { name: 'Remove block 1', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Remove block', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('route needs a choice');
  await expect(page.getByRole('button', { name: 'Preview session', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Publish study', exact: true })).toBeDisabled();
});

test('matrix rehearsal is accessible at tablet and phone widths', async ({ page }) => {
  await page.setViewportSize({ width: 768, height: 1024 });
  await study(page, 'Tablet battery', false);
  await page.getByText('Add block', { exact: true }).click();
  await page.getByRole('button', { name: 'Add question battery', exact: true }).click();
  await page.getByLabel('Battery instructions').fill('How often do you consume each food?');
  await page.getByLabel('Row 1', { exact: true }).fill('Vegetables');
  await page.getByRole('tab', { name: 'Response scale', exact: true }).click();
  await page.getByLabel('Scale template').selectOption('frequency');
  await save(page);
  await page.getByRole('button', { name: 'Preview session', exact: true }).click();
  const preview = page.getByRole('dialog');
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.setViewportSize({ width: 390, height: 844 });
  await preview.getByRole('radio', { name: 'Vegetables: Never', exact: true }).check();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await expect(preview.getByRole('button', { name: 'Continue', exact: true })).toBeEnabled();
  const widths = await page.evaluate(() => [
    document.documentElement.scrollWidth,
    window.innerWidth,
  ]);
  expect(widths[0]).toBeLessThanOrEqual(widths[1]);
  await page.screenshot({ path: 'test-results/session-matrix-phone.png' });
});

test('duplicate blocks and sensory tests with independent identifiers and scales', async ({
  page,
  request,
}) => {
  await study(page, 'Repeated blocks');
  await page.getByRole('button', { name: 'Duplicate block', exact: true }).click();
  await expect(page.getByLabel('Block title', { exact: true })).toHaveValue('Test 1 (copy)');
  await page.getByText('Add block', { exact: true }).click();
  await page.getByRole('button', { name: 'Add consent', exact: true }).click();
  await page.getByRole('button', { name: 'Duplicate block', exact: true }).click();
  await page.getByLabel('Choice question').fill('Do you also agree to this additional procedure?');
  await page.getByText('Add block', { exact: true }).click();
  await page.getByRole('button', { name: 'Add question battery', exact: true }).click();
  await page.getByLabel('Battery instructions').fill('Answer each statement.');
  await page.getByLabel('Row 1', { exact: true }).fill('First statement');
  await page.getByRole('button', { name: 'Duplicate block', exact: true }).click();
  await page.getByRole('tab', { name: 'Response scale', exact: true }).click();
  await page.getByLabel('Option 1 label', { exact: true }).fill('Independent label');
  await save(page);
  const id = new URL(page.url()).searchParams.get('study')!;
  const result = await (await request.get(`${api}/studies/${id}`, { headers })).json();
  const version = result.versions[0];
  const steps = version.form.steps;
  expect(new Set(steps.map((step: { id: string }) => step.id)).size).toBe(6);
  expect(steps[1].route.condition.source_step_id).toBe(steps[1].id);
  expect(steps[0].route.condition.source_step_id).toBe(steps[0].id);
  expect(steps[2].scale[0].label).toBe('Disagree strongly');
  expect(steps[3].scale[0].label).toBe('Independent label');
  expect(steps[4].study_test_id).not.toBe(steps[5].study_test_id);
  const tests = await (
    await request.get(`${api}/studies/${id}/versions/${version.id}/tests`, { headers })
  ).json();
  expect(tests).toHaveLength(2);
  expect(tests[0].configuration).toEqual(tests[1].configuration);
  await page.getByRole('button', { name: 'Publish study', exact: true }).click();
  await page.getByRole('button', { name: 'Publish version', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Duplicate block', exact: true })).toHaveCount(0);
});

test('navigate a long form and bulk-edit a hundred-row battery with save always available', async ({
  page,
  request,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await study(page, 'Large questionnaire', false);
  await page.getByText('Add block', { exact: true }).click();
  await page.getByRole('button', { name: 'Add instructions', exact: true }).click();
  await page.getByLabel('Block title', { exact: true }).fill('Block 1');
  await page.getByLabel('Instruction text').fill('Read this instruction before continuing.');
  for (let index = 2; index <= 30; index++) {
    await page.getByRole('button', { name: 'Duplicate block', exact: true }).click();
    await page.getByLabel('Block title', { exact: true }).fill(`Block ${index}`);
  }
  await page.getByLabel('Find a block').fill('Block 24');
  await expect(page.locator('.compact-outline li')).toHaveCount(1);
  await page.getByRole('button', { name: /Block 24.*Text/ }).click();
  await page.getByText('Add block', { exact: true }).click();
  await page.getByRole('button', { name: 'Add question battery', exact: true }).click();
  await expect(page.getByLabel('Find a block')).toHaveValue('');
  await page.getByLabel('Battery instructions').fill('Please answer every statement.');
  await page.getByText('Add several rows at once', { exact: true }).click();
  await page
    .getByLabel('One statement per line')
    .fill(Array.from({ length: 100 }, (_, i) => `Statement ${i + 1}`).join('\n'));
  await page.getByRole('button', { name: 'Add statements', exact: true }).click();
  await expect(page.getByLabel('Row 100', { exact: true })).toHaveValue('Statement 100');
  await page.getByLabel('Row 100', { exact: true }).fill('Edited final statement');
  const saveButton = page.getByRole('button', { name: 'Save flow', exact: true });
  const bounds = await saveButton.boundingBox();
  expect(bounds!.y).toBeGreaterThanOrEqual(0);
  expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(900);
  await page.getByRole('tab', { name: 'Content', exact: true }).focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('tab', { name: 'Response scale', exact: true })).toBeFocused();
  await page.keyboard.press('End');
  await expect(page.getByRole('tab', { name: 'Settings', exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await page.keyboard.press('Home');
  await save(page);
  const id = new URL(page.url()).searchParams.get('study')!;
  const result = await (await request.get(`${api}/studies/${id}`, { headers })).json();
  const steps = result.versions[0].form.steps;
  expect(steps).toHaveLength(31);
  expect(steps[23].title).toBe('Block 24');
  expect(steps[24].rows).toHaveLength(100);
  expect(steps[24].rows[99].prompt).toBe('Edited final statement');
  expect(steps[25].title).toBe('Block 25');
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.screenshot({ path: 'test-results/large-form-desktop.png' });
});

test('touch authoring remains usable at tablet and phone widths', async ({ browser }) => {
  const context = await browser.newContext({
    baseURL: 'http://127.0.0.1:5174/researcher/',
    hasTouch: true,
    viewport: { width: 768, height: 1024 },
  });
  const page = await context.newPage();
  try {
    await study(page, 'Touch controls', false);
    expect(await page.evaluate(() => matchMedia('(pointer: coarse)').matches)).toBe(true);
    await page.getByText('Add block', { exact: true }).click();
    await page.getByRole('button', { name: 'Add question battery', exact: true }).click();
    await page.getByLabel('Battery instructions').fill('Answer these statements.');
    await page
      .getByLabel('Row 1', { exact: true })
      .fill(
        'This is a longer statement that must remain fully visible when the question row becomes narrower on a touch screen.',
      );
    for (const width of [768, 390]) {
      await page.setViewportSize({ width, height: 1024 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      const remove = await page
        .getByRole('button', { name: 'Remove row 1', exact: true })
        .boundingBox();
      expect(remove!.height).toBeGreaterThanOrEqual(44);
      const textarea = page.getByLabel('Row 1', { exact: true });
      await expect
        .poll(() => textarea.evaluate((element) => element.clientHeight >= element.scrollHeight))
        .toBe(true);
      expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    }
    await page.screenshot({ path: 'test-results/touch-form-phone.png', fullPage: true });
    await save(page);
  } finally {
    await context.close();
  }
});
