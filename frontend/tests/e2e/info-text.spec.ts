import { test, expect, type Page } from '@playwright/test';
import { axeScan } from './audit';
import { expectFlowSaved } from './save';
import { addStep, startStudy } from './steps';
import { timeoutScale } from '../timeouts';
import { displayText } from '../../src/shared/flow/text';
import {
  parseRichText,
  plainRichText,
  type RichBlock,
  type RichInline,
} from '../../src/shared/nodes/richText';

const token = 'e2e-researcher-' + 'x'.repeat(32);
const headers = { Authorization: 'Bearer ' + token };

async function signIn(page: Page) {
  await page.getByLabel('Access key', { exact: true }).fill(token);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
}
const shape = (blocks: RichBlock[]) => JSON.stringify(blocks);
const text = (value: string): RichInline => ({ kind: 'text', text: value });

test('information text: paragraphs, line breaks, bold and italic, nothing else', () => {
  // A blank line starts a paragraph; a single line break stays a line break.
  expect(parseRichText('One\ntwo\n\nThree')).toEqual([
    [{ kind: 'text', text: 'One' }, { kind: 'break' }, { kind: 'text', text: 'two' }],
    [{ kind: 'text', text: 'Three' }],
  ]);
  // Windows line endings, extra blank lines and trailing space are tidied, not shown.
  expect(parseRichText('A\r\n\r\n\r\n\r\nB\n\n')).toHaveLength(2);
  expect(parseRichText('   \n\n  ')).toEqual([]);
  expect(parseRichText('')).toEqual([]);
  // Bold, italic, both, and italic inside bold.
  expect(shape(parseRichText('a **b** c'))).toBe(
    shape([[text('a '), { kind: 'strong', children: [text('b')] }, text(' c')]]),
  );
  expect(shape(parseRichText('*i*'))).toBe(shape([[{ kind: 'em', children: [text('i')] }]]));
  expect(shape(parseRichText('***x***'))).toBe(
    shape([[{ kind: 'strong', children: [{ kind: 'em', children: [text('x')] }] }]]),
  );
  expect(shape(parseRichText('**very *important* point**'))).toBe(
    shape([
      [
        {
          kind: 'strong',
          children: [text('very '), { kind: 'em', children: [text('important')] }, text(' point')],
        },
      ],
    ]),
  );
  // Formatting stays inside its line.
  expect(plainRichText('**a\nb**')).toBe('**a\nb**');
  // A star that is not a mark stays a star: spaces around it, an unmatched mark, an escape.
  expect(plainRichText('5 * 3 * 2')).toBe('5 * 3 * 2');
  expect(plainRichText('**open')).toBe('**open');
  expect(plainRichText('Price \\*not italic\\*')).toBe('Price *not italic*');
  expect(plainRichText('a \\\\ b')).toBe('a \\ b');
  // HTML and links are only text.
  expect(plainRichText('<b>x</b> <script>y()</script> [l](http://e)')).toBe(
    '<b>x</b> <script>y()</script> [l](http://e)',
  );
  // Zero, spaces and other languages survive untouched.
  expect(plainRichText('0')).toBe('0');
  expect(plainRichText('Ångström **smak**')).toBe('Ångström smak');
});

test('$SAMPLE shows the sample code, like {{sample_code}}, and nothing else changes', () => {
  const variables = { 'sample.code': 'Sample 1', 'sample.position': 2 };
  expect(displayText('Taste $SAMPLE now', variables)).toBe('Taste Sample 1 now');
  expect(displayText('$SAMPLE and {{ sample_code }} at {{sample_position}}', variables)).toBe(
    'Sample 1 and Sample 1 at 2',
  );
  // Only the exact word: $SAMPLES, $sample and prices are ordinary text.
  expect(displayText('$SAMPLES $sample $5', variables)).toBe('$SAMPLES $sample $5');
  // An older study (tokens off) shows it literally; outside a loop there is no code to show.
  expect(displayText('Taste $SAMPLE', variables, false)).toBe('Taste $SAMPLE');
  expect(displayText('Taste $SAMPLE', {})).toBe('Taste ');
});

