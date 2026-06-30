# test-assist-ci fixtures

Throwaway scaffolding for bringing up the test-assist CI agent. Will be replaced once real
`Needs-Testing` issues flow through the pipeline.

## Layout

| Path | Purpose |
|------|---------|
| `seed/logs_seed.json` | Tiny log batch ingested before the agent runs, so Logs/Streams pages are non-empty. |
| `seed/seed.sh` | Idempotent script the engine calls after healthz. POSTs `logs_seed.json` to `ZO_BASE_URL`. |
| `fixture-issues/` | Synthetic GitHub issue payloads — same JSON shape as `gh issue view`. Lets Scout run without real issues. |
| `expected-verdicts.json` | Verdict each fixture issue should produce. Pipeline regression contract. |

## How the agent consumes this

1. Phase 0.5 (new) → `seed/seed.sh` runs against `$ZO_BASE_URL`.
2. Phase 1 (Scout) → if `FIXTURE_MODE=true`, reads `fixture-issues/*.json` instead of calling GitHub.
3. End of run → engine diffs final verdicts against `expected-verdicts.json` and fails the job on mismatch.

## Required env

`ZO_BASE_URL`, `ZO_ROOT_USER_EMAIL`, `ZO_ROOT_USER_PASSWORD`, `ORGNAME` (default `default`).
