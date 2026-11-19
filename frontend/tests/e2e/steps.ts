import type { Page } from '@playwright/test';

const labels: Record<string, string> = {
  info: 'Information',
  consent: 'Consent',
  question: 'Question',
  matrix: 'Question grid',
  group: 'Group',
  'sample loop': 'Repeat for each sample',
  confirm: 'Confirmation',
  'code entry': 'Code entry',
  serve_gate: 'Wait for sample',
  end: 'End',
};

const openMenu = (page: Page) =>
  page.getByRole('button', { name: 'Add step', exact: true }).click();

/** Add a non-method step through the Add step menu (kind uses the old button wording). */
export async function addStep(page: Page, kind: string) {
  await openMenu(page);
  await page.getByRole('button', { name: labels[kind] ?? kind, exact: true }).click();
}

/** Add a registered sensory method (by registry id) through the Add step menu. */
export async function addMethodStep(page: Page, methodId: string) {
  await openMenu(page);
  await page.locator('[data-method-id="' + methodId + '"]').click();
}

export async function reuseBlock(page: Page) {
  await openMenu(page);
  await page.getByRole('button', { name: 'Questionnaire block…', exact: true }).click();
}

/** Actions kept under the study header's More actions menu. */
export async function moreAction(page: Page, name: string) {
  await page.getByRole('button', { name: 'More actions', exact: true }).click();
  await page.getByRole('button', { name, exact: true }).click();
}

/** Open the New study form from the Studies list. */
export async function startStudy(page: Page) {
  await page.getByRole('button', { name: 'Studies', exact: true }).click();
  await page.getByRole('button', { name: 'New study', exact: true }).click();
}
