import { test, expect, type APIRequestContext, type Page } from '@playwright/test';
import { axeScan } from './audit';
import { capture } from './capture';
import {
  createRoom,
  issuePairing,
  publishServingStudy,
  publishSmallStudy,
  researcherHeaders,
} from './seed';

async function signIn(page: Page, path: string) {
  await page.goto(path);
  await page.getByLabel('Access key', { exact: true }).fill('e2e-researcher-' + 'x'.repeat(32));
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
}

/** The tablet side of a serving gate: a paired tablet on a booth has asked for samples. */
async function askForSamples(request: APIRequestContext, roomName: string) {
  const [boothId] = await createRoom(request, roomName, 1);
  const study = await publishServingStudy(request, 'Board serving');
  const code = await issuePairing(request, boothId);
  const paired = await (await request.post('/terminal-pairings/redeem', { data: { code } })).json();
  const tablet = { Authorization: 'Bearer ' + paired.terminal_token };
  const terminals = await (
    await request.get('/terminals?limit=200', { headers: researcherHeaders })
  ).json();
  const mine = terminals.find((t: { id: string }) => t.id === paired.terminal_id);
  const started = await request.post('/terminals/' + mine.id + '/next-assessment', {
    headers: researcherHeaders,
    data: {
      expected_revision: mine.revision,
      staff_name: 'Anna',
      reason: 'Serving rehearsal',
      study_version_id: study.versionId,
    },
  });
  expect(started.status(), await started.text()).toBe(200);
  const task = await (
    await request.get('/terminals/' + mine.id + '/assignment', { headers: tablet })
  ).json();
  const session = '/sessions/' + task.session_id;
  const assignment = (
    await (await request.get(session + '/operations', { headers: tablet })).json()
  ).assignment;
  const now = () => new Date().toISOString();
  expect(
    (
      await request.post(session + '/path-events', {
        headers: tablet,
        data: {
          events: [
            {
              client_event_id: crypto.randomUUID(),
              seq: 1,
              step_id: study.gateId,
              occurrence_id: 'study',
              kind: 'entered',
              recorded_at: now(),
              answer_event_ids: [],
            },
          ],
        },
      })
    ).status(),
  ).toBe(200);
  expect(
    (
      await request.post(session + '/operations', {
        headers: tablet,
        data: {
          client_event_id: crypto.randomUUID(),
          assignment_id: assignment.id,
          step_id: study.gateId,
          occurrence_id: 'study',
          action: 'ready',
          expected_revision: 0,
          actor: 'Tablet',
          recorded_at: now(),
        },
      })
    ).status(),
  ).toBe(200);
  return paired as { name: string; terminal_id: string };
}

/**
 * The Room picker only exists once more than one room has loaded. Ask the server how many there
 * are, so the test waits for the picker instead of racing the page's own load.
 */
async function chooseRoom(page: Page, request: APIRequestContext, roomName: string) {
  const rooms = await (await request.get('/rooms', { headers: researcherHeaders })).json();
  if (rooms.length > 1)
    await page.getByLabel('Room', { exact: true }).selectOption({ label: roomName });
}

