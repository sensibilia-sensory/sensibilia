import { copyFileSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { resolve, sep } from "node:path";
import { createTestRenderer } from "@opentui/core/testing";
import { Workbench } from "../src/app";
import { PythonBackend } from "../src/bridge";
import { outline } from "../src/model";

const output = resolve(import.meta.dir, "../../../docs/tui");
mkdirSync(output, { recursive: true });
const scratchRoot = resolve(import.meta.dir, "../../../.verification");
mkdirSync(scratchRoot, { recursive: true });
const scratch = mkdtempSync(resolve(scratchRoot, "captures-"));
for (const [width, height, theme, state] of [
  [120, 36, "dark", "fields"],
  [80, 24, "dark", "fields"],
  [120, 36, "light", "fields"],
  [120, 36, "light", "preview"],
  [120, 36, "contrast", "fields"],
  [120, 36, "contrast", "check"],
  [120, 36, "dark", "errors"],
  [120, 36, "dark", "add"],
  [120, 36, "dark", "files"],
  [120, 36, "dark", "server"],
  [120, 36, "dark", "confirm"],
] as const) {
  const setup = await createTestRenderer({ width, height });
  const backend = new PythonBackend();
  const app = new Workbench(setup.renderer, backend);
  try {
    const file = resolve(scratch, `${theme}-${state}-${width}.json`);
    copyFileSync(
      resolve(import.meta.dir, "../../../examples/sample-study.json"),
      file,
    );
    await app.start(file);
    await app.select({
      section: "flow",
      id: outline(app.snapshot!.document)[1].id,
    });
    app.theme = theme;
    if (state === "errors") {
      await app.mutate("add", {
        section: "flow",
        kind: "info",
        title: "Review wording",
      });
      await app.check();
    } else if (state === "check") await app.check();
    else if (state === "confirm") {
      app.dirty = true;
      setup.mockInput.pressKey("F10");
    } else app.panel = state;
    app.render();
    await setup.renderOnce();
    const name = `${width}x${height}-${theme}-${state}`;
    await Bun.write(resolve(output, name + ".txt"), setup.captureCharFrame());
    const captured = setup.captureSpans();
    await Bun.write(
      resolve(output, name + ".json"),
      JSON.stringify({
        ...captured,
        lines: captured.lines.map((line) => ({
          spans: line.spans.map((span) => ({
            ...span,
            fg: span.fg.toInts(),
            bg: span.bg.toInts(),
          })),
        })),
      }),
    );
    console.log(name + "\n" + setup.captureCharFrame());
  } finally {
    app.close();
  }
}
if (resolve(scratch).startsWith(scratchRoot + sep))
  rmSync(scratch, { recursive: true, force: true });
