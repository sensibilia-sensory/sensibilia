# Contributing to Sensibilia

Sensibilia is a self-hosted sensory and consumer research platform for a university laboratory. Researchers configure studies from a library of established sensory methods, assessors complete them on Android tablets in an offline-capable Progressive Web App (PWA), and the server records responses, exports raw data and runs analyses on explicit snapshots in isolated jobs.

The intended audience is the small laboratory: one server computer, a few tablets, possibly a LAN without internet, and no IT department. The standard install (`docker-up.sh`, or the Windows portable zip) is the default. The institution-managed install (`compose.yaml`, `deploy/operations.md`) is an optional path for laboratories whose institution supplies certificates, hosts and backup monitoring. Write documentation and checks for the first, and do not make the standard install depend on institutional services.

Keep the architecture small and understandable: one modular monolith, one backend, one database. Sensibilia is not a general-purpose experimental scripting language, and it implements established sensory methods rather than inventing new ones.

## Checks

Every pull request must pass CI:

- `python -m ruff check .` and `python -m ruff format --check .`
- `python scripts/export_contracts.py` leaves `docs/contracts/` unchanged, and `npm run contracts` (in `frontend/`) leaves `src/api-schema.d.ts` unchanged. Never hand-edit contracts or generated types.
- `python -m pytest`
- In `frontend/`: `npm run typecheck`, `npm run check:controls` (no native controls outside `src/ui/`), `npm run format:check`, `npm run build` and `npm run test:e2e:fast`. The `@audit` tier (accessibility, gallery, density) runs nightly and on release tags.

Formatting is owned by Ruff and Prettier; reviews do not comment on it.

## Review checklist

Every item is pass/fail. A change is not accepted if it:

1. Mutates a published study version, a session's assigned version or order, or any append-only record (responses, form/path/temporal events, allocations, assignments, snapshots, audit rows). Corrections add records; they never rewrite history.
2. Deletes collected data or a study. Use close and archive. Do not bypass or drop the append-only database triggers.
3. Lets a tablet choose or change its study version, or lets a session credential read another session.
4. Adds an endpoint without an authentication dependency, or places a researcher-only action on a tablet-reachable route.
5. Acknowledges an event before its transaction commits, or accepts events without a duplicate-safe `client_event_id` path.
6. Collapses distinct states (missing, skipped, unselected, zero) in storage, validation, export or UI.
7. Hardcodes study-specific questions, attributes, product labels or images into the assessor UI, or adds method logic outside the shared evaluator.
8. Changes the database schema without a new Alembic migration, an `EXPECTED_REVISION` bump in `src/sensibilia/db.py`, and a test that covers the upgrade (and the downgrade where one exists). Never edit an applied migration.
9. Adds a method without all of: configuration schema, backend validator, frontend renderer, export semantics, documentation in `docs/method-library.md`, and tests.
10. Puts secrets, tokens or personal identifiers into URLs, logs, list payloads or exports.
11. Adds a framework, service, queue, scripting layer or UI dependency without discussing it first in an issue.
12. Breaks a UI rule below.
13. Introduces a user-visible behaviour change, new endpoint or new screen without matching tests, a `docs/api.md` row when it adds a researcher workflow endpoint, and, for screens, a `/dev/ui` gallery entry.
14. Makes the standard install need internet to start, a container registry, institutional DNS or certificates, or an IT role. The Windows portable edition follows the same rule and must also start from a folder name with spaces and non-ASCII letters.

## Architecture and invariants

- **Stack:** Python, FastAPI, Pydantic, SQLAlchemy, Alembic; SQLite on the local server with foreign keys, WAL and a busy timeout. Researcher and assessor UIs are React + TypeScript; the assessor UI is a PWA using IndexedDB for study packages and unsynchronised events. Keep database-specific assumptions behind the persistence layer where practical.
- **Contracts:** the generated `docs/contracts/openapi.json` is the API contract (CI keeps it current); `docs/api.md` explains conventions and the main workflow endpoints. Method configurations are versioned Pydantic/JSON Schema contracts, frozen once published (a change needs a new method version and migration).
- **Boundary:** the tablet talks to the API only and never reads the database. Researcher-authorised endpoints stay separate from the restricted session API used by tablets.
- **Method registry:** a test type is a reusable, literature-defined method (hedonic acceptance, CATA, RATA, JAR, TCATA, triangle, duo-trio, Flash profiling, Napping, …) implemented in code and described by a versioned schema. A JSON schema alone is not an implementation: each type needs a frontend renderer and a response validator. Implement from documented definitions and accepted practice; where conventions vary, expose an explicit researcher setting. When a specification is uncertain, document the open point rather than inventing a standard.
- **Study model:** a study has identity and metadata. A *study version* is an immutable published revision (publishing freezes it; changes create the next version). A *study test* is one configured instance of a method inside a version. A *session* is one assessor's execution of an exact published version and carries their assigned sequence. A *response* records an observation with enough context to interpret it. Studies compose methods through a validated flow (questionnaire steps, sample loops, serving gates, guards) whose answers and path are recorded as events. There are no tables per study, assessor or method.
- **Session package:** the package a tablet receives contains everything needed offline: method identifiers and versions, configured tests, instructions, presentation order, applicable sample codes and image references, all with stable identifiers. Private product labels never reach assessors.
- **Offline collection:** (1) cache the assigned package before a session begins; (2) persist each response locally before showing it as saved; (3) give every event a stable unique `client_event_id`; (4) queue events and retry safely; (5) treat repeats of an event ID as duplicates without creating a second observation; (6) acknowledge only after the server transaction commits; (7) retain unsynchronised events across reloads and restarts and show pending or synchronised status; (8) corrections follow one documented rule and preserve history. Tablet storage and the server database are operational stores, not backups.
- **Exports:** the long (tidy) CSV preserves study and version, session, sample, test, question or attribute, value and timestamps; wide exports and immutable snapshot archives build on it. JSON values are exported in a documented, lossless form. Missing, skipped, unselected and zero stay distinguishable. Analyses run on explicit snapshots in isolated jobs, never in a request handler and never with unrestricted access to the operational database.
- **Closing an assessment:** staff may end an assessment in progress. Answers the tablet recorded before the end are still accepted when it reconnects; later ones are not.
- **Composite endpoints** (for example creating a study with its samples and tests) are atomic: a failure leaves nothing behind.

