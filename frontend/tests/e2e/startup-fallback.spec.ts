import { test, expect } from '@playwright/test';

test('a page whose application script fails explains itself instead of staying blank', async ({
  page,
}) => {
  await page.route(/\/src\/main\.tsx|\/assets\/index-.*\.js/, (route) => route.abort());
  await page.goto('/assessor/');
  const alert = page.getByRole('alert');
  await expect(alert).toContainText('The application did not start.', { timeout: 15000 });
  await expect(alert).toContainText('Secure connection (https)');
  await expect(alert).toContainText('Browser:');
});
