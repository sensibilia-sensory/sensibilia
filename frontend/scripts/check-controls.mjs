import ts from 'typescript';
import { readdir, readFile } from 'node:fs/promises';
const issues = [];
async function scan(dir) {
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const file = dir + '/' + e.name;
    if (e.isDirectory()) await scan(file);
    else if (file.endsWith('.tsx')) {
      const source = ts.createSourceFile(
        file,
        await readFile(file, 'utf8'),
        ts.ScriptTarget.Latest,
        true,
        ts.ScriptKind.TSX,
      );
      function visit(n) {
        if (ts.isJsxOpeningElement(n) || ts.isJsxSelfClosingElement(n)) {
          const tag = n.tagName.getText(source);
          if (
            ['button', 'input', 'select', 'textarea'].includes(tag) &&
            !file.startsWith('src/ui/')
          )
            issues.push(file + ': native control ' + tag);
          const attrs = n.attributes.properties;
          const planned = attrs.some(
            (a) =>
              ts.isJsxAttribute(a) &&
              a.name.getText(source) === 'variant' &&
              a.initializer?.getText(source) === '"planned"',
          );
          if (
            planned &&
            attrs.some(
              (a) => ts.isJsxAttribute(a) && ['onClick', 'href'].includes(a.name.getText(source)),
            )
          )
            issues.push(file + ': planned control has an action');
        }
        ts.forEachChild(n, visit);
      }
      visit(source);
    }
  }
}
// Audit all active screen modules. Legacy modules are unreachable from Router.
for (const dir of ['src/researcher', 'src/shared', 'src/dev', 'src/ui']) await scan(dir);
if (issues.length) {
  console.error(issues.join('\\n'));
  process.exitCode = 1;
} else console.log('Active controls comply: primitives only; planned controls have no actions.');