## Credentials and data retention

- Four credential classes exist: the shared **researcher key**, the **operator key** (serving staff), a per-tablet **terminal token**, and a per-assessment **session token**. Each is scoped to its own routes. Secrets are shown once, stored hashed, and never placed in URLs.
- The researcher key identifies a credential, not a person; audit records carry its fingerprint plus a typed staff name that is not authenticated.
- Collected data is never deleted by the application. Studies leave everyday views by being closed and archived, both reversible. Archived studies are read-only; results and export stay available.

## UI principles

This is a professional laboratory tool, not a marketing site or consumer app. Optimise for correctness and scan speed, for people who are not developers and use it occasionally under time pressure. Compact is not hostile: density is welcome only while the next action stays obvious.

There are two surfaces with two density profiles:

- **Researcher UI** (`frontend/`): a dense desktop workbench in a macOS-style shell (persistent source-list sidebar, unified toolbar, flat continuous workspace).
- **Assessor PWA** (`frontend/src/assessor/`): touch-first on an Android tablet, one task per screen, 48px minimum targets, a framed shell with a top bar and one pinned primary action.

### Usability rules

1. **One task, one screen.** Selecting, configuring and previewing happen together (list left, editor and preview right). Never make someone leave a page to finish an action they started on it.
2. **Actions look like actions.** Every action is a visible button. Underlined text, plain words in table cells and hover-only controls are never the only way to act. Row actions are small buttons or icon buttons with a label.
3. **People see names, not identifiers.** UUIDs, hashes and revision numbers live in a collapsed "Details" row with a copy button, and in exports and audit logs. A field that asks for an ID is a picker instead.
4. **Plain words.** Interface text uses the laboratory's words ("Wait for sample", "Ended by staff"), not internal names (`serve_gate`, `in_progress`). API and export names do not change; the Details row may show both. Labels come from the lexicon (`frontend/src/shared/lexicon.ts`).
5. **Next step is visible.** A study shows where it is in its workflow (Describe, Build, Check, Release, Run, Results) and what to do next.
6. **Metadata that decides an action stays visible** as columns, not clicks (version, status, type, updated time, open assessments). Do not show columns that are empty everywhere.
7. **Irreversible or consequential actions** (end an assessment, close, archive) name their effect and what stays safe, and use a side panel or an inline two-step confirm (`ConfirmButton`), not a modal. Nothing is deleted.

### Banned patterns

- Card grids (2x2, auto-fit, masonry) for anything that is a list of records. Lists of more than 4 items are tables (sortable, filterable, one row per item).
- Icon tiles, decorative icons in tinted boxes, hero headings, taglines, subtitle paragraphs under page titles.
- Radius above 6px (radio markers stay round so single choice is not mistaken for multiple choice), drop shadows, gradients, pill badges larger than text.
- One large primary button per item. The one primary action of a page sits in its toolbar. A side panel or inline form may carry one primary button for its own task.
- Modals for anything that can be a side panel, inline edit or tab.
- More than one row of page chrome (title, breadcrumb, version, checklist, toolbar) above the work area.

### Colour, themes and tokens

- All colour comes from the `--c-*` tokens in `frontend/src/styles/tokens.css`; components never hold colour values (the white QR background is the one exception). A new colour token is defined in the light, dark and contrast blocks.
- The researcher UI has Light, Dark and High contrast themes (`data-theme` on the root, chosen from the sidebar, default from the device). Each theme must pass the axe contrast scan (`tests/e2e/theme.spec.ts`).
- Assessor screens and `.ui-preview` stay light under all themes, so researchers see what a tablet shows and booth conditions do not depend on a setting.
- Spacing, type size, radius and heights come from `tokens.css`; components hold no hardcoded values. If a token is missing, add it.

### Researcher UI