test('run study: place tablets by dragging, watch status, arrange booths', async ({
  page,
  request,
}) => {
  const roomName = 'Board room ' + Date.now();
  await (
    await request.post('/rooms', {
      headers: researcherHeaders,
      data: {
        name: roomName,
        rows: 1,
        columns: 2,
        booths: [1, 2].map((n) => ({
          id: crypto.randomUUID(),
          label: String(n),
          row: 1,
          column: n,
          enabled: true,
        })),
      },
    })
  ).json();
  const study = await publishSmallStudy(request, 'Board study');
  const code = await issuePairing(request);
  const paired = await (await request.post('/terminal-pairings/redeem', { data: { code } })).json();

  await signIn(page, '/researcher/run');
  await expect(page.getByRole('heading', { name: 'Run study' })).toBeVisible();
  await chooseRoom(page, request, roomName);
  await page.getByLabel('Your name', { exact: true }).fill('Anna');

  const tablet = page.getByRole('listitem').filter({ hasText: paired.name });
  const booth1 = page.getByRole('button', { name: /^Booth 1,/ });
  await expect(tablet).toContainText('Not on a booth');
  await expect(booth1).toContainText('No tablet');

  // Dragging a tablet onto a booth links it and shows its stage in words.
  await tablet.dragTo(booth1);
  await expect(booth1).toContainText(paired.name);
  await expect(booth1).toContainText('Waiting for assignment');
  await expect(tablet).toContainText('Booth 1');

  // The booth follows the assessor: starting an assessment changes the text without a reload.
  const terminals = await (
    await request.get('/terminals?limit=200', { headers: researcherHeaders })
  ).json();
  const mine = terminals.find((t: { id: string }) => t.id === paired.terminal_id);
  const started = await request.post('/terminals/' + mine.id + '/next-assessment', {
    headers: researcherHeaders,
    data: {
      expected_revision: mine.revision,
      staff_name: 'Anna',
      reason: 'First assessment',
      study_version_id: study.versionId,
    },
  });
  expect(started.status(), await started.text()).toBe(200);
  await expect(booth1).toContainText('Test starting', { timeout: 10000 });
  await capture(page, 'run-study-running', 'desktop', '.ui-board');

  // A running assessment keeps its tablet where it is.
  await tablet.dragTo(page.getByRole('button', { name: /^Booth 2,/ }));
  await expect(page.getByRole('alert')).toContainText('has an assessment running');
  await expect(booth1).toContainText(paired.name);

  // Dragging a booth saves its place as a new layout revision.
  const before = (await (await request.get('/rooms', { headers: researcherHeaders })).json()).find(
    (r: { name: string }) => r.name === roomName,
  );
  const box = (await booth1.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + 20);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 40, box.y + 80, { steps: 6 });
  await page.mouse.move(box.x + box.width / 2 + 120, box.y + 160, { steps: 6 });
  await page.mouse.up();
  await expect
    .poll(async () => {
      const rooms = await (await request.get('/rooms', { headers: researcherHeaders })).json();
      const now = rooms.find((r: { name: string }) => r.name === roomName);
      return now.revision > before.revision && now.booths[0].x !== null;
    })
    .toBe(true);

  // Add booth creates the next numbered booth; selecting it offers rename and a keyboard route.
  await page.getByRole('button', { name: 'Add booth', exact: true }).click();
  const booth3 = page.getByRole('button', { name: /^Booth 3,/ });
  await expect(booth3).toBeVisible();
  await expect(page.getByRole('complementary', { name: 'Booth 3' })).toBeVisible();
  await axeScan(page, '.ui-board');
  await page.getByLabel('Booth name', { exact: true }).fill('Bench');
  await page.getByRole('button', { name: 'Save name', exact: true }).click();
  await expect(page.getByRole('button', { name: /^Booth Bench,/ })).toBeVisible();
  await page.getByRole('button', { name: 'Remove booth…', exact: true }).click();
  await page.getByRole('button', { name: 'Remove booth', exact: true }).click();
  await expect(page.getByRole('button', { name: /^Booth Bench,/ })).toHaveCount(0);
});

