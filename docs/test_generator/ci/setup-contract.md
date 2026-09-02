# Test Setup Contract: Quick Mode Built-in Fields  (area: RUM)

## Streams / data the spec must establish

Tag each item by SCOPE so the Engineer puts it in the right place:
- **`[shared/read-only]`** — every test just READS it the same way → set up ONCE / use a pre-seeded stream.
- **`[per-test]`** — only one test needs it, or a test MUTATES it → set up INSIDE that test, uniquely named.

- **`_rumdata` [per-test — unique `service` per run]** — flattened RUM error events carrying the
  four built-in identity fields. Required fields after flatten: `service`, `version`, `session_id`
  (from `session.id`), `view_url` (from `view.url`). Why: the built-in quick-mode field list is
  exactly `service, version, session_id, view_url`; the backend re-add is only observable by
  asserting these keys are present in the `SELECT *` result of a wide stream.
- **Wide-schema precondition (CRITICAL — decides whether the test is meaningful)** — the trim
  (and thus the re-add) only engages when the stream has **more than `quick_mode_num_fields`
  (default 500) columns** (`schema.rs:51`). The small RUM error fixtures used elsewhere
  (`fixtureErrorEvent`, `ingestRumErrors`, `ingest_rum_errors.py`) produce only ~25 fields — with
  those, `SELECT *` returns every field and the "built-in fields present" assertion **passes
  trivially even if the fix is reverted** (a weak smoke test, not a regression gate).
  To make the assertion actually exercise the fix, ingest **one deterministic wide event**: a RUM
  error carrying the 4 identity fields (`service`, `version`, `session.id`, `view.url`) PLUS a
  `context` object with 600+ distinct keys whose flattened names sort alphabetically **before**
  `service` (e.g. `context.a_000` … `context.a_600` → flatten to `context_a_000` …). Then the
  "first" strategy trims to the first 500 `context_a_*` fields and only the built-in re-add
  (`schema.rs:217-225`) brings `service`/`version`/`session_id`/`view_url` back. If a revert drops
  them, the assertion fails. (OpenObserve flattens nested keys with `_`: `session.id → session_id`,
  `view.url → view_url`.)

## How to create it (copy these EXACT patterns — do NOT invent setup)

- **RUM event shape + ingest**: copy `fixtureErrorEvent()` +
  `ingestFixtureErrors()` from
  `tests/ui-testing/playwright-tests/RUM/sourcemap-upload-pretty.spec.js:86-141`.
  Concretely:
  ```js
  await page.request.post(`${BASE}/api/${ORG}/_rumdata/_json`, {
    headers: { Authorization: AUTH_HEADER, 'Content-Type': 'application/json' },
    data: events,   // each event: { service, version, env, session:{id}, view:{id,url}, error:{...} }
  });
  ```
  where `{ ORG, BASE }` + `AUTH_HEADER` come from `rumTestContext()` / `basicAuthHeader()` in
  `tests/ui-testing/playwright-tests/utils/rum-env.js:48,71,76`.
- **Alt ingest helper (no sourcemap fixture needed)**: `ingestRumErrors(page, count)` from
  `tests/ui-testing/playwright-tests/utils/rum-error-ingestion.js:17-67` already produces events
  with `service`, `version`, `session.id`, `view.url` (service `o2-sourcemap-test-app`).
- **Backend-behavior verification (the core assertion)**: run a `SELECT *` search via
  `searchStream(page, { sql })` from `tests/ui-testing/playwright-tests/utils/rum-stream-verify.js:22-46`
  (or `waitForStreamRows` at :53-66 for a poll-until-ready gate). Example query already used in the
  RUM specs: `SELECT * FROM "_rumdata" WHERE service = '<svc>' AND type = 'error'`. Assert every
  returned hit contains `service`, `version`, `session_id`, `view_url` keys.
- **Auth/org**: `ORGNAME=default`; least-privilege `ZO_RUM_TEST_EMAIL/PASSWORD` preferred, else
  root creds — resolved centrally by `rumTestContext()` (rum-env.js). Never hardcode credentials.
- **Timing**: the built-in-field assertion is only valid AFTER the stream schema hydrates and rows
  are queryable. Gate with `waitForStreamRows` (minRows ≥ 1) before asserting field keys; do NOT
  assert on the very first request (schema can lag under parallel-worker load).

## Preconditions / toggles

- **No UI toggle required for the backend path**: `quick_mode_force_enabled=true` by default
  (config.rs:2571) → `SELECT *` on `_rumdata` takes the trim + re-add path even with Quick Mode off.
  The E2E assertion above exercises exactly this.
- If adding a UI-side assertion (field-list "interesting" marks), enable quick mode first via
  `pm.logsPage.ensureQuickModeState(true)` (`tests/ui-testing/pages/logsPages/logsPage.js:5966-5997`)
  and confirm via the per-field star buttons `[data-test^="log-search-index-list-interesting-"]`.
- SQL mode must be OFF for the plain `SELECT *` path; if a test toggles SQL mode, restore with
  `pm.logsPage.disableSqlModeIfNeeded()` (logsPage.js:8873).

## Gotchas (so the Healer/Engineer don't rediscover them)

- The four fields are the **flattened** names: `session.id → session_id`, `view.url → view_url`.
  Assert on `session_id`/`view_url`, NOT `session`/`view` (those nested objects don't exist as
  columns in `_rumdata`).
- The re-add is ONLY observable when the stream exceeds `quick_mode_num_fields` (500) AND the
  identity fields fall beyond the first-N cut. With a narrow fixture the assertion is a no-op that
  passes with or without the fix. Decide up-front: (a) deterministic wide event (recommended) or
  (b) accept a smoke test + rely on the Rust unit test
  (`test_generate_quick_mode_fields_keeps_builtin_fields`, schema.rs:449) for the real gate.
- `_rumdata` schema arrives async — assert only after `waitForStreamRows` confirms ≥1 row, else the
  resolver sees an empty/short schema and the trim never engages (assertion false-passes/fails).
- `_rumdata` is a shared stream across RUM specs; use a **unique `service` per run**
  (`e2e-qmf-${Date.now()}`) so this spec's rows are filterable and don't collide with
  `sourcemap-upload-pretty.spec.js` / other RUM specs on a shared instance.
- The built-in re-add is only observable for streams wider than 500 fields; a synthetic narrow
  stream (a handful of fields) will NOT exercise the fix — keep the RUM-shaped event (wide
  `context` + the 4 identity fields) rather than inventing an unrelated logs schema.
- Config extras (`ZO_FEATURE_QUICK_MODE_FIELDS`) are empty by default in OSS — do not assert extras
  unless the harness explicitly sets the env.
