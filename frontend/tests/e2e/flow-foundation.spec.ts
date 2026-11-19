import { fieldLabels } from '../../src/shared/lexicon';
import { snapshotWorkflow } from './snapshot-workflow';
import { wideExportWorkflow } from './wide-export-workflow';
import { assetsWorkflow } from './assets-workflow';
import { temporalWorkflow } from './temporal-workflow';
import { registeredMethodsWorkflow } from './v2-methods-workflow';
import { questionnaireGalleryProof, questionnaireWorkflow } from './questionnaire-workflow';
import { readFile, writeFile } from 'node:fs/promises';
import { proveCollection, proveCsv } from './complete-proof';
import { csvRecords } from './csv';
import { offlineLifecycle, openStaff, stored } from './offline-helpers';
import { outline } from '../../src/shared/flow';
import { methodTextFields } from '../../src/shared/flow/text';
import type { Configuration } from '../../src/shared/methods/hedonic_acceptance_9/validation';
import type { Flow, Test } from '../../src/shared/flow';
import { test, expect, type Page } from '@playwright/test';
import { expectFlowSaved } from './save';
import { capture } from './capture';
import { timeoutScale } from '../timeouts';
import { evidencePath } from './evidence';
import { addMethodStep, addStep, moreAction, startStudy } from './steps';

const token = 'e2e-researcher-' + 'x'.repeat(32);
const headers = { Authorization: 'Bearer ' + token };
async function signIn(page: Page) {
  await page.getByLabel('Access key', { exact: true }).fill(token);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
}

