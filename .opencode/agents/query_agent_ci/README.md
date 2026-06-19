# Query Agent CI — OpenCode Agents

Agents powering the Query Agent SQL regression pipeline in `.github/workflows/query-agent.yml`.

## Pipeline Flow

```
/query-agent PR comment OR dispatch
  │
  ├── Job 1: qa-ci-triage
  │     Reads: PR diff
  │     Decides: skip? generation_mode? categories_affected?
  │     Writes: run-context.json, triage.json
  │
  ├── Job 2: qa-ci-warden → qa-ci-fabricator → qa-ci-inscriber
  │     Warden: classifies SQL from diff, assigns Q-IDs, writes query-plan.json
  │     Fabricator: edits data_gen.py to add records for new query indices
  │     Inscriber: writes query JSON entries, runs compute_counts.py, validates
  │
  ├── Job 3: Validate/Heal (build OO → run new queries → heal if failing)
  │
  └── Job 4: PR-back (open PR with new queries if validated)
```

## Agents

| Agent | File | Role |
|-------|------|------|
| `qa-ci-triage` | `qa-ci-triage.md` | Analyze PR diff, detect SQL changes, classify categories |
| `qa-ci-warden` | `qa-ci-warden.md` | Classify SQL, assign Q-IDs, orchestrate generation |
| `qa-ci-fabricator` | `qa-ci-fabricator.md` | Edit `data_gen.py` for new query indices |
| `qa-ci-inscriber` | `qa-ci-inscriber.md` | Write query JSONs, run `compute_counts.py`, validate |

## Model

All agents use `deepseek/deepseek-v4-pro` via the provider configured in `opencode.jsonc`.

## Registration

Agents are registered in `opencode.jsonc` under the `agent` block, alongside the E2E council agents.
OpenCode does NOT auto-discover nested folders — explicit registration is required.

## Related

- E2E Council agents: `.opencode/agents/e2e_ci_council_of_agents/`
- Query agent test data: `tests/test-data/query-agent/`
- Query agent test harness: `tests/api-testing/tests/query_agent/`
