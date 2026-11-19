import {
  BoxRenderable,
  InputRenderable,
  SelectRenderable,
  SelectRenderableEvents,
  ScrollBoxRenderable,
  TextareaRenderable,
  TextRenderable,
  type CliRenderer,
  type KeyEvent,
  type Renderable,
} from "@opentui/core";
import { resolve } from "node:path";
import type { Backend } from "./bridge";
import {
  kindNames,
  outline,
  parseField,
  type Field,
  type Option,
  type Selection,
  type Snapshot,
  type MethodForm,
} from "./model";
import { methodFields } from "./method-form";
import { tokens, type Theme } from "./tokens";

type Panel =
  | "fields"
  | "preview"
  | "advanced"
  | "routing"
  | "details"
  | "add"
  | "check"
  | "files"
  | "server"
  | "help"
  | "confirm";
type Focus = {
  node: Renderable;
  activate?: () => void;
  scroll?: ScrollBoxRenderable;
};

export class Workbench {
  snapshot?: Snapshot;
  panel: Panel = "files";
  section = "flow";
  theme: Theme = "dark";
  busy = false;
  dirty = false;
  status = "Open a local study or create one. No server connection is needed.";
  error = false;
  private root?: BoxRenderable;
  private footer?: TextRenderable;
  private focus: Focus[] = [];
  private focusIndex = 0;
  private editNext = false;
  private draft = new Map<string, any>();
  private readers = new Map<string, () => any>();
  private transient = new Map<string, any>();
  private methodDrafts = new Map<string, Map<string, any>>();
  private report: any[] = [];
  private reportNote = "";
  private catalog: {
    kinds: Option[];
    methods: Option[];
    methodForms: Record<string, MethodForm>;
  } = {
    kinds: [],
    methods: [],
    methodForms: {},
  };
  private confirmation?: {
    message: string;
    apply: () => Promise<void> | void;
    returnTo: Panel;
  };
  private serial = 0;
  private navigation = 0;
  private closed = false;
  private get style() {
    return tokens(this.theme);
  }

  constructor(
    readonly renderer: CliRenderer,
    readonly backend: Backend,
  ) {
    renderer.keyInput.on("keypress", this.key);
    renderer.on("resize", () => this.render());
  }

  async start(filename?: string) {
    this.catalog = await this.backend.call({ action: "catalog" });
    if (filename) await this.open(filename);
    else this.render();
  }

  private message(text: string, error = false) {
    this.status = text;
    this.error = error;
    if (this.footer) {
      this.footer.content = `${this.busy ? "Working… " : ""}${this.dirty ? "Unapplied fields · " : ""}${text}`;
      this.footer.height = Math.min(
        this.style.size("status"),
        Math.max(
          this.style.size("row"),
          `${this.dirty ? "Unapplied fields · " : ""}${text}`
            .split("\n")
            .reduce(
              (rows, line) =>
                rows +
                Math.max(1, Math.ceil(line.length / this.renderer.width)),
              0,
            ),
        ),
      );
      this.footer.fg = this.style.color(error ? "danger" : "muted");
    }
  }

  private staged(path: string, value: any) {
    return this.draft.has(path) ? this.draft.get(path) : value;
  }
  private change(path: string, value: any) {
    this.draft.set(path, value);
    this.dirty = true;
    this.message(
      "F2 applies fields to the local file. Esc discards unapplied fields.",
    );
  }
  private guard() {
    if (!this.dirty) return true;
    this.message(
      this.panel === "add"
        ? "Complete Add or discard this new item with Esc before changing selection."
        : "Apply fields with F2 or discard them with Esc before changing selection.",
      true,
    );
    return false;
  }

  async open(filename: string) {
    if (!this.guard()) return;
    await this.perform(async () => {
      this.adopt(
        await this.backend.call({ action: "read", file: resolve(filename) }),
      );
      const first = this.snapshot!.document.form.nodes[0];
      if (first)
        this.adopt(
          await this.backend.call({
            action: "read",
            file: this.snapshot!.file,
            selection: { section: "flow", id: first.id },
          }),
        );
      this.panel = "fields";
      this.section = "flow";
      this.message("Opened local file. Changes are saved only when applied.");
    });
  }
  private adopt(snapshot: Snapshot) {
    this.snapshot = snapshot;
    this.draft.clear();
    this.readers.clear();
    this.dirty = false;
    this.methodDrafts.clear();
    this.navigation++;
  }
  private async perform(action: () => Promise<void>) {
    if (this.busy || this.closed) return;
    this.busy = true;
    this.message(this.status);
    try {
      await action();
    } catch (error) {
      this.message(
        error instanceof Error ? error.message : String(error),
        true,
      );
    } finally {
      this.busy = false;
      if (!this.closed) this.render();
    }
  }

