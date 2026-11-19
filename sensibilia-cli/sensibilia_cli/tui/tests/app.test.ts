import { afterEach, expect, test } from "bun:test";
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { resolve, sep } from "node:path";
import {
  BoxRenderable,
  InputRenderable,
  SelectRenderable,
  TextareaRenderable,
  TextRenderable,
  type BaseRenderable,
} from "@opentui/core";
import { createTestRenderer } from "@opentui/core/testing";
import { Workbench } from "../src/app";
import { PythonBackend } from "../src/bridge";
import { outline } from "../src/model";
import { tokens } from "../src/tokens";

const scratch = resolve(import.meta.dir, "../../../.verification/tui");
mkdirSync(scratch, { recursive: true });
let current:
  | {
      setup: Awaited<ReturnType<typeof createTestRenderer>>;
      app: Workbench;
      folder: string;
      file: string;
    }
  | undefined;

afterEach(() => {
  current?.app.close();
  if (current && resolve(current.folder).startsWith(scratch + sep))
    rmSync(current.folder, { recursive: true, force: true });
  current = undefined;
});

async function start(width = 120, height = 36) {
  const folder = mkdtempSync(resolve(scratch, "case-"));
  const file = resolve(folder, "study.json");
  copyFileSync(
    resolve(import.meta.dir, "../../../examples/sample-study.json"),
    file,
  );
  const setup = await createTestRenderer({ width, height });
  const app = new Workbench(setup.renderer, new PythonBackend());
  current = { setup, app, folder, file };
  await app.start(file);
  await setup.renderOnce();
  return current;
}

function descendants(node: BaseRenderable): BaseRenderable[] {
  return [node, ...node.getChildren().flatMap(descendants)];
}
function inputFor(label: string) {
  const box = descendants(current!.setup.renderer.root).find(
    (node) =>
      node instanceof BoxRenderable &&
      node
        .getChildren()
        .some(
          (child) =>
            child instanceof TextRenderable && child.plainText === label,
        ),
  );
  const input = box
    ?.getChildren()
    .find((child) => child instanceof TextareaRenderable);
  if (!(input instanceof TextareaRenderable))
    throw new Error(`Input missing: ${label}`);
  input.focus();
  return input;
}
function button(label: string) {
  const box = descendants(current!.setup.renderer.root).find(
    (node) =>
      node instanceof BoxRenderable &&
      node
        .getChildren()
        .some(
          (child) =>
            child instanceof TextRenderable && child.plainText === `[${label}]`,
        ),
  );
  if (!(box instanceof BoxRenderable))
    throw new Error(`Button missing: ${label}`);
  box.focus();
  current!.setup.mockInput.pressEnter();
}
async function settle(predicate: () => boolean) {
  for (let pass = 0; pass < 300; pass++) {
    if (predicate()) return;
    await Bun.sleep(10);
  }
  throw new Error(`Timed out: ${current?.app.status}`);
}

test("initial render is clean, compact and hides internal identifiers", async () => {
  const { setup, app } = await start();
  expect(app.dirty).toBe(false);
  expect(setup.captureCharFrame()).toContain("Sensibilia");
  expect(setup.captureCharFrame()).toContain("Example sample evaluation");
  const rows = outline(app.snapshot!.document);
  expect(setup.captureCharFrame()).not.toContain(rows[0].id);
  await app.select({ section: "flow", id: rows[1].id });
  await setup.renderOnce();
  expect(setup.captureCharFrame()).toContain(
    "How often do you use this product?",
  );
  expect(setup.captureCharFrame()).toContain("Choice 1");
  expect(app.dirty).toBe(false);
});

