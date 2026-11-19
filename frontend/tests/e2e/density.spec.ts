import { test, expect, type Page } from '@playwright/test';
import { axeScan } from './audit';
import { mkdir, writeFile } from 'node:fs/promises';
import { format } from 'prettier';
import { evidenceDir, evidencePath } from './evidence';

async function densityViolations(page: Page) {
  return page.evaluate(() => {
    const out: string[] = [];
    for (const el of document.querySelectorAll<HTMLElement>('body *')) {
      const s = getComputedStyle(el);
      if (!el.offsetParent) continue;
      for (const side of ['Top', 'Right', 'Bottom', 'Left']) {
        const p = parseFloat(s.getPropertyValue(`padding-${side.toLowerCase()}`));
        if (p > 12) out.push(`${el.tagName}.${el.className} padding${side}=${p}`);
      }
      for (const corner of ['top-left', 'top-right', 'bottom-left', 'bottom-right']) {
        const r = parseFloat(s.getPropertyValue(`border-${corner}-radius`));
        if (r > 6) out.push(`${el.tagName}.${el.className} radius=${r}`);
      }
      if (s.boxShadow !== 'none') out.push(`${el.tagName}.${el.className} box-shadow`);
      if (s.backgroundImage.includes('gradient('))
        out.push(`${el.tagName}.${el.className} gradient`);
      if (
        s.display === 'grid' &&
        s.gridTemplateColumns.split(' ').length >= 2 &&
        el.children.length >= 4 &&
        el.dataset.layout !== 'allowed-grid'
      )
        out.push(`${el.tagName}.${el.className} possible card grid`);
    }
    return out;
  });
}

test('density: /dev/ui', { tag: '@audit' }, async ({ page }) => {
  await page.goto('/dev/ui');
  const violations = await densityViolations(page);
  expect(violations, violations.join('\n')).toEqual([]);
  await page.getByRole('button', { name: 'Show properties', exact: true }).click();
  await page.getByRole('button', { name: 'Fields & property grid', exact: true }).click();
  await page.locator('.ui-main').getByText('Advanced settings', { exact: true }).click();
  expect(await densityViolations(page)).toEqual([]);
  await page.getByRole('button', { name: 'Generate codes…', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  expect(await densityViolations(page)).toEqual([]);
});

test(
  'gallery test-types table shows 15+ complete rows without scrolling',
  { tag: '@audit' },
  async ({ page }) => {
    await page.goto('/dev/ui');
    await page.evaluate(() => document.fonts.ready);
    const metrics = await page.getByTestId('test-types-table').evaluate((table) => {
      const viewport = { top: 0, right: innerWidth, bottom: innerHeight, left: 0 };
      for (let parent: Element | null = table; parent; parent = parent.parentElement) {
        const style = getComputedStyle(parent);
        if (/(auto|scroll|hidden)/.test(style.overflow + style.overflowY + style.overflowX)) {
          const rect = parent.getBoundingClientRect();
          viewport.top = Math.max(viewport.top, rect.top);
          viewport.bottom = Math.min(viewport.bottom, rect.bottom);
          viewport.left = Math.max(viewport.left, rect.left);
          viewport.right = Math.min(viewport.right, rect.right);
        }
      }
      const rows = Array.from(table.querySelectorAll('tbody tr'));
      return {
        visibleRows: rows.filter((row) => {
          const r = row.getBoundingClientRect();
          return (
            r.top >= viewport.top &&
            r.bottom <= viewport.bottom &&
            r.left >= viewport.left &&
            r.right <= viewport.right
          );
        }).length,
        rowHeights: [...new Set(rows.map((row) => row.getBoundingClientRect().height))],
        headerHeight: table.querySelector('thead')!.getBoundingClientRect().height,
        documentScroll: document.documentElement.scrollHeight > innerHeight,
      };
    });
    expect(metrics.visibleRows).toBeGreaterThanOrEqual(15);
    expect(metrics.rowHeights).toEqual([28]);
    expect(metrics.headerHeight).toBe(30);
    expect(metrics.documentScroll).toBe(false);
    await mkdir(evidenceDir, { recursive: true });
    await page.screenshot({ path: evidencePath('gallery-baseline.png') });
    await writeFile(
      evidencePath('gallery-metrics.json'),
      await format(JSON.stringify(metrics), { parser: 'json' }),
    );
  },
);

test('gallery has no serious or critical axe violations', { tag: '@audit' }, async ({ page }) => {
  await page.goto('/dev/ui');
  // One full-page scan covers the gallery shell and document-level rules; later steps
  // scan only what they reveal.
  await axeScan(page, 'page');
  await page.getByRole('button', { name: 'Show properties', exact: true }).click();
  await page.locator('.ui-main').getByText('Advanced settings', { exact: true }).click();
  await axeScan(page, '#properties, .ui-side-panel');
  await page.getByRole('button', { name: 'Generate codes…', exact: true }).click();
  await axeScan(page, 'dialog[open]');
});
