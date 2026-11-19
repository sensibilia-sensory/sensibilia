import { expect, type Page } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { format } from 'prettier';
import { evidenceDir, evidencePath } from './evidence';
import { auditEnabled, axeScan, type Audit } from './audit';

// Evidence files (screenshots, metrics JSON) are written in the audit tier, or on request
// with SENSIBILIA_EVIDENCE=1. The fast tier skips layout metrics and file writes.
const evidenceEnabled = auditEnabled || process.env.SENSIBILIA_EVIDENCE === '1';
const emptyMetrics = {
  violations: [] as string[],
  tables: [] as {
    enlarged: boolean;
    tablet: boolean;
    name: string | null | undefined;
    columnsVisible: number;
    rowsVisible: number;
    rowHeights: number[];
    headerHeight: number | undefined;
  }[],
  fieldsVisible: 0,
};
export async function capture(
  page: Page,
  name: string,
  profile: 'desktop' | 'operator-big' | 'tablet' = 'desktop',
  // Scan only a UI state not already scanned in this run; omit for repeated states.
  audit?: Audit,
) {
  if (!evidenceEnabled) return { metrics: emptyMetrics, axe: undefined };
  await mkdir(evidenceDir, { recursive: true });
  const metrics = await page.evaluate(() => {
    const violations: string[] = [];
    for (const el of document.querySelectorAll<HTMLElement>('body *')) {
      if (!el.checkVisibility()) continue;
      const s = getComputedStyle(el);
      for (const side of ['top', 'right', 'bottom', 'left'])
        if (parseFloat(s.getPropertyValue('padding-' + side)) > 12)
          violations.push(el.tagName + ' padding');
      // Radio markers are round so single choice is not mistaken for multiple choice.
      const roundControl = el instanceof HTMLInputElement && el.type === 'radio';
      for (const corner of ['top-left', 'top-right', 'bottom-left', 'bottom-right'])
        if (!roundControl && parseFloat(s.getPropertyValue('border-' + corner + '-radius')) > 6)
          violations.push(el.tagName + ' radius');
      if (s.boxShadow !== 'none' || s.backgroundImage.includes('gradient('))
        violations.push(el.tagName + ' decoration');
      if (
        s.display === 'grid' &&
        s.gridTemplateColumns.split(' ').length >= 2 &&
        el.children.length >= 4 &&
        el.dataset.layout !== 'allowed-grid'
      )
        violations.push(el.tagName + ' card grid');
    }
    const visible = (el: Element) => {
      if (!el.checkVisibility()) return false;
      const r = el.getBoundingClientRect();
      let top = 0,
        bottom = innerHeight,
        left = 0,
        right = innerWidth;
      for (let parent = el.parentElement; parent; parent = parent.parentElement) {
        const style = getComputedStyle(parent);
        if (/(auto|scroll|hidden)/.test(style.overflow + style.overflowY + style.overflowX)) {
          const bound = parent.getBoundingClientRect();
          top = Math.max(top, bound.top);
          bottom = Math.min(bottom, bound.bottom);
          left = Math.max(left, bound.left);
          right = Math.min(right, bound.right);
        }
      }
      if (el.matches('tbody tr')) {
        const headers = [...(el.closest('table')?.querySelectorAll('thead th') ?? [])];
        top = Math.max(top, ...headers.map((header) => header.getBoundingClientRect().bottom));
      }
      return (
        r.top >= top &&
        r.bottom <= bottom &&
        (el.matches('tbody tr') || (r.left >= left && r.right <= right)) &&
        r.width > 0 &&
        r.height > 0
      );
    };
    return {
      violations,
      tables: [...document.querySelectorAll('table')]
        .filter((t) => t.checkVisibility())
        .map((t) => ({
          enlarged: !!t.closest('.ui-operator-big'),
          tablet: !!t.closest('.ui-preview'),
          name: t.querySelector('caption')?.textContent,
          columnsVisible: [...t.querySelectorAll('thead th')].filter(visible).length,
          rowsVisible: [...t.querySelectorAll('tbody tr[data-row-id]')].filter(visible).length,
          rowHeights: [
            ...new Set(
              [...t.querySelectorAll('tbody tr[data-row-id]')].map(
                (r) => r.getBoundingClientRect().height,
              ),
            ),
          ],
          headerHeight: t.querySelector('thead')?.getBoundingClientRect().height,
        })),
      fieldsVisible: [...document.querySelectorAll('.ui-field')].filter(visible).length,
    };
  });
  expect(metrics.violations).toEqual([]);
  for (const table of metrics.tables) {
    const big =
      (profile === 'operator-big' && table.enlarged) || (profile === 'tablet' && table.tablet);
    if (profile === 'tablet' && table.tablet) {
      expect(table.rowHeights.every((h) => h >= 48)).toBe(true);
      expect(table.headerHeight).toBeGreaterThanOrEqual(48);
    } else {
      if (table.rowHeights.length) expect(table.rowHeights).toEqual([big ? 48 : 28]);
      expect(table.headerHeight).toBe(big ? 48 : 30);
    }
  }
  await page.screenshot({ path: evidencePath(name + '.png') });
  await writeFile(
    evidencePath(name + '.json'),
    await format(JSON.stringify(metrics), { parser: 'json' }),
  );
  const axe = audit ? await axeScan(page, audit) : undefined;
  return { metrics, axe };
}
