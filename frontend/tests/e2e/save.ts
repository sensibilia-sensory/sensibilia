import { expect, type Page } from '@playwright/test';

// Save flow is disabled both while a save is in flight and once the draft is clean.
// Wait for the in-flight state to clear so later navigation is not held by the
// unsaved-changes guard on slower machines.
export async function expectFlowSaved(page: Page) {
  const save = page.getByRole('button', { name: 'Save flow', exact: true });
  await expect(save).toBeDisabled();
  await expect(page.getByText('Loading / saving…', { exact: true })).toHaveCount(0);
  await expect(save).toBeDisabled();
}
