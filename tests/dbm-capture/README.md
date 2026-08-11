# tests/dbm-capture — a CONSUMER copy

**The canonical source for everything here is the `o2-dbm-capture` repo.**
Regenerate there, then sync. Do not hand-edit `fixtures/` or `replay/` in this
tree.

## Why this directory exists

The DBM API tests resolve it by path at runtime, with no knowledge that the
other repo exists:

* `tests/api-testing/tests/dbm/test_phase1_ingest.py:48-52` —
  `Path(__file__).resolve().parents[4] / "tests" / "dbm-capture"`, then
  `sys.path.insert(0, …/replay)` and `import replay`.
* `test_phase2_rollup.py:55-59` — the same.
* Both read `fixtures/*.json` directly (`phase1:94,242,330`;
  `phase2:88`). Between them they need `python-pg-new.json`,
  `java-dup.json` and `dotnet-pg10-legacy.json`.

Keeping the files in-tree means a test run needs nothing but this checkout.
Fetching them across repos at test time would turn "a fixture changed" and "the
network failed" into the same symptom.

## What lives where

| | edit here? | notes |
|---|---|---|
| `fixtures/` | **no** | produced by `make capture && make scrub` in o2-dbm-capture |
| `replay/` | **no** | mirror |
| `scrub/` | **no** | mirror |
| `extract/` | **no** | mirror, except the corpus-path resolution, which is intentionally different in each repo |
| `MANIFEST.md` | yes | provenance table; `test_phase1_ingest.py:62` cites it for expected span counts |
| `apps/`, `collector/`, `docker-compose.yml`, `Makefile` | superseded | the running rig now lives in o2-dbm-capture |

A fixture is an *observation* of what an SDK actually emitted. Editing one so a
test passes destroys the only property it has.

## Syncing

From an `o2-dbm-capture` checkout:

```bash
make check-drift      OO=/path/to/openobserve   # report differences
make sync-openobserve OO=/path/to/openobserve   # push, then re-verify
```

`make check-drift` is the first thing to run when a DBM API test starts failing
for no apparent reason. Full rationale and the list of deliberately-different
files: `o2-dbm-capture/docs/FIXTURE-HANDOFF.md`.
