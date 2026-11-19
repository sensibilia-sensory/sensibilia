# Sensibilia terminal flow workbench

Optional OpenTUI Core UI around the Python CLI. It uses the same portable files, contracts,
validators and server operations. The Sensibilia application is not imported by the workbench.

From the repository root:

```bash
.venv/bin/python sensibilia-cli/flow.py tui my-study.json
```

The launcher selects that exact Python interpreter. Direct Bun development from this folder:

```bash
bun install --frozen-lockfile
bun run start -- path/to/study.json
bun run typecheck
bun test
bun run capture
bun run capture:methods
python scripts/render_captures.py
```

Capture rendering needs Pillow only for the optional PNG developer helper. The UI itself uses
OpenTUI Core; TypeScript and Bun types are development dependencies. The Python backend requires
Pydantic, like the CLI. OpenTUI declares Bun 1.3.14 or newer.

Set `SENSIBILIA_PYTHON` to the interpreter executable for direct Bun development when autodetection
cannot find a companion or platform virtual environment. Paths are passed as subprocess arguments,
not shell commands. Bun's automatic `.env` loading is disabled by the launcher and package scripts.

Layout, keyboard interaction, file safety and contrast tests use the real native test renderer
and a real Python subprocess. They operate on copies of the example in the companion's ignored
`.verification` folder. The capture gallery is generated from the renderer's cell buffers; the
PNG helper preserves their text and foreground/background colours.

Implementation:

- `src/app.ts`: workspace, focus, staged fields and explicit actions.
- `src/bridge.ts`: private JSON-lines transport and Python child lifecycle.
- `src/model.ts`: display types, outline and input parsing.
- `src/method-form.ts`: named sample pickers and conditional field presentation.
- `src/tokens.css`: palette snapshots and terminal-cell geometry tokens.
- `../tui_backend.py`: contract-derived fields and CLI operations, with local-file hash checks.
- `../method_forms.py`: guided forms for all ten methods, using the existing Pydantic defaults,
  enums, constants and validators. Required wording, RATA labels and TCATA timing are explicit inputs.
- `../tui_launcher.py`: optional dependency setup and launch from Python.

No new assessor renderer, method implementation, network listener or platform endpoint is added.
The three palettes have text contrast tests. Axe and browser-gallery tooling do not operate on a
terminal; `bun run capture` generates a screenshot gallery for layout review instead.
