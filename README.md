# Sensibilia

Sensibilia runs a sensory and consumer research laboratory from one computer: build a study from established sensory methods, run the tasting session on Android tablets in the booths, serve samples from a live floor plan, and take the data straight into R. It is free software, self-hosted, and works on a laboratory network with no internet and no IT department.

## What it does

### Build a study the way the session runs

- **Session flow editor.** Put consent, information pages, screening questions, question batteries and sensory tests in the order the assessor sees them, and preview the whole session (every branch) at desktop, tablet or phone width before you publish.
- **If / else routing.** Route on any earlier answer: screen out on refused consent, show a notice to some assessors, or skip a block.
- **Allergy and diet screening.** Tag samples with their ingredients and map a screening question's answers to those tags. Samples an assessor must not taste are skipped for that assessor, and once restrictions are declared the flow check blocks publication until every serving step skips conflicting samples.
- **Sample loops and serving gates.** "Repeat for each sample" runs one or more methods per coded sample. A **Wait for sample** step pauses the tablet until the assessor confirms the samples have arrived, or, if the laboratory prefers, until staff mark them served. "No, call staff" asks for help from the booth.
- **Presentation designs.** Fixed order, seeded randomisation, Latin squares or Williams designs balanced for first-order carry-over, with generated three-digit blinding codes. Each assessment's order is allocated when it is started and never changes.
- **Reusable questions.** Standard and numbered scales, matrix batteries, a questionnaire item bank for consent and information texts, and questionnaire files you can save and load. Studies can carry translations and image stimuli.
- **Published means frozen.** Publishing freezes the study version. Later edits make a new draft, and every assessment keeps the exact version, sample codes and order it was given.

### Sensory methods

| Method | What assessors do |
| --- | --- |
| Nine-point hedonic | Rate liking from "dislike extremely" to "like extremely" |
| CATA | Check every attribute that applies to each sample |
| RATA | Check the attributes that apply and rate how strongly |
| JAR | Rate each attribute from "too little" through "just about right" to "too much" |
| TCATA | Select and deselect attributes over time while tasting, with recorded timing |
| Triangle, duo-trio | Find the odd sample, or the sample that matches the reference |
| 2-AFC | Choose between two samples, directional (scored) or as a preference |
| Flash profiling | Write their own descriptors, then rank the samples on each |
| Napping | Place samples on a blank map by similarity, then describe them |

Each method follows a published definition. Where conventions differ in the literature (scale origin, ties, skips, reference technique), the choice is an explicit researcher setting. The [method library](docs/method-library.md) documents each one.

### Run the session

- **Run study** is one page for the session: a floor plan of the booths or a list, showing what every tablet is doing, including which booth is waiting for which sample codes. Start the first assessment or the next assessor on a tablet, serve samples, and end an assessment, all from there.
- **Booth serving.** When a tablet reaches a Wait for sample step, its booth shows the sample codes to bring, and staff can acknowledge and mark them served from the floor plan. Staff who only serve can use a separate operator key and view.
- Tablets report completion themselves, so the next assessor can start as soon as one finishes.

### Tablets

- **Offline-first assessor app.** Each answer is stored on the tablet before it is shown as saved, then synchronised when the server is reachable. A dropped Wi-Fi connection never loses an answer, and retries never create duplicates.
- **Android kiosk app.** A small Android app shows the assessor screen full screen and can lock the tablet to it (kiosk mode); staff leave it from a press-and-hold corner. It is built with your laboratory's own certificate, so tablets connect over HTTPS with nothing to install in Settings. Tablets are paired by scanning a QR code on the researcher screen.

### Data and analysis