test("keyboard edits apply through Python and stable identifiers survive", async () => {
  const { setup, app, file } = await start();
  const id = outline(app.snapshot!.document)[1].id;
  await app.select({ section: "flow", id });
  await setup.renderOnce();
  const input = inputFor("Title (en)");
  expect(input).toBeInstanceOf(InputRenderable);
  setup.mockInput.pressKey("a", { ctrl: true });
  await setup.mockInput.typeText("Usage frequency");
  await settle(() => app.dirty);
  setup.mockInput.pressKey("F2");
  await settle(() => !app.busy && !app.dirty);
  const saved = JSON.parse(readFileSync(file, "utf8"));
  expect(saved.form.nodes[1].id).toBe(id);
  expect(saved.form.nodes[1].title.en).toBe("Usage frequency");
});

test("dirty fields survive theme and resize; navigation is guarded; Escape discards", async () => {
  const { setup, app, file } = await start();
  const rows = outline(app.snapshot!.document);
  await app.select({ section: "flow", id: rows[1].id });
  await setup.renderOnce();
  inputFor("Title (en)");
  setup.mockInput.pressKey("a", { ctrl: true });
  await setup.mockInput.typeText("Unapplied wording");
  await settle(() => app.dirty);
  await app.select({ section: "flow", id: rows[0].id });
  expect(app.snapshot!.selection.id).toBe(rows[1].id);
  setup.mockInput.pressKey("F8");
  await setup.renderOnce();
  setup.resize(80, 24);
  app.render();
  await setup.renderOnce();
  expect(inputFor("Title (en)").plainText).toBe("Unapplied wording");
  expect(readFileSync(file, "utf8")).not.toContain("Unapplied wording");
  setup.mockInput.pressEscape();
  await settle(() => !app.dirty);
  await setup.renderOnce();
  expect(app.dirty).toBe(false);
  expect(inputFor("Title (en)").plainText).toBe("Frequency");
});

test("invalid JSON is reported and never overwrites the document", async () => {
  const { setup, app, file } = await start();
  const original = readFileSync(file, "utf8");
  const id = outline(app.snapshot!.document)[1].id;
  await app.select({ section: "flow", id });
  button("JSON");
  await setup.renderOnce();
  inputFor("Existing contract fields (JSON)");
  setup.mockInput.pressKey("a", { ctrl: true });
  await setup.mockInput.typeText("invalid JSON");
  await settle(() => app.dirty);
  await app.apply();
  await setup.renderOnce();
  expect(app.error).toBe(true);
  expect(app.dirty).toBe(true);
  expect(readFileSync(file, "utf8")).toBe(original);
});

test("add, reorder, validate and undo operate on the local file", async () => {
  const { setup, app } = await start();
  const before = outline(app.snapshot!.document);
  setup.mockInput.pressKey("F3");
  await setup.renderOnce();
  button("Add block");
  await settle(
    () =>
      !app.busy && outline(app.snapshot!.document).length === before.length + 1,
  );
  const added = app.snapshot!.selection.id!;
  const beforeMove = outline(app.snapshot!.document).findIndex(
    (row) => row.id === added,
  );
  await app.mutate("move", { direction: "up" });
  expect(
    outline(app.snapshot!.document).findIndex((row) => row.id === added),
  ).toBe(beforeMove - 1);
  await app.check();
  await setup.renderOnce();
  expect(setup.captureCharFrame()).toContain("errors");
  expect(setup.captureCharFrame()).toContain("Review nonblank");
  await app.mutate("undo");
  expect(
    outline(app.snapshot!.document).findIndex((row) => row.id === added),
  ).toBe(beforeMove);
});

test("minimum terminal fits its toolbar and all example outline rows; smaller screens show guidance", async () => {
  const { setup, app } = await start(80, 24);
  const frame = setup.captureCharFrame();
  expect(frame).toContain("[F10 Quit]");
  expect(frame).toContain("Welcome");
  expect(frame).toContain("Done");
  setup.resize(60, 18);
  app.render();
  await setup.renderOnce();
  expect(setup.captureCharFrame()).toContain("Resize the terminal");
});