  async select(selection: Selection) {
    if (!this.guard() || !this.snapshot || this.busy) return;
    const navigation = ++this.navigation;
    try {
      const next = await this.backend.call<Snapshot>({
        action: "read",
        file: this.snapshot.file,
        selection,
      });
      if (navigation !== this.navigation || this.closed) return;
      if (next.hash !== this.snapshot.hash) {
        this.message(
          "File changed outside this TUI. Use Files → Open to review the new file.",
          true,
        );
        return;
      }
      this.adopt(next);
      this.panel = "fields";
      this.error = false;
      this.editNext = true;
      this.render();
    } catch (error) {
      this.message(String(error), true);
    }
  }
  private request(action: string, extra: Record<string, unknown> = {}) {
    if (!this.snapshot) throw new Error("Open or create a study first.");
    return {
      action,
      file: this.snapshot.file,
      hash: this.snapshot.hash,
      selection: this.snapshot.selection,
      ...extra,
    };
  }
  async mutate(action: string, extra: Record<string, unknown> = {}) {
    if (!(action === "add" && this.panel === "add") && !this.guard()) return;
    await this.perform(async () => {
      this.adopt(
        await this.backend.call<Snapshot>(this.request(action, extra)),
      );
      this.panel = "fields";
      this.message("Saved to the local file. Server draft unchanged.");
    });
  }
  async apply() {
    if (
      !this.snapshot ||
      !["fields", "advanced", "routing"].includes(this.panel)
    )
      return;
    await this.perform(async () => {
      const changes = Object.fromEntries(
        [...this.readers].map(([path, read]) => [path, read()]),
      );
      const isJson = this.panel === "advanced" || this.panel === "routing";
      const request = isJson
        ? this.request(this.panel === "advanced" ? "advanced" : "apply", {
            raw: this.transient.get("json"),
          })
        : this.request("apply", { changes });
      this.adopt(await this.backend.call<Snapshot>(request));
      this.message("Applied to the local file. Server draft unchanged.");
    });
  }
  async check() {
    if (!this.guard() || !this.snapshot) return;
    await this.perform(async () => {
      const result = await this.backend.call<{ issues: any[] }>(
        this.request("check"),
      );
      this.report = result.issues;
      this.reportNote =
        "Local checks; server validation is still required before publication.";
      this.panel = "check";
      this.message(
        this.report.length
          ? "Select an issue to open its block or sensory test."
          : "Local flow checks passed.",
      );
    });
  }
  private switch(panel: Panel) {
    if (!this.guard()) return;
    this.panel = panel;
    this.transient.clear();
    this.methodDrafts.clear();
    this.error = false;
    this.render();
  }
  private confirm(message: string, apply: () => Promise<void> | void) {
    this.confirmation = { message, apply, returnTo: this.panel };
    this.panel = "confirm";
    this.render();
  }
  private quit() {
    if (this.busy) {
      this.message(
        "An operation is in progress. Wait for its result before quitting.",
        true,
      );
      return;
    }
    if (this.dirty)
      this.confirm(
        "Unapplied fields will be discarded. Your saved local file stays intact.",
        () => this.close(),
      );
    else this.close();
  }
  close() {
    if (this.closed) return;
    this.closed = true;
    this.renderer.keyInput.off("keypress", this.key);
    this.backend.close();
    this.renderer.destroy();
  }
  private key = (key: KeyEvent) => {
    const actions: Record<string, () => void> = {
      f1: () => this.switch("help"),
      f2: () => {
        void this.apply();
      },
      f3: () => this.switch("add"),
      f4: () => this.switch("preview"),
      f5: () => {
        void this.check();
      },
      f6: () => this.switch("server"),
      f7: () => this.switch("files"),
      f8: () => {
        this.theme =
          this.theme === "dark"
            ? "light"
            : this.theme === "light"
              ? "contrast"
              : "dark";
        this.render();
      },
      f10: () => this.quit(),
    };
    if (actions[key.name]) {
      key.preventDefault();
      actions[key.name]();
      return;
    }
    if (key.ctrl && key.name === "c") {
      key.preventDefault();
      this.quit();
      return;
    }
    if (key.ctrl && key.name === "s") {
      key.preventDefault();
      void this.apply();
      return;
    }
    if (
      key.ctrl &&
      key.name === "z" &&
      !this.focus[this.focusIndex]?.node.id.startsWith("input-")
    ) {
      key.preventDefault();
      void this.mutate("undo");
      return;
    }
    if (key.name === "escape") {
      key.preventDefault();
      if (this.panel === "confirm")
        this.panel = this.confirmation?.returnTo ?? "fields";
      else {
        this.draft.clear();
        this.dirty = false;
        this.transient.clear();
        this.methodDrafts.clear();
        this.panel = this.snapshot ? "fields" : "files";
        this.message("Unapplied fields discarded. Saved file unchanged.");
      }
      this.render();
      return;
    }
    if (key.name === "tab") {
      key.preventDefault();
      this.focusIndex =
        (this.focusIndex + (key.shift ? -1 : 1) + this.focus.length) %
        this.focus.length;
      const item = this.focus[this.focusIndex];
      item?.node.focus();
      item?.scroll?.scrollChildIntoView(item.node);
    } else if (
      ["return", "enter", "space"].includes(key.name) &&
      this.focus[this.focusIndex]?.activate &&
      this.focus[this.focusIndex].node.focused
    ) {
      key.preventDefault();
      this.focus[this.focusIndex].activate?.();
    }
  };