test('run study: start and end an assessment from the booth panel', async ({ page, request }) => {
  const study = await publishSmallStudy(request, 'Panel run study');
  const roomName = 'Panel room ' + Date.now();
  const [boothId] = await createRoom(request, roomName, 1);
  const code = await issuePairing(request, boothId);
  const paired = await (await request.post('/terminal-pairings/redeem', { data: { code } })).json();

  await signIn(page, '/researcher/run');
  await expect(page.getByRole('heading', { name: 'Run study' })).toBeVisible();
  // The tablet list and the rooms load together; wait for them before looking for the Room picker.
  await expect(page.getByRole('listitem').filter({ hasText: paired.name })).toBeVisible();
  await chooseRoom(page, request, roomName);
  await page
    .getByLabel('Study for next assessments', { exact: true })
    .selectOption(study.versionId);
  const booth = page.getByRole('button', { name: /^Booth Booth 1,/ });
  await expect(booth).toContainText(paired.name, { timeout: 10000 });
  await booth.click();
  const panel = page.getByRole('group', { name: 'Assessment on this tablet', exact: true });
  const start = panel.getByRole('button', { name: 'Start first assessment', exact: true });
  // Staff must give a name before acting.
  await expect(start).toBeDisabled();
  await page.getByLabel('Your name', { exact: true }).fill('Anna');
  await start.click();
  await expect(booth).toContainText('Test starting', { timeout: 10000 });
  await expect(panel).toContainText('Panel run study · v1');
  // Ending names its effect and asks once more; answers already on the tablet stay safe.
  await expect(panel).toContainText('Answers the tablet already recorded');
  await panel.getByRole('button', { name: 'End assessment', exact: true }).click();
  await panel.getByRole('button', { name: 'End now', exact: true }).click();
  await expect(booth).toContainText('Ended by staff', { timeout: 10000 });
  await expect(panel.getByRole('button', { name: 'Next assessor', exact: true })).toBeEnabled();
});

test('run study: staff acknowledge and serve a sample request without the operator key', async ({
  page,
  request,
}) => {
  const roomName = 'Serving room ' + Date.now();
  const paired = await askForSamples(request, roomName);

  await signIn(page, '/researcher/run');
  // The tablet list and the rooms load together; wait for them before looking for the Room picker.
  await expect(page.getByRole('listitem').filter({ hasText: paired.name })).toBeVisible();
  await chooseRoom(page, request, roomName);
  const booth = page.getByRole('button', { name: /^Booth Booth 1,/ });
  await expect(booth).toContainText('Needs samples 731', { timeout: 10000 });
  await booth.click();
  const panel = page.getByRole('group', { name: 'Samples to serve', exact: true });
  await expect(panel).toContainText('731 · Private batch');
  await expect(panel).toContainText('Waiting for sample');
  // Staff must give a name before acting.
  await expect(panel.getByRole('button', { name: 'Acknowledge', exact: true })).toBeDisabled();
  await page.getByLabel('Your name', { exact: true }).fill('Anna');
  await axeScan(page, '.ui-board');
  await capture(page, 'run-study-serving-request', 'desktop', '.ui-board');
  await panel.getByRole('button', { name: 'Acknowledge', exact: true }).click();
  await expect(panel).toContainText('Being prepared', { timeout: 10000 });
  await panel.getByRole('button', { name: 'Mark served…', exact: true }).click();
  await panel.getByRole('button', { name: 'Confirm physical delivery', exact: true }).click();
  // Served: the request is resolved and the booth goes back to the assessment.
  await expect(page.getByRole('group', { name: 'Samples to serve', exact: true })).toHaveCount(0, {
    timeout: 10000,
  });
  await expect(booth).not.toContainText('Needs samples');
  await capture(page, 'run-study-served', 'desktop', '.ui-board');
});