- **Exports** in long (tidy), wide and R-ready CSV keep the study version, session, sample, test, question, value and timestamps. Missing, skipped, unselected, selected-but-unrated and zero stay distinguishable. Corrections are added, never overwritten, and the history is kept.
- **Frozen snapshots** bundle a dataset with its configurations, images and checksums, so an analysis can always be traced to exactly the data it used.
- **Built-in statistics (optional add-on).** On Windows, one double-click installs R with SensoMineR, FactoMineR, sensR and agricolae from a fixed, checksummed package set. Results > Analyses then gives each answer in plain words, with charts and Excel and Word reports:

  | Method | Analysis |
  | --- | --- |
  | Nine-point hedonic | Two-way ANOVA with Tukey HSD or Fisher LSD letters, or Friedman |
  | Triangle, duo-trio, 2-AFC | Exact binomial difference or similarity test with d′ |
  | JAR | Penalty analysis against liking |
  | CATA | Cochran's Q, pairwise McNemar, correspondence analysis, impact on liking |
  | RATA | Per-attribute ANOVA with letters, share checked, PCA map |

  A power calculator for the discrimination tests works without the add-on.

### Runs on one laboratory computer

- **Windows:** a portable zip, nothing to install. Double-click Start; backup, restore and the firewall rule are double-click files too.
- **Linux:** one script on Docker.
- One database, kept in one `data/` folder with verified backups. Collected data is never deleted by the application: studies are closed and archived instead.

## Project status

Sensibilia is at version 0.1.1 and ready for rehearsal with synthetic studies; [CHANGELOG.md](CHANGELOG.md) lists what changed since, including fixes not yet in a release. Before you collect data from people, validate the install on your own laboratory server and tablets, including backup and restore and the staff workflow. For publication-quality use, also compare results with an established reference system and check the methods you rely on, in particular TCATA timing and digital Napping.

## Install (Windows, portable)

For laboratories that run Windows and prefer not to use a console. Python, the web server and the tablet-app builder are inside the zip; nothing is installed and no internet is needed.

1. Download `Sensibilia-<version>-windows-portable.zip` from the [releases page](../../releases). Each zip is built and tested by CI from the tagged source, and has a `.sha256` file next to it so you can check the download (`certutil -hashfile <zip> SHA256`).
2. Right-click the zip, choose Properties, tick **Unblock** and press OK. Then unzip it somewhere that stays, such as the Desktop or `D:\`.
3. Double-click **Start Sensibilia**.

Back up, restore, sign-in keys and the firewall rule are double-click files too. The [Windows guide](deploy/windows.md) has the details, including how tablets get the app (open the address Start prints in Chrome on the tablet). It uses the same `data/` folder as the Docker install, so a laboratory can move between the two. To build the zip from source instead, run `python scripts/build_portable.py`.

## Install (Linux, Docker)

This is the standard install for a small laboratory: one server computer, a few tablets, no IT department needed. You need `git`, Docker Engine with Compose v2, and internet access for the first start, which builds the application image.

```bash
git clone <repository-url> sensibilia && cd sensibilia
./docker-up.sh --password
```

The script detects this computer's LAN address (the proxy only answers for `localhost` and that address), starts the stack in the background and prints the URLs, the keys it generated (once; they are also saved in `.env`) and the fingerprint of the laboratory root certificate. Open <https://localhost:1379/researcher/>; other devices use the LAN address it prints. If they cannot connect, allow TCP ports 1379 and 1380 in the firewall (`sudo ufw allow 1379/tcp && sudo ufw allow 1380/tcp`). The containers run in the background and restart with Docker, so no system service is required.

Without `--password` there is no sign-in, and anyone who can reach port 1379 has full access. That is acceptable only on a network you trust completely. Your browser warns about the laboratory certificate until it trusts the root (see below); tablets with the Android app need nothing installed.

| Address | Use |
| --- | --- |
| `https://localhost:1379/researcher/` | Researcher workspace |
| `https://localhost:1379/operator` | Serving staff with only the operator key (researchers serve from Run study) |
| `https://localhost:1379/assessor/` | Tablets (paired from the researcher screen) |
| `http://localhost:1380/certificate.crt` | Public root certificate (plain HTTP, nothing else) |

## Running it

