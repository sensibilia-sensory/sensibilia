# Sensibilia Session flow CLI

A free-standing command-line authoring tool for Sensibilia's **Session flow** (Flow v2):
instructions, consent, screening questions, question batteries, groups, sample loops, sensory
tests, serving steps and endings. Local JSON files work offline. Server commands use the existing
researcher API. Nothing imports the application at runtime or opens its database.

Everything needed by this companion lives in this folder. You can move or copy the folder into a
separate repository.

## Terminal workbench

The optional TUI adds a flow outline, property editors, a wording preview, validation, undo and
server draft actions. Launch it from the Sensibilia repository:

```bash
.venv/bin/python sensibilia-cli/flow.py tui sensibilia-cli/examples/sample-study.json
```

On Windows, use `.venv\Scripts\python.exe` wherever these examples use `.venv/bin/python`.

Use a copy of the example for your own study. Omit the filename to open the file/create panel.
With an installed package, use `sensibilia-flow tui my-study.json`.

The TUI needs Bun (OpenTUI declares Bun 1.3.14+); on first launch it installs its locked dependencies
inside its own folder. Ordinary Python CLI commands need no Bun or OpenTUI. Pass `--no-install`
to prevent first-run installation when working offline.

Select an outline row with arrows and Enter. Tab / Shift+Tab moves between buttons and fields;
arrows change picker values. F2 applies fields to the local file, F3 adds an item in the selected
section, F4 shows wording, F5 checks the saved local flow, F6 opens server actions, F7 opens Files,
F8 cycles themes and F10 quits. Esc discards unapplied fields. Every action also has a text button.
The minimum terminal size is 80 columns × 24 rows; 120×36 is more comfortable.

New items and edits stay staged until Add or Apply; invalid edits keep the saved file intact.
Changing selection or quitting guards unapplied wording. Undo covers local edits in the current
workbench process; server operations clear it. An external file change requires reopening the file.

All ten registered methods have guided creation and property editors: nine-point hedonic, CATA,
RATA, JAR, TCATA, triangle, duo-trio, 2-AFC, flash profiling and Napping. In **Tests**, choose **Add**,
pick the registered method, then enter its named fields. Sample pickers show codes and product
names; no UUID entry or configuration JSON is needed. Add sample definitions in **Samples** first
when the method requires a sample set.

Attributes/questions and scale labels use one entry per line during creation. The nine-point
hedonic and JAR labels start with the existing contract defaults. RATA scale labels and TCATA's
duration/tolerance require explicit entry. RATA exposes its origin (0 or 1), rating target and
required-rating policy; JAR accepts 3, 5 or 7 categories. Duo-trio reference products and 2-AFC
expected products are picked from the selected samples, and appear only for modes that need them.
Flash profiling exposes descriptor/ranking instructions, limits and ties. Napping exposes optional
descriptions while keeping the sheet settings fixed. Other fixed method settings remain read-only.

Method-specific drafts are retained while switching the method picker. Subsequent prompt edits
preserve stable attribute/question IDs. Invalid configurations leave the saved file intact.
The optional JSON editor remains available for advanced work. Rules expose the existing Flow v2
contract. Preview shows saved wording and does not simulate assessor execution.

Server actions reuse the CLI's API client and revision protection. Set
`SENSIBILIA_RESEARCHER_TOKEN` before launching if you will use them; the TUI never displays or saves
the key and does not open an invisible credential prompt. Create, Prepare and New draft explain
their effects in an inline confirmation panel. If preparation fails after a checkpoint, reopen
the local file before resuming so you can review the identifiers already saved by the CLI.

[TUI development and tests](sensibilia_cli/tui/README.md)

## Run

Python 3.11+ and Pydantic 2.10+ are required. From the Sensibilia repository, use its existing Python:

```bash
.venv/bin/python sensibilia-cli/flow.py --help
```

For an independent installation, copy this folder anywhere and install into its own environment:

```bash
cd path/to/sensibilia-cli
python3 -m venv .venv
.venv/bin/python -m pip install .
.venv/bin/sensibilia-flow --help
```

On Windows use `py -3 -m venv .venv`, then `.venv\Scripts\python.exe -m pip install .` and
`.venv\Scripts\sensibilia-flow.exe`.
The commands below assume the installed `sensibilia-flow` is on your PATH. Otherwise replace it
with the executable above, or `python path/to/sensibilia-cli/flow.py`.

## Start with the working example

Run these from this folder after installation:

```bash
sensibilia-flow copy examples/sample-study.json my-study.json
sensibilia-flow show my-study.json
sensibilia-flow set my-study.json Welcome /data/body/en --text "Please follow the laboratory instructions."
sensibilia-flow check my-study.json --complete
sensibilia-flow edit my-study.json
```

The example contains two samples, a screening question, a sample loop and a nine-point hedonic
test. Its wording and sample definitions are examples for replacement and review, not an approved
laboratory protocol. The fixed hedonic scale comes from the platform's existing method definition.

## Construct a study