test("quit with unapplied edits presents inline confirmation", async () => {
  const { setup, app } = await start();
  await app.select({
    section: "flow",
    id: outline(app.snapshot!.document)[1].id,
  });
  inputFor("Title (en)");
  await setup.mockInput.typeText(" edit");
  await settle(() => app.dirty);
  setup.mockInput.pressKey("F10");
  await setup.renderOnce();
  expect(app.panel).toBe("confirm");
  expect(setup.captureCharFrame()).toContain("saved local file stays intact");
  setup.mockInput.pressEscape();
  await settle(() => app.panel === "fields");
  await setup.renderOnce();
  expect(app.dirty).toBe(true);
  expect(app.panel).toBe("fields");
});

test("new item wording is guarded until added or discarded", async () => {
  const { setup, app } = await start();
  setup.mockInput.pressKey("F3");
  await setup.renderOnce();
  inputFor("Title");
  setup.mockInput.pressKey("a", { ctrl: true });
  await setup.renderOnce();
  await setup.mockInput.typeText("New screening question");
  await settle(() => app.dirty);
  setup.mockInput.pressKey("F7");
  expect(app.panel).toBe("add");
  button("Add block");
  await settle(() => !app.busy && !app.dirty);
  expect(app.snapshot!.view.title).toBe("New screening question");
});

test("each theme keeps ordinary, muted and selected text above WCAG AA contrast", () => {
  expect(tokens("light").color("bg")).not.toBe(tokens("dark").color("bg"));
  expect(tokens("contrast").color("bg")).toBe("#ffffff");
  const luminance = (hex: string) => {
    const values = [1, 3, 5]
      .map((index) => parseInt(hex.slice(index, index + 2), 16) / 255)
      .map((value) =>
        value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4,
      );
    return values[0] * 0.2126 + values[1] * 0.7152 + values[2] * 0.0722;
  };
  for (const theme of ["dark", "light", "contrast"] as const) {
    const style = tokens(theme);
    for (const [foreground, background] of [
      ["text", "panel"],
      ["muted", "panel"],
      ["text", "selected"],
      ["accent-contrast", "accent"],
    ]) {
      const a = luminance(style.color(foreground)),
        b = luminance(style.color(background));
      expect(
        (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05),
      ).toBeGreaterThanOrEqual(4.5);
    }
  }
});

