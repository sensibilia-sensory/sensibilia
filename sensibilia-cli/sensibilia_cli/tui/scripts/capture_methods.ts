import { copyFileSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { resolve, sep } from "node:path";
import {
  BoxRenderable,
  SelectRenderable,
  ScrollBoxRenderable,
  TextareaRenderable,
  TextRenderable,
  type BaseRenderable,
} from "@opentui/core";
import { createTestRenderer } from "@opentui/core/testing";
import { Workbench } from "../src/app";
import { PythonBackend } from "../src/bridge";

const output = resolve(import.meta.dir, "../../../docs/tui");
const scratchRoot = resolve(import.meta.dir, "../../../.verification");
mkdirSync(scratchRoot, { recursive: true });
mkdirSync(output, { recursive: true });
const scratch = mkdtempSync(resolve(scratchRoot, "method-captures-"));
const methods = [
  "hedonic-9-v1",
  "cata-v1",
  "rata-v1",
  "jar-v1",
  "triangle-v1",
  "duo-trio-v1",
  "two-afc-v1",
  "flash-profile-v1",
  "napping-v1",
  "tcata-v1",
];
function descendants(node: BaseRenderable): BaseRenderable[] {
  return [node, ...node.getChildren().flatMap(descendants)];
}
for (const [method, width, height, scrolled] of [
  ...methods.map((method) => [method, 120, 36, false] as const),
  ["rata-v1", 80, 24, true] as const,
  ["tcata-v1", 120, 36, true] as const,
]) {
  const setup = await createTestRenderer({ width, height });
  const app = new Workbench(setup.renderer, new PythonBackend());
  function control(label: string, type: "input" | "choice") {
    const box = descendants(setup.renderer.root).find(
      (node) =>
        node instanceof BoxRenderable &&
        node
          .getChildren()
          .some(
            (child) =>
              child instanceof TextRenderable && child.plainText === label,
          ),
    );
    const result = box
      ?.getChildren()
      .find((child) =>
        type === "input"
          ? child instanceof TextareaRenderable
          : child instanceof SelectRenderable,
      );
    if (!result) throw new Error(`Missing ${label}`);
    (result as TextareaRenderable).focus();
    return result;
  }
  async function fill(label: string, text: string) {
    control(label, "input");
    setup.mockInput.pressKey("a", { ctrl: true });
    await setup.renderOnce();
    await setup.mockInput.pasteBracketedText(text);
    await setup.renderOnce();
  }
  async function choose(label: string, value: unknown) {
    let select = control(label, "choice") as SelectRenderable;
    const index = select.options.findIndex((option) => option.value === value);
    while (select.getSelectedIndex() !== index) {
      setup.mockInput.pressArrow(
        select.getSelectedIndex() < index ? "down" : "up",
      );
      await setup.renderOnce();
      select = control(label, "choice") as SelectRenderable;
    }
  }
  try {
    const file = resolve(scratch, `${method}-${width}-${scrolled}.json`);
    copyFileSync(
      resolve(import.meta.dir, "../../../examples/sample-study.json"),
      file,
    );
    await app.start(file);
    app.section = "tests";
    app.panel = "add";
    app.render();
    await setup.renderOnce();
    await choose("Registered method", method);
    await fill("Name", `${method.split("-v1")[0]} evaluation`);
    await fill("Instructions", "Follow the reviewed laboratory protocol.");
    if (method === "hedonic-9-v1")
      await fill("Questions · one per line", "Overall liking");
    if (["cata-v1", "rata-v1", "jar-v1", "tcata-v1"].includes(method))
      await fill("Attributes · one per line", "Sweet\nSour\nCreamy");
    if (method !== "hedonic-9-v1")
      for (const sample of app.snapshot!.document.samples) {
        const box = descendants(setup.renderer.root).find(
          (node) =>
            node instanceof BoxRenderable &&
            node
              .getChildren()
              .some(
                (child) =>
                  child instanceof TextRenderable &&
                  child.plainText === `[  ${sample.code} — ${sample.label}]`,
              ),
        ) as BoxRenderable;
        box.focus();
        setup.mockInput.pressEnter();
        await setup.renderOnce();
      }
    if (method === "rata-v1") {
      await fill("Scale labels · one per line", "Low\nMedium\nHigh");
      await choose("Scale origin", 0);
    }
    if (method === "duo-trio-v1") {
      await choose("Reference mode", "constant");
      await choose("Reference product", app.snapshot!.document.samples[0].id);
    }
    if (method === "two-afc-v1") {
      await fill("Comparison question", "Which sample is sweeter?");
      await choose(
        "Expected higher product",
        app.snapshot!.document.samples[0].id,
      );
    }
    if (method === "flash-profile-v1") {
      await fill(
        "Descriptor instructions",
        "Use the reviewed descriptor instructions.",
      );
      await fill(
        "Ranking instructions",
        "Use the reviewed ranking instructions.",
      );
    }
    if (method === "tcata-v1") {
      await fill("Start instruction", "Begin after the staff instruction.");
      await fill("Duration (ms)", "30000");
      await fill("Timing tolerance (ms)", "50");
    }
    if (!scrolled) {
      control("Registered method", "choice");
      (
        setup.renderer.root.findDescendantById(
          "properties",
        ) as ScrollBoxRenderable
      ).scrollTo(0);
    } else if (method === "tcata-v1") control("Timing tolerance (ms)", "input");
    await setup.renderOnce();
    const name = `method-${method}-${width}x${height}${scrolled ? "-scrolled" : ""}`;
    const capture = setup.captureSpans();
    await Bun.write(resolve(output, name + ".txt"), setup.captureCharFrame());
    await Bun.write(
      resolve(output, name + ".json"),
      JSON.stringify({
        ...capture,
        lines: capture.lines.map((line) => ({
          spans: line.spans.map((span) => ({
            ...span,
            fg: span.fg.toInts(),
            bg: span.bg.toInts(),
          })),
        })),
      }),
    );
    console.log(name);
  } finally {
    app.close();
  }
}
if (resolve(scratch).startsWith(scratchRoot + sep))
  rmSync(scratch, { recursive: true, force: true });
