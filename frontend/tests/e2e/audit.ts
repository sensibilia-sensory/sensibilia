import { expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

// Accessibility scans run once per distinct UI state, and only in the audit tier.
// 'page' scans the whole document (one per page shell, so document-level rules such as
// landmarks, headings, title and duplicate IDs are covered). A CSS selector scans only
// the component a step revealed. SENSIBILIA_AUDIT=0 (the fast CI tier) skips scans.
export type Audit = 'page' | (string & {});

export const auditEnabled = process.env.SENSIBILIA_AUDIT !== '0';

export async function axeScan(page: Page, audit: Audit) {
  if (!auditEnabled) return undefined;
  const builder = new AxeBuilder({ page });
  if (audit !== 'page') {
    await expect(page.locator(audit).first(), `axe scope ${audit}`).toBeAttached();
    builder.include(audit);
  }
  const result = await builder.analyze();
  expect(result.violations.filter((v) => ['serious', 'critical'].includes(v.impact ?? ''))).toEqual(
    [],
  );
  return result;
}
