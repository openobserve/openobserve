# Kinora self-host POC

Evaluating [Kinora](https://github.com/Kinora-dev/kinora) (self-hosted) as a Playwright
reporting dashboard — a possible replacement for / complement to TestDino.

**Status: validated locally.** Stack runs in Docker, a sample suite uploads runs +
traces, and every headline feature renders. See `screenshots/`.

---

## What was stood up

- **Kinora stack** (cloned to `../../../../kinora`, i.e. `o2_free/kinora`) via its
  `selfhost/docker-compose.yml`: Postgres 18 + server + migrate + nginx web, single origin.
- **Served at:** http://localhost:8099 (8080 was already taken on this machine).
- **Account:** `poc@kinora.local` (no SMTP needed — self-host auto-verifies).
- **Project:** `openobserve-e2e-poc`, fed by this suite.

## This suite

A deliberately-varied, **offline** Playwright suite (uses `page.setContent`, so it needs
no running OpenObserve backend) designed to exercise Kinora's features:

| Spec | Behaviour | Demonstrates |
|------|-----------|--------------|
| `stable.spec.js` | 4 always-pass | green baseline / pass-rate trend |
| `failing.spec.js` | 1 always-fail (+ trace) | failure grouping, **embedded trace viewer** |
| `flaky.spec.js` | ~50% fail, retried | **flaky-rate** detection (pass-on-retry = flaky) |
| `regression.spec.js` | green, breaks with `KINORA_POC_BREAK=1` | **run comparison** / "newly failing" |

## Run it

```bash
cd tests/ui-testing/kinora-poc
npm install
# .env already holds KINORA_URL=http://localhost:8099 and the project token
npm test            # normal run
npm run test:break  # regression run (extra failure, for the Compare view)
```

## Findings (all ✅)

- **Overview** — global pass rate, per-run colored strips, sparkline trend.
- **Per-run table** — pass / fail / **flaky** / duration columns.
- **Per-test history** — flaky-rate + fail-rate per test, "New failure/flakiness" tags,
  "Unstable only" filter. *(This is the headline value vs raw Playwright HTML reports.)*
- **Test detail** — all-time pass/flaky/fail rate, status timeline, full error logs.
- **Embedded trace viewer** — real Playwright trace (actions/DOM/console) inline, served
  from the local artifacts volume. No download.
- **Run comparison** — `Compare` button diffs any two runs.

## Gotcha hit & fixed

Trace upload first returned **500: `EACCES mkdir /app/.data/artifacts/...`** — the named
volume is root-owned but the server runs as uid 1001. Fix:

```bash
cd o2_free/kinora/selfhost
docker compose exec -u root server chown -R 1001:65533 /app/.data
```

(Persists for the life of the volume. File this upstream, or set artifact storage to S3.)

## Stack admin

```bash
cd o2_free/kinora/selfhost
docker compose ps          # status
docker compose logs server # logs
docker compose down        # stop (keeps volumes/data)
docker compose down -v     # stop + wipe data
```

---

## Real-data path (use actual GitHub CI history instead of this synthetic suite)

Kinora's `@kinora/cli` is built for this:

- `kinora upload results.json` — one Playwright **json** report + its traces.
- `kinora import ./reports` — bulk historical backfill from a dir of json reports
  (past runs are free / skip alerts; **traces not uploaded by import**).

For OpenObserve's CI specifically:
- Each e2e shard uploads `blob-report-<folder>-attempt-N` artifacts, but
  **retention is only 1 day** — so only the last ~24h of runs are downloadable.
- They're **blob** reports, not json. Backfill recipe:
  ```bash
  gh run download <run_id> --pattern 'blob-report-*' -D ./all-blob-reports
  npx playwright merge-reports --reporter json ./all-blob-reports > results.json
  npx @kinora/cli upload results.json --project openobserve-e2e-real \
    --url http://localhost:8099 --token <token> \
    --git-repo-url https://github.com/openobserve/openobserve
  ```
- For lasting real history, add a `kinora upload` step to `playwright.yml` (alongside the
  TestDino upload) or bump artifact retention.