  private label(parent: BoxRenderable, content: string, muted = false) {
    const node = new TextRenderable(this.renderer, {
      content,
      fg: this.style.color(muted ? "muted" : "text"),
      flexShrink: 0,
    });
    parent.add(node);
    return node;
  }
  private button(
    parent: BoxRenderable,
    label: string,
    action: () => void,
    disabled = false,
  ) {
    let ancestor: any = parent;
    while (ancestor && !(ancestor instanceof ScrollBoxRenderable))
      ancestor = ancestor.parent;
    const scroll = ancestor as ScrollBoxRenderable | undefined;
    const node = new BoxRenderable(this.renderer, {
      id: `button-${++this.serial}`,
      height: this.style.size("row"),
      flexShrink: 0,
      backgroundColor: this.style.color("panel"),
      onMouseDown: () => {
        if (!disabled && !this.busy) action();
      },
    });
    this.label(node, `[${label}]`, disabled);
    node.focusable = !disabled;
    node.on("focused", () => {
      node.backgroundColor = this.style.color("selected");
      this.focusIndex = this.focus.findIndex((item) => item.node === node);
      scroll?.scrollChildIntoView(node);
    });
    node.on("blurred", () => {
      node.backgroundColor = this.style.color("panel");
    });
    parent.add(node);
    if (!disabled)
      this.focus.push({
        node,
        scroll,
        activate: () => {
          if (!this.busy) action();
        },
      });
    return node;
  }
  private row(parent: BoxRenderable) {
    const row = new BoxRenderable(this.renderer, {
      flexDirection: "row",
      gap: this.style.size("gap"),
      flexShrink: 0,
    });
    parent.add(row);
    return row;
  }
  private input(
    parent: BoxRenderable,
    label: string,
    value: string,
    changed: (value: string) => void,
    multiline = false,
    scroll?: ScrollBoxRenderable,
  ) {
    const box = new BoxRenderable(this.renderer, {
      flexDirection: multiline ? "column" : "row",
      flexShrink: 0,
      marginBottom: multiline ? this.style.size("gap") : 0,
    });
    const caption = this.label(box, label, true);
    if (!multiline) {
      caption.width = Math.min(
        this.style.size("label"),
        Math.floor(this.renderer.width / 5),
      );
      caption.height = this.style.size("row");
      caption.wrapMode = "none";
      caption.truncate = true;
      box.gap = this.style.size("gap");
    }
    let input: TextareaRenderable;
    const options = {
      id: `input-${++this.serial}`,
      height: this.style.size(multiline ? "multiline" : "input"),
      flexGrow: 1,
      initialValue: value,
      backgroundColor: this.style.color("bg"),
      textColor: this.style.color("text"),
      focusedBackgroundColor: this.style.color("selected"),
      focusedTextColor: this.style.color("text"),
      selectionBg: this.style.color("selected"),
      selectionFg: this.style.color("text"),
      cursorColor: this.style.color("accent"),
      keyBindings: [{ name: "a", ctrl: true, action: "select-all" as const }],
      onContentChange: () => {
        if (input && input.plainText !== value) changed(input.plainText);
      },
    };
    input = multiline
      ? new TextareaRenderable(this.renderer, { ...options, wrapMode: "word" })
      : new InputRenderable(this.renderer, { ...options, value });
    if (!multiline) input.cursorOffset = 0;
    input.on("focused", () => {
      this.focusIndex = this.focus.findIndex((item) => item.node === input);
      scroll?.scrollChildIntoView(box);
    });
    box.add(input);
    parent.add(box);
    this.focus.push({ node: input, scroll });
    return input;
  }
  private choice(
    parent: BoxRenderable,
    label: string,
    options: Option[],
    value: any,
    changed: (value: any) => void,
    scroll?: ScrollBoxRenderable,
  ) {
    const row = this.row(parent);
    const caption = this.label(row, label, true);
    caption.width = Math.min(
      this.style.size("label"),
      Math.floor(this.renderer.width / 5),
    );
    caption.height = this.style.size("row");
    caption.wrapMode = "none";
    caption.truncate = true;
    const select = new SelectRenderable(this.renderer, {
      id: `select-${++this.serial}`,
      height: this.style.size("row"),
      flexGrow: 1,
      options: options.map((option) => ({
        name: option.label,
        description: "",
        value: option.value,
      })),
      selectedIndex: Math.max(
        0,
        options.findIndex((option) => option.value === value),
      ),
      showDescription: false,
      showSelectionIndicator: true,
      backgroundColor: this.style.color("bg"),
      textColor: this.style.color("text"),
      selectedBackgroundColor: this.style.color("selected"),
      selectedTextColor: this.style.color("text"),
      focusedBackgroundColor: this.style.color("selected"),
      focusedTextColor: this.style.color("text"),
    });
    select.on(SelectRenderableEvents.SELECTION_CHANGED, (_index, option) =>
      changed(option.value),
    );
    select.on("focused", () => {
      this.focusIndex = this.focus.findIndex((item) => item.node === select);
      scroll?.scrollChildIntoView(select);
    });
    row.add(select);
    this.focus.push({ node: select, scroll });
    return select;
  }

