# Test Setup Contract: Config Endpoint Split: Login Bootstrap vs Authenticated Full Config (area: GeneralTests)

> Read by the **Engineer** (implements setup), the **Healer** and the **Refiner**
> (consult instead of blind-scanning when a data/setup failure appears).
> Scope: OSS build (`build_type === "opensource"`).

## Streams / data the spec must establish

This feature is **config-endpoint only** — it needs **no stream data and no ingest**.
The preconditions are auth/org state and HTTP endpoint access, not ingested records.
Nothing in `config-bootstrap` reads streams, schemas, or usage data.

- **No streams required.** Any test that ingests is out of scope.

## How to create the preconditions (copy these EXACT patterns — do NOT invent setup)

### Auth / org
- **Unauthenticated bootstrap:** make the request with **no** `Authorization` header.
  Use a bare `page.request.get(...)` (no headers) or a raw `request` fixture.
- **Authenticated full config + E2E:** reuse the framework session exactly as the
  correlation specs do — `authedRequest` / `getAuthHeaders` / `getOrgIdentifier` from
  `tests/ui-testing/playwright-tests/utils/cloud-auth.js`
  (`BASE = process.env.ZO_BASE_URL`, `getAuthHeaders()` → Basic `email:password` on
  self-hosted). See usage at
  `tests/ui-testing/playwright-tests/utils/correlation-api-helpers.js:31,126-142`.
- **E2E navigation + auth:** use `navigateToBase(page)` and the `test` fixture from
  `tests/ui-testing/playwright-tests/utils/enhanced-baseFixtures.js:20-104,134-178`
  (saved storageState auth; `verifyAuthentication` keys on
  `[data-test="navbar-main-nav"]`).
- **Login form flow (if a fresh/unauth page is needed):**
  `pm.loginPage.openInternalLoginForm()` → `fillLoginForm(ZO_ROOT_USER_EMAIL,
  ZO_ROOT_USER_PASSWORD)` → `submitLoginForm()` from
  `tests/ui-testing/pages/generalPages/loginPage.js:31-44,80-144`.

### Exact API calls the spec should make

| # | Call | Expected (OSS) | Source of truth |
|---|------|----------------|-----------------|
| 1 | `GET ${ZO_BASE_URL}/config` (no auth) | 200; keys are **exactly** `["build_type","commit_hash","custom_hide_self_logo","custom_logo_dark_img","custom_logo_img","custom_logo_text","native_login_enabled","rum","sso_enabled","telemetry_enabled"]`; `build_type === "opensource"`; `commit_hash` non-empty; **no** `version`/`license_expiry`/`instance` | backend test `src/api/http/src/handler/http/router/mod.rs:1626-1677` |
| 2 | `GET ${ZO_BASE_URL}/api/${ORGNAME}/config` (auth) | 200; `version` present & non-empty; `sql_reserved_keywords` non-empty array; `instance` **absent**; `build_type === "opensource"` | `router/mod.rs:1700-1745` |
| 3 | `POST ${ZO_BASE_URL}/api/${ORGNAME}/config` (auth) | 405 | `router/mod.rs:1734-1744` |
| 4 | `GET ${ZO_BASE_URL}/config/reload` (no auth) | 401 | `router/mod.rs:1680-1694` |

## Preconditions / toggles
- No SQL-mode or quick-mode toggle is involved; no ingestion threshold; no
  `restricted_routes_on_empty_data` interaction (the About page is reachable on an
  empty org — the empty-data redirect only fires on specific routes, and `/about`
  is not among them).
- Ensure the E2E session is on the org `process.env["ORGNAME"]` (default `default`);
  `navigateToBase` already appends `?org_identifier=${ORGNAME}`.

## Timing gotchas (so the Healer/Engineer don't rediscover them)
- **Full config is async after login.** `version`/`build_date` exist ONLY on the
  full config, so a test that navigates straight to `/about` can observe an empty
  version pill. Wait for the nav rail (`[data-test="navbar-main-nav"]`, already used
  by `verifyAuthentication`) **or** poll the version pill until non-empty before
  asserting. Do **not** assert `version` on the unauthenticated bootstrap response —
  it must be absent.
- **`/config` vs `/api/{org}/config` are different base paths.** The bootstrap is
  `GET /config` (no `/api/`, no org). The full config is `GET /api/{org}/config`.
  Do not conflate them.
- **`getAuthHeaders()` on self-hosted** uses `ZO_ROOT_USER_EMAIL`/`ZO_ROOT_USER_PASSWORD`
  (Basic) — this authorizes `/api/{org}/config`. On cloud it uses the passcode from
  `cloud-config.json`; keep using `authedRequest` so 401/403 self-heal.

## Gotchas
- The bootstrap exact-key-set assertion is the *security contract*. If a future PR
  adds a key to `ConfigBootstrapResponse`, this test (and the backend test) must be
  updated in lockstep — never "fix" the E2E by loosening the key list.
- `EnterpriseUpgradeDialog`'s `ingestion_quota` fallback (always `50`) is a known
  backend gap, enterprise-only, and out of scope for OSS. Do not assert it.