test('information text editor: new lines, Bold and Italic buttons, and what the tablet shows', async ({
  page,
}) => {
  await page.goto('/dev/ui');
  await page.getByRole('button', { name: 'Flow foundation', exact: true }).click();
  const panel = page.getByRole('tabpanel', { name: 'Information text', exact: true });
  await page.getByRole('tab', { name: 'Information text', exact: true }).click();
  const box = panel.getByLabel('Text', { exact: true });
  const shown = panel.getByTestId('info-text-rendered');
  // The starting text shows two paragraphs, one line break, bold and italic.
  await expect(shown.locator('p')).toHaveCount(2);
  await expect(shown.locator('br')).toHaveCount(1);
  await expect(shown.locator('strong')).toHaveText('taste each sample in order');
  await expect(shown.locator('em')).toHaveText('Rinse your mouth');
  // Typing Enter makes a new line.
  await box.fill('');
  await box.pressSequentially('First line');
  await box.press('Enter');
  await box.pressSequentially('Second line');
  await expect(box).toHaveValue('First line\nSecond line');
  await expect(shown.locator('br')).toHaveCount(1);
  // Select a word and use Bold, then Italic on another, then Bold again to take it off.
  await box.fill('Rinse well between samples');
  await box.evaluate((el: HTMLTextAreaElement) => el.setSelectionRange(6, 10));
  await panel.getByRole('button', { name: 'Bold', exact: true }).click();
  await expect(box).toHaveValue('Rinse **well** between samples');
  await expect(shown.locator('strong')).toHaveText('well');
  await expect(box).toBeFocused();
  await panel.getByRole('button', { name: 'Bold', exact: true }).click();
  await expect(box).toHaveValue('Rinse well between samples');
  await box.evaluate((el: HTMLTextAreaElement) => el.setSelectionRange(11, 18));
  await panel.getByRole('button', { name: 'Italic', exact: true }).click();
  await expect(box).toHaveValue('Rinse well *between* samples');
  await expect(shown.locator('em')).toHaveText('between');
  // Typed HTML is shown as text and creates no elements.
  await box.fill('<b>not bold</b> <img src=x onerror=alert(1)><script>boom()</script>');
  await expect(shown).toContainText('<b>not bold</b>');
  await expect(shown.locator('b, img, script')).toHaveCount(0);
  await expect(shown.locator('strong, em')).toHaveCount(0);
  // Read-only: no typing and no formatting buttons.
  await page.getByRole('tab', { name: 'Information text, read-only', exact: true }).click();
  const locked = page.getByRole('tabpanel', { name: 'Information text, read-only', exact: true });
  await expect(locked.getByLabel('Text', { exact: true })).toBeDisabled();
  await expect(locked.getByRole('button', { name: 'Bold', exact: true })).toBeDisabled();
  await expect(locked.getByRole('button', { name: 'Italic', exact: true })).toBeDisabled();
});

test('inside a sample loop the editor offers Insert sample code, and only there', async ({
  page,
}) => {
  await page.goto('/dev/ui');
  await page.getByRole('button', { name: 'Flow foundation', exact: true }).click();
  await page.getByRole('tab', { name: 'Information text', exact: true }).click();
  const outside = page.getByRole('tabpanel', { name: 'Information text', exact: true });
  await expect(outside.getByRole('button', { name: 'Insert sample code' })).toHaveCount(0);
  await page.getByRole('tab', { name: 'Information text in a sample loop', exact: true }).click();
  const panel = page.getByRole('tabpanel', { name: 'Information text in a sample loop' });
  const box = panel.getByLabel('Text', { exact: true });
  await expect(panel.getByText('Type $SAMPLE to show the code')).toBeVisible();
  await box.fill('Taste  now');
  await box.evaluate((el: HTMLTextAreaElement) => el.setSelectionRange(6, 6));
  await panel.getByRole('button', { name: 'Insert sample code', exact: true }).click();
  await expect(box).toHaveValue('Taste $SAMPLE now');
  await expect(box).toBeFocused();
});

test('an information step keeps its line breaks and formatting through save and reload', async ({
  page,
  request,
}) => {
  test.setTimeout(120000 * timeoutScale);
  await page.goto('/researcher/studies');
  await signIn(page);
  await startStudy(page);
  await page.getByLabel('Title', { exact: true }).fill('Information text');
  await page.getByLabel('Description', { exact: true }).fill('Formatted information');
  await page.getByRole('button', { name: 'Create draft', exact: true }).click();
  await expect(page).toHaveURL(/\/versions\/[^/]+\/flow$/);
  const [, , , studyId, , versionId] = new URL(page.url()).pathname.split('/');
  await addStep(page, 'info');
  const box = page.getByLabel('Text', { exact: true });
  await box.fill('Welcome.');
  await box.press('Enter');
  await box.pressSequentially('Taste in the order shown.');
  await box.press('Enter');
  await box.press('Enter');
  await box.pressSequentially('Rinse between samples');
  await box.evaluate((el: HTMLTextAreaElement) => el.setSelectionRange(0, 8));
  await page.getByRole('button', { name: 'Bold', exact: true }).click();
  await expect(box).toBeFocused();
  await expectFlowSaved(page);
  const body = async () => {
    const version = await (
      await request.get('/studies/' + studyId + '/versions/' + versionId, { headers })
    ).json();
    return version.form.nodes.find((n: { kind: string }) => n.kind === 'info').data.body.en;
  };
  const expected = '**Welcome.**\nTaste in the order shown.\n\nRinse between samples';
  expect(await body()).toBe(expected);
  await page.reload();
  await signIn(page);
  await page
    .getByTestId('flow-outline')
    .locator('tbody tr[data-row-id]')
    .first()
    .getByRole('button', { name: 'Edit', exact: true })
    .click();
  await expect(page.getByLabel('Text', { exact: true })).toHaveValue(expected);
});

test(
  'information text editor passes the accessibility scan',
  { tag: '@audit' },
  async ({ page }) => {
    await page.goto('/dev/ui');
    await page.getByRole('button', { name: 'Flow foundation', exact: true }).click();
    await page.getByRole('tab', { name: 'Information text', exact: true }).click();
    await axeScan(page, '[data-testid="info-text-fixture"]');
  },
);