- Inter first (bundled), then the native stack. Base 13px, labels 12px, group labels 11px, section headings 16px, page title 22px, line-height 1.3.
- Form controls and toolbar buttons are 32px (`--h-control`), sidebar rows 30px (`--h-nav`), table rows and in-table controls 28px (`--h-compact`, header 30px).
- Spacing scale 2/4/8/12px only; panel padding at most 12px; the one exception is `--gap-form` (20px) between stacked form fields.
- App shell (`AppShell`): a full-height left sidebar (240px, `--w-nav`) beside one column holding a 44px top bar and the work area, with an optional right properties panel. The sidebar is a drawer below 800px. The workspace is one flat surface; sections are separated by headings and 1px lines, never wrapped in cards. Plain forms stop at `--w-form`; tables and builders use the full width.
- Master-detail for hierarchical things (questions, sample sets, distribution rules): the selected item's editor and preview sit beside the list, never below it. Tabs for secondary content.
- Settings forms use a property grid: label column left, control right, collapsible sections.
- Tables: sticky header, sortable columns, inline status chips, row-level actions at the far right as real buttons, keyboard navigation, filter bar above.
- The method reference is a table, not cards, and not a place to start studies (studies start from the Studies list).

### Assessor app

- Use the shared flow evaluator and `NodeAnswerRenderer`; never implement local method logic.
- Persist answers and path/outbox atomically before showing Saved or advancing.
- Credentials are session-only; there is no researcher key or version selector on a tablet.
- Every assessor screen is an `AssessorShell`: a 4px frame (`--sp-frame`, plus safe-area insets) around one flat surface, a 56px top bar, one centred column (`--w-assessor`) that scrolls inside the surface, and an optional pinned action bar. The document itself never scrolls.
- The top bar holds the brand, the sample position and code inside a loop (with a progress line), and the press-and-hold staff control. It never shows the study title, product labels, or sync or pending status: those are staff-only.
- The one primary action of a screen sits in the pinned action bar (56px). Screens that answer inline (serving gate) show no bar. Never put a second primary button on a screen.
- Text is 18px body, 28px titles; choices are flat 56px rows with the whole row as the target and a 2px accent outline for the selection.
- The Android kiosk shell (`android/`) only wraps this app in a full-screen WebView; it must not gain study logic, storage or sync of its own.

## Frontend stack

- React 19 + Vite + TypeScript, plain CSS with tokens from `src/styles/tokens.css`. No Tailwind, shadcn, MUI, Chakra, Mantine or any other CSS framework.
- Allowed additions for dense UI: `@tanstack/react-table` (headless) and `@tanstack/react-virtual`. Discuss other UI dependencies in an issue first.
- Icons: `lucide-react` at 14–16px, stroke 1.5. Icons accompany labels or sit in icon-only toolbar/row buttons with `aria-label`; never in decorative tiles.
- Shared primitives live in `src/ui/`: `DataTable`, `EditableTable`, `PropertyGrid`, `Toolbar`, `SidePanel`, `Field`, `Button`, `ConfirmButton`, `Tabs`, `StatusText`. Build screens from these only; `npm run check:controls` rejects native `button`, `input`, `select` and `textarea` outside `src/ui`.
- `DataTable` is for read-only cells and row actions. A table whose cells hold live inputs uses `EditableTable`, because `DataTable` rebuilds cell renderers on every render, which drops input focus.
- Types for API data come from `npm run contracts`; do not hand-write them.
- Start every new screen by adding it to the `/dev/ui` gallery (`src/dev/*Gallery.tsx`) with an `@audit` e2e test that scans each distinct state once. Assessor screens go in the "Sessions and offline" gallery and are covered by `assessor-shell.spec.ts` or an `@audit` scan.
- Audit each distinct UI state once: axe full-page once per page shell, and scoped to the component a step reveals (dialog, side panel, validation errors). Workflow tests prove behaviour and data integrity and do not repeat audits of unchanged states.

## Minimum tests

- Valid and invalid method configurations.
- Publishing freezes the administered configuration.
- Responses cannot reference a test from another study version.
- Duplicate `client_event_id` submissions are safe.
- Offline responses survive refresh and restart, and synchronise after reconnection.
- CSV exports preserve values and contextual identifiers; missing, unselected, skipped and zero stay distinguishable.
- Closing, ending and archiving: new assessments are refused when closed or archived; answers recorded before an end still sync and later ones are rejected; archiving is refused while assessments are in progress; archived studies are read-only.
- Composite endpoints persist nothing on failure.
- Each theme passes the axe contrast scan, and every new screen has a `/dev/ui` gallery entry.

## Non-goals

- A general-purpose experimental scripting language.
- One SQL table per study.
- Native Android development beyond the thin kiosk shell in `android/`.
- Microservices, distributed databases, or cloud orchestration.
- A large statistical-analysis suite. Analysis stays limited to reproducible snapshots and bounded, isolated jobs.
- Deleting collected data or studies from the application.

## License of contributions

By submitting a contribution you agree that code is licensed under the [AGPL-3.0-or-later](LICENSE) and documentation under [CC BY 4.0](LICENSE-docs), the same terms as the rest of the repository.
