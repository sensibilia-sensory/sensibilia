import { test, expect } from '@playwright/test';
import { capture } from './capture';
import { activeAttributes, temporalValid } from '../../src/shared/methods/temporal';
import { defaultConfiguration } from '../../src/methods';
import { timeoutScale } from '../timeouts';

test(
  'TCATA gallery concurrent toggles replay and lifecycle states',
  { tag: '@audit' },
  async ({ page }) => {
    test.setTimeout(120000 * timeoutScale);
    await page.goto('/dev/ui');
    await page.getByRole('button', { name: 'Temporal methods', exact: true }).click();
    const section = page.getByRole('region', { name: 'Temporal gallery', exact: true });
    await section.getByRole('button', { name: 'Start temporal run', exact: true }).click();
    await section.getByRole('button', { name: 'Sweet · unselected', exact: true }).click();
    await section.getByRole('button', { name: 'Bitter · unselected', exact: true }).click();
    await expect(
      section.getByRole('button', { name: 'Sweet · selected', exact: true }),
    ).toHaveAttribute('aria-pressed', 'true');
    await expect(
      section.getByRole('button', { name: 'Bitter · selected', exact: true }),
    ).toHaveAttribute('aria-pressed', 'true');
    await section.getByRole('button', { name: 'Sweet · selected', exact: true }).click();
    await expect(section.getByText(/complete ·/)).toBeVisible({ timeout: 10000 });
    await expect(
      section.getByTestId('gallery-temporal-capture-transitions').locator('tbody tr[data-row-id]'),
    ).toHaveCount(3);
    await section
      .getByRole('tabpanel', { name: 'capture', exact: true })
      .getByLabel('Replay elapsed ms', { exact: true })
      .fill('5000');
    await expect(section.getByText('Active at replay: Bitter', { exact: true })).toBeVisible();
    await capture(page, 'slice-17-gallery-capture', 'tablet', '#temporal-gallery');
    await section.getByRole('tab', { name: 'readonly', exact: true }).click();
    await expect(
      section.getByTestId('gallery-temporal-readonly-transitions').locator('tbody tr[data-row-id]'),
    ).toHaveCount(6);
    await capture(page, 'slice-17-gallery-replay', 'desktop', '#temporal-gallery');
    await section.getByRole('tab', { name: 'editor', exact: true }).click();
    await expect(section.getByLabel('Duration ms', { exact: true })).toBeVisible();
    await capture(page, 'slice-17-gallery-editor', 'desktop', '#temporal-gallery');
    await section.getByRole('tab', { name: 'empty', exact: true }).click();
    await expect(section.getByText('Not started', { exact: true })).toBeVisible();
    await section.getByRole('tab', { name: 'loading', exact: true }).click();
    await expect(section.getByRole('status')).toContainText('Loading');
    await section.getByRole('tab', { name: 'error', exact: true }).click();
    await expect(section.getByRole('alert')).toContainText('Cannot read');
  },
);

test('TCATA replay keeps zero concurrent states and rejects redundant transitions', () => {
  const config = defaultConfiguration('tcata-v1', []);
  if (config.kind !== 'tcata') throw new Error('Missing configuration');
  config.attributes = [
    { id: 'a', prompt: 'A', required: true },
    { id: 'b', prompt: 'B', required: true },
  ];
  const transitions = [
    {
      client_event_id: '1',
      seq: 1,
      elapsed_ms: 0,
      attribute_id: 'a',
      selected: true,
      recorded_at: '2026-10-14T12:00:00Z',
    },
    {
      client_event_id: '2',
      seq: 2,
      elapsed_ms: 0,
      attribute_id: 'b',
      selected: true,
      recorded_at: '2026-10-14T12:00:00Z',
    },
    {
      client_event_id: '3',
      seq: 3,
      elapsed_ms: 2,
      attribute_id: 'a',
      selected: false,
      recorded_at: '2026-10-14T12:00:00Z',
    },
  ];
  expect([...activeAttributes(transitions, 0)]).toEqual(['a', 'b']);
  expect([...activeAttributes(transitions, 2)]).toEqual(['b']);
  const value = {
    state: 'complete' as const,
    started_at: '2026-10-14T12:00:00Z',
    ended_at: '2026-10-14T12:00:30Z',
    elapsed_ms: 30000,
    clock_resolution_ms: 0.1,
    interruption_flags: [],
    transitions,
  };
  expect(temporalValid(config, value)).toBe(true);
  expect(
    temporalValid(config, {
      ...value,
      transitions: [...transitions, { ...transitions[2], client_event_id: '4', seq: 4 }],
    }),
  ).toBe(false);
});
