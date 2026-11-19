# Researcher workspace

Open http://127.0.0.1:8000/researcher/ after building `frontend` and starting FastAPI. Sign in
with the `SENSIBILIA_RESEARCHER_TOKEN` value in the local `.env`. The access key is held in page
memory and is never written to browser storage or bundled frontend assets. Reloading requires
signing in again; saved study configurations remain on the server.

## Configure a study

1. Select **New study**, enter a title and optional description, and create the draft.
2. Add products under **Coded samples**, then select **Add your first test** or **Add test** and
   choose **Test method**. Hedonic, CATA, RATA, JAR, triangle, duo-trio, Flash profiling and digital
   Napping are available. More than one instance may be added to the same study. See the
   [method library guide](method-library.md) for method-specific settings and response semantics.
3. Enter assessor instructions and question wording. Add, remove, or reorder questions and
   choose whether each answer is required. Stable question codes identify observations in exports;
   the editor generates codes for additional questions, with an optional code editor.
4. Open **Response scale** and review the nine scale labels. Default English labels are supplied by the backend's method
   implementation. Adapted or translated labels must preserve the intended category meanings.
5. In **Settings**, explicitly enable skipping if your study permits it. An allowed skip counts toward completion
   and remains distinguishable from missing answers.
6. Select **Preview test** to try the assessor preview. Its ratings and skips remain local to the preview and create no
   sessions or observations. Use **Reset preview answers** to start again.
7. Save the test. Instructions, questions, and labels are checked by the API; unsuccessful saves
   retain your form edits and show an error. Save study details separately when editing that section.

Select **Session flow** to add consent and screening choices, text/acknowledgment screens,
question batteries with shared scales, and forward if/else routes. The searchable outline stays
beside the selected block; use **Add block** to insert a new screen and **Duplicate block** to copy
one. Edit content, response scale, routing, and settings in their respective tabs. Save and preview
actions remain above the scrolling editor. Rehearse the whole session
through **Preview session**. See [the session flow guide](study-forms.md) for examples and semantics.

Without a saved flow, tests are presented in the order they are added; removing a draft test closes
the gap. Methods select version-owned coded products. Provisioning freezes product order and blind
codes; comparison previews use representative codes. Assessor provisioning and private serving
plans currently use the API. Images and operator/booth management remain future work.

## Publish and revise

Save all edits before publishing. **Publish study** opens a review dialog with the version, number
of tests, question count, and flow blocks. Publishing freezes the saved version. Published inputs become
read-only; the preview remains interactive. The version selector lets you inspect earlier snapshots.

Select **Create new draft** to clone the last publication into the next revision. If a draft already
exists, use **Open current draft**. Editing later instructions or study details never changes the
versions assigned to existing sessions. The initial UI uses the shared laboratory credential;
individual administrator/researcher accounts and permissions remain future work.

Switching study sections, versions, the library, or signing out prompts before discarding unsaved
edits. Browser reload/close uses the browser's standard unsaved-change prompt. Unsaved researcher
forms are not an offline store. Save before leaving; the assessor PWA will have a separate durable
event queue.

## Development

The `frontend` package uses React, TypeScript, Vite, locally bundled fonts, and Lucide icons.
`npm ci` installs versions from `package-lock.json`. `npm run build` checks types and builds
`frontend/dist`; FastAPI serves that directory when it exists. `npm run dev` serves the researcher
UI on port 5173 and proxies root API paths to the backend on port 8000. No production Node service
or cross-origin browser permissions are required.

Types are generated from the checked-in OpenAPI contract. After changing an endpoint:

```bash
.venv/bin/python scripts/export_contracts.py
cd frontend
npm run contracts
npm run build
```

`npm run test:e2e` starts isolated servers on ports 8001 and 5174 and uses Chromium. Install it
once with `npx playwright install chromium`. Automated checks cover the workflow, publication,
revision preservation, consent/refusal and screening routes, shared-scale matrices, acknowledgment,
unsaved changes, failed saves, preview isolation, independent block/test duplication, large-form
navigation, 100-row bulk entry, keyboard tabs, and accessibility at desktop, tablet and phone
viewport sizes. These browser tests are not a substitute for the eventual Android
assessor-PWA durability checks on actual tablets. Build artifacts and browser-test outputs are ignored.
