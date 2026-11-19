# Snapshot and analysis operations

## Analyses (optional add-on)

Sensibilia runs without the analysis add-on. With it, Results > **Analyses** suggests the
analyses that fit the study's tests (liking ANOVA with post-hoc letters, triangle / duo-trio /
2-AFC tests with d′, JAR penalty analysis, CATA), runs them on frozen answers, and shows a
plain answer, a chart, the table, warnings, "How to read this" and Details. Each result downloads
as Excel or Word. "Assessors needed…" (a power calculator for discrimination tests) works with or
without the add-on.

### Installing the add-on

The add-on is R 4.6 with SensoMineR, FactoMineR, sensR, agricolae and their dependencies (about
230 MB). Every file is named, with its SHA-256, in `src/sensibilia/analysis/r-runtime.lock.json`;
the installer refuses anything that does not match and leaves nothing half-installed.

- **Windows portable:** close Sensibilia, double-click **Add analysis (R).bat**, start Sensibilia
  again. R is installed for the current user (no administrator rights) into
  `data\analysis-runtime`. Windows lists it as "R for Windows 4.6.2" under installed apps.
- **Laboratory computer without internet:** on any Windows computer with internet, unzip the same
  Sensibilia version and run **Download analysis for another computer.bat**. Copy the folder
  `analysis-download` to the laboratory computer and drop it on **Add analysis (R).bat**.
- **From a console:** `python -m sensibilia.analysis_setup install [--from FOLDER]`, `download
  FOLDER`, `status`, `remove`.
- **Docker standard install:** not yet packaged; the Analyses view says the add-on is missing.

`data\analysis-runtime` is not in backups (they hold the database and assets); it can be rebuilt
from the lock at any time. It survives replacing the zip, because `data\` is kept. A newer
Sensibilia whose lock differs reports "needs a newer analysis add-on"; install again. Results
already computed stay readable in every case.

### How an analysis runs

Run analysis freezes a snapshot of the current answers of the version (label "For analysis
<time>") and queues the analysis in the same transaction. A background runner in the server starts
it within seconds: `Rscript --vanilla` in its own temporary folder, given only R-ready rows of that
snapshot, the settings and sample codes (never private product labels, the database or keys),
with a 120 s limit, a 1 GiB memory limit and capped output. The result is checked against its
contract before it is stored with its receipt (recipe and its SHA-256, settings, snapshot and
dataset hash, R and package versions, result SHA-256). Results and figures cannot be changed or
deleted. If the server stops during an analysis, the analysis is marked failed at the next start;
run it again.

To maintain the lock (developers): `python scripts/lock_r_runtime.py --date YYYY-MM-DD
--r-version X.Y.Z`, then run `tests/test_analysis_recipes.py` with the add-on installed.

## Snapshots and the ledger census

Choose version/all-published scope and All/Current history in Results. Enter a snapshot label and staff name, then Freeze dataset snapshot. Inspect the manifest and separate atomic counts; download the checksum archive. Later collection changes live exports, never a frozen cut. Verify manifest.sha256 and every file digest; import formula-like CSV text as text.

Select the cut and Queue ledger census. The API queues jobs; it never starts a worker. Run an authorized administrative host coordinator from the same installed release, configured for the same local operational SQLite DB and an explicitly provisioned trusted Docker runtime. The script container receives no DB or credential access. Never put Docker privileges on tablets or expose its socket through the API.

Supply a locally provisioned Python image by immutable digest. Tags and runtime pulls are refused. Verification used python@sha256:593bd06efe90efa80dc4eee3948be7c0fde4134606dd40d8dd8dbcade98e669c (3.12.12 slim bookworm). Production administrators approve and provision their runtime, retain its digest receipt and validate deployment permissions.

From the configured environment, replace JOB_UUID and APPROVED_DIGEST:

```bash
.venv/bin/python -m sensibilia.analysis_worker JOB_UUID --image python@sha256:APPROVED_DIGEST
```

On Windows, run the same module with `.venv\Scripts\python.exe`. The coordinator needs the operational DB local path/permissions; named-volume deployments require explicit administrative volume access and Docker client/runtime validation. Do not copy a live DB to another path or configure a second operational DB to run jobs. Rehearse worker placement/limits with the deployment owner.

Refresh jobs and download Result JSON with recipe/source hash, image digest, dataset hash, result/checksum and execution times. Reproduce by queuing a new job on the same cut. Census counts projected row kinds/states; it performs no scoring or statistical inference. Blank provisioned sessions are in manifest.session_count but excluded from result.session_count_with_rows.

Cancel job prevents queued/running work from publishing late results. Missing runtime/image, invalid output and resource bounds fail closed; preserve the failed receipt and queue a new job after resolving the cause. No host-script fallback exists.

After a coordinator crash, verify the original coordinator is stopped before recovering a retained running job:

```bash
.venv/bin/python -m sensibilia.analysis_worker JOB_UUID --image python@sha256:APPROVED_DIGEST --recover "STAFF NAME"
```

Recovery removes/verifies absence of its exact container and marks the job failed with staff attribution. An already absent container is permitted; unverified runtime removal is refused. Queue a new job, retain both receipts. Results cancellation remains available.

Snapshots/jobs are included in existing SQLite-aware backups. Checksums are integrity checks, not digital signatures or protocol approval. Retain the historical collection deployment/image receipt separately. Before publication-quality use, compare results with an established reference system.