```bash
sensibilia-flow new study.json --title "Sample evaluation" --language en
sensibilia-flow add study.json info --title Welcome --body "Follow the staff's instructions."
sensibilia-flow add study.json question --title Frequency --prompt "How often do you use this product?" --option rarely=Rarely --option often=Often

sensibilia-flow sample study.json add --code 123 --label "Example product A" --no-ingredients
sensibilia-flow sample study.json add --code 456 --label "Example product B" --tag milk
sensibilia-flow test study.json add --name "Overall liking" --type hedonic-9-v1 --config examples/hedonic.json
sensibilia-flow add study.json loop_samples --title Samples --sample 123 --sample 456
sensibilia-flow add study.json embedded_method --title Liking --test "Overall liking" --parent Samples
sensibilia-flow add study.json end --title Done --body "Thank you."

sensibilia-flow show study.json
sensibilia-flow check study.json --complete
```

Ingredient tags left unspecified remain **unreviewed** (`null`). `--no-ingredients` explicitly
records a reviewed empty list. Review actual ingredients and eligibility rules before use.

`methods` lists the bundled method IDs. `test ... add/replace --config file.json` validates the
configuration with Sensibilia's existing method validator. The full platform method guide remains
`docs/method-library.md` in the main repository.

## Edit and organise

Select a block by its title or its current outline number (`1`, `3.2`). Unique UUIDs are also
accepted; `show --details` reveals them. Titles must be unambiguous. Outline numbers change when
you move blocks; stored block UUIDs remain stable.

```bash
sensibilia-flow set study.json Frequency /data/prompt/en --text "Your revised question"
sensibilia-flow set study.json Frequency /data/allow_skip --value true
sensibilia-flow set study.json study /title --text "Revised study title"
sensibilia-flow move study.json Frequency --before Welcome
sensibilia-flow move study.json Frequency --parent Samples --before Liking
sensibilia-flow remove study.json Frequency
```

`--parent` chooses a group or loop; omitting it chooses the top level. `--before` chooses a sibling;
omitting it appends. The contract rejects nested sample loops and invalid current-sample bindings.
Reordering can invalidate routing rules; run `check --complete` afterwards.

`set` accepts JSON pointers relative to the block, or to the entire document when the selector is
`study`. Use `--text` for literal strings, `--value` for JSON numbers/booleans/null/arrays/objects,
or `--from-file` for complex values without shell-quoting issues. IDs, guards, translations, method
overlays and other existing contract fields are available through `set` or `edit`.

`edit` opens a temporary document in `$VISUAL`, `$EDITOR`, Notepad on Windows or vi elsewhere.
Use `--editor "code --wait"` to choose a blocking editor. The original is replaced only after valid
JSON and contract validation. Rejected edits are kept beside it as `study.json.rejected.json`.

### Choices, batteries and advanced blocks

For a multiple-choice question, use `--answer-type multiple` and optionally repeat `--exclusive CODE`.
For text or integer questions use `--answer-type text/integer`; integer bounds are `--min` and
`--max`, text length is `--max-length`. `--optional` and `--allow-skip` are independent settings.

```bash
sensibilia-flow add study.json matrix_question --title "Question battery" --data examples/matrix.json
sensibilia-flow add study.json consent --title "Participant information" --body "Replace with your reviewed participant information."
sensibilia-flow add study.json group --title "Screening"
sensibilia-flow add study.json confirm --title "Acknowledgment" --body "I have read the instructions."
```

Every `add` kind also accepts `--data` containing its existing node-data JSON contract. This
supports the full configuration of `serve_gate`, `code_entry`, matrices and other advanced steps.
For multilingual studies add the language to `/form/languages` and provide reviewed text in every
declared language. No automatic translation is performed.

Guards are Flow v2 **entry guards**: true enters the block, false takes its `otherwise` action.
Use `show --details` to obtain an earlier question's UUID and put the condition in `guard.json`:

```json
{"variable":"answer.REPLACE_WITH_EARLIER_QUESTION_UUID","operator":"eq","value":"often"}
```

```bash
sensibilia-flow set study.json "Question battery" /guard --from-file guard.json
```

The normal false action skips this block and continues. Complex `all`/`any`, `is_defined` checks
and explicit forward destinations use the same contract through `/guard` and `/otherwise`.
Requiredness, scope, missing/skipped values and reachability are checked by the bundled platform
validators. This tool does not introduce a scripting language or run assessor responses.

## Load and save server drafts

Use your researcher key at the hidden prompt, or set `SENSIBILIA_RESEARCHER_TOKEN` through your
normal secret-handling process. There is no token command-line flag, and the key is not saved in
authoring files. Set `SENSIBILIA_URL` or pass `--url`. HTTPS verifies the server certificate using
Python's trust store. For a lab CA, configure the interpreter's trust store before connecting.
HTTP is accepted for loopback; a network HTTP connection requires the explicit `--allow-http` flag
on each command. Redirects and environment proxies are disabled.

```bash
sensibilia-flow studies --url https://sensibilia.example.edu --search "Pilot" --details
sensibilia-flow pull draft.json --url https://sensibilia.example.edu --study STUDY_UUID
sensibilia-flow show draft.json
sensibilia-flow set draft.json Welcome /data/body/en --text "Revised participant instructions"
sensibilia-flow check draft.json --complete
sensibilia-flow push draft.json
sensibilia-flow server-check draft.json
```

