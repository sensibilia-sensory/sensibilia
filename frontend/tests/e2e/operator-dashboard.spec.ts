import { test, expect } from '@playwright/test';
import { capture } from './capture';
import { timeoutScale } from '../timeouts';
const staff = { Authorization: 'Bearer e2e-researcher-' + 'x'.repeat(32) };
const operator = 'e2e-operator-' + 'o'.repeat(32);
test(
  'operator gallery spatial primitive, dense tasks and loading empty error readonly states',
  { tag: '@audit' },
  async ({ page }) => {
    test.setTimeout(120000 * timeoutScale);
    await page.goto('/dev/ui');
    await page.getByRole('button', { name: 'Operator and serving', exact: true }).click();
    const gallery = page.getByRole('region', { name: 'Operator gallery', exact: true });
    await expect(
      gallery.getByRole('table', { name: 'Laboratory floor layout', exact: true }),
    ).toBeVisible();
    await expect(
      gallery
        .getByRole('table', { name: 'Laboratory floor layout', exact: true })
        .locator('tbody tr'),
    ).toHaveCount(5);
    await gallery.getByTestId('operator-tasks').scrollIntoViewIfNeeded();
    await capture(page, 'slice-14-gallery-operator', 'desktop', '#operations');
    for (const state of ['loading', 'empty', 'error', 'readonly']) {
      await gallery.getByRole('button', { name: state, exact: true }).click();
      if (state === 'loading')
        await expect(gallery.getByText('Loading serving tasks…')).toBeVisible();
      if (state === 'empty')
        await expect(
          gallery.getByText('No active booth assignments. Staff must assign assessments.'),
        ).toBeVisible();
      if (state === 'error') await expect(gallery.getByRole('alert')).toContainText('interrupted');
      if (state === 'readonly')
        await expect(
          gallery.getByRole('button', { name: 'Acknowledge', exact: true }).first(),
        ).toBeDisabled();
    }
    await gallery.getByRole('button', { name: 'populated', exact: true }).click();
    // Default: the assessor's confirmation is the delivery, so Yes never waits for staff.
    const yes = gallery.getByRole('button', { name: 'Yes, I have them' });
    await expect(yes).toBeEnabled();
    await expect(gallery.getByText('in front of you?')).toBeVisible();
    await expect(gallery.getByRole('button', { name: 'Ask staff', exact: true })).toHaveCount(0);
    await gallery.getByRole('button', { name: 'No, call staff' }).click();
    await expect(gallery.getByText('Staff have been called to your booth')).toBeVisible();
    await expect(yes).toBeEnabled();
    // The call text clears once the server reports a new state.
    await gallery.getByRole('button', { name: 'Staff set served', exact: true }).click();
    await expect(gallery.getByText('Your samples have been served')).toBeVisible();
    await expect(gallery.getByRole('button', { name: 'No, call staff' })).toBeEnabled();
    // Opt-in: staff must mark the samples delivered, with a staff-verified fallback after the wait.
    await gallery.getByRole('button', { name: 'Require staff delivery', exact: true }).click();
    await expect(yes).toBeEnabled();
    await gallery.getByRole('button', { name: 'Staff set ready', exact: true }).click();
    await expect(yes).toBeDisabled();
    await gallery.getByRole('button', { name: 'Ask staff', exact: true }).click();
    await gallery
      .getByLabel('Manual delivery reason')
      .fill('Staff physically checked booth and sample');
    await expect(yes).toBeEnabled();
    await gallery.getByRole('button', { name: 'No, call staff' }).click();
    await expect(yes).toBeDisabled();
    // Staff delivery after a call enables Yes again.
    await gallery.getByRole('button', { name: 'Staff set served', exact: true }).click();
    await expect(yes).toBeEnabled();
    await gallery.getByRole('button', { name: 'big', exact: true }).click();
    await capture(page, 'slice-14-gallery-big-screen', 'operator-big', '#operations');
    await page.getByRole('button', { name: 'Room layouts', exact: true }).click();
    const rooms = page.getByRole('region', { name: 'Room gallery', exact: true });
    await expect(rooms.getByTestId('booths').locator('tbody tr[data-row-id]')).toHaveCount(8);
    await capture(page, 'slice-14-gallery-rooms', 'operator-big', '#rooms-gallery');
    await rooms.getByRole('button', { name: 'loading', exact: true }).click();
    await expect(rooms.getByText('Loading rooms…')).toBeVisible();
    await rooms.getByRole('button', { name: 'empty', exact: true }).click();
    await expect(rooms.getByTestId('rooms')).toContainText('No records');
    await rooms.getByRole('button', { name: 'error', exact: true }).click();
    await expect(rooms.getByRole('alert')).toContainText('interrupted');
    await rooms.getByRole('button', { name: 'readonly', exact: true }).click();
    await expect(rooms.getByRole('button', { name: 'New room', exact: true })).toBeDisabled();
  },
);
test('two operator clients observe durable tasks and stale delivery rejection without research access', async ({
  page,
  context,
  request,
}) => {
  test.setTimeout(90000 * timeoutScale);
  const study = await (
    await request.post('/studies', { headers: staff, data: { title: 'Serving test' } })
  ).json();
  const version = study.versions[0];
  const method = await (
    await request.post('/studies/' + study.id + '/tests', {
      headers: staff,
      data: {
        test_type_id: 'hedonic-9-v1',
        configuration: {
          instructions: 'Taste',
          questions: [{ id: 'liking', prompt: 'Liking', required: true }],
          scale_labels: [
            'Dislike extremely',
            'Dislike very much',
            'Dislike moderately',
            'Dislike slightly',
            'Neither like nor dislike',
            'Like slightly',
            'Like moderately',
            'Like very much',
            'Like extremely',
          ],
          allow_skips: false,
        },
      },
    })
  ).json();
  expect(method.id).toBeTruthy();
  const sample = await (
    await request.post('/studies/' + study.id + '/samples', {
      headers: staff,
      data: { code: '731', label: 'Private batch', ingredient_tags: [] },
    })
  ).json();
  const base = '/studies/' + study.id + '/versions/' + version.id;
  const rev = await (await request.get(base, { headers: staff })).json();
  const gate = crypto.randomUUID(),
    end = crypto.randomUUID();
  const flow = {
    schema_version: 2,
    languages: ['en'],
    default_language: 'en',
    nodes: [
      {
        id: gate,
        kind: 'serve_gate',
        title: { en: 'Delivery' },
        data: {
          body: { en: 'Confirm code' },
          preparation: { en: 'One portion' },
          sample_binding: 'set',
          sample_ids: [sample.id],
          timeout_seconds: 30,
        },
      },
      {
        id: crypto.randomUUID(),
        kind: 'embedded_method',
        title: { en: 'Liking' },
        data: { study_test_id: method.id, sample_binding: 'none' },
      },
      {
        id: end,
        kind: 'end',
        title: { en: 'End' },
        data: { body: { en: 'Finished' }, outcome: 'completed' },
      },
    ],
  };
  const saved = await request.put(base + '/form', {
    headers: staff,
    data: { form: flow, revision_hash: rev.revision_hash },
  });
  expect(saved.status(), await saved.text()).toBe(200);
  const review = await (await request.get(base + '/validation', { headers: staff })).json();
  expect(review.valid).toBe(true);
  expect(
    (
      await request.post('/studies/' + study.id + '/publish', {
        headers: staff,
        data: { study_version_id: version.id, revision_hash: review.revision_hash },
      })
    ).status(),
  ).toBe(200);
  const session = await (
    await request.post('/sessions', {
      headers: staff,
      data: { study_version_id: version.id, assessor_code: 'A' },
    })
  ).json();
  const booth = crypto.randomUUID();
  const room = await (
    await request.post('/rooms', {
      headers: staff,
      data: {
        name: 'Operator room',
        rows: 1,
        columns: 1,
        booths: [{ id: booth, label: 'B1', row: 1, column: 1, enabled: true }],
      },
    })
  ).json();
  const assigned = await (
    await request.post('/booth-assignments', {
      headers: staff,
      data: {
        client_event_id: crypto.randomUUID(),
        session_id: session.id,
        room_version_id: room.id,
        booth_id: booth,
        staff_name: 'Staff',
        reason: 'Pilot',
      },
    })
  ).json();
  const auth = { Authorization: 'Bearer ' + session.session_token };
  expect(
    (
      await request.post('/sessions/' + session.id + '/path-events', {
        headers: auth,
        data: {
          events: [
            {
              client_event_id: crypto.randomUUID(),
              seq: 1,
              step_id: gate,
              occurrence_id: 'study',
              kind: 'entered',
              recorded_at: new Date().toISOString(),
              answer_event_ids: [],
            },
          ],
        },
      })
    ).status(),
  ).toBe(200);
  expect(
    (
      await request.post('/sessions/' + session.id + '/operations', {
        headers: auth,
        data: {
          client_event_id: crypto.randomUUID(),
          assignment_id: assigned.assignment.id,
          step_id: gate,
          occurrence_id: 'study',
          action: 'ready',
          expected_revision: 0,
          actor: 'Tablet',
          recorded_at: new Date().toISOString(),
        },
      })
    ).status(),
  ).toBe(200);
  const second = await context.newPage();
  for (const p of [page, second]) {
    await p.goto('/operator');
    await p.getByLabel('Operator access key').fill(operator);
    await p.getByLabel('Operator name').fill(p === page ? 'One' : 'Two');
    await p.getByRole('button', { name: 'Open serving dashboard' }).click();
    await expect(p.getByTestId('operator-tasks')).toContainText('731 / Private batch');
  }
  await second.getByRole('button', { name: 'Acknowledge', exact: true }).click();
  await page.getByRole('button', { name: 'Acknowledge', exact: true }).click();
  await page.getByRole('button', { name: 'Confirm acknowledgement', exact: true }).click();
  await expect(page.getByTestId('operator-tasks')).toContainText('Being prepared');
  await second.getByRole('button', { name: 'Confirm acknowledgement', exact: true }).click();
  await expect(second.getByRole('alert')).toContainText('refresh');
  await page.getByRole('button', { name: 'Mark served', exact: true }).click();
  await page.getByRole('button', { name: 'Confirm physical delivery', exact: true }).click();
  await expect(page.getByTestId('operator-tasks')).toContainText('Served');
  await expect
    .poll(
      async () =>
        (
          await (
            await request.get('/sessions/' + session.id + '/operations', { headers: auth })
          ).json()
        ).signals[0].state,
    )
    .toBe('served');
  await capture(page, 'slice-14-operator-served', 'desktop', 'page');
  expect(
    (
      await request.get('/studies/' + study.id + '/export', {
        headers: { Authorization: 'Bearer ' + operator },
      })
    ).status(),
  ).toBe(401);
  const dto = await (
    await request.get('/operator/dashboard', { headers: { Authorization: 'Bearer ' + operator } })
  ).json();
  expect(JSON.stringify(dto)).not.toMatch(
    /answers|configuration|correct_slot|restriction_tag_map|token_hash/,
  );
  await second.close();
});
