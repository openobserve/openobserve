# Test Setup Contract: Database Monitoring  (area: Infra)

> This feature's E2E specs are **READ-ONLY**: they ingest NOTHING and create NO streams.
> Every data-bearing assertion reads whatever a **collector-fed org already holds**. The single
> most important precondition is therefore an environment concern, not a test-internal one:
> `ORGNAME` must point at an org a database collector (receiver) actually feeds.

## The one hard precondition (environment, not reproducible from a test)

- **A collector-fed org.** DBM data is produced by an OpenObserve database collector/receiver
  (Postgres / MySQL / MariaDB / SQL Server) running against a real database, writing:
  - the shared server-vantage logs stream **`_o2_dbm_server`** (statement lists, deadlocks,
    blocking samples, activity samples, plans, server samples), and
  - the trace-side rollups the client vantage reads (spans with `db.*` semconv), plus
  - metric streams for the instance-health column (`instance_metrics`).
- **Feature flag ON:** `database_monitoring_enabled` must be reachable as `true` in `/config`
  (server `cfg.db_monitoring.enabled`). The route guard redirects to `/traces` when the flag is
  loaded and `false`.
- **Auth:** the suite logs in as the root user; the page object's API probes use Basic auth built
  from `ZO_ROOT_USER_EMAIL` / `ZO_ROOT_USER_PASSWORD` (OpenObserve authenticates API calls with an
  `Authorization` header held in localStorage, NOT a cookie — `page.request` inherits nothing).
- **Enterprise (deadlocks / blocking / table-health):** those three tabs are **locked on OSS**
  (backend 403 + `config.isEnterprise !== "true"`). Their specs are legitimately absent/skipped on
  an OSS run. This pipeline is OSS, so plan those three tabs as `test.fixme`/skip-when-gated.

## How the dev specs establish "data exists" (copy these EXACT patterns — do NOT invent setup)

The dev's own specs (already in the diff) are the reference implementation. They **do not ingest**;
they discover the org's real scope from the API and `test.skip` when nothing is there:

- **Discover engine/instance/namespace from the data** (never hardcode `postgresql`):
  `dbm.firstScopeFromApi()` / `dbm.firstNamespaceFromApi()` — see
  `tests/ui-testing/pages/dbmPages/databaseMonitoringPage.js:729-774`.
- **Discover a plan-bearing fingerprint** from the stream:
  `POST /api/{org}/_search?type=logs` with
  `SELECT * FROM _o2_dbm_server WHERE o2_dbm_plan IS NOT NULL LIMIT 5` —
  see `tests/ui-testing/playwright-tests/Infra/databaseMonitoringPlans.spec.js:22-53`.
- **Discover a server-reported fingerprint** (works with or without traces):
  `dbm.firstServerQueryFingerprint()` → `GET /db_monitoring/server_queries` —
  see `databaseMonitoringPage.js:699-703`.
- **Count rows from the API** to compare UI-vs-API (never a pinned number, the rig ingests
  continuously): `dbm.apiCount(endpoint, params)` — see `databaseMonitoringPage.js:785-809`.

## Streams / data the spec must establish

There is **nothing to create** inside a Playwright test. The data model is:

- `_o2_dbm_server` **[shared/read-only, pre-seeded by the collector]** — fields include
  `o2_dbm_fingerprint`, `o2_dbm_engine`, `o2_dbm_instance`, `o2_dbm_namespace`, `o2_dbm_plan`,
  `o2_dbm_plan_hash`, `o2_dbm_plan_source`, plus event feeds (deadlocks/blocking/activity/samples).
  Why: every server-vantage read (fallback lists, plans, server metrics, deadlocks, blocking,
  activity, table health) resolves from here.
- Trace rollup streams **[shared/read-only]** — the client-vantage (`db_totals`/`query_stats`)
  source. Why: Overview/Top/Slowest rows + percentiles + "where it runs" + history charts.
- Metric streams (collector) **[shared/read-only]** — `instance_metrics` for the Overview health
  column. Why: connection saturation / cache-hit / replication-lag / deadlock counts.

**No `[per-test]` streams are required** — no test mutates data.

## Preconditions / toggles
- `ORGNAME` env: point at the collector-fed org (dev rig uses `pg_server`; the specs fall back to
  `default` and skip data assertions on an empty org).
- `ZO_BASE_URL`, `ZO_ROOT_USER_EMAIL`, `ZO_ROOT_USER_PASSWORD` — required by `page.request` probes.
- Do **not** force SQL mode; DBM has no SQL-mode dependency.

## Gotchas (so the Healer/Engineer don't rediscover them)
1. **keep-alive staleness.** `DbmShell` wraps list tabs in `<keep-alive>`; arriving on a tab
   repaints the previous run's rows for up to ~1s. Use `waitForSettled` (wait for *empty state OR
   rows*, then wait for the count to stop moving, re-checking the empty state inside the loop) —
   `databaseMonitoringPage.js:419-489`. This is the single most common flake source.
2. **OTable renders a header `<tr>` and a skeleton `<tbody data-test="o2-table-skeleton-body">`.**
   Count rows via `getRowCount` (excludes both) — a bare `tr` count is always 1 too many, and
   counting the skeleton reads a phantom population (8 on this build). `databaseMonitoringPage.js:306-323`.
3. **Detail panels are `v-if`, not `v-show`.** Plans/Callers are absent from the DOM unless
   `?tab=plans` / `?tab=callers` is in the URL. `openQueryDetailTab` exists for this —
   `databaseMonitoringPage.js:683-696`.
4. **Empty states are gated on `!loading`.** A single read mid-fetch sees "no rows and no
   explanation" and mis-condemns a working page. Wait for the explanation FIRST (`waitForExplanation`),
   then count rows. `databaseMonitoringPage.js:850-860`.
5. **Badge vs table are different grains** (population vs a capped cut). Assert "non-zero badge
   never over an empty table", not exact equality — Activity's badge counts `by_state` population,
   its table lists sampled rows.
6. **Search is server-side on deadlocks/blocked/queries, client-side on table-health/activity.**
   Use `search()` (600ms debounce floor + wait-for-movement + settle), never a fixed sleep —
   `databaseMonitoringPage.js:175-216`.
7. **`data-test` prefix trap:** the scope filters are hardcoded `dbm-queries-*` on EVERY tab
   (Table health's instance chip is still `dbm-queries-scope-chip-instance`). The chip the UI labels
   "database" is the `instance` dimension; the real database is `namespace`. `databaseMonitoringPage.js:13-23`.
8. **Schema/data arrives async.** On the Overview, instance-health columns populate from an
   unawaited `instance_metrics` read AFTER the query table paints; never assert a health cell on
   first paint, and never fail the page when that read is absent (it degrades to blank columns).
9. **API probe auth** must be an explicit `Authorization: Basic <base64(email:password)>` header —
   `page.request` does not inherit the SPA's localStorage token. `databaseMonitoringPage.js:358-399`.