test('flow foundation: real backend create configure reload preview publish package', async ({
  page,
  request,
}, testInfo) => {
  test.setTimeout(1080000 * timeoutScale);
  expect((await request.get('/health')).status()).toBe(200);
  await page.goto('/researcher/methods');
  if (new URL(page.url()).protocol === 'https:') {
    expect(await page.evaluate(() => isSecureContext)).toBe(true);
    expect(await page.content()).not.toContain('/@vite/client');
  }
  await signIn(page);
  const methods = page.getByTestId('methods-table');
  await expect(methods.locator('tbody tr[data-row-id]')).toHaveCount(10);
  await capture(page, 'slice-12-methods', 'desktop', 'page');
  // The reference list is documentation: no per-method study actions.
  await expect(methods.getByRole('button', { name: 'Create study' })).toHaveCount(0);
  await startStudy(page);
  await expect(page).toHaveURL(/\/researcher\/studies\/new$/);
  await page.getByLabel('Title', { exact: true }).fill('Slice 2 real workflow');
  await page.getByLabel('Description', { exact: true }).fill('Nine-point hedonic proof');
  await capture(page, 'slice-12-create', 'desktop', 'page');
  await page.getByRole('button', { name: 'Create draft', exact: true }).click();
  await expect(page).toHaveURL(/\/versions\/[^/]+\/flow$/);
  const base = page.url().replace(/\/flow$/, '');
  const parts = new URL(base).pathname.split('/');
  const s = parts[3],
    v = parts[5];
  await expect(page.getByTestId('flow-outline')).toContainText('No steps yet.');
  await capture(page, 'slice-12-empty-flow', 'desktop', 'page');
  await addMethodStep(page, 'hedonic-9-v1');
  const editor = page.getByRole('complementary', { name: 'New hedonic method', exact: true });
  await expect(editor).toBeVisible();
  await editor
    .getByLabel('Instructions', { exact: true })
    .fill('Taste the sample and rate your overall liking.');
  await editor.getByLabel('Question text 1', { exact: true }).fill('Overall liking');
  const invalid = editor.getByLabel('Scale label 9', { exact: true });
  await invalid.fill('');
  await editor.getByRole('button', { name: 'Add configured method', exact: true }).click();
  await expect(invalid).toHaveAttribute('aria-invalid', 'true');
  await expect(page.getByTestId('flow-outline').locator('tbody tr[data-row-id]')).toHaveCount(0);
  await invalid.fill('Like extremely');
  await editor.getByRole('button', { name: 'Add configured method', exact: true }).click();
  await expect(page.getByTestId('flow-outline').locator('tbody tr[data-row-id]')).toHaveCount(2);
  await Promise.all([
    page
      .waitForResponse(
        (response) => response.request().method() === 'PUT' && response.url().endsWith('/draft'),
      )
      .then((response) => expect(response.status()).toBe(200)),
    page.getByRole('button', { name: 'Save flow', exact: true }).click(),
  ]);
  await expectFlowSaved(page);
  const saved = await request.get('/studies/' + s + '/versions/' + v, { headers });
  expect(saved.ok()).toBeTruthy();
  const snapshot = await saved.json();
  const nodeId = snapshot.form.nodes[0].id;
  await capture(page, 'slice-12-flow', 'desktop', '[data-testid="flow-outline"]');
  await page.getByRole('tab', { name: 'Details', exact: true }).click();
  await capture(page, 'slice-12-details', 'desktop', '#main');
  await page.getByRole('tab', { name: 'Study sequence', exact: true }).click();
  await page
    .getByTestId('flow-outline')
    .locator('tbody tr[data-row-id]')
    .first()
    .getByRole('button', { name: 'Edit', exact: true })
    .click();
  await expect(page).toHaveURL(new RegExp(nodeId + '$'));
  await page.getByLabel('Step title', { exact: true }).fill('Overall acceptance');
  await Promise.all([
    page
      .waitForResponse(
        (response) => response.request().method() === 'PUT' && response.url().endsWith('/draft'),
      )
      .then((response) => expect(response.status()).toBe(200)),
    page.getByRole('button', { name: 'Save flow', exact: true }).click(),
  ]);
  await page.reload();
  await signIn(page);
  await expect(page.getByLabel('Step title', { exact: true })).toHaveValue('Overall acceptance');
  // A real concurrent researcher edit rejects stale saves without losing the buffer.
  await page.getByLabel('Step title', { exact: true }).fill('Retained unsaved title');
  await page.goBack();
  await expect(page).toHaveURL(new RegExp(nodeId + '$'));
  await expect(page.getByRole('group', { name: 'Unsaved navigation', exact: true })).toBeVisible();
  await expect(page.getByLabel('Step title', { exact: true })).toHaveValue(
    'Retained unsaved title',
  );
  await page.getByRole('button', { name: 'Keep editing', exact: true }).click();
  const concurrent = await (
    await request.get('/studies/' + s + '/versions/' + v, { headers })
  ).json();
  expect(
    (
      await request.patch('/studies/' + s + '/versions/' + v, {
        headers,
        data: {
          title: concurrent.title,
          description: 'Concurrent metadata edit',
          revision_hash: concurrent.revision_hash,
        },
      })
    ).status(),
  ).toBe(200);
  await page.getByRole('button', { name: 'Save flow', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Draft changed');
  await expect(page.getByLabel('Step title', { exact: true })).toHaveValue(
    'Retained unsaved title',
  );
  await page.getByRole('button', { name: 'Discard', exact: true }).click();
  await expect(page.getByLabel('Step title', { exact: true })).toHaveValue('Overall acceptance');
  await capture(page, 'slice-12-node', 'desktop', '#main');
  const saveFlow = async () => {
    await Promise.all([
      page
        .waitForResponse((r) => r.request().method() === 'PUT' && r.url().endsWith('/draft'))
        .then((r) => expect(r.status()).toBe(200)),
      page.getByRole('button', { name: 'Save flow', exact: true }).click(),
    ]);
    await expectFlowSaved(page);
  };
  const select = async (id: string) => {
    await page
      .getByTestId('flow-outline')
      .locator('tr[data-row-id="' + id + '"]')
      .getByRole('button', { name: 'Edit', exact: true })
      .click();
  };
  const add = async (kind: string, title: string) => {
    await addStep(page, kind);
    await page.getByLabel('Step title', { exact: true }).fill(title);
    return new URL(page.url()).pathname.split('/').at(-1)!;
  };
  const guard = async (variable: string, operator: string, literal?: string) => {
    await page.getByRole('button', { name: 'Show only if', exact: true }).click();
    await page.getByLabel('Show if', { exact: true }).selectOption('condition');
    await page.getByLabel('Answer or setting 1', { exact: true }).selectOption(variable);
    await page.getByLabel('Comparison 1', { exact: true }).selectOption(operator);
    if (literal !== undefined) {
      const field = page.getByLabel('Compare with 1', { exact: true });
      if (await field.evaluate((el) => el.tagName === 'SELECT')) await field.selectOption(literal);
      else await field.fill(literal);
    }
    await page.getByRole('button', { name: 'Close Show only if', exact: true }).click();
  };
  const consentId = await add('consent', 'Consent');
  await page.getByLabel('Text', { exact: true }).fill('Please choose whether you consent.');
  await page.getByLabel('Agree button text', { exact: true }).fill('I agree');
  await page.getByLabel('Decline button text', { exact: true }).fill('I decline');
  await page.getByRole('button', { name: 'Move Consent up', exact: true }).click();
  await saveFlow();
  const restrictionId = await add('question', 'Restrictions');
  await page.getByLabel('Answer type', { exact: true }).selectOption('multiple');
  await page.getByLabel('Question text', { exact: true }).fill('Choose restrictions');
  await page.getByLabel('ID', { exact: true }).nth(0).fill('nuts');
  await page.getByLabel('Option text', { exact: true }).nth(0).fill('Nuts');
  await page.getByLabel('ID', { exact: true }).nth(1).fill('none');
  await page.getByLabel('Option text', { exact: true }).nth(1).fill('None');
  await page.getByLabel('Exclusive', { exact: true }).nth(1).check();
  // Switching to single choice clears multiple-only flags, rather than retaining hidden invalid data.
  await page.getByLabel('Answer type', { exact: true }).selectOption('single');
  await saveFlow();
  await page.getByLabel('Answer type', { exact: true }).selectOption('multiple');
  await expect(page.getByLabel('Exclusive', { exact: true }).nth(1)).not.toBeChecked();
  await page.getByLabel('Exclusive', { exact: true }).nth(1).check();
  await page.getByLabel('Restriction source', { exact: true }).check();
  await saveFlow();
  const reviewId = await add('confirm', 'Restriction review');
  await page.getByLabel('Text', { exact: true }).fill('Review your declared restrictions.');
  await page.getByLabel('Confirm button text', { exact: true }).fill('Reviewed restrictions');
  await guard('assessor.restrictions', 'neq');
  await saveFlow();
  const codeId = await add('code entry', 'Returning code');
  await page.getByLabel('Question text', { exact: true }).fill('Returning participant code');
  await page.getByLabel('Compare codes by', { exact: true }).selectOption('trim_upper_ascii');
  await saveFlow();
  const groupId = await add('group', 'Baseline questions');
  await guard('answer.' + codeId + '.matched', 'eq', 'false');
  const ageId = await add('question', 'Age');
  await page.getByLabel('Answer type', { exact: true }).selectOption('integer');
  await page.getByLabel('Question text', { exact: true }).fill('Age in years');
  await page.getByLabel('Lowest value', { exact: true }).fill('0.5');
  await page.getByLabel('Highest value', { exact: true }).fill('120');
  await page.getByRole('button', { name: 'Save flow', exact: true }).click();
  await expect(page.getByLabel('Lowest value', { exact: true })).toHaveAttribute(
    'aria-invalid',
    'true',
  );
  await expect(page.getByLabel('Lowest value', { exact: true })).toHaveValue('0.5');
  await capture(page, 'slice-12-invalid-integer', 'desktop', '#main');
  await page.getByRole('table', { name: 'Field errors', exact: true }).scrollIntoViewIfNeeded();
  await capture(page, 'slice-12-field-errors');
  await page.getByLabel('Lowest value', { exact: true }).fill('0');
  await saveFlow();
  await select(nodeId);
  const detourId = await add('confirm', 'Route review');
  await page.getByLabel('Text', { exact: true }).fill('Review route');
  await page.getByLabel('Confirm button text', { exact: true }).fill('Route acknowledged');
  await guard('context.language', 'eq', 'sv');
  await page
    .getByLabel('If condition is not met', { exact: true })
    .selectOption('previous_question');
  await page.getByRole('button', { name: 'Move Route review up', exact: true }).click();
  await saveFlow();
  const finishRow = page
    .getByTestId('flow-outline')
    .locator('tr[data-row-id]')
    .filter({ hasText: 'Finish' });
  const finishId = (await finishRow.getAttribute('data-row-id'))!;
  await select(finishId);
  const screenId = await add('end', 'Ineligible');
  await page.getByLabel('Text', { exact: true }).fill('Participation ended.');
  await page.getByLabel('Result', { exact: true }).selectOption('screened_out');
  await saveFlow();
  await select(restrictionId);
  await guard('answer.' + consentId, 'eq', 'true');
  await page.getByLabel('If condition is not met', { exact: true }).selectOption('end_study');
  await page.getByLabel('If condition is not met target', { exact: true }).selectOption(screenId);
  await saveFlow();
  await select(reviewId);
  await page.getByLabel('If condition is not met', { exact: true }).selectOption('skip_to');
  await page.getByLabel('If condition is not met target', { exact: true }).selectOption(codeId);
  await saveFlow();
  const guidanceId = await add('info', 'Restriction guidance');
  await page
    .getByLabel('Text', { exact: true })
    .fill('Follow the laboratory instructions for restrictions.');
  await saveFlow();
  await select(reviewId);
  await expect(page.getByLabel('If condition is not met target', { exact: true })).toHaveValue(
    codeId,
  );
  await expect(page.getByLabel('If condition is not met target', { exact: true })).toContainText(
    '5 Returning code',
  );
  await expect(page.getByTestId('flow-outline').locator('svg.ui-outline-gutter')).toHaveCount(1);
  await capture(page, 'slice-12-guards-flow', 'desktop', '[data-testid="flow-outline"]');
  // Stable UUID targets survive renumbering; group children retain hierarchical numbering.
  const guardsSnapshot = await (
    await request.get('/studies/' + s + '/versions/' + v, { headers })
  ).json();
  expect(
    guardsSnapshot.form.nodes.find((n: { id: string }) => n.id === reviewId).otherwise.target_id,
  ).toBe(codeId);
  expect(
    guardsSnapshot.form.nodes.find((n: { id: string }) => n.id === groupId).data.children[0].id,
  ).toBe(ageId);
  expect(
    guardsSnapshot.form.nodes.find((n: { id: string }) => n.id === detourId).otherwise.action,
  ).toBe('previous_question');
  expect(guardsSnapshot.form.nodes.find((n: { id: string }) => n.id === guidanceId).kind).toBe(
    'info',
  );
  await expect(page.getByRole('button', { name: 'Show only if', exact: true })).toBeEnabled();
  await select(restrictionId);
  await page.getByTestId('node-references').scrollIntoViewIfNeeded();
  await expect(page.getByTestId('node-references')).toContainText('Restriction review');
  await capture(page, 'slice-12-references', 'desktop', '[data-testid="node-references"]');
  await select(detourId);
  await guard('context.booth_number', 'eq', '0');
  await saveFlow();
  await page.getByRole('tab', { name: 'Release', exact: true }).click();
  await page.getByRole('button', { name: 'Review saved snapshot', exact: true }).click();
  await expect(
    page
      .getByTestId('publication-issues')
      .getByText(/rule reads an answer that an assessor may not have given/)
      .first(),
  ).toBeVisible();
  await expect(page.getByLabel('Acknowledge freeze', { exact: true })).toBeDisabled();
  await capture(page, 'slice-12-invalid-guard', 'desktop', '[data-testid="publication-issues"]');
  await page.getByRole('tab', { name: 'Study sequence', exact: true }).click();
  await select(detourId);
  await guard('context.language', 'eq', 'sv');
  await saveFlow();
  const backward = await (
    await request.get('/studies/' + s + '/versions/' + v, { headers })
  ).json();
  backward.form.nodes.find((n: { id: string }) => n.id === detourId).otherwise = {
    action: 'skip_to',
    target_id: consentId,
  };
  expect(
    (
      await request.put('/studies/' + s + '/versions/' + v + '/form', {
        headers,
        data: { form: backward.form, revision_hash: backward.revision_hash },
      })
    ).status(),
  ).toBe(200);
  await page.getByRole('button', { name: 'Reload', exact: true }).click();
  await expect(page.getByLabel('If condition is not met target', { exact: true })).toHaveValue(
    consentId,
  );
  await expect(page.getByLabel('If condition is not met target', { exact: true })).toContainText(
    'Illegal/missing target',
  );
  await page.getByRole('tab', { name: 'Release', exact: true }).click();
  await page.getByRole('button', { name: 'Review saved snapshot', exact: true }).click();
  await expect(
    page
      .getByTestId('publication-issues')
      .getByText(/skip points to a step it cannot jump to/)
      .first(),
  ).toBeVisible();
  await page.getByRole('tab', { name: 'Study sequence', exact: true }).click();
  await select(detourId);
  await page
    .getByLabel('If condition is not met', { exact: true })
    .selectOption('previous_question');
  await saveFlow();
  await page.getByRole('tab', { name: 'Preview', exact: true }).click();
  let ingestion = 0;
  page.on('request', (r) => {
    if (r.method() === 'POST' && /responses|form-events|path-events/.test(r.url())) ingestion++;
  });
  await expect(page.getByRole('radio', { checked: true })).toHaveCount(0);
  await page.getByRole('radio', { name: 'I agree', exact: true }).check();
  await page.getByRole('button', { name: 'Next', exact: true }).click();
  await page.getByRole('checkbox', { name: 'Nuts', exact: true }).check();
  await page.getByRole('button', { name: 'Next', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Restriction review', exact: true }),
  ).toBeVisible();
  await page.getByLabel('Reviewed restrictions', { exact: true }).check();
  await page.getByRole('button', { name: 'Next', exact: true }).click();
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await page.getByRole('button', { name: 'Next', exact: true }).click();
  await page.getByLabel('Age in years', { exact: true }).fill('0');
  await page.getByRole('button', { name: 'Next', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Review only' })).toBeVisible();
  await expect(page.getByLabel('Age in years', { exact: true })).toBeDisabled();
  await expect(page.getByLabel('Age in years', { exact: true })).toHaveValue('0');
  await capture(page, 'slice-12-review-zero', 'desktop', '#main');
  await page.getByRole('button', { name: 'Return to flow', exact: true }).click();
  await expect(page.getByRole('radio')).toHaveCount(9);
  await expect(page.getByRole('radio', { checked: true })).toHaveCount(0);
  const targets = await page
    .locator('.ui-choice-scale label')
    .evaluateAll((els) => els.map((e) => e.getBoundingClientRect().height));
  expect(targets.every((h) => h >= 48)).toBe(true);
  await capture(page, 'slice-12-preview', 'desktop', '#main');
  await page.getByRole('radio', { name: '9 · Like extremely', exact: true }).check();
  await page.getByRole('button', { name: 'Next', exact: true }).click();
  await expect(
    page.getByRole('status').filter({ hasText: 'Thank you for participating.' }),
  ).toBeVisible();
  await page.getByText('Rehearsal context', { exact: true }).click();
  await page.getByLabel('Returning codes', { exact: true }).fill('ABC');
  await page
    .getByRole('button', { name: 'Apply rehearsal context and reset', exact: true })
    .click();
  await page.getByRole('radio', { name: 'I agree', exact: true }).check();
  await page.getByRole('button', { name: 'Next', exact: true }).click();
  await page.getByRole('checkbox', { name: 'None', exact: true }).check();
  await page.getByRole('button', { name: 'Next', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Returning code', exact: true })).toBeVisible();
  await page.getByLabel('Returning participant code', { exact: true }).fill(' abc ');
  await page.getByRole('button', { name: 'Next', exact: true }).click();
  // Returning membership omits the group; the detour reviews the immutable code.
  await expect(page.getByRole('status').filter({ hasText: 'Review only' })).toBeVisible();
  await expect(page.getByLabel('Returning participant code', { exact: true })).toBeDisabled();
  await expect(page.getByLabel('Returning participant code', { exact: true })).toHaveValue('ABC');
  await expect(page.getByLabel('Age in years', { exact: true })).toHaveCount(0);
  await capture(page, 'slice-12-returning-review');
  await page.getByRole('button', { name: 'Return to flow', exact: true }).click();
  await page.getByRole('radio', { name: '9 · Like extremely', exact: true }).check();
  await page.getByRole('button', { name: 'Next', exact: true }).click();
  await page.getByRole('button', { name: 'Reset rehearsal', exact: true }).click();
  await page.getByRole('radio', { name: 'I decline', exact: true }).check();
  await page.getByRole('button', { name: 'Next', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Participation ended.' })).toBeVisible();
  expect(ingestion).toBe(0);
  await page.getByRole('tab', { name: 'Release', exact: true }).click();
  await page.goBack();
  await expect(page.getByRole('tab', { name: 'Preview', exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await page.goForward();
  await page.getByRole('button', { name: 'Review saved snapshot', exact: true }).click();
  await expect(page.getByText('Flow snapshot is valid.', { exact: true })).toBeVisible();
  await page.getByLabel('Acknowledge freeze', { exact: true }).check();
  for (const warning of await page.getByRole('checkbox', { name: /^Acknowledge warning:/ }).all())
    await warning.check();
  await capture(page, 'slice-12-publish', 'desktop', '#main');
  await page.getByRole('button', { name: 'Release for collection', exact: true }).click();
  await expect(page.getByText(/Published at/)).toBeVisible();
  const provision = await request.post('/sessions', {
    headers,
    data: { study_version_id: v, assessor_code: 'FLOW-01' },
  });
  expect(provision.status()).toBe(201);
  const session = await provision.json();
  const pkg = await request.get('/sessions/' + session.id + '/test', {
    headers: { Authorization: 'Bearer ' + session.session_token },
  });
  expect(pkg.status()).toBe(200);
  const data = await pkg.json();
  expect(data.package_schema_version).toBe(4);
  expect(data.flow.nodes.find((n: { id: string }) => n.id === nodeId).id).toBe(nodeId);
  expect(data.flow.nodes.find((n: { id: string }) => n.id === nodeId).title.en).toBe(
    'Overall acceptance',
  );
  expect(data.evaluator_version).toBe('guards-v2.2');
  expect(data.tests[0].configuration.scale_labels).toHaveLength(9);
  expect(
    (
      await request.put('/studies/' + s + '/versions/' + v + '/form', {
        headers,
        data: { form: data.flow, revision_hash: data.revision_hash },
      })
    ).status(),
  ).toBe(409);
  await page.getByRole('tab', { name: 'Study sequence', exact: true }).click();
  await page
    .getByTestId('flow-outline')
    .locator('tbody tr[data-row-id]')
    .first()
    .getByRole('button', { name: 'Edit', exact: true })
    .click();
  await expect(page.getByLabel('Step title', { exact: true })).toBeDisabled();
  await capture(page, 'slice-12-readonly', 'desktop', '#main');
  await page.getByRole('button', { name: 'Revise study', exact: true }).click();
  await expect(page).toHaveURL(/versions\/[^/]+\/flow$/);
  const cloneVersion = new URL(page.url()).pathname.split('/')[5];
  expect(cloneVersion).not.toBe(v);
  const cloned = await (
    await request.get('/studies/' + s + '/versions/' + cloneVersion, { headers })
  ).json();
  expect(
    cloned.form.nodes.find((n: { id: string }) => n.id === nodeId).data.study_test_id,
  ).not.toBe(data.tests[0].id);
  await select(ageId);
  await page.getByRole('button', { name: 'Move out of group', exact: true }).click();
  await saveFlow();
  await expect(
    page
      .getByTestId('flow-outline')
      .locator('tr[data-row-id="' + ageId + '"] td')
      .first(),
  ).toHaveText('7');
  await page.getByRole('button', { name: 'Move into group above', exact: true }).click();
  await saveFlow();
  await expect(
    page
      .getByTestId('flow-outline')
      .locator('tr[data-row-id="' + ageId + '"] td')
      .first(),
  ).toHaveText('6.1');
  const groupRow = page.getByTestId('flow-outline').locator('tr[data-row-id="' + groupId + '"]');
  await groupRow.focus();
  await page.keyboard.press('ArrowLeft');
  await expect(
    page.getByTestId('flow-outline').locator('tr[data-row-id="' + ageId + '"]'),
  ).toHaveCount(0);
  await page.keyboard.press('End');
  await expect(
    page.getByTestId('flow-outline').locator('tbody tr[data-row-id]').last(),
  ).toBeFocused();
  await page.keyboard.press('Home');
  await expect(
    page.getByTestId('flow-outline').locator('tbody tr[data-row-id]').first(),
  ).toBeFocused();
  await groupRow.focus();
  await page.keyboard.press('ArrowRight');
  await expect(
    page.getByTestId('flow-outline').locator('tr[data-row-id="' + ageId + '"]'),
  ).toHaveCount(1);
  await select(guidanceId);
  await page.getByRole('button', { name: 'Duplicate step', exact: true }).click();
  await expect(page.getByLabel('Step title', { exact: true })).toHaveValue(
    'Copy of Restriction guidance',
  );
  await saveFlow();
  await page.getByRole('button', { name: 'Delete step', exact: true }).click();
  await page.getByRole('button', { name: 'Confirm delete step', exact: true }).click();
  await saveFlow();
  expect(
    await (
      await request.get('/sessions/' + session.id + '/test', {
        headers: { Authorization: 'Bearer ' + session.session_token },
      })
    ).json(),
  ).toEqual(data);
  await capture(page, 'slice-12-cloned-flow');

  // The same real-backend workflow continues with fixed samples.
  await select(nodeId);
  await addStep(page, 'sample loop');
  const loopId = new URL(page.url()).pathname.split('/')[7];
  await page.getByLabel('Step title', { exact: true }).fill('Fixed samples');
  for (let i = 0; i < 4; i++) {
    await page.getByLabel('Sample code', { exact: true }).fill('S' + i);
    await page.getByLabel('Private label', { exact: true }).fill('Private product ' + i);
    await page.getByLabel('Ingredient tags', { exact: true }).fill(i === 1 ? 'nut' : '');
    await page.getByLabel('Tags reviewed', { exact: true }).check();
    await page.getByRole('button', { name: 'Create and include sample', exact: true }).click();
    await expect(page.getByTestId('loop-samples').locator('tbody tr[data-row-id]')).toHaveCount(
      i + 1,
    );
  }
  await saveFlow();
  await page.getByRole('button', { name: 'Move Fixed samples up', exact: true }).click();
  await select(nodeId);
  await page.getByRole('button', { name: 'Move into group above', exact: true }).click();
  await saveFlow();
  await select(loopId);
  await page.getByTestId('loop-samples').scrollIntoViewIfNeeded();
  await capture(page, 'slice-12-loop-properties', 'desktop', '[data-testid="loop-samples"]');
  await page.reload();
  await signIn(page);
  await expect(page.getByTestId('loop-samples').locator('tbody tr[data-row-id]')).toHaveCount(4);
  const loopBase = '/studies/' + s + '/versions/' + cloneVersion;
  // The complete proof authors every loop detail through the existing controls.
  await select(restrictionId);
  await page.getByLabel('Tags for nuts', { exact: true }).fill('nut');
  await saveFlow();
  await select(loopId);
  const rinseId = await add('info', 'Rinse');
  await page.getByLabel('Text', { exact: true }).fill('Researcher supplied rinse instructions.');
  await page.getByRole('button', { name: 'Move Rinse up', exact: true }).click();
  await saveFlow();
  const sampleCodeId = await add('code entry', 'Presented sample');
  await page.getByLabel('Question text', { exact: true }).fill('Confirm sample code');
  await page.getByLabel('Code used for', { exact: true }).selectOption('sample_code');
  await page.getByLabel('Allow unknown codes', { exact: true }).uncheck();
  await page.getByLabel('Compare codes by', { exact: true }).selectOption('trim_upper_ascii');
  await saveFlow();
  const warningId = await add('info', 'Do not taste');
  await page.getByLabel('Text', { exact: true }).fill('Do not taste this sample.');
  await guard('derived.sample_conflicts_restriction', 'eq', 'true');
  await saveFlow();
  await select(nodeId);
  await guard('derived.sample_conflicts_restriction', 'eq', 'false');
  await page.getByLabel('If condition is not met', { exact: true }).selectOption('next_sample');
  await saveFlow();
  const savedLoop = await (await request.get(loopBase, { headers })).json();
  const loop = savedLoop.form.nodes.find((n: { id: string }) => n.id === loopId);
  expect(loop.data.children.map((n: { id: string }) => n.id)).toEqual([
    rinseId,
    sampleCodeId,
    warningId,
    nodeId,
  ]);
  expect(loop.data.children.at(-1).data.sample_binding).toBe('current');
  await page.reload();
  await signIn(page);
  await page.getByRole('tab', { name: 'Preview', exact: true }).click();
  await page.getByRole('radio', { name: 'I agree', exact: true }).check();
  await page.getByRole('button', { name: 'Next', exact: true }).click();
  await page.getByRole('checkbox', { name: 'Nuts', exact: true }).check();
  await page.getByRole('button', { name: 'Next', exact: true }).click();
  await page.getByLabel('Reviewed restrictions', { exact: true }).check();
  await page.getByRole('button', { name: 'Next', exact: true }).click();
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await page.getByLabel('Returning participant code', { exact: true }).fill('');
  await page.getByRole('button', { name: 'Next', exact: true }).click();
  await page.getByLabel('Age in years', { exact: true }).fill('0');
  await page.getByRole('button', { name: 'Next', exact: true }).click();
  await page.getByRole('button', { name: 'Return to flow', exact: true }).click();
  for (let i = 0; i < 4; i++) {
    await expect(
      page.getByRole('status').filter({ hasText: 'Sample ' + (i + 1) + ' · code S' + i }),
    ).toBeVisible();
    await page.getByRole('button', { name: 'Continue', exact: true }).click();
    await page.getByLabel('Confirm sample code', { exact: true }).fill('WRONG');
    await expect(page.getByRole('button', { name: 'Next', exact: true })).toBeDisabled();
    await page.getByLabel('Confirm sample code', { exact: true }).fill(' s' + i + ' ');
    await expect(page.getByRole('button', { name: 'Next', exact: true })).toBeEnabled();
    await page.getByRole('button', { name: 'Next', exact: true }).click();
    if (i === 1) {
      await expect(page.getByText('Do not taste this sample.', { exact: true })).toBeVisible();
      await expect(
        page.getByRole('radio', { name: '9 · Like extremely', exact: true }),
      ).toHaveCount(0);
      await capture(page, 'slice-12-conflict', 'desktop', '#main');
      await page.getByRole('button', { name: 'Continue', exact: true }).click();
    } else {
      await page.getByRole('radio', { name: '9 · Like extremely', exact: true }).check();
      await page.getByRole('button', { name: 'Next', exact: true }).click();
    }
  }
  expect(ingestion).toBe(0);
  await page.getByRole('tab', { name: 'Release', exact: true }).click();
  await page.getByRole('button', { name: 'Review saved snapshot', exact: true }).click();
  await expect(page.getByText('Flow snapshot is valid.', { exact: true })).toBeVisible();
  await page.getByLabel('Acknowledge freeze', { exact: true }).check();
  for (const warning of await page.getByRole('checkbox', { name: /^Acknowledge warning:/ }).all())
    await warning.check();
  await page.getByRole('button', { name: 'Release for collection', exact: true }).click();
  await expect(page.getByText(/Published at/)).toBeVisible();
  const loopSession = await (
    await request.post('/sessions', {
      headers,
      data: { study_version_id: cloneVersion, assessor_code: 'LOOP-01' },
    })
  ).json();
  const loopPackage = await (
    await request.get('/sessions/' + loopSession.id + '/test', {
      headers: { Authorization: 'Bearer ' + loopSession.session_token },
    })
  ).json();
  expect(loopPackage.loop_assignments[0].samples).toHaveLength(4);
  expect(loopPackage.evaluator_version).toBe('samples-v2.3');
  expect(JSON.stringify(loopPackage)).not.toContain('Private product');
  expect(
    await (
      await request.get('/sessions/' + session.id + '/test', {
        headers: { Authorization: 'Bearer ' + session.session_token },
      })
    ).json(),
  ).toEqual(data);

  // The proof continues on the Study sequence tab with the frozen publication.
  await page.getByRole('tab', { name: 'Study sequence', exact: true }).click();

  // The same workflow continues: reviewed translations, diagnostics and hash/warnings.
  await page.getByRole('button', { name: 'Revise study', exact: true }).click();
  await expect(page).not.toHaveURL(new RegExp('/versions/' + cloneVersion + '/'));
  await expect(page).toHaveURL(/versions\/[^/]+\/flow$/);
  const checkedVersion = new URL(page.url()).pathname.split('/')[5];
  const checkedBase = '/studies/' + s + '/versions/' + checkedVersion;
  await page.getByRole('tab', { name: 'Details', exact: true }).click();
  await page.getByLabel('New language', { exact: true }).fill('sv');
  await page.getByRole('button', { name: 'Add language', exact: true }).click();
  await Promise.all([
    page.waitForResponse((r) => r.request().method() === 'PUT' && r.url().endsWith('/draft')),
    page.getByRole('button', { name: 'Save details', exact: true }).click(),
  ]);
  await page.getByRole('tab', { name: 'Study sequence', exact: true }).click();
  await page.getByRole('button', { name: 'Check study', exact: true }).click();
  await expect(page).toHaveURL(/flow\?panel=check$/);
  const checkPanel = page.getByRole('complementary', { name: 'Check study', exact: true });
  const checkTable = checkPanel.getByTestId('flow-check-issues');
  await expect(checkTable).toContainText('Text is missing in one of the study’s languages');
  await capture(
    page,
    'slice-12-missing-translations',
    'desktop',
    '[data-testid="flow-check-issues"]',
  );
  const firstMissing = checkTable.locator('tbody tr[data-row-id]').first();
  await firstMissing.getByRole('button', { name: 'Go to problem', exact: true }).click();
  await expect(page.getByLabel('Step title', { exact: true })).toBeFocused();
  await expect(
    page
      .getByRole('tablist', { name: 'Node text language' })
      .getByRole('tab', { name: 'sv', exact: true }),
  ).toHaveAttribute('aria-selected', 'true');
  const third = await (await request.get(checkedBase, { headers })).json();
  const thirdTests = (await (
    await request.get(checkedBase + '/tests', { headers })
  ).json()) as Test[];
  // All assessor text is edited through the existing fields and language tabs.
  for (const { node } of outline(third.form.nodes)) {
    await select(node.id);
    await page
      .getByRole('tablist', { name: 'Node text language' })
      .getByRole('tab', { name: 'sv', exact: true })
      .click();
    await page.getByLabel('Step title', { exact: true }).fill('Sv ' + node.title.en);
    if (node.kind === 'embedded_method') {
      const configured = thirdTests.find((t) => t.id === node.data.study_test_id)!;
      const languagePanel = page
        .getByRole('tabpanel', { name: 'sv', exact: true })
        .filter({ has: page.getByLabel('/instructions', { exact: true }) });
      for (const [pointer, text] of Object.entries(
        methodTextFields(configured.configuration as Configuration),
      ))
        await languagePanel.getByLabel(pointer, { exact: true }).fill('Sv ' + text);
    } else {
      const data = node.data as unknown as Record<string, unknown>;
      for (const field of [
        'body',
        'prompt',
        'instructions',
        'continue_label',
        'accept_label',
        'decline_label',
        'ack_label',
      ])
        if (data[field])
          await page
            .getByLabel(fieldLabels[field] ?? field, { exact: true })
            .fill('Sv ' + (data[field] as Record<string, string>).en);
      if (node.kind === 'question' || node.kind === 'matrix_question')
        for (const [i, option] of (node.data.options ?? []).entries())
          await page
            .getByLabel('Option text', { exact: true })
            .nth(i)
            .fill('Sv ' + option.label.en);
      if (node.kind === 'matrix_question')
        for (const [i, row] of node.data.rows.entries())
          await page
            .getByLabel('Question text', { exact: true })
            .nth(i)
            .fill('Sv ' + row.prompt.en);
    }
    await saveFlow();
  }
  // An outside-loop token links to its exact localized property.
  await select(consentId);
  await page.getByLabel('Text', { exact: true }).fill('{{sample_code}}');
  await saveFlow();
  await page.getByRole('button', { name: 'Check study', exact: true }).click();
  await expect(checkTable).toContainText('sample placeholder outside a sample loop');
  await checkTable
    .locator('tbody tr[data-row-id]')
    .filter({ hasText: 'sample placeholder outside a sample loop' })
    .getByRole('button', { name: 'Go to problem', exact: true })
    .click();
  await expect(page.getByLabel('Text', { exact: true })).toBeFocused();
  await page
    .getByLabel('Text', { exact: true })
    .fill('Sv ' + third.form.nodes.find((n: { id: string }) => n.id === consentId).data.body.en);
  await saveFlow();
  // Explicitly place one info node beyond both terminal outcomes.
  await select(screenId);
  await page
    .getByRole('tablist', { name: 'Node text language' })
    .getByRole('tab', { name: 'en', exact: true })
    .click();
  const unreachableId = await add('info', 'Unreachable note');
  await page.getByLabel('Text', { exact: true }).fill('Review intentional unreachable content.');
  await page
    .getByRole('tablist', { name: 'Node text language' })
    .getByRole('tab', { name: 'sv', exact: true })
    .click();
  await page.getByLabel('Step title', { exact: true }).fill('Oåtkomlig');
  await page.getByLabel('Text', { exact: true }).fill('Granska avsiktligt oåtkomlig text.');
  await page.getByLabel('Continue button text', { exact: true }).fill('Fortsätt');
  await page.getByRole('button', { name: 'Move Unreachable note down', exact: true }).click();
  await saveFlow();
  await page.getByRole('button', { name: 'Check study', exact: true }).click();
  await expect(checkTable).toContainText('No route reaches this step');
  await capture(page, 'slice-12-check-warning');
  await page.reload();
  await signIn(page);
  await expect(checkPanel).toBeVisible();
  await checkPanel.getByRole('button', { name: 'Close Check study', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Check study', exact: true })).toBeFocused();
  await page.getByRole('tab', { name: 'Preview', exact: true }).click();
  await page.getByLabel('Rehearsal language', { exact: true }).selectOption('sv');
  await expect(page.getByRole('radio', { name: 'Sv I agree', exact: true })).toBeVisible();
  // The same workflow continues with editable metadata, blinded codes and a frozen Williams design.
  await page.getByRole('tab', { name: 'Samples', exact: true }).click();
  await page
    .getByTestId('study-samples')
    .getByRole('button', { name: 'Edit sample', exact: true })
    .first()
    .click();
  await page.getByLabel('Private label', { exact: true }).fill('Private product revised');
  await page.getByRole('button', { name: 'Save sample', exact: true }).click();
  await expect(page.getByTestId('study-samples')).toContainText('Private product revised');
  await capture(page, 'slice-13-samples', 'desktop', '#main');
  await page.getByRole('tab', { name: 'Blinding', exact: true }).click();
  await page.getByRole('button', { name: 'Generate blinding codes', exact: true }).click();
  await page.getByLabel('Blinding seed', { exact: true }).fill('73');
  await page.getByRole('button', { name: 'Confirm generate blinding codes', exact: true }).click();
  await expect(
    page.getByRole('complementary', { name: 'Generate blinding codes', exact: true }),
  ).toHaveCount(0);
  const blindedSamples = await (await request.get(checkedBase + '/samples', { headers })).json();
  expect(new Set(blindedSamples.map((s: { code: string }) => s.code)).size).toBe(4);
  expect(blindedSamples.every((s: { code: string }) => /^\d{3}$/.test(s.code))).toBe(true);
  await page.getByRole('tab', { name: 'Design', exact: true }).click();
  await page.getByRole('button', { name: 'Generate design', exact: true }).click();
  await page.getByLabel('Design algorithm', { exact: true }).selectOption('williams');
  await page.getByLabel('Design seed', { exact: true }).fill('42');
  await page.getByRole('button', { name: 'Generate and save design', exact: true }).click();
  await expect(
    page.getByRole('complementary', { name: 'Generate sample design', exact: true }),
  ).toHaveCount(0);
  const frozenDesign = (await (await request.get(checkedBase + '/designs', { headers })).json())[0];
  expect(frozenDesign.sequences).toHaveLength(4);
  await page.getByRole('button', { name: 'Review sequences', exact: true }).click();
  await expect(
    page
      .getByRole('complementary', { name: 'Review sample design', exact: true })
      .getByRole('region', { name: 'Assessor rehearsal' }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Close Review sample design', exact: true }).click();
  await capture(page, 'slice-13-design', 'desktop', '#main');

  await page.getByRole('tab', { name: 'Release', exact: true }).click();
  await page.getByRole('button', { name: 'Review saved snapshot', exact: true }).click();
  await expect(page.getByTestId('publication-outline')).toContainText('hedonic-9-v1');
  await expect(
    page.getByTestId('publication-assignments').locator('tbody tr[data-row-id]'),
  ).toHaveCount(4);
  await page.getByLabel('Acknowledge freeze', { exact: true }).check();
  for (const warning of await page.getByRole('checkbox', { name: /^Acknowledge warning:/ }).all())
    if ((await warning.getAttribute('aria-label')) !== 'Acknowledge warning: unreachable_node')
      await warning.check();
  await expect(
    page.getByRole('button', { name: 'Release for collection', exact: true }),
  ).toBeDisabled();
  await page.getByLabel('Acknowledge warning: unreachable_node', { exact: true }).check();
  const reviewedThird = await (await request.get(checkedBase, { headers })).json();
  expect(
    (
      await request.patch(checkedBase, {
        headers,
        data: {
          title: reviewedThird.title,
          description: 'Concurrent review edit',
          revision_hash: reviewedThird.revision_hash,
        },
      })
    ).status(),
  ).toBe(200);
  await Promise.all([
    page
      .waitForResponse((r) => r.url().endsWith('/publish'))
      .then((r) => expect(r.status()).toBe(409)),
    page.getByRole('button', { name: 'Release for collection', exact: true }).click(),
  ]);
  await expect(page.getByRole('alert').filter({ hasText: 'Draft changed' }).first()).toBeVisible();
  await page.getByRole('button', { name: 'Review saved snapshot', exact: true }).click();
  await page.getByLabel('Acknowledge freeze', { exact: true }).check();
  await page.getByLabel('Acknowledge warning: unreachable_node', { exact: true }).check();
  for (const warning of await page.getByRole('checkbox', { name: /^Acknowledge warning:/ }).all())
    await warning.check();
  await capture(page, 'slice-12-publication-review');
  await page.getByRole('button', { name: 'Release for collection', exact: true }).click();
  await expect(page.getByText(/Published at/)).toBeVisible();
  await page.getByRole('tab', { name: 'Study sequence', exact: true }).click();
  await select(unreachableId);
  await expect(page.getByLabel('Step title', { exact: true })).toBeDisabled();
  expect(
    await (
      await request.get('/sessions/' + session.id + '/test', {
        headers: { Authorization: 'Bearer ' + session.session_token },
      })
    ).json(),
  ).toEqual(data);
  expect(
    await (
      await request.get('/sessions/' + loopSession.id + '/test', {
        headers: { Authorization: 'Bearer ' + loopSession.session_token },
      })
    ).json(),
  ).toEqual(loopPackage);

  await page.getByRole('tab', { name: 'Assessments', exact: true }).click();
  await expect(page.getByTestId('sessions-table')).toBeVisible();
  await page.getByRole('button', { name: 'Provision session', exact: true }).click();
  await page.getByLabel('Assessor code', { exact: true }).fill('SLICE6');
  await page.getByLabel('Session language', { exact: true }).selectOption('sv');
  await page
    .getByRole('tabpanel', { name: 'Assessments', exact: true })
    .getByLabel('Returning codes', { exact: true })
    .fill('ABC');
  await page
    .getByRole('tabpanel', { name: 'Assessments', exact: true })
    .getByLabel('Booth number', { exact: true })
    .fill('0');
  await page.getByRole('button', { name: 'Create session', exact: true }).click();
  await expect(page.getByLabel('Session token', { exact: true })).toBeVisible();
  const provisionedId = await page.getByLabel('Session ID', { exact: true }).inputValue();
  const provisionedToken = await page.getByLabel('Session token', { exact: true }).inputValue();
  await capture(page, 'slice-12-session-provisioned', 'desktop', '#main');
  await page.getByRole('button', { name: 'Close credential', exact: true }).click();
  await expect(page.getByLabel('Session token', { exact: true })).toHaveCount(0);
  await capture(page, 'slice-12-sessions');
  const credential = { Authorization: 'Bearer ' + provisionedToken };
  const frozen = await (
    await request.get('/sessions/' + provisionedId + '/test', { headers: credential })
  ).json();
  const publication = await (await request.get(checkedBase, { headers })).json();
  const frozenSamples = await (await request.get(checkedBase + '/samples', { headers })).json();
  expect(frozen.study_version).toEqual(publication);
  expect(frozen.flow).toEqual(publication.form);
  expect(frozen.revision_hash).toBe(publication.revision_hash);
  expect(frozen.evaluator_version).toBe('designs-v2.6');
  expect(frozen.context.language).toBe('sv');
  expect(frozen.context.booth_number).toBe(0);
  const finalLoop = outline(publication.form.nodes as Flow['nodes']).find(
    ({ node }) => node.kind === 'loop_samples',
  )!.node;
  if (finalLoop.kind !== 'loop_samples') throw new Error('Expected sample loop');
  expect(frozen.loop_assignments[0].samples).toEqual(
    (frozenDesign.sequences[0] as string[]).map((id, i) => {
      const sample = frozenSamples.find((sample: { id: string }) => sample.id === id);
      return {
        sample_id: id,
        code: sample.code,
        position: i + 1,
        ingredient_tags: sample.ingredient_tags,
      };
    }),
  );
  expect(JSON.stringify(frozen)).not.toContain('Private product');
  // Query parameters cannot change the publication assigned to the credential.
  expect(
    await (
      await request.get('/sessions/' + provisionedId + '/test?study_version_id=' + v, {
        headers: credential,
      })
    ).json(),
  ).toEqual(frozen);
  expect(
    (await request.get('/sessions/' + session.id + '/test', { headers: credential })).status(),
  ).toBe(401);
  const foreign = await request.post('/sessions/' + provisionedId + '/responses', {
    headers: credential,
    data: {
      events: [
        {
          client_event_id: crypto.randomUUID(),
          study_test_id: data.tests[0].id,
          question_id: 'overall_liking',
          value: { state: 'rated', rating: 9 },
          recorded_at: new Date().toISOString(),
        },
      ],
    },
  });
  expect(foreign.status()).toBe(422);
  expect((await foreign.json()).detail).toBe('Test does not belong to the assigned study version');
  // The same authoring-to-export workflow continues with staff registration and handover.
  await page.getByRole('button', { name: 'Laboratory terminals', exact: true }).click();
  await page.getByLabel('Staff name', { exact: true }).fill('Workflow technician');
  await page.getByLabel('Action reason', { exact: true }).fill('Prepared hedonic assessment');
  // Recovery path: manual registration shows a selectable, read-only key.
  await page.getByText('Manual registration (recovery)', { exact: true }).click();
  await page.getByLabel('Terminal name', { exact: true }).fill('Workflow manual ' + provisionedId);
  await page.getByRole('button', { name: 'Register terminal', exact: true }).click();
  const key = page.getByLabel('New terminal access key', { exact: true });
  await expect(key).toHaveAttribute('type', 'text');
  await expect(key).toHaveAttribute('readonly', '');
  await expect(
    page.getByRole('button', { name: 'Prepare this tablet with new key', exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Close terminal credential', exact: true }).click();
  await page.getByRole('button', { name: 'Close Terminal assignment', exact: true }).click();
  // Primary path: one-time code, no key shown or typed.
  await page.getByRole('button', { name: 'Set up new tablet', exact: true }).click();
  await expect(page.getByRole('img', { name: 'Pairing QR code' })).toBeVisible();
  const code = ((await page.locator('.ui-pairing-code').textContent()) ?? '').replace('-', '');
  expect(code).toHaveLength(8);
  const redeemed = await request.post('/terminal-pairings/redeem', { data: { code } });
  expect(redeemed.status()).toBe(200);
  const paired = await redeemed.json();
  await expect(page.getByText(/is paired\. Assign an assessment/)).toBeVisible({ timeout: 10000 });
  expect(await page.content()).not.toContain(paired.terminal_token);
  const terminal = { id: paired.terminal_id, terminal_token: paired.terminal_token };
  await page.getByText('Assign an existing assessment by ID (advanced)', { exact: true }).click();
  await page.getByLabel('Assessment ID', { exact: true }).fill(provisionedId);
  await page.getByRole('button', { name: 'Assign assessment', exact: true }).click();
  await expect(page.getByTestId('terminal-audit')).toContainText('assigned');
  await expect(page.getByTestId('terminals-table')).toContainText('SLICE6');
  await page.getByRole('button', { name: 'Close Terminal assignment', exact: true }).click();
  await capture(page, 'slice-12-workflow-terminals', 'desktop', 'page');
  await page.goBack();
  await expect(page.getByTestId('sessions-table')).toBeVisible();
  let nextAssessment: { id: string };
  let beforeRetry: Awaited<ReturnType<typeof proveCollection>> | undefined;
  const local = await offlineLifecycle({
    sessionId: provisionedId,
    token: provisionedToken,
    profile: testInfo.outputPath('workflow-tablet'),
    terminal,
    onPending: async (_tablet, saved, terminal) => {
      const created = await request.post('/sessions', {
        headers,
        data: { study_version_id: v, assessor_code: 'NEXT' },
      });
      expect(created.status()).toBe(201);
      nextAssessment = await created.json();
      const blocked = await request.post('/terminals/' + terminal.id + '/assignments', {
        headers,
        data: {
          session_id: nextAssessment.id,
          expected_revision: 1,
          staff_name: 'Workflow technician',
          reason: 'Pending handover probe',
        },
      });
      expect(blocked.status()).toBe(409);
      expect((await blocked.json()).detail).toContain('Finish and synchronise');
      expect(
        saved.outbox.some((o) => o.endpoint === 'responses' || o.endpoint === 'form-events'),
      ).toBe(true);
    },
    afterHandover: async (tablet, saved, terminal) => {
      const handed = await request.post('/terminals/' + terminal.id + '/assignments', {
        headers,
        data: {
          session_id: nextAssessment.id,
          expected_revision: 1,
          staff_name: 'Workflow technician',
          reason: 'Synchronised handover',
        },
      });
      expect(handed.status()).toBe(200);
      await tablet.goto(new URL('/researcher/terminals', tablet.url()).href);
      await signIn(tablet);
      await tablet.getByRole('button', { name: 'Prepare registered tablet', exact: true }).click();
      await expect(
        tablet.getByRole('status').filter({ hasText: 'Tablet prepared.' }),
      ).toBeVisible();
      expect(await stored(tablet, saved.id)).toEqual(saved);
      await tablet.goto(new URL('/assessor/', tablet.url()).href);
      await expect(await openStaff(tablet)).toContainText('NEXT');
      await tablet.reload();
      await expect(await openStaff(tablet)).toContainText('NEXT');
      expect(await stored(tablet, saved.id)).toEqual(saved);
      await capture(tablet, 'slice-11-handover-tablet', 'desktop', 'page');
      await tablet.goto(new URL('/assessor/sessions/' + saved.id, tablet.url()).href);
      await expect(tablet.getByRole('alert')).toContainText('not the task prepared');
    },
    prefix:
      new URL(testInfo.project.use.baseURL!).protocol === 'https:'
        ? 'slice-11-https-workflow-tablet'
        : 'slice-12-workflow-tablet',
    origin: testInfo.project.use.baseURL,
    request,
    beforeRetry: async (saved) => {
      beforeRetry = await proveCollection(request, headers, saved);
    },
  });
  const proof = await proveCollection(request, headers, local);
  expect(proof).toEqual(beforeRetry);
  expect(local.package).toEqual(frozen);
  const finishedPackage = await (
    await request.get('/sessions/' + provisionedId + '/test', { headers: credential })
  ).json();
  expect(finishedPackage.session.status).toBe('completed');
  expect(Number.isFinite(Date.parse(finishedPackage.session.completed_at))).toBe(true);
  expect({ ...finishedPackage, session: frozen.session }).toEqual(frozen);
  expect(await (await request.get(checkedBase, { headers })).json()).toEqual(publication);
  const rated = proof.ledger.filter((r) => r.row_kind === 'answer');
  expect(rated).toHaveLength(3);
  expect(rated.map((r) => r.sample_code)).toEqual(
    frozen.loop_assignments[0].samples
      .filter((s: { ingredient_tags: string[] }) => !s.ingredient_tags.includes('nut'))
      .map((s: { code: string }) => s.code),
  );
  expect(
    rated.every(
      (r) => r.design_id === frozenDesign.id && r.design_seed === 42 && r.serving_slot_id,
    ),
  ).toBe(true);
  expect(
    rated.every(
      (r) =>
        JSON.parse(r.value_json).rating === 9 &&
        r.is_current === true &&
        r.supersedes_event_id === null,
    ),
  ).toBe(true);
  const restricted = proof.paths.filter((p) => p.reason === 'restriction');
  expect(restricted).toHaveLength(1);
  expect(restricted[0].sample_id).toBe(
    frozen.loop_assignments[0].samples.find((s: { ingredient_tags: string[] }) =>
      s.ingredient_tags.includes('nut'),
    ).sample_id,
  );
  expect(restricted[0].kind).toBe('skipped');
  expect(proof.paths.some((p) => p.step_id === ageId && p.reason === 'not_shown')).toBe(true);
  await page.getByRole('button', { name: 'Refresh sessions', exact: true }).click();
  await page.getByLabel('Session status', { exact: true }).selectOption('completed');
  await expect(page.getByTestId('sessions-table')).toContainText('SLICE6');
  await capture(page, 'slice-12-sessions-completed');

  // The same offline workflow continues into scoped Data and downloaded CSV.
  await page.getByRole('tab', { name: 'Results', exact: true }).click();
  await expect(page).toHaveURL(/\/data$/);
  const ledger = page.getByTestId('data-ledger');
  await expect(ledger).toContainText('SLICE6');
  await expect(ledger).toContainText('restriction');
  await capture(page, 'slice-12-workflow-data', 'desktop', '#main');
  const scopedRows = await (
    await request.get('/studies/' + s + '/data?study_version_id=' + third.id + '&limit=1000', {
      headers,
    })
  ).json();
  expect(
    scopedRows.some(
      (r: { row_kind: string; skip_reason: string }) =>
        r.row_kind === 'path' && r.skip_reason === 'restriction',
    ),
  ).toBeTruthy();
  expect(
    scopedRows.some(
      (r: { row_kind: string; skip_reason: string; client_event_id: string | null }) =>
        r.row_kind === 'expected_missing' &&
        r.skip_reason === 'restriction' &&
        r.client_event_id === null,
    ),
  ).toBeTruthy();
  const downloaded = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export long CSV', exact: true }).click();
  const csv = csvRecords(await readFile((await (await downloaded).path())!, 'utf8'));
  proveCsv(csv, proof.ledger);
  expect(csv).toHaveLength(scopedRows.length);
  expect(new Set(csv.map((r) => r.study_version_id))).toEqual(new Set([third.id]));
  expect(
    csv
      .filter((r) => r.row_kind === 'answer')
      .every((r) => JSON.parse(r.value_json).rating === 9 && r.is_current === 'True'),
  ).toBeTruthy();
  expect(csv.filter((r) => r.row_kind === 'path').map((r) => r.client_event_id).length).toBe(
    new Set(csv.filter((r) => r.row_kind === 'path').map((r) => r.client_event_id)).size,
  );
  await writeFile(
    evidencePath('slice-11-workflow-reconciliation.json'),
    JSON.stringify(
      {
        study_id: s,
        study_version_id: publication.id,
        version_number: publication.version_number,
        revision_hash: frozen.revision_hash,
        language: frozen.context.language,
        sample_codes: frozen.loop_assignments[0].samples.map(
          (sample: { code: string }) => sample.code,
        ),
        observations: proof.observations.length,
        form_answers: proof.form.length,
        path_events: proof.paths.length,
        unique_event_ids: proof.allIds.length,
        csv_rows: csv.length,
        expected_missing: proof.ledger.filter((r) => r.row_kind === 'expected_missing').length,
        restriction_skips: restricted.length,
        exact_retry_unchanged: true,
        shared_replay_identical: true,
        cross_version_status: foreign.status(),
      },
      null,
      2,
    ) + '\n',
  );
  await page.getByLabel('Data scope', { exact: true }).selectOption('');
  await expect(ledger).toContainText('SLICE6');
  const all = await (await request.get('/studies/' + s + '/data?limit=1000', { headers })).json();
  expect(
    new Set(all.map((r: { study_version_id: string }) => r.study_version_id)).size,
  ).toBeGreaterThan(1);
  await capture(page, 'slice-12-workflow-data-all');
  await page.reload();
  await signIn(page);
  await expect(page.getByLabel('Data scope', { exact: true })).toHaveValue('');
  await expect(page.getByTestId('data-ledger')).toContainText('SLICE6');
  await page.goto('/researcher/studies?search=Slice%202&offset=0');
  await signIn(page);
  await expect(page.getByTestId('studies-table')).toContainText('Slice 2 real workflow');
  await capture(page, 'slice-12-studies', 'desktop', 'page');
  // Templates extend this same collection workflow; no second authoring-to-export flow.
  await page.goto(base + '/publish');
  await signIn(page);
  await moreAction(page, 'Register template');
  await page.getByLabel('Template name', { exact: true }).fill('Slice 12 reviewed hedonic');
  await page
    .getByLabel('Template review notes', { exact: true })
    .fill('Review wording, restrictions, sample codes and translations before each release.');
  await page.getByRole('button', { name: 'Confirm template registration', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Template registered' })).toBeVisible();
  await page.getByRole('button', { name: 'Study templates', exact: true }).click();
  await page
    .getByTestId('study-templates')
    .locator('tbody tr')
    .filter({ hasText: 'Slice 12 reviewed hedonic' })
    .getByRole('button', { name: 'Use template', exact: true })
    .click();
  await page.getByLabel('New study title', { exact: true }).fill('Slice 12 template study');
  await page
    .getByLabel('Review wording, restrictions, sample codes and translations before release', {
      exact: true,
    })
    .check();
  await page.getByRole('button', { name: 'Create from template', exact: true }).click();
  await expect(page).toHaveURL(/versions\/[^/]+\/flow$/);
  const copyParts = new URL(page.url()).pathname.split('/');
  const copyApi = '/studies/' + copyParts[3] + '/versions/' + copyParts[5];
  const copy = await (await request.get(copyApi, { headers })).json();
  expect(copy.id).not.toBe(v);
  expect(copy.form.nodes.find((n: { id: string }) => n.id === nodeId).data.study_test_id).not.toBe(
    data.tests[0].id,
  );
  expect(await (await request.get(copyApi + '/sessions', { headers })).json()).toEqual([]);
  await capture(page, 'slice-12-template-workspace', 'desktop', 'page');
  await page
    .getByTestId('flow-outline')
    .locator('tr[data-row-id="' + nodeId + '"]')
    .getByRole('button', { name: 'Edit', exact: true })
    .click();
  await page.getByRole('button', { name: 'Delete step', exact: true }).click();
  await page.getByRole('button', { name: 'Confirm delete step', exact: true }).click();
  await expect
    .poll(async () => (await (await request.get(copyApi + '/tests', { headers })).json()).length)
    .toBe(0);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect
    .poll(async () => (await (await request.get(copyApi + '/tests', { headers })).json()).length)
    .toBe(1);
  await page.getByRole('button', { name: 'Redo', exact: true }).click();
  await expect
    .poll(async () => (await (await request.get(copyApi + '/tests', { headers })).json()).length)
    .toBe(0);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect
    .poll(async () => (await (await request.get(copyApi + '/tests', { headers })).json()).length)
    .toBe(1);
  await page
    .getByTestId('flow-outline')
    .locator('tr[data-row-id="' + nodeId + '"]')
    .getByRole('button', { name: 'Edit', exact: true })
    .click();
  // A real competing writer makes autosave fail; no mocked success/failure response.
  const prior = await (await request.get(copyApi, { headers })).json();
  await page.getByLabel('Step title', { exact: true }).fill('Retained template edit');
  expect(
    (
      await request.patch(copyApi, {
        headers,
        data: {
          title: prior.title,
          description: 'Competing template editor',
          revision_hash: prior.revision_hash,
        },
      })
    ).status(),
  ).toBe(200);
  await expect(page.getByRole('alert')).toContainText('Draft changed');
  await expect(page.getByLabel('Step title', { exact: true })).toHaveValue(
    'Retained template edit',
  );
  await page
    .getByRole('button', { name: 'Read server revision for comparison', exact: true })
    .click();
  await expect(
    page.getByRole('status').filter({ hasText: 'Competing template editor' }),
  ).toBeVisible();
  await page.getByTestId('draft-comparison').scrollIntoViewIfNeeded();
  await capture(page, 'slice-12-draft-comparison', 'desktop', '[data-testid="draft-comparison"]');
  await page.getByRole('button', { name: 'Reload and discard local edits', exact: true }).click();
  await page.getByLabel('Step title', { exact: true }).fill('');
  await expect
    .poll(
      async () =>
        (await (await request.get(copyApi, { headers })).json()).form.nodes.find(
          (n: { id: string }) => n.id === nodeId,
        ).title.en,
    )
    .toBe('');
  await page.getByRole('button', { name: 'Check study', exact: true }).click();
  const problem = page
    .getByTestId('flow-check-issues')
    .locator('tbody tr')
    .filter({ hasText: 'Text is missing in one of the study’s languages' })
    .first();
  await problem.getByRole('button', { name: 'Go to problem', exact: true }).click();
  await page.getByLabel('Step title', { exact: true }).fill('Reviewed template liking');
  await expect
    .poll(
      async () =>
        (await (await request.get(copyApi, { headers })).json()).form.nodes.find(
          (n: { id: string }) => n.id === nodeId,
        ).title.en,
    )
    .toBe('Reviewed template liking');
  await page.getByRole('tab', { name: 'Preview', exact: true }).click();
  await page.getByRole('radio', { name: 'I decline', exact: true }).check();
  await page.getByRole('button', { name: 'Next', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Participation ended.' })).toBeVisible();
  await page.getByRole('tab', { name: 'Release', exact: true }).click();
  await page.getByRole('button', { name: 'Review saved snapshot', exact: true }).click();
  await page.getByLabel('Acknowledge freeze', { exact: true }).check();
  for (const warning of await page.getByRole('checkbox', { name: /^Acknowledge warning:/ }).all())
    await warning.check();
  await page.getByRole('button', { name: 'Release for collection', exact: true }).click();
  await expect(page.getByText(/Published at/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Undo', exact: true })).toBeDisabled();
  await moreAction(page, 'Read draft audit');
  await expect(page.getByTestId('draft-audit')).toContainText('researcher-key:');
  await page.getByTestId('draft-audit').scrollIntoViewIfNeeded();
  await capture(page, 'slice-12-draft-audit', 'desktop', '[data-testid="draft-audit"]');
  expect(await (await request.get(copyApi + '/sessions', { headers })).json()).toEqual([]);
  expect(await (await request.get(checkedBase, { headers })).json()).toEqual(publication);
  await capture(page, 'slice-12-template-released');
  // The same continuous workflow now revises its collected publication for incomplete blocks.
  await page.goto('/researcher' + checkedBase + '/flow');
  await signIn(page);
  await page.getByRole('button', { name: 'Revise study', exact: true }).click();
  await expect(page).not.toHaveURL(new RegExp('/versions/' + checkedVersion + '/'));
  await expect(page).toHaveURL(/versions\/[^/]+\/flow$/);
  const subsetVersion = new URL(page.url()).pathname.split('/')[5];
  const subsetBase = '/studies/' + s + '/versions/' + subsetVersion;
  await page.getByRole('tab', { name: 'Design', exact: true }).click();
  await page.getByRole('button', { name: 'Generate design', exact: true }).click();
  await page.getByLabel('Design algorithm', { exact: true }).selectOption('incomplete');
  await page.getByLabel('Samples per assessor', { exact: true }).fill('2');
  await page.getByRole('button', { name: 'Generate and save design', exact: true }).click();
  await expect(
    page.getByRole('complementary', { name: 'Generate sample design', exact: true }),
  ).toHaveCount(0);
  const subsetDesign = (await (await request.get(subsetBase + '/designs', { headers })).json())[0];
  expect(subsetDesign.sequences).toHaveLength(12);
  await capture(page, 'slice-13-incomplete-design');
  await page.getByRole('tab', { name: 'Release', exact: true }).click();
  await page.getByRole('button', { name: 'Review saved snapshot', exact: true }).click();
  await page.getByLabel('Acknowledge freeze', { exact: true }).check();
  for (const warning of await page.getByRole('checkbox', { name: /^Acknowledge warning:/ }).all())
    await warning.check();
  await page.getByRole('button', { name: 'Release for collection', exact: true }).click();
  await expect(page.getByText(/Published at/)).toBeVisible();
  await page.getByRole('tab', { name: 'Assessments', exact: true }).click();
  await page.getByRole('button', { name: 'Provision session', exact: true }).click();
  await page.getByLabel('Assessor code', { exact: true }).fill('SUBSET');
  await page.getByRole('button', { name: 'Create session', exact: true }).click();
  await expect(page.getByLabel('Session token', { exact: true })).toBeVisible();
  const subsetSessionId = await page.getByLabel('Session ID', { exact: true }).inputValue();
  const subsetToken = await page.getByLabel('Session token', { exact: true }).inputValue();
  await page.getByRole('button', { name: 'Close credential', exact: true }).click();
  const subsetPackage = await (
    await request.get('/sessions/' + subsetSessionId + '/test', {
      headers: { Authorization: 'Bearer ' + subsetToken },
    })
  ).json();
  expect(
    subsetPackage.loop_assignments[0].samples.map((s: { sample_id: string }) => s.sample_id),
  ).toEqual(subsetDesign.sequences[0]);
  expect(subsetPackage.loop_assignments[0].samples).toHaveLength(2);
  expect(JSON.stringify(subsetPackage)).not.toContain('Private product');
  const subsetLocal = await offlineLifecycle({
    sessionId: subsetSessionId,
    token: subsetToken,
    profile: testInfo.outputPath('incomplete-tablet'),
    request,
    origin: testInfo.project.use.baseURL,
    prefix: 'slice-13-incomplete-tablet',
  });
  const subsetProof = await proveCollection(request, headers, subsetLocal);
  expect(subsetLocal.package).toEqual(subsetPackage);
  const assignedIds = new Set(subsetDesign.sequences[0]);
  expect(subsetProof.observations.every((o) => assignedIds.has(o.sample_id))).toBe(true);
  const subsetCsv = await (
    await request.get('/studies/' + s + '/export?study_version_id=' + subsetVersion, { headers })
  ).text();
  proveCsv(csvRecords(subsetCsv), subsetProof.ledger);
  await page.getByRole('tab', { name: 'Design', exact: true }).click();
  await page.getByText(/^Allocation history/).click();
  await expect(page.getByTestId('design-allocations').locator('tbody tr[data-row-id]')).toHaveCount(
    1,
  );
  await expect(page.getByRole('button', { name: 'Generate design', exact: true })).toBeDisabled();
  await page.getByTestId('design-allocations').scrollIntoViewIfNeeded();
  await capture(
    page,
    'slice-13-frozen-allocations',
    'desktop',
    '[data-testid="design-allocations"]',
  );
  expect(await (await request.get(checkedBase, { headers })).json()).toEqual(publication);
  // Booth serving continues this same authoring-to-offline-to-export workflow.
  await page.getByRole('button', { name: 'Revise study', exact: true }).click();
  await expect(page).toHaveURL(/versions\/[^/]+\/flow$/);
  const servingVersion = new URL(page.url()).pathname.split('/')[5];
  await select(loopId);
  const servingGateId = await add('serve_gate', 'Wait for sample');
  // Staff delivery is opt-in: the wait setting only appears once it is required.
  const waitSetting = page.getByLabel('Wait before asking staff (seconds)', { exact: true });
  const requireStaff = page.getByLabel('Staff must mark samples as delivered', { exact: true });
  await expect(requireStaff).not.toBeChecked();
  await expect(waitSetting).toHaveCount(0);
  await requireStaff.check();
  await waitSetting.fill('30');
  // The offline tablet below confirms deliveries itself, so leave the option off.
  await requireStaff.uncheck();
  await expect(waitSetting).toHaveCount(0);
  await guard('derived.sample_conflicts_restriction', 'eq', 'false');
  await page.getByLabel('If condition is not met', { exact: true }).selectOption('next_sample');
  for (const language of ['en', 'sv']) {
    await page
      .getByRole('tablist', { name: 'Node text language' })
      .getByRole('tab', { name: language, exact: true })
      .click();
    await page.getByLabel('Step title', { exact: true }).fill('Wait for sample');
    await page
      .getByLabel('Text', { exact: true })
      .fill('Wait for delivery. Check the received blind code before tasting.');
    await page
      .getByLabel('Preparation notes', { exact: true })
      .fill('One portion; physically verify booth and frozen code.');
  }
  for (let move = 0; move < 3; move++)
    await page.getByRole('button', { name: 'Move Wait for sample up', exact: true }).click();
  await saveFlow();
  await capture(page, 'slice-14-gate-properties', 'desktop', '#main');
  await page.getByRole('tab', { name: 'Release', exact: true }).click();
  await page.getByRole('button', { name: 'Review saved snapshot', exact: true }).click();
  await page.getByLabel('Acknowledge freeze', { exact: true }).check();
  for (const warning of await page.getByRole('checkbox', { name: /^Acknowledge warning:/ }).all())
    await warning.check();
  await page.getByRole('button', { name: 'Release for collection', exact: true }).click();
  await expect(page.getByText(/Published at/)).toBeVisible();
  const servingSession = await (
    await request.post('/sessions', {
      headers,
      data: { study_version_id: servingVersion, assessor_code: 'SERVING-14' },
    })
  ).json();
  // Staff uses real room/booth controls; UUIDs are stable and metadata stays staff-only.
  await page.getByRole('button', { name: 'Run study', exact: true }).click();
  await page.getByRole('button', { name: 'Advanced room editor', exact: true }).click();
  await page.getByRole('button', { name: 'New room', exact: true }).click();
  await page.getByLabel('Room name', { exact: true }).fill('Continuous proof room');
  await page.getByRole('button', { name: 'Add booth', exact: true }).click();
  await capture(page, 'slice-14-room-editor', 'desktop', 'page');
  await page.getByRole('button', { name: 'Save room revision', exact: true }).click();
  await expect(
    page.getByRole('complementary', { name: 'Room layout revision', exact: true }),
  ).toHaveCount(0);
  await page.getByLabel('Assessment ID', { exact: true }).fill(servingSession.id);
  const room = (await (await request.get('/rooms', { headers })).json()).find(
    (r: { name: string }) => r.name === 'Continuous proof room',
  );
  await page.getByLabel('Assign to booth', { exact: true }).selectOption(room.booths[0].id);
  await page.getByLabel('Staff name', { exact: true }).fill('Test technician');
  await page.getByLabel('Assignment reason', { exact: true }).fill('Offline serving rehearsal');
  const [assignmentResponse] = await Promise.all([
    page.waitForResponse(
      (r) => r.request().method() === 'POST' && new URL(r.url()).pathname === '/booth-assignments',
    ),
    page.getByRole('button', { name: 'Assign assessment to booth', exact: true }).click(),
  ]);
  expect(assignmentResponse.status()).toBe(200);
  const { assignment } = await assignmentResponse.json();
  expect(assignment).toMatchObject({
    session_id: servingSession.id,
    room_version_id: room.id,
    booth_id: room.booths[0].id,
  });
  await expect
    .poll(
      async () =>
        (
          await (
            await request.get('/sessions/' + servingSession.id + '/operations', {
              headers: { Authorization: 'Bearer ' + servingSession.session_token },
            })
          ).json()
        ).assignment?.id,
    )
    .toBe(assignment.id);
  // History spans the whole laboratory, including assignments from other tests.
  const assignmentRow = page
    .getByTestId('booth-assignment-history')
    .locator('tbody tr[data-row-id="' + assignment.id + '"]');
  await expect(assignmentRow).toHaveCount(1);
  await expect(assignmentRow).toContainText('Test technician');
  await expect(assignmentRow).toContainText('Offline serving rehearsal');
  await capture(page, 'slice-14-rooms', 'desktop', '[data-testid="booth-assignment-history"]');
  const servingLocal = await offlineLifecycle({
    sessionId: servingSession.id,
    token: servingSession.session_token,
    profile: testInfo.outputPath('serving-tablet'),
    request,
    prefix: 'slice-14-serving-tablet',
    origin: testInfo.project.use.baseURL,
  });
  const servingProof = await proveCollection(request, headers, servingLocal);
  const deliveries = servingProof.form.filter((e) => e.step_id === servingGateId);
  expect(deliveries.length).toBeGreaterThan(0);
  expect(
    deliveries.every(
      (e) =>
        'value' in e &&
        e.value.state === 'delivery' &&
        'mode' in e.value &&
        e.value.mode === 'served',
    ),
  ).toBe(true);
  const servingCsv = await (
    await request.get('/studies/' + s + '/export?study_version_id=' + servingVersion, { headers })
  ).text();
  proveCsv(csvRecords(servingCsv), servingProof.ledger);
  expect(servingCsv).not.toContain('elapsed_ms');
  expect(servingCsv).not.toContain('offline');
  await registeredMethodsWorkflow(page, request, headers, testInfo);
  await questionnaireWorkflow(page, request, headers, testInfo);
  await temporalWorkflow(page, request, headers, testInfo);
  await assetsWorkflow(page, request, headers, testInfo);
  await wideExportWorkflow(page, request, headers, s, third.id);
  await snapshotWorkflow(page, request, headers, s, third.id);
  expect(await (await request.get(checkedBase, { headers })).json()).toEqual(publication);
});

test(
  'foundation gallery planned controls schema editor outline keyboard and states',
  { tag: '@audit' },
  async ({ page }) => {
    test.setTimeout(120000 * timeoutScale);
    await page.goto('/dev/ui');
    await page.getByRole('button', { name: 'Flow foundation', exact: true }).click();
    const gallery = page.getByRole('region', { name: 'Flow foundation fixtures', exact: true });
    await expect(
      gallery.getByRole('button', { name: 'Show only if · Planned', exact: true }),
    ).toHaveCount(0);
    await expect(
      gallery.getByRole('button', { name: 'Sample loop · Planned', exact: true }),
    ).toHaveCount(0);
    await expect(gallery.getByLabel('Secret fixture', { exact: true })).toHaveAttribute(
      'type',
      'password',
    );
    const rows = gallery.getByTestId('flow-outline').locator('tbody tr[data-row-id]');
    await rows.first().focus();
    await page.keyboard.press('ArrowDown');
    await expect(rows.nth(1)).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(gallery.getByTestId('foundation-selection')).toContainText(
      '10000000-0000-4000-8000-000000000002',
    );
    await gallery.getByRole('tab', { name: 'Read-only', exact: true }).click();
    await expect(
      gallery
        .getByRole('tabpanel', { name: 'Read-only', exact: true })
        .getByLabel('Instructions', { exact: true }),
    ).toBeDisabled();
    await gallery.getByRole('tab', { name: 'Empty', exact: true }).click();
    await expect(gallery.getByText('No steps yet. Use Add step.', { exact: true })).toBeVisible();
    await gallery.getByRole('tab', { name: 'Loading', exact: true }).click();
    await expect(gallery.getByText('Loading saved flow…', { exact: true })).toHaveAttribute(
      'aria-busy',
      'true',
    );
    await gallery.getByRole('tab', { name: 'Error', exact: true }).click();
    await expect(gallery.getByRole('alert')).toContainText('Draft changed');
    await gallery.getByRole('tab', { name: 'Rehearsal', exact: true }).click();
    await expect(gallery.getByRole('radio')).toHaveCount(9);
    await capture(page, 'slice-12-gallery-foundation', 'desktop', '#foundation');
    // Sample and design gallery states extend the existing composition.
    await page.getByRole('button', { name: 'Samples and design', exact: true }).click();
    const sampleGallery = page.getByRole('region', {
      name: 'Samples and design fixtures',
      exact: true,
    });
    await expect(
      sampleGallery.getByTestId('study-samples').locator('tbody tr[data-row-id]:visible'),
    ).toHaveCount(20);
    await capture(page, 'slice-13-gallery-samples', 'desktop', '#samples-design');
    await sampleGallery.getByRole('tab', { name: 'loading', exact: true }).click();
    await expect(
      sampleGallery.getByRole('status').filter({ hasText: 'Loading samples' }),
    ).toBeVisible();
    await sampleGallery.getByRole('tab', { name: 'empty', exact: true }).click();
    await expect(sampleGallery.getByText('No samples. Create a draft sample.')).toBeVisible();
    await sampleGallery.getByRole('tab', { name: 'error', exact: true }).click();
    await expect(sampleGallery.getByRole('alert')).toContainText('Cannot reach');
    await sampleGallery.getByRole('tab', { name: 'readonly', exact: true }).click();
    await expect(
      sampleGallery.getByRole('button', { name: 'Edit sample', exact: true }).first(),
    ).toBeDisabled();
    await sampleGallery.getByRole('tab', { name: 'design', exact: true }).click();
    await expect(
      sampleGallery.getByTestId('design-sequences').locator('tbody tr[data-row-id]'),
    ).toHaveCount(24);
    await capture(page, 'slice-13-gallery-design', 'desktop', '#samples-design');
    await questionnaireGalleryProof(page);
  },
);

test('autosave keeps the cursor in the step title while the researcher pauses', async ({
  page,
}) => {
  test.setTimeout(120000 * timeoutScale);
  await page.goto('/researcher/studies');
  await signIn(page);
  await startStudy(page);
  await page.getByLabel('Title', { exact: true }).fill('Autosave focus');
  await page.getByLabel('Description', { exact: true }).fill('Typing must not be interrupted');
  await page.getByRole('button', { name: 'Create draft', exact: true }).click();
  await expect(page).toHaveURL(/\/versions\/[^/]+\/flow$/);
  await addStep(page, 'info');
  const title = page.getByLabel('Step title', { exact: true });
  await title.fill('');
  await title.pressSequentially('First part', { delay: 20 });
  // Pause past the autosave delay and wait for the real save to finish.
  await page.waitForResponse(
    (response) => response.request().method() === 'PUT' && response.url().endsWith('/draft'),
  );
  await expectFlowSaved(page);
  await expect(title).toBeFocused();
  await page.keyboard.type(' and second part');
  await expect(title).toHaveValue('First part and second part');
});
