# CI → OpenObserve reporting

Each of three CI workflows emits **one summary JSON document per run** into a dedicated
OpenObserve stream, so we can build performance/reliability dashboards on top of them.

| Workflow | Repo | Stream | Emitting job |
|---|---|---|---|
| Playwright Regression (`playwright_regression.yml`) | openobserve (OSS) | `ci_regression` | `report_to_openobserve` |
| DocGen engine (`docgen.yml`) | o2-enterprise | `ci_docgen` | `report_metrics` |
| E2E Council engine (`e2e-council.yml`) | o2-enterprise | `ci_council` | `report_metrics` |

All three post via the shared, never-fail poster `.github/scripts/o2-report.sh`
(`POST {base}/{stream}/_json`, Basic auth). The report job is `continue-on-error` and the
poster always `exit 0`s — **reporting can never fail or slow the real CI run.** A rotated
passcode just shows up as an ingest `::warning::` with no metric for that run.

## Secrets to create (BOTH repos: openobserve + o2-enterprise)

Identical name + value in each repo (Settings → Secrets and variables → Actions). These can
also be **org-level** secrets scoped to both repos instead of per-repo.

> ⚠️ This file lives in a **public** repo — it deliberately contains **no** real host, org id,
> IP, or credential. The concrete values live only in the GitHub Actions secrets below. Ask the
> infra/QA owner for the actual ingest URL + passcode.

**Secrets** (Settings → Secrets and variables → Actions → *Secrets*):

| Secret | Value (format) |
|---|---|
| `O2_REPORTING_INGEST_BASE` | `https://<external-host>/api/<org-identifier>` — use the **externally-reachable** host (see note) |
| `O2_REPORTING_AUTH` | `base64("<email>:<passcode>")` — e.g. `printf '%s' '<email>:<passcode>' \| base64` |

> **Use an externally-reachable host.** An `*.internal.*` ingest host typically resolves to a
> private VPC IP that public GitHub/ubicloud runners cannot reach (ingests then fail as harmless
> `HTTP 000` warnings, no data lands). Use the public/`external` endpoint of the same instance,
> which normally serves a valid TLS cert — then no `-k` / `O2_REPORTING_INSECURE` is needed.

> Optional variable `O2_REPORTING_INSECURE=true` (a GitHub Actions **variable**, not a secret) is
> a fallback for a host with a self-signed cert — it makes the poster use `curl -k`. Leave it
> unset for a host with a valid cert.

> The passcode **rotates**. When it does, regenerate `O2_REPORTING_AUTH` in both repos.
> Until the secrets exist the report job is a no-op (logs a skip warning) — safe to merge first,
> add secrets after.

> ℹ️ Final reachability is confirmed on the first real CI run — a non-2xx/000 just warns and
> drops that run's metrics, never failing the build.

The PAT used by the engine report jobs for cross-repo PR-URL lookups is the existing
`ORG_ADMIN_TOKEN` (no new token needed).

## Event schemas

### Shared core (all three streams)
`_timestamp` (auto), `workflow` (`regression`|`docgen`|`council`), `repo`, `run_id`,
`run_attempt`, `run_url`, `trigger` (`schedule`|`workflow_dispatch`|`issue_comment`|`pull_request`),
`actor`, `started_at`, `finished_at`, `duration_sec` (wall-clock), `runner_seconds`
(Σ job durations — cost proxy).

### `ci_regression`
`branch`, `conclusion` (success/failure), `build_result`, `ui_result`, `merge_result`,
`build_duration_sec`, `shards_total`, `shards_passed`, `shards_failed`,
`shards[]` (`{name, conclusion, duration_sec}` per matrix shard),
`tests_total`, `tests_passed`, `tests_failed`, `tests_flaky`, `tests_skipped`.

### `ci_docgen`
`source_repo`, `pr_number`, `dry_run`, `mode` (dryrun/full),
`outcome` (`gated_out`|`triaged`|`no_docs_needed`|`docs_pr_opened`|`failed`),
`gate_allowed`, `needs_docs`, `feature_slug`, `doc_mode` (new/augment/update),
`triage_result`, `generate_result`, `screenshots_result`, `open_prs_result`,
`has_placeholders`, `screenshots_applied`, `screenshots_total`, `screenshots_complete`,
`docs_pr_dev_url`, `docs_pr_main_url`,
`stage_triage_sec`, `stage_generate_sec`, `stage_screenshots_sec`, `stage_open_prs_sec`.

### `ci_council`
`source_repo`, `pr_number`, `dry_run`, `mode`,
`outcome` (`gated_out`|`skipped`|`triaged`|`no_e2e_needed`|`test_pr_opened`|`heal_passed_no_pr`|`heal_failed`),
`author_allowed`, `skip`, `needs_e2e`, `reuse`, `feature_mode` (open/merged), `work_branch`,
`triage_result`, `generate_result`, `generate_has_changes`, `verify_heal_result`,
`heal_status` (passing/failing/…), `quality_status` (pass/fail), `heal_passed`,
`pr_back_result`, `ent_register_result`, `test_pr_url`,
`stage_triage_sec`, `stage_generate_sec`, `stage_verify_heal_sec`, `stage_pr_back_sec`, `stage_ent_register_sec`.

## Starter dashboard queries (OpenObserve SQL)

**Regression — pass rate over time**
```sql
SELECT histogram(_timestamp, '1 day') AS day,
       count(*) AS runs,
       sum(CASE WHEN conclusion = 'success' THEN 1 ELSE 0 END) AS passed,
       round(100.0 * sum(CASE WHEN conclusion='success' THEN 1 ELSE 0 END)/count(*), 1) AS pass_pct
FROM ci_regression GROUP BY day ORDER BY day;
```

**Regression — flaky/failed test counts trend**
```sql
SELECT histogram(_timestamp,'1 day') AS day,
       sum(tests_failed) AS failed, sum(tests_flaky) AS flaky
FROM ci_regression GROUP BY day ORDER BY day;
```

**Regression — slowest shards (avg duration)** — unnest `shards` or query the flattened field.
```sql
SELECT avg(build_duration_sec) AS avg_build_sec, avg(duration_sec) AS avg_wallclock_sec,
       avg(runner_seconds) AS avg_runner_sec
FROM ci_regression;
```

**DocGen — outcome breakdown**
```sql
SELECT outcome, count(*) FROM ci_docgen GROUP BY outcome ORDER BY count(*) DESC;
```

**DocGen — stage time profile (where time goes)**
```sql
SELECT avg(stage_triage_sec) AS triage, avg(stage_generate_sec) AS generate,
       avg(stage_screenshots_sec) AS screenshots, avg(stage_open_prs_sec) AS open_prs
FROM ci_docgen WHERE dry_run = false;
```

**Council — heal success rate + outcome funnel**
```sql
SELECT outcome, count(*) AS runs,
       sum(CASE WHEN heal_passed THEN 1 ELSE 0 END) AS healed_pass
FROM ci_council GROUP BY outcome ORDER BY runs DESC;
```

**All workflows — throughput by trigger (volume)**
```sql
SELECT trigger, count(*) FROM ci_council GROUP BY trigger;   -- repeat per stream
```

## Building the dashboards
After the **first real run lands in each stream** (so field types are inferred), import a
dashboard JSON or build panels in the UI using the queries above. Field names here are the
contract the report jobs emit — verify the first ingest matches, then wire panels.