  render() {
    if (this.closed) return;
    const oldFocus = this.focus[this.focusIndex]?.node.id;
    this.root?.destroyRecursively();
    this.focus = [];
    this.readers.clear();
    this.serial = 0;
    this.root = new BoxRenderable(this.renderer, {
      width: "100%",
      height: "100%",
      flexDirection: "column",
      backgroundColor: this.style.color("bg"),
    });
    this.renderer.root.add(this.root);
    if (
      this.renderer.width < this.style.size("min-width") ||
      this.renderer.height < this.style.size("min-height")
    ) {
      this.label(
        this.root,
        "Sensibilia needs at least 80 columns × 24 rows.\nResize the terminal.",
      );
      this.button(this.root, "F10 Quit", () => this.quit());
      this.focus[0]?.node.focus();
      return;
    }
    const toolbar = this.row(this.root);
    const title = this.label(
      toolbar,
      this.renderer.width < this.style.size("compact") ? "Flow" : "Sensibilia",
    );
    title.fg = this.style.color("accent");
    this.button(
      toolbar,
      "F2 Apply",
      () => {
        void this.apply();
      },
      !this.snapshot || !["fields", "advanced", "routing"].includes(this.panel),
    );
    this.button(toolbar, "F3 Add", () => this.switch("add"), !this.snapshot);
    this.button(
      toolbar,
      "F5 Check",
      () => {
        void this.check();
      },
      !this.snapshot,
    );
    this.button(toolbar, "F6 Server", () => this.switch("server"));
    this.button(toolbar, "F7 Files", () => this.switch("files"));
    this.button(toolbar, "F10 Quit", () => this.quit());
    const workspace = new BoxRenderable(this.renderer, {
      flexDirection: "row",
      flexGrow: 1,
      minHeight: 0,
    });
    this.root.add(workspace);
    this.renderOutline(workspace);
    const right = new BoxRenderable(this.renderer, {
      titleColor: this.style.color("text"),
      title:
        this.panel === "add" && this.section === "tests"
          ? this.catalog.methods.find(
              (item) =>
                item.value === (this.transient.get("method") ?? "hedonic-9-v1"),
            )?.label
          : undefined,
      flexGrow: 1,
      minWidth: 0,
      flexDirection: "column",
      border: true,
      borderStyle: "single",
      borderColor: this.style.color("border"),
      backgroundColor: this.style.color("panel"),
      paddingX: this.style.size("padding"),
    });
    workspace.add(right);
    if (
      this.snapshot &&
      ["fields", "preview", "advanced", "routing", "details"].includes(
        this.panel,
      )
    ) {
      const tabs = this.row(right);
      for (const [name, panel] of [
        ["Edit", "fields"],
        ["Preview", "preview"],
        ["Rules", "routing"],
        ["Details", "details"],
        ["JSON", "advanced"],
      ] as const) {
        this.button(
          tabs,
          name,
          () => this.switch(panel),
          panel === this.panel ||
            (panel === "routing" && this.snapshot.selection.section !== "flow"),
        );
      }
    }
    const content = new ScrollBoxRenderable(this.renderer, {
      id: "properties",
      flexGrow: 1,
      minHeight: 0,
      scrollX: false,
      scrollY: true,
      scrollbarOptions: {
        trackOptions: {
          foregroundColor: this.style.color("border"),
          backgroundColor: this.style.color("panel"),
        },
        arrowOptions: {
          foregroundColor: this.style.color("muted"),
          backgroundColor: this.style.color("panel"),
        },
      },
      contentOptions: {
        flexDirection: "column",
        paddingY: this.style.size("padding"),
      },
    });
    right.add(content);
    if (this.error && this.status.includes("\n"))
      this.label(content, this.status).fg = this.style.color("danger");
    this.renderPanel(content);
    this.footer = new TextRenderable(this.renderer, {
      id: "status",
      height: this.style.size("status"),
      flexShrink: 0,
      content: "",
      fg: this.style.color(this.error ? "danger" : "muted"),
    });
    this.root.add(this.footer);
    this.message(this.status, this.error);
    this.label(
      this.root,
      "Tab focus · Enter edit · F4 Preview · F8 Theme · F1 Help · Esc discard",
      true,
    );
    const preferred = this.editNext
      ? this.focus.find((item) => item.node.id.startsWith("input-"))
      : this.focus.find((item) => item.node.id === oldFocus);
    this.editNext = false;
    (
      preferred ??
      this.focus.find((item) => item.node.id === "outline") ??
      this.focus[0]
    )?.node.focus();
    this.renderer.requestRender();
  }

  private renderOutline(parent: BoxRenderable) {
    const width = Math.min(
      this.style.size("outline"),
      Math.max(
        this.style.size("outline-min"),
        Math.floor(this.renderer.width / 3),
      ),
    );
    const left = new BoxRenderable(this.renderer, {
      width,
      minWidth: width,
      flexDirection: "column",
      border: true,
      borderStyle: "single",
      borderColor: this.style.color("border"),
      paddingX: this.style.size("padding"),
    });
    parent.add(left);
    if (!this.snapshot) {
      this.label(left, "No study open", true);
      return;
    }
    this.label(left, this.snapshot.document.title);
    const source = this.snapshot.document.source;
    this.label(
      left,
      source
        ? source.published_at
          ? "Published copy"
          : "Server draft · local copy"
        : "Local study",
      true,
    );
    const tabs = this.row(left);
    for (const [label, section] of [
      ["Flow", "flow"],
      ["Tests", "tests"],
      ["Samples", "samples"],
    ]) {
      this.button(
        tabs,
        label,
        () => {
          if (this.guard()) {
            this.section = section;
            this.render();
          }
        },
        section === this.section,
      );
    }
    this.button(left, "Study settings", () => {
      void this.select({ section: "study" });
    });
    let options: { name: string; description: string; value: Selection }[];
    const titleWidth = Math.max(
      this.style.size("outline-title-min"),
      width - this.style.size("outline-reserve"),
    );
    const typeWidth = Math.max(
      this.style.size("outline-kind-min"),
      width - titleWidth - this.style.size("outline-kind-reserve"),
    );
    const fit = (text: string, length: number) =>
      text.length > length
        ? text.slice(0, length - 1) + "…"
        : text.padEnd(length);
    if (this.section === "flow")
      options = outline(this.snapshot.document).map((row) => ({
        name: `${row.number.padEnd(4)} ${fit(row.title, titleWidth)} ${fit(kindNames[row.kind], typeWidth)}`,
        description: kindNames[row.kind],
        value: { section: "flow", id: row.id },
      }));
    else if (this.section === "tests")
      options = this.snapshot.document.tests.map((test: any) => ({
        name: test.name,
        description:
          this.catalog.methods.find((item) => item.value === test.test_type_id)
            ?.label ?? "Sensory test",
        value: { section: "tests", id: test.id },
      }));
    else
      options = this.snapshot.document.samples.map((sample: any) => ({
        name: `${sample.code}  ${sample.label}`,
        description:
          sample.ingredient_tags === null
            ? "Ingredients unreviewed"
            : "Ingredients reviewed",
        value: { section: "samples", id: sample.id },
      }));
    this.label(
      left,
      this.section === "flow" ? "Order · Title / Type" : "Name / Status",
      true,
    );
    const list = new SelectRenderable(this.renderer, {
      id: "outline",
      flexGrow: 1,
      minHeight: 0,
      options,
      selectedIndex: Math.max(
        0,
        options.findIndex(
          (option) => option.value.id === this.snapshot?.selection.id,
        ),
      ),
      showDescription: false,
      showScrollIndicator: true,
      backgroundColor: this.style.color("bg"),
      focusedBackgroundColor: this.style.color("bg"),
      focusedTextColor: this.style.color("text"),
      textColor: this.style.color("text"),
      descriptionColor: this.style.color("muted"),
      selectedDescriptionColor: this.style.color("muted"),
      selectedBackgroundColor: this.style.color("selected"),
      selectedTextColor: this.style.color("text"),
    });
    list.on(SelectRenderableEvents.ITEM_SELECTED, (_index, option) => {
      void this.select(option.value);
    });
    list.on("focused", () => {
      this.focusIndex = this.focus.findIndex((item) => item.node === list);
    });
    left.add(list);
    this.focus.push({ node: list });
    if (!options.length) this.label(left, "F3 adds the first item.", true);
    if (this.section === "flow" && this.snapshot.selection.section === "flow") {
      const moves = this.row(left);
      for (const direction of ["up", "down", "indent", "outdent"]) {
        this.button(
          moves,
          direction === "indent"
            ? ">"
            : direction === "outdent"
              ? "<"
              : direction,
          () => {
            void this.mutate("move", { direction });
          },
        );
      }
    }
    this.button(
      left,
      "Undo local edit",
      () => {
        void this.mutate("undo");
      },
      !this.snapshot.canUndo,
    );
  }