function choiceFor(label: string) {
  const box = descendants(current!.setup.renderer.root).find(
    (node) =>
      node instanceof BoxRenderable &&
      node
        .getChildren()
        .some(
          (child) =>
            child instanceof TextRenderable && child.plainText === label,
        ),
  );
  const select = box
    ?.getChildren()
    .find((child) => child instanceof SelectRenderable);
  if (!(select instanceof SelectRenderable))
    throw new Error(`Picker missing: ${label}`);
  select.focus();
  return select;
}
async function choose(label: string, value: unknown) {
  const setup = current!.setup;
  let select = choiceFor(label);
  const destination = select.options.findIndex(
    (option) => option.value === value,
  );
  if (destination < 0)
    throw new Error(`Picker ${label} has no requested option`);
  for (
    let step = 0;
    select.getSelectedIndex() !== destination && step < 20;
    step++
  ) {
    setup.mockInput.pressArrow(
      select.getSelectedIndex() < destination ? "down" : "up",
    );
    await setup.renderOnce();
    select = choiceFor(label);
  }
  expect(select.getSelectedIndex()).toBe(destination);
}
async function fill(label: string, text: string) {
  const setup = current!.setup;
  inputFor(label);
  setup.mockInput.pressKey("a", { ctrl: true });
  await setup.renderOnce();
  await setup.mockInput.pasteBracketedText(text);
  await setup.renderOnce();
}

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
test.each(methods)(
  "guided creation and editing of %s require no configuration JSON",
  async (method) => {
    const { app, setup, file } = await start();
    app.section = "tests";
    app.render();
    setup.mockInput.pressKey("F3");
    await setup.renderOnce();
    await fill("Name", `Guided ${method}`);
    await choose("Registered method", method);
    await fill("Instructions", "Follow the reviewed laboratory protocol.");
    if (method === "hedonic-9-v1")
      await fill("Questions · one per line", "Overall liking\nAroma liking");
    if (["cata-v1", "rata-v1", "jar-v1", "tcata-v1"].includes(method))
      await fill("Attributes · one per line", "Sweet\nSour");
    if (method !== "hedonic-9-v1") {
      for (const sample of app.snapshot!.document.samples) {
        button(`  ${sample.code} — ${sample.label}`);
        await setup.renderOnce();
      }
    }
    if (method === "rata-v1") {
      await fill("Scale labels · one per line", "Low\nMedium\nHigh");
      await choose("Scale origin", 0);
      await choose("Require ratings", false);
    }
    if (method === "jar-v1")
      await fill(
        "Scale labels · one per line",
        "Too little\nJust about right\nToo much",
      );
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
      await fill("Descriptor instructions", "Describe the differences.");
      await fill("Ranking instructions", "Rank by increasing intensity.");
      await fill("Minimum descriptors", "2");
      await fill("Maximum descriptors", "12");
      await choose("Allow tied ranks", false);
    }
    if (method === "napping-v1") await choose("Collect descriptions", true);
    if (method === "tcata-v1") {
      await fill("Start instruction", "Begin after the staff instruction.");
      await fill("Duration (ms)", "30000");
      await fill("Timing tolerance (ms)", "50");
    }
    expect(setup.captureCharFrame()).not.toContain("configuration (JSON)");
    expect(setup.captureCharFrame()).not.toContain(
      app.snapshot!.document.samples[0].id,
    );
    button("Add configured test");
    await settle(() => !app.busy && !app.dirty);
    const created = app.snapshot!.document.tests.at(-1);
    expect(created.name).toBe(`Guided ${method}`);
    expect(created.test_type_id).toBe(method);
    if (method === "rata-v1") {
      expect(created.configuration.rating_min).toBe(0);
      expect(app.snapshot!.view.preview).toContain("0. Low");
      expect(created.configuration.require_ratings).toBe(false);
    }
    if (method === "jar-v1")
      expect(created.configuration.scale_labels).toHaveLength(3);
    if (method === "tcata-v1")
      expect(created.configuration.duration_ms).toBe(30000);
    if (method === "napping-v1") {
      expect(created.configuration.canvas_width).toBe(60);
      expect(created.configuration.collect_descriptions).toBe(true);
    }
    const questionIds = (
      created.configuration.questions ??
      created.configuration.attributes ??
      []
    ).map((item: any) => item.id);
    await setup.renderOnce();
    await fill("Instructions", "Edited reviewed instructions.");
    await app.apply();
    expect(app.error).toBe(false);
    const edited = JSON.parse(readFileSync(file, "utf8")).tests.at(-1);
    expect(edited.id).toBe(created.id);
    expect(edited.configuration.instructions).toBe(
      "Edited reviewed instructions.",
    );
    expect(
      (
        edited.configuration.questions ??
        edited.configuration.attributes ??
        []
      ).map((item: any) => item.id),
    ).toEqual(questionIds);
    if (method === "two-afc-v1") {
      await choose("Comparison task", "preference");
      expect(() => choiceFor("Expected higher product")).toThrow();
      await app.apply();
      expect(app.error).toBe(false);
      expect(
        app.snapshot!.document.tests.at(-1).configuration.expected_sample_id,
      ).toBeNull();
    }
  },
);

test("changing the method keeps unfinished method drafts", async () => {
  const { app, setup } = await start();
  app.section = "tests";
  app.render();
  setup.mockInput.pressKey("F3");
  await setup.renderOnce();
  await fill("Name", "Kept name");
  await choose("Registered method", "cata-v1");
  await fill("Attributes · one per line", "Sweet\nSour");
  await choose("Registered method", "rata-v1");
  await fill("Attributes · one per line", "Firm\nSoft");
  await choose("Registered method", "cata-v1");
  expect(inputFor("Attributes · one per line").plainText).toBe("Sweet\nSour");
  expect(inputFor("Name").plainText).toBe("Kept name");
  expect(app.dirty).toBe(true);
});
