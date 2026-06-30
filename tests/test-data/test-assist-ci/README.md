# test-assist-ci fixtures

Throwaway scaffolding for bringing up the test-assist CI agent. Will be replaced once real
`Needs-Testing` issues flow through the pipeline.

## Layout

| Path | Purpose |
|------|---------|
| `seed/logs_seed.json` | Tiny log batch ingested before the agent runs, so Logs/Streams pages are non-empty. |
| `seed/seed.sh` | Idempotent script the engine calls in fixture mode. POSTs `logs_seed.json` to `ZO_BASE_URL`. Uses `set -euo pipefail` + header-based auth (no creds in `ps`). |
| `fixture-issues/` | Synthetic GitHub issue payloads — same JSON shape as `gh issue view`. Lets Scout run without real issues. |
| `expected-verdicts.json` | Verdict each fixture issue should produce. Pipeline regression contract. |

## How the agent consumes this

1. Phase 0.5 (new) → `seed/seed.sh` runs against `$ZO_BASE_URL` (only when `FIXTURE_MODE=true`).
2. Phase 1 (Scout) → if `FIXTURE_MODE=true`, reads `fixture-issues/*.json` instead of calling GitHub.
3. End of run → engine diffs final verdicts against `expected-verdicts.json` and fails the job on mismatch.

## Required env (consumed by `seed.sh`)

| Variable | Default | Notes |
|----------|---------|-------|
| `ZO_BASE_URL` | — (required) | The OpenObserve instance the engine booted. |
| `ZO_ROOT_USER_EMAIL` | — (required) | Root user for basic auth. |
| `ZO_ROOT_USER_PASSWORD` | — (required) | Root user password. |
| `ORGNAME` | `default` | OpenObserve org to ingest into. |
| `CI_SEED_STREAM` | `ci_seed_stream` | Stream name the seed creates; the fixture spec references this exact name. Override only when running multiple seeders against one instance. |

## `expected-verdicts.json` schema

A JSON object keyed by issue number. Each entry:

```jsonc
{
  "90001": {
    "fixture": "bug-001-fixed.json",        // filename under fixture-issues/
    "expected_status": "FIXED",             // one of FIXED | STILL_PRESENT | INCONCLUSIVE
    "expected_confidence": "HIGH"           // one of HIGH | LOW
  }
}
```

The engine's regression-mode reads this file after Reporter finishes, compares each fixture
issue's actual verdict against `expected_status` + `expected_confidence`, and fails the job
on mismatch. Real (non-fixture) issues never appear here and are not regression-checked.
