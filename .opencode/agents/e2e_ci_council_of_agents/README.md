# e2e_ci_council_of_agents

CI-adjusted version of the Council of Agents E2E test-generation pipeline, built to run
**non-interactively in GitHub Actions via OpenCode on DeepSeek-V4-Pro**.

This is the **CI copy**. The interactive local copy lives in
`.claude/commands/council_of_agents/` (Claude Code). The two are intentionally separate
(see the handoff doc §9.3) — keep the prompt *bodies* aligned, but these files carry
CI-specific wiring: standalone invocation, file-based handoff, no interactive prompts.

> **Spec / source of truth:** `tests/ui-testing/MD_Files/council-of-agents-export/CICD integration/council-ci-automation-handoff.md`

---

## What's different from the local Council agents

| Local (Claude Code) | CI (this folder) |
|---|---|
| `mode: subagent`, spawned by the Orchestrator in one session | `mode: primary`, each run as its **own** `opencode run --agent ...` invocation |
| Conversation-based handoff | **File-based handoff** via `docs/test_generator/` artifacts |
| Interactive checkpoints ("DO NOT proceed until user approves") | **No interactive prompts** — agents decide and write artifacts |
| Engineer runs + heals tests inline (`--headed`) | Engineer **generates only**; the Healer runs them headless in a later job |
| Enterprise detection inside each agent | **Triage** gates ENT/OSS once up front; ENT is skipped in v1 |
| Hardcoded local absolute paths | Repo-relative paths only |
| Scribe (Phase 6) part of pipeline | **Scribe excluded** from CI |

---

## Agents (invocation order)

| Order | Agent file | OpenCode agent | Job | Role |
|-------|-----------|----------------|-----|------|
| 0 | `e2e-ci-triage.md` | `e2e-ci-triage` | 1 | Classify ENT/OSS, needs-e2e, skip gate. Writes `run-context.json`. |
| 1 | `e2e-ci-analyst.md` | `e2e-ci-analyst` | 2 | Analyze source → Feature Design Document. |
| 2 | `e2e-ci-architect.md` | `e2e-ci-architect` | 2 | Feature doc → prioritized Test Plan. |
| 3 | `e2e-ci-engineer.md` | `e2e-ci-engineer` | 2 | Test Plan → spec file(s) + page objects + **register in `playwright.yml`**. No execution. |
| 4 | `e2e-ci-sentinel.md` | `e2e-ci-sentinel` | 2 | Audit generated code. **Blocks** on critical issues. |
| 5 | `e2e-ci-healer.md` | `e2e-ci-healer` | 3 | Run tests on local OSS binary, fix until passing (**max 3 iterations, <6 min/test**), Sentinel re-audit. |

Sequencing lives in the **workflow YAML** (it re-implements the Orchestrator). There is no
Orchestrator agent in CI — the YAML calls each `opencode run` in order.

---

## File-based handoff contract

All artifacts live under `docs/test_generator/`. Each agent **reads** its inputs and **writes**
its outputs as files; nothing is passed via conversation. Between GitHub jobs, the whole
`docs/test_generator/` tree (plus any edited test/page-object files) is shuttled with
`upload-artifact` / `download-artifact`.

```
docs/test_generator/
  ci/
    diff.patch              # Workflow writes the change diff (untrusted input).
    feature_hint.txt        # Workflow writes the optional hint (untrusted input).
    trigger_comment.txt     # Workflow writes the triggering comment (untrusted input).
    run-context.json        # Triage writes; ALL downstream agents read. The single source of run state.
    triage.json             # Full triage output (for the PR comment in dry-run).
    playwright-registration.json  # Engineer writes: { group, spec_filename, create_group }. A
                            # DETERMINISTIC (non-LLM) step applies the run_files edit — agents
                            # never edit .github/workflows/ themselves.
    sentinel-verdict.json   # Sentinel writes: { verdict: PASS|FAIL, critical_count }.
    heal-result.json        # Healer writes: { status: passing|failing, iterations }.
  features/<slug>-feature.md            # Analyst
  test-plans/<slug>-test-plan.md        # Architect
  generation-reports/<slug>-generation.md  # Engineer (what it created + the playwright.yml edit)
  audit-reports/<slug>-audit.md         # Sentinel
  execution-reports/<slug>-execution.md # Healer
```

The generated test itself is written to the repo, not under `docs/`:
`tests/ui-testing/playwright-tests/<Area>/<spec_filename>` (+ any page-object edits under
`tests/ui-testing/pages/`).

### `run-context.json` schema

```json
{
  "feature_slug": "share-link",
  "feature_title": "Logs Share Link",
  "area": "Logs",
  "edition": "oss",
  "needs_e2e": true,
  "needs_api": false,
  "spec_filename": "shareLink.spec.js",
  "spec_path": "tests/ui-testing/playwright-tests/Logs/shareLink.spec.js",
  "playwright_group": "Logs-Core",
  "source_files": ["web/src/plugins/logs/..."],
  "skip": false,
  "skip_reason": ""
}
```

`playwright_group` = the `testfolder` matrix group in `.github/workflows/playwright.yml` whose
`run_files` array the Engineer appends the spec filename to.

---

## Security model

These agents process **attacker-controllable** input (PR diffs, comments, hints — anyone can
open a PR). Hardening built into the design:

- **Untrusted input is data, not instructions.** The diff/comment/hint reach agents as files,
  and every agent that reads them is told to treat their content as inert data and ignore any
  embedded instructions ("prompt injection").
- **No LLM edits to CI workflow files.** The Engineer never edits `.github/workflows/**`; it
  emits `playwright-registration.json` and a deterministic step applies a single `run_files`
  append.
- **Path/identifier validation before shelling out.** `spec_filename` must match
  `^[A-Za-z0-9._-]+\.spec\.js$`; `spec_path` is regex-validated before the Healer runs it (and
  again in the workflow).
- **Least-privilege CI.** The live triage job runs with `contents: read`; only the PR-back job
  requests `contents: write`.
- **Human review remains the backstop.** All generated code lands in a PR a human reviews before
  merge; Sentinel auto-fixes are a tiny whitelist (add import, `console.log`→`testLogger`, tag
  `@` prefix).

## Scope (v1)

- **OSS only.** ENT features are skipped at triage (no generation, no PR).
- **Scribe excluded.** TestDino upload rides the generated PR's own existing CI.
- **Local OSS binary** is the Healer's only run target.
- On-demand agents (Inspector / Gatekeeper / Guardian / API-Smith) are out of scope.

## Invocation (CI)

Each agent runs standalone, e.g.:

```bash
opencode run --agent e2e-ci-analyst --model deepseek/deepseek-v4-pro \
  "Generate the Feature Design Document for the feature described in docs/test_generator/ci/run-context.json"
```

The model is passed at invocation (not pinned in frontmatter) so the same files can run on a
different provider if needed. The DeepSeek provider is configured in `opencode.jsonc`.

> **Discovery caveat:** verify against current OpenCode docs whether agents in a nested
> subfolder of `.opencode/agents/` are auto-discovered. If not, either flatten the files or
> register them explicitly / invoke by prompt-file path in the workflow.
