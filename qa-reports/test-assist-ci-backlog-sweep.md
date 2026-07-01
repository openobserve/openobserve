# Test-Assist CI — Backlog Sweep

> Automated bug-verification roll-up. One row per issue the [test-assist-ci pipeline](https://github.com/openobserve/o2-enterprise/actions/workflows/test-assist.yml) has processed. Verdicts come from CI; closures stay manual until pipeline accuracy is calibrated.

**Pipeline:** [`test-assist.yml`](https://github.com/openobserve/o2-enterprise/actions/workflows/test-assist.yml) (o2-enterprise)
**Batch dispatcher:** [`scripts/test-assist-ci-batch.sh`](../scripts/test-assist-ci-batch.sh)
**Mode:** `write_mode=false` (no GitHub verdict writes; only the factual `Test-Assist-CI-Verified` label is applied per run)
**Filter to find verified issues:** [`label:"Test-Assist-CI-Verified"`](https://github.com/openobserve/openobserve/issues?q=is%3Aissue+label%3A%22Test-Assist-CI-Verified%22)

## How to read verdicts

| Verdict | Meaning | Action |
|---------|---------|--------|
| `FIXED` (HIGH) | Pipeline asserts the reported behaviour is no longer present | Spot-check screenshot; if accurate, close + add `Testing-Completed` |
| `STILL_PRESENT` (HIGH) | Pipeline asserts the bug is still reproducible | Confirm via screenshot; route to dev |
| `INCONCLUSIVE` (LOW) | Pipeline could not produce a confident verdict (selectors stale, repro unclear, timeout, etc.) | Manual verification needed |
| `SKIP` | Bug not testable by this pipeline (non-UI, no repro steps) | Route to backend QA or ask reporter for clarification |

## Sweep — week of 2026-06-30

_Populated as batches complete._

| # | Issue | Verdict | Confidence | Elapsed | Run | Evidence |
|---|-------|---------|------------|---------|-----|----------|
<!-- BATCH_TABLE_START -->
<!-- BATCH_TABLE_END -->

## Tier breakdown for the 100-priority list

| Tier | Source | Count | Priority |
|------|--------|-------|----------|
| 1 | Open `Needs-Testing` | ~9-10 | Highest — fresh verification queue |
| 2 | Open `Retested-Failed` (newest first) | 30 | High — known-broken; chance of silent re-fix |
| 3 | Open `Bug` from 2025+ (newest first) | ~60 | Medium — recent code → grounded selectors |
| 4 | Open `Bug` from 2024 and older | (deferred) | Low — UI may have drifted from repro |

## How to dispatch a batch

```bash
# From this OSS repo checkout, with `gh` authenticated:

# 1. Stage the issue list (one number per line, or use the tier queries below)
echo "12452
11700
12647" > /tmp/batch.txt

# 2. Dispatch in parallel
./scripts/test-assist-ci-batch.sh < /tmp/batch.txt

# 3. Watch progress at:
#    https://github.com/openobserve/o2-enterprise/actions/workflows/test-assist.yml
```

Tier queries used to build the 100-priority list:

```bash
# Tier 1
gh issue list --repo openobserve/openobserve --label "☢️ Bug" --label "Needs-Testing" --state open \
  --json number --jq '.[].number'

# Tier 2 (sorted newest first)
gh issue list --repo openobserve/openobserve --label "☢️ Bug" --label "Retested-Failed" --state open --limit 50 \
  --json number,createdAt --jq 'sort_by(.createdAt)|reverse|.[].number'

# Tier 3 (2025+, sorted newest first)
gh issue list --repo openobserve/openobserve --label "☢️ Bug" --state open --limit 300 \
  --json number,createdAt --jq 'sort_by(.createdAt)|reverse|.[]|select(.createdAt >= "2025-01-01")|.number'
```

## Historical sweeps

_(none yet — this is the first)_
