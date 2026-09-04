# test-assist-ci fixtures

Throwaway scaffolding for bringing up the test-assist CI agent. Will be replaced once real
`Needs-Testing` issues flow through the pipeline.

## Layout

| Path | Purpose |
|------|---------|
| `seed/seed-common.sh` | **Main seed** — runs for BOTH fixture AND real-issue dispatches. Ingests logs (4 streams), OTLP traces, OTLP metrics, 3 alerts, 1 pipeline. This is what unblocks real-bug verification: without seed, Tester finds an empty app and can't observe reported behaviours. |
| `seed/logs_seed.json` | Tiny 5-entry log batch → `ci_seed_stream` (kept for fixture #90001 backward compat). Read by `seed-common.sh`. |
| `seed/traces_seed.json` | Small OTLP resource-spans payload (5 spans across a checkout flow). |
| `seed/metrics_seed.json` | Small OTLP resource-metrics payload (HTTP counters + latency gauge + memory gauge). |
| `seed/alerts_seed.json` | 3 sample alerts (scheduled + real-time + disabled) — populates the Alerts page. |
| `seed/pipeline_seed.json` | 1 basic pipeline (default → ci_pipeline_out) — populates the Pipelines page. |
| `seed/seed.sh` | ⚠️ Deprecated — the fixture-only seed. Superseded by `seed-common.sh`; delete after two clean batches confirm the common seed works. |
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