`pull` selects the current draft, or the latest publication when there is no draft. Use
`--version-id UUID` to choose another version. A publication can be inspected and copied locally;
it cannot be pushed. To edit a published study, clone and load a new server draft:

```bash
sensibilia-flow draft next-draft.json --url https://sensibilia.example.edu --study STUDY_UUID
```

The server refuses this if a draft already exists. Legacy Form v1 is refused by `pull`; `draft`
explicitly asks the server to convert a legacy publication when cloning it. A version with no
form is loaded with an empty Flow v2 outline; insert its existing tests before saving the flow.

`push` uses one aggregate draft request for metadata, the flow and existing tests. It sends the
last loaded revision hash. If anyone changed the draft, it refuses the save; there is no force-save
option. Load into a **different** file and reconcile local edits. Successful saves read back the
server's normalized configuration and refresh the local revision hash. Server publication and
warning review remain in the existing researcher UI.

### New studies, samples and sensory tests

```bash
sensibilia-flow create study.json --url https://sensibilia.example.edu
```

For a loaded draft with newly added local samples or test configurations:

```bash
sensibilia-flow prepare draft.json
sensibilia-flow push draft.json
```

`prepare` creates only missing resources and remaps references to the server's UUIDs. `push` does
not implicitly create them. `create` first creates an empty server study, then prepares resources
and pushes the flow.

**Resource creation is a sequence of transactions**, because the current API has no single
endpoint for creating an arbitrary complete study. Each acknowledged creation is checkpointed in
the local file. If a later step fails, the study and already-created resources remain as drafts.
After an ordinary API rejection, inspect the file and server, fix the problem, then resume with
`prepare` and `push`. There is no automatic deletion or rollback of successful resource creation.

A lost response, connection failure or interruption during a write can mean the server committed
without the local checkpoint being updated. Inspect the server before retrying, especially after
resource creation: these existing creation endpoints do not offer an idempotency key. Likewise,
do not edit a shared draft concurrently during `prepare`; additions return no revision hash, so
the companion reads back and verifies its expected metadata, flow, tests and samples before
checkpointing. Ordinary pushes remain protected by the exact saved revision hash.

Edit existing server sample definitions, designs, blinding and assets in Sensibilia's researcher
UI and then reload. Server sample removal is not supported by this companion. The CLI can add
references to existing assets but does not upload images. A detached local copy retains image
references; remove or replace them before creating another study.

## Files and validation

The authoring document contains `format_version`, `title`, `description`, `form`, `tests`, `samples`
and optional `source` (server origin, study/version UUIDs and revision hash). Local names for test
configurations are companion metadata and are not sent as method configuration fields. Collected
responses, assessor identifiers and credentials are never downloaded by this tool.

```bash
sensibilia-flow export study.json flow.json
sensibilia-flow export draft.json form-request.json --request
sensibilia-flow copy draft.json independent-study.json
```

`flow.json` is the raw existing DraftFlowV2 contract. A request export contains `form` and
`revision_hash` for the existing `/form` endpoint; neither export creates sample/test resources.
`copy` detaches the server origin and remaps resource UUIDs for a new study. New files and exports
refuse overwrites. Store your local files outside this tool's source folder as normal research
working documents.

`check` validates draft structure, method configurations and local resource references.
`check --complete` adds complete text, method coverage and the platform's guard/graph/text checks.
Incomplete drafts may be stored locally or on the server. **Local validation is not a publication
approval:** the server also checks assets, study designs and other operational state.
`server-check` reports on the saved server revision, excluding unsaved local edits. This server
version requires at least one sensory method for Flow v2 publication; a questionnaire-only local
draft can be authored, but will not pass its publication check.

Exit status: `0` success, `1` validation report has errors, `2` usage/file/API failure, `130` interrupted.
Add `--json` to `show` or `check` for machine-readable output. Validation failures from a malformed
document go to standard error and exit `2`.

## Compatibility and tests

The existing pure Python validators are bundled under `sensibilia_cli/contracts/`. Their manifest
records source commit `ba908baaf01428e0ced85c697e2a85e3bf6dc205` and source hashes. Only package
imports were adjusted. They are a deliberate compatibility snapshot; update and test them when
the platform contract changes. They do not require the Sensibilia package or its repository.

Run standalone tests from this folder:

```bash
python -m unittest discover -s tests -v
```

To include real API compatibility tests, use the platform development environment from its root:

```bash
export PYTHONPATH="$PWD/sensibilia-cli:$PWD/src"
.venv/bin/python -m unittest discover -s sensibilia-cli/tests -v
.venv/bin/python -m ruff check sensibilia-cli
.venv/bin/python -m ruff format --check sensibilia-cli
```

These API tests migrate temporary SQLite databases and never touch operational data. They cover
creation/reference remapping, atomic draft saves, stale edits, publication immutability, resource
preparation, and rollback on a rejected save. Without the platform environment they are skipped;
standalone authoring and HTTP transport tests still run.