  private renderPanel(parent: ScrollBoxRenderable) {
    if (this.panel === "files") return this.filesPanel(parent);
    if (this.panel === "server") return this.serverPanel(parent);
    if (this.panel === "add") return this.addPanel(parent);
    if (this.panel === "confirm") {
      this.label(parent, this.confirmation?.message ?? "Confirm action");
      this.button(parent, "Confirm", () => {
        const action = this.confirmation?.apply;
        this.panel = this.confirmation?.returnTo ?? "fields";
        void action?.();
      });
      this.button(parent, "Cancel", () => {
        this.panel = this.confirmation?.returnTo ?? "fields";
        this.render();
      });
      return;
    }
    if (this.panel === "help") {
      this.label(
        parent,
        "Session flow workbench\n\nEnter opens the selected row for editing. Tab moves between controls.\nF2 / Ctrl+S applies fields atomically to the local file.\nF3 adds a block, test or sample in the active section.\nF4 shows wording; it does not execute assessor routing.\nF5 checks the complete saved local flow.\nF6 opens server actions; writes are always explicit.\nF7 opens or creates files. F8 cycles the three themes.\nEsc discards unapplied fields. F10 / Ctrl+C quits.\n\nMove buttons reorder siblings; > nests under the preceding group,\n< moves out of a group. Block identities are preserved.\n\nJSON exposes existing contract fields. Details contains identifiers.\nServer authentication uses SENSIBILIA_RESEARCHER_TOKEN.\nExisting server sample edits remain a researcher UI task.",
      );
      return;
    }
    if (this.panel === "check") {
      this.label(
        parent,
        `${this.report.filter((item) => item.severity === "error").length} errors · ${this.report.filter((item) => item.severity === "warning").length} warnings`,
      );
      this.label(parent, this.reportNote, true);
      if (!this.report.length) this.label(parent, "No issues found.");
      const list = new SelectRenderable(this.renderer, {
        id: "issues",
        minHeight: this.style.size("input"),
        flexGrow: 1,
        options: this.report.map((issue) => ({
          name: `${issue.severity}: ${issue.message}`,
          description:
            outline(this.snapshot!.document).find(
              (row) => row.id === issue.node_id,
            )?.title ??
            this.snapshot!.document.tests.find(
              (test: any) => test.id === issue.study_test_id,
            )?.name ??
            "Study",
          value: issue,
        })),
        backgroundColor: this.style.color("panel"),
        focusedBackgroundColor: this.style.color("panel"),
        focusedTextColor: this.style.color("text"),
        textColor: this.style.color("text"),
        descriptionColor: this.style.color("muted"),
        selectedBackgroundColor: this.style.color("selected"),
        selectedTextColor: this.style.color("text"),
        selectedDescriptionColor: this.style.color("muted"),
      });
      list.on(SelectRenderableEvents.ITEM_SELECTED, (_index, option) => {
        if (option.value.node_id)
          void this.select({ section: "flow", id: option.value.node_id });
        else if (option.value.study_test_id)
          void this.select({
            section: "tests",
            id: option.value.study_test_id,
          });
      });
      parent.add(list);
      this.focus.push({ node: list, scroll: parent });
      return;
    }
    if (!this.snapshot) {
      this.label(parent, "Open a study through Files.");
      return;
    }
    const view = this.snapshot.view;
    this.label(parent, view.title);
    if (this.panel === "preview") {
      this.label(parent, "Saved wording · not assessor execution", true);
      const paper = new BoxRenderable(this.renderer, {
        backgroundColor: tokens("light").color("panel"),
        padding: this.style.size("padding"),
        flexShrink: 0,
      });
      this.label(paper, view.preview).fg = tokens("light").color("text");
      parent.add(paper);
      return;
    }
    if (this.panel === "details") {
      this.label(parent, JSON.stringify(view.details, null, 2));
      return;
    }
    if (this.panel === "advanced" || this.panel === "routing") {
      const value =
        this.panel === "routing"
          ? {
              "/guard": view.advanced.guard,
              "/otherwise": view.advanced.otherwise,
            }
          : view.advanced;
      if (this.panel === "routing")
        this.label(
          parent,
          "True enters this block; false takes Otherwise.\nUse existing Flow v2 conditions and forward destinations.",
          true,
        );
      const text = this.transient.get("json") ?? JSON.stringify(value, null, 2);
      this.transient.set("json", text);
      this.input(
        parent,
        this.panel === "routing"
          ? "Entry condition and Otherwise (JSON)"
          : "Existing contract fields (JSON)",
        text,
        (next) => {
          this.transient.set("json", next);
          this.dirty = true;
          this.message("F2 applies this JSON; Esc keeps the saved file.");
        },
        true,
        parent,
      ).height = Math.max(
        this.style.size("multiline"),
        this.renderer.height - this.style.size("status") * 5,
      );
      return;
    }
    for (const note of view.notes ?? []) this.label(parent, note, true);
    const fields = methodFields(
      view.fields,
      (field) => this.staged(field.path, field.value),
      this.snapshot.document.samples,
    );
    for (const field of fields) this.renderField(parent, field);
    for (const array of view.arrays) {
      const buttons = this.row(parent);
      this.button(buttons, `Add ${array.label.toLowerCase()}`, () => {
        void this.mutate("array-add", { pointer: array.path });
      });
      this.button(
        buttons,
        `Remove last ${array.label.toLowerCase()}`,
        () => {
          void this.mutate("array-remove", {
            pointer: array.path,
            index: array.count - 1,
          });
        },
        !array.count,
      );
    }
    if (this.snapshot.selection.section !== "study")
      this.button(parent, "Remove from local draft", () => {
        if (this.guard())
          this.confirm(
            "Remove this local item? Server changes require a later explicit save. Collected data is untouched.",
            () => this.mutate("remove"),
          );
      });
  }
  private renderField(parent: ScrollBoxRenderable, field: Field) {
    const current = this.staged(field.path, field.value);
    if (field.type === "choice") {
      this.choice(
        parent,
        field.label,
        field.options,
        current,
        (value) => {
          this.change(field.path, value);
          if (field.reactive) this.render();
        },
        parent,
      );
      this.readers.set(field.path, () => this.staged(field.path, field.value));
    } else if (field.type === "multi") {
      this.label(parent, field.label, true);
      for (const option of field.options)
        this.button(
          parent,
          `${(current ?? []).includes(option.value) ? "x" : " "} ${option.label}`,
          () => {
            const values = [...(this.staged(field.path, field.value) ?? [])];
            this.change(
              field.path,
              values.includes(option.value)
                ? values.filter((item) => item !== option.value)
                : [...values, option.value],
            );
            this.render();
          },
        );
      if (!field.options.length)
        this.label(parent, "Add sample definitions in Samples first.", true);
      this.readers.set(field.path, () => this.staged(field.path, field.value));
    } else {
      const initial = this.draft.has(field.path)
        ? current
        : field.type === "lines"
          ? (field.value ?? []).join("\n")
          : field.type === "json"
            ? JSON.stringify(field.value, null, 2)
            : String(field.value ?? "");
      const input = this.input(
        parent,
        field.label + (field.type === "number" ? " · blank = unset" : ""),
        initial,
        (value) => this.change(field.path, value),
        ["multiline", "json", "lines"].includes(field.type),
        parent,
      );
      if (field.type === "lines") input.height = this.lineEditorHeight(initial);
      this.readers.set(field.path, () => parseField(field, input.plainText));
    }
  }
  private lineEditorHeight(value: string) {
    return Math.max(
      this.style.size("multiline"),
      Math.min(this.style.size("scale-lines"), value.split("\n").length),
    );
  }
  private temporaryInput(
    parent: ScrollBoxRenderable,
    key: string,
    label: string,
    fallback = "",
    multiline = false,
  ) {
    const value = this.transient.get(key) ?? fallback;
    this.transient.set(key, value);
    return this.input(
      parent,
      label,
      value,
      (value) => {
        this.transient.set(key, value);
        if (this.panel === "add") {
          this.dirty = true;
          this.message("Complete Add or press Esc to discard this new item.");
        }
      },
      multiline,
      parent,
    );
  }
  private filesPanel(parent: ScrollBoxRenderable) {
    this.label(parent, "Local files");
    this.temporaryInput(
      parent,
      "path",
      "File path",
      this.snapshot?.file ?? "study.json",
    );
    this.temporaryInput(parent, "title", "New study title", "Untitled study");
    this.temporaryInput(parent, "language", "Language", "en");
    const row = this.row(parent);
    this.button(row, "Open", () => {
      void this.open(this.transient.get("path"));
    });
    this.button(row, "Create new file", () => {
      if (!this.guard()) return;
      void this.perform(async () => {
        this.adopt(
          await this.backend.call({
            action: "new",
            file: resolve(this.transient.get("path")),
            title: this.transient.get("title"),
            language: this.transient.get("language"),
          }),
        );
        this.panel = "fields";
        this.message("Created a local study. F3 adds its first block.");
      });
    });
    this.label(
      parent,
      "New files refuse overwrites. Edits stay local until an explicit server save.",
      true,
    );
    if (this.snapshot) {
      this.temporaryInput(parent, "output", "Output path", "study-copy.json");
      const exports = this.row(parent);
      for (const [label, operation] of [
        ["Export raw flow", "export"],
        ["Copy independent study", "copy"],
      ]) {
        this.button(exports, label, () => {
          if (this.guard())
            void this.perform(async () => {
              const result: any = await this.backend.call(
                this.request("file-export", {
                  operation,
                  output: resolve(this.transient.get("output")),
                }),
              );
              if (result.document) {
                this.adopt(result);
                this.panel = "fields";
              }
              this.message(result.message ?? "Copied to a new local study.");
            });
        });
      }
    }
  }
  private addPanel(parent: ScrollBoxRenderable) {
    if (!this.snapshot) {
      this.label(parent, "Open a study first.");
      return;
    }
    this.label(
      parent,
      `Add ${this.section === "flow" ? "flow block" : this.section === "tests" ? "sensory test" : "sample"}`,
    );
    if (this.section === "flow") {
      const kind = this.transient.get("kind") ?? "question";
      this.transient.set("kind", kind);
      this.choice(
        parent,
        "Block type",
        this.catalog.kinds,
        kind,
        (value) => {
          this.transient.set("kind", value);
          this.render();
        },
        parent,
      );
      this.temporaryInput(
        parent,
        "title",
        "Title",
        this.catalog.kinds.find((item) => item.value === kind)?.label,
      );
      const groups = outline(this.snapshot.document).filter((item) =>
        ["group", "loop_samples"].includes(item.kind),
      );
      const selected = outline(this.snapshot.document).find(
        (item) => item.id === this.snapshot?.selection.id,
      );
      const defaultParent = selected
        ? ["group", "loop_samples"].includes(selected.kind)
          ? selected.id
          : (selected.parent ?? null)
        : null;
      const parentId = this.transient.has("parent")
        ? this.transient.get("parent")
        : defaultParent;
      this.transient.set("parent", parentId);
      this.choice(
        parent,
        "Place in",
        [
          { value: null, label: "Top level" },
          ...groups.map((item) => ({ value: item.id, label: item.title })),
        ],
        parentId,
        (value) => this.transient.set("parent", value),
        parent,
      );
      if (kind === "embedded_method") {
        const options = this.snapshot.document.tests.map((test: any) => ({
          value: test.id,
          label: test.name,
        }));
        this.transient.set(
          "test",
          this.transient.get("test") ?? options[0]?.value,
        );
        this.choice(
          parent,
          "Sensory test",
          options,
          this.transient.get("test"),
          (value) => this.transient.set("test", value),
          parent,
        );
      }
      this.button(parent, "Add block", () => {
        void this.mutate("add", {
          section: "flow",
          kind: this.transient.get("kind"),
          title: this.transient.get("title"),
          parent: this.transient.get("parent"),
          test: this.transient.get("test"),
          after:
            this.snapshot?.selection.section === "flow"
              ? this.snapshot.selection.id
              : undefined,
        });
      });
    } else if (this.section === "samples") {
      this.temporaryInput(parent, "code", "Blind code");
      this.temporaryInput(parent, "label", "Private product label");
      this.temporaryInput(
        parent,
        "tags",
        "Ingredient tags: null = unreviewed; [] = reviewed none",
        "null",
      );
      this.button(parent, "Add local sample", () => {
        void this.perform(async () => {
          this.adopt(
            await this.backend.call<Snapshot>(
              this.request("add", {
                section: "samples",
                code: this.transient.get("code"),
                label: this.transient.get("label"),
                tags: JSON.parse(this.transient.get("tags")),
              }),
            ),
          );
          this.panel = "fields";
          this.message(
            "Added a local sample. Prepare it before its first server save.",
          );
        });
      });
    } else this.addMethodPanel(parent);
  }

