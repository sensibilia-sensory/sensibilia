import { expect, type Page, type APIRequestContext, type TestInfo } from '@playwright/test';
import { capture } from './capture';
import { offlineLifecycle } from './offline-helpers';
import { proveCollection, proveCsv } from './complete-proof';
import { csvRecords } from './csv';
import type { Flow, Answer } from '../../src/shared/flow';
import { writeFile } from 'node:fs/promises';
import { evidencePath } from './evidence';
import { addMethodStep, addStep, reuseBlock, moreAction, startStudy } from './steps';

/** Continues the existing authoring-to-export test through reviewed battery reuse. */
export async function questionnaireWorkflow(
  page: Page,
  request: APIRequestContext,
  headers: Record<string, string>,
  testInfo: TestInfo,
) {
  await startStudy(page);
  await page.getByLabel('Title', { exact: true }).fill('Slice 16 synthetic frequency fixture');
  await page.getByRole('button', { name: 'Create draft', exact: true }).click();
  await expect(page).toHaveURL(/\/versions\/[^/]+\/flow$/);
  const parts = new URL(page.url()).pathname.split('/'),
    study = parts[3],
    version = parts[5];
  const sourceApi = '/studies/' + study + '/versions/' + version;
  const save = async () => {
    const button = page.getByRole('button', { name: 'Save flow', exact: true });
    if (await button.isEnabled()) await button.click();
    await expect(button).toBeDisabled();
  };
  const add = async (kind: string, title: string) => {
    await addStep(page, kind);
    await page.getByLabel('Step title', { exact: true }).fill(title);
    return new URL(page.url()).pathname.split('/').at(-1)!;
  };
  const select = async (id: string) => {
    await page
      .getByTestId('flow-outline')
      .locator('tr[data-row-id="' + id + '"]')
      .getByRole('button', { name: 'Edit', exact: true })
      .click();
  };
  const consent = await add('consent', 'Fixture consent');
  await page
    .getByLabel('Text', { exact: true })
    .fill('This is a synthetic questionnaire rehearsal. Choose whether to continue.');
  await page.getByLabel('Agree button text', { exact: true }).fill('Agree');
  await page.getByLabel('Decline button text', { exact: true }).fill('Decline');
  await save();
  const gate = await add('info', 'Consent routing');
  await page
    .getByLabel('Text', { exact: true })
    .fill('Consent accepted. Follow the reviewed study instructions.');
  await save();
  const matrix = await add('matrix', 'Frequency battery · 17 items');
  await page
    .getByLabel('instructions', { exact: true })
    .fill('Synthetic frequency fixture only; no validated instrument or total score is claimed.');
  await page.getByLabel('Allow skipping', { exact: true }).check();
  const editor = page.getByRole('region', { name: 'Questionnaire block editor', exact: true });
  await editor.getByLabel('Row prompt row_1', { exact: true }).fill('Frequency item 1');
  await editor.getByLabel('Required row_1', { exact: true }).uncheck();
  await editor.getByText('Bulk row entry · en', { exact: true }).click();
  await editor
    .getByLabel('New row prompts', { exact: true })
    .fill(Array.from({ length: 16 }, (_, i) => 'Frequency item ' + (i + 2)).join('\n'));
  await editor.getByLabel('New rows required', { exact: true }).uncheck();
  await editor.getByRole('button', { name: 'Append reviewed rows', exact: true }).click();
  await expect(
    editor
      .getByRole('table', { name: 'Battery rows', exact: true })
      .locator('tbody tr[data-row-id]'),
  ).toHaveCount(17);
  await capture(page, 'slice-16-battery-editor', 'desktop', '#main');
  await editor.getByRole('tab', { name: 'Scale options', exact: true }).click();
  await editor.getByLabel('Scale label option_1', { exact: true }).fill('Never');
  await editor.getByLabel('Scale score option_1', { exact: true }).fill('0');
  await editor.getByLabel('Scale label option_2', { exact: true }).fill('Often');
  await editor.getByLabel('Scale score option_2', { exact: true }).fill('1');
  await save();
  const loop = await add('sample loop', 'Two hedonic samples');
  for (let i = 0; i < 2; i++) {
    await page.getByLabel('Sample code', { exact: true }).fill(String(417 + i));
    await page
      .getByLabel('Private label', { exact: true })
      .fill('Private questionnaire sample ' + i);
    await page.getByLabel('Ingredient tags', { exact: true }).fill('');
    await page.getByLabel('Tags reviewed', { exact: true }).check();
    await page.getByRole('button', { name: 'Create and include sample', exact: true }).click();
    // The fields clear when the sample exists and is in the loop; saving earlier races on slow runners.
    await expect(page.getByLabel('Sample code', { exact: true })).toHaveValue('');
  }
  await save();
  await addMethodStep(page, 'hedonic-9-v1');
  await page
    .getByLabel('Instructions', { exact: true })
    .fill('Taste the assigned sample and rate overall liking.');
  await page.getByLabel('Question text 1', { exact: true }).fill('Overall liking');
  await page.getByRole('button', { name: 'Add configured method', exact: true }).click();
  await save();
  const finish = await page
    .getByTestId('flow-outline')
    .locator('tr[data-row-id]')
    .filter({ hasText: 'Finish' })
    .getAttribute('data-row-id');
  await select(finish!);
  const screen = await add('end', 'Consent declined');
  await page.getByLabel('Text', { exact: true }).fill('Consent declined. Participation ended.');
  await page.getByLabel('Result', { exact: true }).selectOption('screened_out');
  await save();
  await select(gate);
  await page.getByRole('button', { name: 'Show only if', exact: true }).click();
  await page.getByLabel('Show if', { exact: true }).selectOption('condition');
  await page.getByLabel('Answer or setting 1', { exact: true }).selectOption('answer.' + consent);
  await page.getByLabel('Comparison 1', { exact: true }).selectOption('eq');
  await page.getByLabel('Compare with 1', { exact: true }).selectOption('true');
  await page.getByRole('button', { name: 'Close Show only if', exact: true }).click();
  await page.getByLabel('If condition is not met', { exact: true }).selectOption('end_study');
  await page.getByLabel('If condition is not met target', { exact: true }).selectOption(screen);
  await save();
  const release = async () => {
    await page.getByRole('tab', { name: 'Release', exact: true }).click();
    await page.getByRole('button', { name: 'Review saved snapshot', exact: true }).click();
    await expect(page.getByLabel('Acknowledge freeze', { exact: true })).toBeEnabled();
    await page.getByLabel('Acknowledge freeze', { exact: true }).check();
    for (const warning of await page.getByRole('checkbox', { name: /^Acknowledge warning:/ }).all())
      await warning.check();
    await page.getByRole('button', { name: 'Release for collection', exact: true }).click();
    await expect(page.getByText(/Published at/)).toBeVisible();
  };
  await release();
  const frozen = await (await request.get(sourceApi, { headers })).json();
  await moreAction(page, 'Register template');
  await page
    .getByLabel('Template name', { exact: true })
    .fill('Slice 16 reviewed synthetic battery');
  await page
    .getByLabel('Template review notes', { exact: true })
    .fill(
      'Synthetic fixture; review prompts, frequency labels, direction and translations for each use. No scoring algorithm or validated instrument.',
    );
  await page.getByRole('button', { name: 'Confirm template registration', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Template registered' })).toBeVisible();
  await moreAction(page, 'Duplicate study');
  await page.getByLabel('New study title', { exact: true }).fill('Slice 16 reused battery offline');
  await page
    .getByLabel('Review wording, restrictions, sample codes and translations before release', {
      exact: true,
    })
    .check();
  await page.getByRole('button', { name: 'Create duplicate', exact: true }).click();
  await expect(page).toHaveURL(
    (url) => url.pathname.endsWith('/flow') && !url.pathname.includes(version),
  );
  const copyParts = new URL(page.url()).pathname.split('/'),
    copyStudy = copyParts[3],
    copyVersion = copyParts[5];
  const copyApi = '/studies/' + copyStudy + '/versions/' + copyVersion;
  await select(matrix);
  await page.getByRole('button', { name: 'Delete step', exact: true }).click();
  await page.getByRole('button', { name: 'Confirm delete step', exact: true }).click();
  await save();
  await select(gate);
  await reuseBlock(page);
  const picker = page.getByRole('complementary', {
    name: 'Reuse reviewed questionnaire block',
    exact: true,
  });
  await picker
    .getByTestId('study-templates')
    .locator('tbody tr')
    .filter({ hasText: 'Slice 16 reviewed synthetic battery' })
    .getByRole('button', { name: 'Use template', exact: true })
    .click();
  await picker
    .getByTestId('questionnaire-blocks')
    .locator('tr[data-row-id="' + matrix + '"]')
    .getByRole('button', { name: 'Select block', exact: true })
    .click();
  await picker
    .getByLabel(
      'Review wording, scale direction and every target-language translation before release',
      { exact: true },
    )
    .check();
  await capture(page, 'slice-16-template-blocks', 'desktop', '#main');
  await picker.getByRole('button', { name: 'Insert reviewed block', exact: true }).click();
  await expect(picker).toHaveCount(0);
  const inserted = new URL(page.url()).pathname.split('/').at(-1)!;
  expect(inserted).not.toBe(matrix);
  await save();
  const copied = await (await request.get(copyApi, { headers })).json();
  const battery = (copied.form as Flow).nodes.find((n) => n.id === inserted)!;
  expect(battery.kind).toBe('matrix_question');
  expect(battery.data).toEqual(frozen.form.nodes.find((n: { id: string }) => n.id === matrix).data);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await save();
  expect(
    (await (await request.get(copyApi, { headers })).json()).form.nodes.some(
      (n: { id: string }) => n.id === inserted,
    ),
  ).toBe(false);
  await page.getByRole('button', { name: 'Redo', exact: true }).click();
  await save();
  await page.getByRole('tab', { name: 'Preview', exact: true }).click();
  await page.getByRole('radio', { name: 'Decline', exact: true }).check();
  await page.getByRole('button', { name: 'Next', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Participation ended.' })).toBeVisible();
  await capture(page, 'slice-16-preview-screenout', 'desktop', '#main');
  await release();
  const publication = await (await request.get(copyApi, { headers })).json();
  const matrixNode = (publication.form as Flow).nodes.find((n) => n.id === inserted)!;
  if (matrixNode.kind !== 'matrix_question') throw new Error('Matrix missing');
  const answers: Answer = {
    state: 'matrix',
    answers: Object.fromEntries(
      matrixNode.data.rows.flatMap((r, i) =>
        i === 2
          ? []
          : [
              [
                r.id,
                i === 1
                  ? { state: 'skipped' }
                  : { state: 'selected', option_id: i === 0 ? 'option_1' : 'option_2' },
              ],
            ],
      ),
    ),
  };
  const results = [];
  for (const decline of [false, true]) {
    const session = await (
      await request.post('/sessions', {
        headers,
        data: {
          study_version_id: copyVersion,
          assessor_code: decline ? 'BATTERY-DECLINE' : 'BATTERY-ACCEPT',
        },
      })
    ).json();
    const local = await offlineLifecycle({
      sessionId: session.id,
      token: session.session_token,
      profile: testInfo.outputPath(decline ? 'q-no' : 'q-yes'),
      request,
      prefix: decline ? 'slice-16-screenout-tablet' : 'slice-16-battery-tablet',
      origin: testInfo.project.use.baseURL,
      taskAnswers: { [consent]: { state: 'answered', value: !decline }, [inserted]: answers },
      expectedOutcome: decline ? 'screened_out' : 'completed',
    });
    const proof = await proveCollection(request, headers, local);
    if (!decline) {
      const rows = proof.ledger.filter(
        (r) => r.row_kind === 'form_answer' && r.step_id === inserted,
      );
      expect(rows).toHaveLength(17);
      expect(rows.slice(0, 3).map((r) => r.state)).toEqual(['selected', 'skipped', 'missing']);
      expect(rows[0].score_json).toBe('0');
      expect(rows[1].score_json).toBe('null');
      expect(rows[2].value_json).toBe('{"state":"missing"}');
      expect(proof.observations).toHaveLength(2);
    } else {
      expect(proof.observations).toEqual([]);
      expect(proof.form).toHaveLength(1);
      expect(proof.ledger.some((r) => r.row_kind === 'form_answer' && r.step_id === inserted)).toBe(
        false,
      );
    }
    const csv = csvRecords(
      await (
        await request.get('/studies/' + copyStudy + '/export?study_version_id=' + copyVersion, {
          headers,
        })
      ).text(),
    );
    proveCsv(
      csv.filter((r) => r.session_id === session.id),
      proof.ledger,
    );
    results.push({
      session_id: session.id,
      outcome: local.state.outcome,
      form_events: proof.form.length,
      observations: proof.observations.length,
      path_events: proof.paths.length,
      csv_rows: proof.ledger.length,
      atomic_event_ids: proof.allIds,
      exact_retry_and_csv: true,
      shared_replay_equal: true,
    });
  }
  expect(await (await request.get(sourceApi, { headers })).json()).toEqual(frozen);
  expect(await (await request.get(copyApi, { headers })).json()).toEqual(publication);
  await writeFile(
    evidencePath('slice-16-questionnaire-reconciliation.json'),
    JSON.stringify(
      {
        source_version_id: version,
        study_version_id: copyVersion,
        inserted_node_id: inserted,
        row_ids: matrixNode.data.rows.map((r) => r.id),
        loop_id: loop,
        results,
      },
      null,
      2,
    ) + '\n',
  );
}

/** Extends the existing foundation gallery proof; contains no independent test. */
export async function questionnaireGalleryProof(page: Page) {
  await page.getByRole('button', { name: 'Questionnaire blocks', exact: true }).click();
  const gallery = page.getByRole('region', { name: 'Questionnaire block fixtures', exact: true });
  const active = () => gallery.getByRole('tabpanel', { name: 'ready', exact: true });
  await expect(
    active()
      .getByRole('table', { name: 'Battery rows', exact: true })
      .locator('tbody tr[data-row-id]'),
  ).toHaveCount(17);
  await active().getByLabel('Row prompt item_1', { exact: true }).fill('Edited fixture');
  await active().getByRole('button', { name: 'Move item_1 down', exact: true }).click();
  await expect(
    active()
      .getByRole('table', { name: 'Battery rows', exact: true })
      .locator('tbody tr[data-row-id]')
      .first(),
  ).toHaveAttribute('data-row-id', 'item_2');
  await capture(page, 'slice-16-gallery-battery', 'desktop', '#questionnaire-gallery');
  await active().getByRole('tab', { name: 'Scale options', exact: true }).click();
  await expect(active().getByLabel('Scale score never', { exact: true })).toHaveValue('0');
  await active().getByLabel('Scale score often', { exact: true }).fill('');
  await capture(page, 'slice-16-gallery-scale', 'desktop', '#questionnaire-gallery');
  await active().getByRole('tab', { name: 'Battery rows', exact: true }).click();
  await active().getByText('Bulk row entry · en', { exact: true }).click();
  await active().getByLabel('New row prompts', { exact: true }).fill('English staged prompt');
  await gallery.getByLabel('Battery fixture language', { exact: true }).selectOption('sv');
  await expect(active().getByLabel('New row prompts', { exact: true })).toHaveValue('');
  await active().getByText('Bulk row entry · sv', { exact: true }).click();
  await active().getByLabel('New row prompts', { exact: true }).fill('Svenskt utkast');
  await gallery.getByLabel('Battery fixture language', { exact: true }).selectOption('en');
  await expect(active().getByLabel('New row prompts', { exact: true })).toHaveValue(
    'English staged prompt',
  );
  await gallery.getByLabel('Battery fixture language', { exact: true }).selectOption('sv');
  await expect(active().getByLabel('New row prompts', { exact: true })).toHaveValue(
    'Svenskt utkast',
  );
  await active().getByRole('tab', { name: 'Battery rows', exact: true }).click();
  await active().getByText('Bulk translations · sv', { exact: true }).click();
  await active().getByLabel('Reviewed row translations', { exact: true }).fill('foreign\tFel');
  await active().getByRole('button', { name: 'Apply reviewed translations', exact: true }).click();
  await expect(active().getByRole('alert')).toContainText('existing row IDs');
  await active()
    .getByLabel('Reviewed row translations', { exact: true })
    .fill('item_1\tGranskad första');
  await active().getByRole('button', { name: 'Apply reviewed translations', exact: true }).click();
  await expect(active().getByLabel('Row prompt item_1', { exact: true })).toHaveValue(
    'Granskad första',
  );
  await gallery.getByLabel('Battery fixture language', { exact: true }).selectOption('en');
  await expect(active().getByLabel('Row prompt item_1', { exact: true })).toHaveValue(
    'Edited fixture',
  );
  await gallery.getByRole('tab', { name: 'loading', exact: true }).click();
  await expect(gallery.getByText('Loading reviewed questionnaire…')).toBeVisible();
  await gallery.getByRole('tab', { name: 'error', exact: true }).click();
  await expect(gallery.getByRole('alert').filter({ hasText: 'Cannot read' })).toBeVisible();
  await gallery.getByRole('tab', { name: 'empty', exact: true }).click();
  await expect(
    gallery
      .getByRole('tabpanel', { name: 'empty', exact: true })
      .getByRole('table', { name: 'Battery rows', exact: true })
      .locator('tbody tr[data-row-id]'),
  ).toHaveCount(0);
  await gallery.getByRole('tab', { name: 'readonly', exact: true }).click();
  await expect(
    gallery
      .getByRole('tabpanel', { name: 'readonly', exact: true })
      .getByLabel('Row prompt item_1', { exact: true }),
  ).toBeDisabled();
  await capture(page, 'slice-16-gallery-readonly', 'desktop', '#questionnaire-gallery');
  await gallery.getByRole('tab', { name: 'blocks', exact: true }).click();
  await expect(gallery.getByTestId('questionnaire-blocks')).toContainText('17');
  await capture(page, 'slice-16-gallery-blocks', 'desktop', '#questionnaire-gallery');
}