test('run study: the list shows who needs samples and opens the serving panel', async ({
  page,
  request,
}) => {
  const paired = await askForSamples(request, 'List serving room ' + Date.now());
  await signIn(page, '/researcher/run?view=list');
  await expect(page.getByRole('tab', { name: 'List', exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  const row = page.getByTestId('run-board').locator('tr', { hasText: paired.name });
  await expect(row).toContainText('Needs samples 731', { timeout: 10000 });
  await row.getByRole('button', { name: 'Serve samples', exact: true }).click();
  await expect(page.getByRole('tab', { name: 'Floor', exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await expect(page.getByRole('group', { name: 'Samples to serve', exact: true })).toContainText(
    '731 · Private batch',
  );
});

test('run study: the list starts a tablet on a released study and shows end-of-day status', async ({
  page,
  request,
}) => {
  const study = await publishSmallStudy(request, 'Run day study');
  const [booth] = await createRoom(request, 'Run day room', 1);
  const code = await issuePairing(request, booth);
  const paired = await (await request.post('/terminal-pairings/redeem', { data: { code } })).json();
  expect(paired.name).toMatch(/^Tablet \d+$/);
  await signIn(page, '/researcher/run?view=list');
  await expect(page.getByRole('heading', { name: 'Run study' })).toBeVisible();
  const row = page.getByTestId('run-board').locator('tr', { hasText: paired.name });
  const start = row.getByRole('button', { name: 'Start first assessment' });
  await expect(start).toBeDisabled();
  await page.getByLabel('Your name', { exact: true }).fill('Anna');
  await page
    .getByLabel('Study for next assessments', { exact: true })
    .selectOption(study.versionId);
  await start.click();
  await expect(row).toContainText('In progress');
  await expect(row).toContainText('A001');
  await expect(row).toContainText('Booth 1');
  // The database is shared with other tests, so only the shape of the line is asserted.
  await expect(page.getByText(/^Tablets \d+ · in progress \d+/)).toBeVisible();
  // Technical IDs stay hidden until asked for.
  await page.getByRole('button', { name: 'Laboratory terminals', exact: true }).click();
  await expect(page.getByTestId('terminals-table')).not.toContainText(paired.terminal_id);
  await page.getByRole('button', { name: 'Show technical IDs', exact: true }).click();
  await expect(page.getByTestId('terminals-table')).toContainText(paired.terminal_id);
});

test('run study: a booth held by an assessment in progress can be ended from the error', async ({
  page,
  request,
}) => {
  const study = await publishSmallStudy(request, 'Held booth study');
  const [boothId] = await createRoom(request, 'Held booth room ' + Date.now(), 1);
  const redeem = async () =>
    (
      await request.post('/terminal-pairings/redeem', {
        data: { code: await issuePairing(request, boothId) },
      })
    ).json();
  const revision = async (id: string) =>
    (await (await request.get('/terminals?limit=200', { headers: researcherHeaders })).json()).find(
      (t: { id: string }) => t.id === id,
    ).revision;
  // An earlier tablet started on the booth and was taken off it mid-assessment.
  const earlier = await redeem();
  const started = await request.post('/terminals/' + earlier.terminal_id + '/next-assessment', {
    headers: researcherHeaders,
    data: {
      expected_revision: await revision(earlier.terminal_id),
      staff_name: 'Seed staff',
      reason: 'Seed',
      study_version_id: study.versionId,
    },
  });
  expect(started.status()).toBe(200);
  const off = await request.put('/terminals/' + earlier.terminal_id + '/booth', {
    headers: researcherHeaders,
    data: {
      expected_revision: await revision(earlier.terminal_id),
      staff_name: 'Seed staff',
      reason: 'Seed',
      booth_id: null,
    },
  });
  expect(off.status()).toBe(200);
  const paired = await redeem();

  await signIn(page, '/researcher/run?view=list');
  await page.getByLabel('Your name', { exact: true }).fill('Anna');
  await page
    .getByLabel('Study for next assessments', { exact: true })
    .selectOption(study.versionId);
  const row = page.getByTestId('run-board').locator('tr', { hasText: paired.name });
  await row.getByRole('button', { name: 'Start first assessment', exact: true }).click();
  const alert = page.getByRole('alert');
  await expect(alert).toContainText('still has assessor');
  await alert
    .getByRole('button', { name: 'End assessment for booth Booth 1', exact: true })
    .click();
  await alert.getByRole('button', { name: 'End now', exact: true }).click();
  await expect(row).toContainText('In progress', { timeout: 10000 });
  await expect(page.getByRole('alert')).toHaveCount(0);
});

test('a tablet whose study was closed moves to another study without being set up again', async ({
  page,
  request,
}) => {
  const old = await publishSmallStudy(request, 'Closed run study');
  const next = await publishSmallStudy(request, 'Follow-up run study');
  const code = await issuePairing(request);
  const paired = await (await request.post('/terminal-pairings/redeem', { data: { code } })).json();
  const tablet = async () =>
    (await (await request.get('/terminals?limit=200', { headers: researcherHeaders })).json()).find(
      (t: { id: string }) => t.id === paired.terminal_id,
    );
  const first = await tablet();
  expect(
    (
      await request.post('/terminals/' + first.id + '/next-assessment', {
        headers: researcherHeaders,
        data: {
          expected_revision: first.revision,
          staff_name: 'Anna',
          reason: 'First assessment',
          study_version_id: old.versionId,
        },
      })
    ).status(),
  ).toBe(200);
  const running = await tablet();
  expect(
    (
      await request.post('/sessions/' + running.session_id + '/end', { headers: researcherHeaders })
    ).status(),
  ).toBe(200);
  expect(
    (
      await request.post('/studies/' + old.studyId + '/close', {
        headers: researcherHeaders,
        data: {},
      })
    ).status(),
  ).toBe(200);
  await signIn(page, '/researcher/run?view=list');
  await page.getByLabel('Your name', { exact: true }).fill('Anna');
  await page.getByLabel('Study for next assessments', { exact: true }).selectOption(next.versionId);
  const row = page.getByTestId('run-board').locator('tr', { hasText: paired.name });
  await expect(row).toContainText('Closed run study · v1 (closed)');
  await row.getByRole('button', { name: 'Start on selected study' }).click();
  await expect(row).toContainText('Follow-up run study · v1');
  await expect(row).toContainText('In progress');
});

test('the old booth board address opens Run study', async ({ page }) => {
  await signIn(page, '/researcher/board');
  await expect(page.getByRole('heading', { name: 'Run study' })).toBeVisible();
  expect(new URL(page.url()).pathname).toBe('/researcher/run');
});

test('a paired tablet claims its assessment and asks staff to confirm before handover', async ({
  page,
  request,
}) => {
  const study = await publishSmallStudy(request, 'Handover study');
  const code = await issuePairing(request);
  await page.goto('/assessor/pair#' + code);
  await expect(page.getByLabel('Pairing code', { exact: true })).toHaveValue(code);
  await page.getByRole('button', { name: 'Register this tablet', exact: true }).click();
  await expect(page.getByRole('heading', { name: /Tablet \d+ registered/ })).toBeVisible();
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Waiting for staff preparation' })).toBeVisible();
  const terminals = await (
    await request.get('/terminals?limit=200', { headers: researcherHeaders })
  ).json();
  const mine = terminals.find((t: { session_id: string | null }) => !t.session_id);
  const assigned = await request.post('/terminals/' + mine.id + '/next-assessment', {
    headers: researcherHeaders,
    data: {
      expected_revision: mine.revision,
      staff_name: 'Anna',
      reason: 'First assessment',
      study_version_id: study.versionId,
    },
  });
  expect(assigned.status(), await assigned.text()).toBe(200);
  await expect(page.getByRole('heading', { name: /Ready for A\d+/ })).toBeVisible({
    timeout: 30000,
  });
  await expect(page.getByText('Complete · works offline')).toBeVisible();
  await page.getByRole('button', { name: 'Hand over to participant', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Instructions' })).toBeVisible();
  // Staff details are not on the participant's screen.
  await expect(page.getByText('pending operations')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Synchronise saved events' })).toHaveCount(0);
});

test(
  'run study gallery: floor stages, serving request, list, handover, staff panel and add step menu',
  { tag: '@audit' },
  async ({ page }) => {
    await page.goto('/dev/ui');
    await page.getByRole('button', { name: 'Run study', exact: true }).click();
    const gallery = page.getByRole('region', { name: 'Run study fixtures', exact: true });
    await expect(gallery.getByRole('button', { name: /^Booth \d,/ })).toHaveCount(6);
    await expect(gallery).toContainText('Needs samples 731 204');
    await expect(gallery).toContainText('Has completed the test');
    // The Next samples box lists every running assessor and stays wholly on the floor when dragged.
    const next = gallery.getByRole('group', { name: 'Next samples', exact: true });
    await expect(next.getByRole('row')).toHaveCount(4);
    await expect(next.getByRole('row', { name: /A002/ })).toContainText('482 Product C');
    const floor = (await gallery.getByRole('group', { name: 'Booths' }).boundingBox())!;
    const inside = async () => {
      const box = (await next.boundingBox())!;
      expect(box.x).toBeGreaterThanOrEqual(floor.x);
      expect(box.y).toBeGreaterThanOrEqual(floor.y);
      expect(box.x + box.width).toBeLessThanOrEqual(floor.x + floor.width + 1);
      expect(box.y + box.height).toBeLessThanOrEqual(floor.y + floor.height + 1);
      return box;
    };
    const start = await inside();
    await page.mouse.move(start.x + 10, start.y + 10);
    await page.mouse.down();
    await page.mouse.move(floor.x - 200, floor.y + floor.height + 200, { steps: 5 });
    await page.mouse.up();
    const moved = await inside();
    expect(moved.x).toBeLessThan(start.x);
    await axeScan(page, '#run-study');
    await capture(page, 'run-study-stages', 'desktop', '#run-study');
    await gallery.getByRole('tab', { name: 'No booths', exact: true }).click();
    await expect(gallery.getByText('No booths yet.')).toBeVisible();
    await gallery.getByRole('tab', { name: 'Serving request', exact: true }).click();
    const request = gallery.getByRole('group', { name: 'Samples to serve', exact: true });
    await expect(request).toContainText('731 · Product A');
    await expect(request).toContainText('204 · Product B');
    await expect(request).toContainText('Waiting for sample');
    await request.getByRole('button', { name: 'Acknowledge', exact: true }).click();
    await expect(request).toContainText('Being prepared');
    await axeScan(page, '#run-study');
    await request.getByRole('button', { name: 'Mark served…', exact: true }).click();
    await expect(request.getByRole('button', { name: 'Confirm physical delivery' })).toBeVisible();
    await request.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(request.getByRole('button', { name: 'Mark served…' })).toBeVisible();
    await gallery.getByRole('button', { name: 'Assessor asks for help', exact: true }).click();
    await expect(request).toContainText('Assessor asked for help with samples');
    await expect(request.getByRole('button', { name: 'Acknowledge help request' })).toBeVisible();

    await gallery.getByRole('tab', { name: 'List', exact: true }).click();
    const board = gallery
      .getByRole('tabpanel', { name: 'List', exact: true })
      .getByTestId('run-board');
    await expect(board.locator('tbody tr[data-row-id]')).toHaveCount(6);
    await expect(board.getByRole('button', { name: 'Serve samples' })).toBeEnabled();
    await expect(board.getByRole('button', { name: 'Next assessor' })).toBeEnabled();
    await expect(board.getByRole('button', { name: 'Start first assessment' })).toBeEnabled();
    await expect(board).toContainText('In progress');
    await capture(page, 'run-study-list', 'desktop', '#run-study');
    await gallery.getByRole('tab', { name: 'List empty', exact: true }).click();
    await expect(gallery.getByText('No tablets or booths yet.')).toBeVisible();
    await gallery.getByRole('tab', { name: 'Name missing', exact: true }).click();
    await expect(
      gallery
        .getByRole('tabpanel', { name: 'Name missing', exact: true })
        .getByRole('button', { name: 'Next assessor' }),
    ).toBeDisabled();
    await gallery.getByRole('tab', { name: 'Handover', exact: true }).click();
    await expect(gallery.getByRole('heading', { name: 'Ready for A003' })).toBeVisible();
    await capture(page, 'run-study-handover', 'tablet', '#run-study');
    await gallery.getByRole('tab', { name: 'Staff panel', exact: true }).click();
    await expect(gallery.getByRole('region', { name: 'Staff status' })).toBeVisible();
    await gallery.getByRole('tab', { name: 'Add step menu', exact: true }).click();
    await expect(gallery.getByRole('button', { name: 'Wait for sample' })).toBeVisible();
    await capture(page, 'run-study-menu', 'desktop', '#run-study');
  },
);