| Command | Effect |
| --- | --- |
| `./docker-up.sh` | Start, or restart after a reboot or a change of network. Builds only if the image is missing, so it also starts without internet. |
| `./docker-up.sh status` | Check the last backup. Fails if there is none from the last 26 hours. Do this before every session. |
| `./docker-up.sh backup` | Write a verified copy of the database and images to `data/backups` (or `BACKUP_DIRECTORY` in `.env`). Keep a copy on a second disk. |
| `./docker-up.sh restore FILE` | Put a backup back. The data it replaces is kept in `data/before-restore-<time>`. |
| `./docker-up.sh update` | After `git pull`: back up, rebuild (needs internet) and restart. |
| `./docker-up.sh down` | Stop. Data stays. |
| `docker compose -f dev.compose.yaml logs -f app` | Follow the server log. |

Everything the laboratory collects lives in `data/` (database, images, certificate authority, backups), not in Docker volumes, so `docker compose -f dev.compose.yaml down -v` removes none of it. Nothing alerts anyone when a backup fails and there is no off-machine copy unless you make one; the [small-laboratory guide](deploy/standard.md) covers the daily routine, a cron line for hourly backups, restoring, a changed address, moving the server to another network or computer, and updating.

**Tablets with the Android app (no certificate step).** The certificate authority is kept in `data/dev-tls` and survives `down -v`, and `./docker-up.sh` saves its root to `data/lab-ca/root.crt` and prints its fingerprint. The server needs no screen: copy that file to any computer with a USB port, build the app there with it once, `./build_android_app.sh`, and install the same APK on every tablet with `adb` ([android/INSTALL.md](android/INSTALL.md) has the steps); it then trusts the server without anything installed in Settings (see [android/README.md](android/README.md)). If the address changes (new network or DHCP lease), run `./docker-up.sh` again; the tablets keep the same certificate authority.

**A tablet or computer with only a browser.** Download `http://<address>:1380/certificate.crt` and install it (Android: Settings > Security > Install a certificate > CA certificate). Compare its SHA-256 fingerprint with the one the researcher screen shows first; the pairing QR carries it too. Then open `https://<address>:1379/assessor/` or scan a pairing QR. Chrome will not install the PWA from a private authority, which is why the Android app exists.

Optional settings (shell or an uncommitted `.env` next to the script): `DEV_RESEARCHER_KEY` and `DEV_OPERATOR_KEY` (any length; set them, or let `--password` do it, to require sign-in; they must differ), `DEV_LAN_ADDRESS` (default: detected), `BACKUP_DIRECTORY` (default `data/backups`), `DEV_NODE_IMAGE`, `DEV_PYTHON_IMAGE`, `DEV_CADDY_IMAGE`. Delete `data/dev-tls` only to start a new certificate authority, after which the Android app must be rebuilt.

## Run without Docker (development)

You need **Python 3.13+**, **Node.js 22.12+ or 24+** and `git`.

```bash
./install.sh      # virtualenv, dependencies, .env, database, built interface
./start.sh        # http://127.0.0.1:8000/researcher/
```

`install.sh` is safe to re-run: it keeps an existing `.env` and copies the database to `data/sensibilia.db.pre-install` before migrating. Settings live in `.env`.

| Command | Effect |
| --- | --- |
| `./install.sh --password` | Generate researcher and operator keys in `.env` (default: no sign-in). |
| `./install.sh --dev` | Skip the production build; use with `./start.sh --dev` for hot reload (API on 8001, interface on 5173). |
| `./install.sh --no-frontend` | API only, no Node.js needed. |
| `./start.sh --lan` | Listen on all interfaces instead of `127.0.0.1`. |
| `PYTHON=/path/to/python3.13 ./install.sh` | Use a specific Python. |

While the server runs, Swagger UI at `http://127.0.0.1:8000/docs` documents the API. Tablets need a trusted HTTPS origin for the PWA, so rehearse with tablets on the Docker install above.

## Institution-managed deployment (optional)

If your institution supplies the certificate and DNS name, builds and reviews the images, and monitors backups, there is a hardened stack for that: Caddy with your own certificate, images pinned by digest, token files and scheduled backups with alerts. Most laboratories do not need it, and it takes planning rather than one command, so it has its own guides:

- [Deployment guide](deploy/operations.md): image build, configuration (`deploy/lab.env.example`), permissions, backup scheduling, recovery.
- [Staff runbook](deploy/runbook.md): daily operation, backups and upgrades. Initialisation (`python3 scripts/laboratory.py initialize`) is only for an empty database volume.

In outline: copy `deploy/lab.env.example` to `deploy/private/lab.env`, fill it in, then run `python3 scripts/laboratory.py initialize`, `start`, `backup` and `status`.

## Development

The application is a modular monolith: FastAPI, Pydantic, SQLAlchemy, and Alembic with local SQLite, plus React/TypeScript for the browser interfaces. The assessor PWA uses IndexedDB and a service worker. Tablets communicate with the API; the database stays on the server.

Use the checked-in dependency locks and run the relevant checks for a change:

```bash
.venv/bin/python -m pytest -q -p no:cacheprovider
.venv/bin/python -m ruff check .
.venv/bin/python -m ruff format --check .
.venv/bin/python scripts/export_contracts.py
npm --prefix frontend run contracts
npm --prefix frontend run typecheck
npm --prefix frontend run check:controls
npm --prefix frontend run format:check
npm --prefix frontend run build
npm --prefix frontend run test:e2e
npm --prefix frontend run test:deployment
```

Browser tests run in two tiers. `npm --prefix frontend run test:e2e` runs the full suite, including gallery, density and accessibility audits; axe scans each distinct UI state once, full-page per page shell and scoped to revealed components. The fast tier, used on every push and pull request, skips the `@audit` tests and axe scans: set `SENSIBILIA_AUDIT=0` and run `npm --prefix frontend run test:e2e -- --grep-invert @audit`. The full audit tier runs nightly, on release tags and on demand (`.github/workflows/audit.yml`).

Browser tests use disposable migrated databases and write screenshots and reconciliation JSON to the ignored `frontend/test-evidence/` directory. Automated browser checks complement, but do not replace, a rehearsal on the intended Android tablets and laboratory network.

See [CONTRIBUTING.md](CONTRIBUTING.md) for the architecture, invariants and review checklist that every change follows.

## Documentation

| Topic | Reference |
| --- | --- |
| Researcher workspace | [Researcher guide](docs/researcher-ui.md) and [session flow and forms](docs/study-forms.md) |
| Method configurations and response values | [Method library](docs/method-library.md) |
| API contracts | [API guide](docs/api.md) and [OpenAPI specification](docs/contracts/openapi.json) |
| Running a small laboratory (standard install) | [Small-laboratory guide](deploy/standard.md) and [Windows guide](deploy/windows.md) |
| Tablets | [Android app install](android/INSTALL.md) and [kiosk shell](android/README.md) |
| Institution-managed deployment (optional) | [Deployment guide](deploy/operations.md) and [staff runbook](deploy/runbook.md) |
| Dataset snapshots and analysis worker | [Snapshot and analysis operations](docs/analysis-operations.md) |
| Authoring session flows from a terminal | [Session flow CLI](sensibilia-cli/README.md) |
| Contributing | [CONTRIBUTING.md](CONTRIBUTING.md) |

## License

Copyright © 2026 Joachim Sundqvist.

- **Source code** is licensed under the [GNU Affero General Public License v3.0 or later](LICENSE) (`AGPL-3.0-or-later`). This covers everything in the repository that is not documentation, including the generated API and flow contracts in `docs/contracts/`. If you run a modified version of Sensibilia as a service that others use over a network, the AGPL requires you to offer those users the corresponding source code.
- **Documentation** (the Markdown files, including `docs/`, the guides in `deploy/` and `android/`, and the portable edition's `READ ME FIRST.txt`) is licensed under [Creative Commons Attribution 4.0 International](LICENSE-docs) (`CC-BY-4.0`).

Third-party dependencies keep their own licenses.