  private addMethodPanel(parent: ScrollBoxRenderable) {
    this.temporaryInput(parent, "name", "Name");
    const method = this.transient.get("method") ?? "hedonic-9-v1";
    this.transient.set("method", method);
    this.choice(
      parent,
      "Registered method",
      this.catalog.methods,
      method,
      (value) => {
        this.transient.set("method", value);
        this.render();
      },
      parent,
    );
    const form = this.catalog.methodForms[method];
    if (!form) {
      this.label(parent, "This method's editor is unavailable.");
      return;
    }
    const values = this.methodDrafts.get(method) ?? new Map<string, any>();
    this.methodDrafts.set(method, values);
    const current = (field: Field) =>
      values.has(field.path) ? values.get(field.path) : field.value;
    const update = (field: Field, value: any, refresh = false) => {
      values.set(field.path, value);
      this.dirty = true;
      this.message(
        "Complete Add or press Esc to discard this test. Method drafts are kept while switching methods.",
      );
      if (refresh) this.render();
    };
    for (const note of form.notes) this.label(parent, note, true);
    const fields = methodFields(
      form.fields,
      current,
      this.snapshot!.document.samples,
    );
    for (const field of fields) {
      const value = current(field);
      if (field.type === "choice") {
        this.choice(
          parent,
          field.label,
          field.options,
          value,
          (next) => update(field, next, field.reactive),
          parent,
        );
      } else if (field.type === "multi") {
        this.label(parent, field.label, true);
        for (const option of field.options)
          this.button(
            parent,
            `${(value ?? []).includes(option.value) ? "x" : " "} ${option.label}`,
            () => {
              const selected = current(field) ?? [];
              update(
                field,
                selected.includes(option.value)
                  ? selected.filter((id: string) => id !== option.value)
                  : [...selected, option.value],
                true,
              );
            },
          );
        if (!field.options.length)
          this.label(
            parent,
            "Add sample definitions in Samples before configuring a sample set.",
            true,
          );
      } else {
        const initial =
          typeof value === "string"
            ? value
            : field.type === "lines"
              ? (value ?? []).join("\n")
              : field.type === "question-lines"
                ? (value ?? []).map((item: any) => item.prompt).join("\n")
                : String(value ?? "");
        const input = this.input(
          parent,
          field.label,
          initial,
          (next) => update(field, next),
          ["multiline", "lines", "question-lines"].includes(field.type),
          parent,
        );
        if (field.type === "lines")
          input.height = this.lineEditorHeight(initial);
      }
    }
    this.button(parent, "Add configured test", () => {
      void this.perform(async () => {
        const guided = Object.fromEntries(
          form.fields.map((field) => {
            const value = current(field);
            return [
              field.path.split("/").at(-1)!,
              typeof value === "string" &&
              ["number", "lines"].includes(field.type)
                ? parseField(field, value)
                : value,
            ];
          }),
        );
        this.adopt(
          await this.backend.call(
            this.request("add", {
              section: "tests",
              name: this.transient.get("name"),
              method,
              guided,
            }),
          ),
        );
        this.panel = "fields";
        this.message(
          "Added a local sensory test. Insert it in the flow and prepare it before saving to the server.",
        );
      });
    });
  }
  private serverPanel(parent: ScrollBoxRenderable) {
    this.label(parent, "Server drafts");
    this.temporaryInput(
      parent,
      "url",
      "Server URL",
      this.snapshot?.document.source?.url ??
        process.env.SENSIBILIA_URL ??
        "http://127.0.0.1:8000",
    );
    const allow = this.transient.get("allowHttp") ?? false;
    this.transient.set("allowHttp", allow);
    this.choice(
      parent,
      "Network HTTP",
      [
        { value: false, label: "No (HTTPS or loopback only)" },
        { value: true, label: "Yes, explicitly allow HTTP" },
      ],
      allow,
      (value) => this.transient.set("allowHttp", value),
      parent,
    );
    this.label(
      parent,
      process.env.SENSIBILIA_RESEARCHER_TOKEN
        ? "Researcher key: provided through the environment"
        : "Set SENSIBILIA_RESEARCHER_TOKEN before launch",
      true,
    );
    this.button(parent, "Browse studies", () => {
      void this.perform(async () => {
        this.transient.set(
          "studies",
          await this.backend.call({
            action: "server-studies",
            file: this.snapshot?.file ?? "study.json",
            url: this.transient.get("url"),
            allowHttp: this.transient.get("allowHttp"),
          }),
        );
      });
    });
    const studies = this.transient.get("studies") as any[] | undefined;
    if (studies) {
      const options = studies.map((study) => ({
        value: study.id,
        label: `${study.title} (${study.status})`,
      }));
      this.transient.set(
        "study",
        this.transient.get("study") ?? options[0]?.value,
      );
      this.choice(
        parent,
        "Study",
        options,
        this.transient.get("study"),
        (value) => this.transient.set("study", value),
        parent,
      );
      this.temporaryInput(
        parent,
        "destination",
        "Load into new local file",
        "loaded-study.json",
      );
      const actions = this.row(parent);
      this.button(
        actions,
        "Load draft / publication",
        () => {
          void this.serverOperation("pull");
        },
        !studies.length,
      );
      this.button(
        actions,
        "New draft",
        () => {
          this.confirm(
            "Create the next server draft from the latest publication? Earlier publications stay immutable.",
            () => this.serverOperation("draft"),
          );
        },
        !studies.length,
      );
    }
    if (!this.snapshot) return;
    const source = this.snapshot.document.source;
    if (source) {
      this.label(
        parent,
        source.published_at
          ? "Published copy: create a new draft to edit."
          : "Save sends the last loaded revision hash.",
        true,
      );
      this.button(
        parent,
        "Save local draft to server",
        () => {
          void this.serverOperation("push");
        },
        !!source.published_at,
      );
      this.button(
        parent,
        "Prepare new tests and samples",
        () => {
          this.confirm(
            "Prepare creates server samples/tests in separate transactions. Successful steps persist if a later step fails. Continue?",
            () => this.serverOperation("prepare"),
          );
        },
        !!source.published_at,
      );
      this.button(parent, "Check saved server draft", () => {
        void this.serverOperation("server-check");
      });
    } else
      this.button(parent, "Create a server study", () => {
        this.confirm(
          "Create a server draft, prepare its resources and save the flow? These are separate transactions; successful steps persist if a later step fails.",
          () => this.serverOperation("create"),
        );
      });
  }
  private async serverOperation(operation: string) {
    if (!this.guard()) return;
    await this.perform(async () => {
      const loading = ["pull", "draft"].includes(operation);
      const request = loading
        ? {
            action: "server-load",
            file: resolve(this.transient.get("destination")),
          }
        : this.request("server");
      const result: any = await this.backend.call({
        ...request,
        operation,
        url: this.transient.get("url"),
        allowHttp: this.transient.get("allowHttp"),
        study: this.transient.get("study"),
      });
      if (operation === "server-check") {
        this.report = result.report.issues;
        this.reportNote = result.stale
          ? "Server revision differs from this local copy."
          : "Saved server draft; unsaved local changes are excluded.";
        this.panel = "check";
        this.message(this.reportNote, result.stale);
      } else {
        this.adopt(result);
        this.panel = "fields";
        this.message(result.message || "Server operation completed.");
      }
    });
  }
}
