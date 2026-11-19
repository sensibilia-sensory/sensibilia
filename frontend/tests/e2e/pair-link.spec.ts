import { test, expect } from '@playwright/test';

test('pairing link with a certificate fingerprint opens the pair page with the code filled in', async ({
  page,
}) => {
  await page.goto('/assessor/pair?ca=' + 'AB'.repeat(32) + '#ABCD2345');
  await expect(page.getByRole('heading', { name: 'Register this tablet' })).toBeVisible();
  await expect(page.getByLabel('Pairing code')).toHaveValue('ABCD2345');
});
