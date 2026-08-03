# Playwright CI shard matrix — single source of truth

`ci-matrix.json` (this directory) is the **only** place the Playwright UI shard list
lives. Both the OSS and Enterprise `playwright.yml` workflows build their test matrix
from it at run time via `.github/scripts/build-ci-matrix.js`, so a spec added here runs
in **both** repos automatically — no more hand-syncing two workflow files.

## Adding / moving a spec

- **A spec both OSS and ENT run:** edit `ci-matrix.json` only. Add the filename to the
  `run_files` of the right shard (`testfolder`). Done — ENT picks it up on its next run.
- **An enterprise-only spec:** edit `o2-enterprise/tests/ui-testing/ci-matrix.ent.json`
  (the overlay), never this file. Two shapes:
  - add it to an existing shared shard → `"append": { "<testfolder>": ["my.spec.js"] }`
  - a whole new ENT-only shard → add an object to `"shards": [ … ]`.
- **A new shard:** add a new object to `ci-matrix.json` with `testfolder`,
  `actual_folder`, `browser`, `run_files`.

## Fields

| field           | meaning                                                                 |
|-----------------|-------------------------------------------------------------------------|
| `testfolder`    | shard label — becomes the job name `e2e / <testfolder>` (must be unique) |
| `actual_folder` | real directory under `playwright-tests/` (e.g. `Logs-Core` → `Logs`)    |
| `browser`       | `chrome`                                                                 |
| `run_files`     | spec filenames run by this shard                                         |
| `disabled`      | *(optional)* specs intentionally turned off — see below                 |

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
already in `ci-matrix.json`; `build-ci-matrix.js` fails the run if it does.
