# Playwright CI shard matrices — single source of truth

## Manifest index

Each Playwright workflow builds its matrix from one of these JSON files (via a
`generate_matrix` job). Shared workflows use an OSS **base** + an ENT **overlay**
(`*.ent.json`, in the enterprise repo); ENT-only workflows use a standalone manifest.

| Manifest | Drives workflow | Kind |
|---|---|---|
| `ci_matrix.json` (+ ENT `ci_matrix.ent.json`) | `playwright.yml` (PR gate) | shared base + overlay |
| `ci_matrix_regression.json` (+ ENT `ci_matrix_regression.ent.json`) | `playwright_regression.yml` | shared base + overlay |
| `ci_matrix_cloud.json` *(ENT repo)* | `playwright_alpha1.yml` | ENT-only standalone |
| `ci_matrix_env.json` *(ENT repo)* | `playwright_env.yml` | ENT-only standalone |
| `ci_matrix_env_scheduled.json` *(ENT repo)* | `playwright_env_scheduled.yml` | ENT-only standalone |
| `ci_matrix_firefox.json` *(ENT repo)* | `playwright-firefox-ondemand.yml` | ENT-only standalone |

Base manifests + `build-ci-matrix.js` live in OSS; overlays and ENT-only manifests live
in `o2-enterprise/tests/ui-testing/ci-matrix/`. The merge script is shared (ENT reuses it
from its OSS checkout).

---

## The shared PR-gate matrix (below refers to `ci_matrix.json`)

`ci_matrix.json` (this directory) is the **only** place the Playwright UI shard list
lives. Both the OSS and Enterprise `playwright.yml` workflows build their test matrix
from it at run time via `.github/scripts/build-ci-matrix.js`, so a spec added here runs
in **both** repos automatically — no more hand-syncing two workflow files.

## Adding / moving a spec

- **A spec both OSS and ENT run:** edit `ci_matrix.json` only. Add the filename to the
  `run_files` of the right shard (`testfolder`). Done — ENT picks it up on its next run.
- **An enterprise-only spec:** edit `o2-enterprise/tests/ui-testing/ci-matrix/ci_matrix.ent.json`
  (the overlay), never this file. Two shapes:
  - add it to an existing shared shard → `"append": { "<testfolder>": ["my.spec.js"] }`
  - a whole new ENT-only shard → add an object to `"shards": [ … ]`.
- **A new shard:** add a new object to `ci_matrix.json` with `testfolder`,
  `actual_folder`, `browser`, `run_files`.

## Fields

| field                 | meaning                                                                 |
|-----------------------|-------------------------------------------------------------------------|
| `testfolder`          | shard label — becomes the job name `e2e / <testfolder>` (must be unique) |
| `actual_folder`       | real directory under `playwright-tests/` (e.g. `Logs-Core` → `Logs`)    |
| `browser`             | `chrome`                                                                 |
| `run_files`           | spec filenames run by this shard                                         |
| `disabled`            | *(optional)* specs intentionally turned off — see below                 |
| `quick_mode_enabled`  | *(optional)* `true` starts this shard's server with `ZO_QUICK_MODE_ENABLED` |
| `ingest_allowed_upto` | *(optional)* hours of backdated ingestion this shard's server accepts    |
| `workers`             | *(optional)* pin `--workers=N` for this shard                            |

The last three exist because a shard is the smallest unit that can change them.

- `ingest_allowed_upto` — the workflow default is **5 hours**, and older rows are
  dropped while ingestion still answers `200`. A suite that seeds history needs a
  wider window; `SLO-Measurement` sets `240` because SLOs measure a rolling 7-day
  window. Shards that omit it keep the workflow default.
- `workers` — `fullyParallel` runs separate spec **files** concurrently, and
  `test.describe.configure({ mode: 'serial' })` only orders tests *within* one
  file. A shard whose specs contend for a shared server-side resource must pin
  `workers: 1`; the specs cannot express that themselves. `SLO-Measurement` does,
  because both of its specs wait on the SLO backfill job, which runs with
  `ZO_SCHEDULER_SLO_BACKFILL_CONCURRENCY=1`.
- `slo_backfill_chunk_secs` — the server default is **86400** (1 day), so a test
  SLO with a 7-day window backfills in 7 sequential chunks under the concurrency-1
  rule above. `SLO-Measurement` sets `604800` so each of its 7-day-window SLOs
  backfills in a single chunk instead. Safe only because no spec in that shard
  asserts on per-chunk timing or partial coverage — only on the final measured
  state. If a future spec in this shard needs to see backfill mid-flight, give
  that spec its own shard rather than lowering this back down.

## Disabling a spec (JSON has no `//` comments)

Every shard ships with a `"disabled": []` placeholder, so turning a spec off is a
fill-in-the-blank — don't delete the spec you want to remember, **move it into that
shard's `disabled` array** with a reason. `build-ci-matrix.js` never emits `disabled`, so
those specs don't run, but the record survives and is git-diffable:

```json
{
  "testfolder": "Alerts",
  "run_files": ["alerts-ui-operations.spec.js"],
  "disabled": [
    { "file": "alerts-e2e-flow.spec.js", "reason": "flaky; pending rewrite" }
  ]
}
```

A spec cannot be in both `run_files` and `disabled` — the build fails if it is. Any
`_comment` (or `_`-prefixed) key is also ignored, for free-form notes.

**Enterprise-only disabled specs** go in the overlay's `disabled` map, keyed by shard:
`"disabled": { "Alerts": [ { "file": "…", "reason": "…" } ] }`.

The ENT overlay only ever carries the **delta** from OSS. It must not re-list any spec
already in `ci_matrix.json`; `build-ci-matrix.js` fails the run if it does.
