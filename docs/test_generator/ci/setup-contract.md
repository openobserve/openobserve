# Test Setup Contract: Synthetics Steps Quota Management  (area: GeneralTests)

This file is the single source of truth for **preconditions and data** the
`organizationSyntheticsSteps.spec.js` spec needs. It is consumed by the Engineer
(implements setup), the Healer and the Refiner (debug setup/data failures). Every
helper below is a **copy of an existing repo pattern** — never invent a new one.

## Hard environment preconditions (checked BEFORE any test, via `test.skip`)

The entire feature is **CLOUD + META-ORG only** — if either is false, the page/route
does not exist and the spec must skip rather than fail.

- Cloud build: `process.env.IS_CLOUD === 'true'` — use the existing
  `isCloudEnvironment()` helper (`tests/ui-testing/pages/cloudPages/cloud-env.js:5`).
  Gate: `test.skip(!isCloudEnvironment(), 'steps quota is cloud-only')`.
- Meta org reachable: the UI hard-redirects to `general` unless the selected org is the
  configured `meta_org` (`OrganizationManagement.vue` `onMounted`). In practice the meta
  org identifier is `_meta`.
- Root-user auth (Basic) available via `ZO_ROOT_USER_EMAIL` / `ZO_ROOT_USER_PASSWORD`
  (used by every existing API helper — see `createOrgPage.js:68`).

## Streams / data the spec must establish

**No streams are involved.** The feature reads/writes **organization quota records**
(backed by the `trial_quota_usage` DB table + in-memory counters), not ingested data.

Tag each data precondition by SCOPE:

- **`[shared/read-only]`** — one target child org, read by all tests.
  - `<any existing child org>` (e.g. `default`) — needed because the quota dialog acts on
    a **row** in the org list. Why: every test opens the dialog on a row and reads its
    `browser_steps_used/limit`, `protocol_steps_used/limit` cells. The org must already
    exist (the list endpoint only returns existing orgs; there is no "create" on this page).
- **`[per-test]`** — the **quota limit value** each test sets. The `limit` field is the
  pool's ceiling and is **mutated by the test itself**, so each test must use a distinct
  value and (ideally) restore it, to avoid cross-test flake in parallel workers.
  - Recommendation: pick a unique, large, improbable value (e.g.
    `1_000_000 + (Date.now() % 900_000)`) so assertions can distinguish "my write" from
    "someone else's write"; and where possible read the *before* value and restore it in a
    `finally` (a `PUT` with the previous limit is idempotent).

## How to create it (copy these EXACT patterns — do NOT invent setup)

- **Switch to `_meta` (hard-nav is the reliable pattern):**
  ```js
  // copy of logoManagementPage.openMetaGeneralSettings (logoManagementPage.js:87-94)
  await page.goto(`${process.env.ZO_BASE_URL}/web/settings/organization_management?org_identifier=_meta`,
    { waitUntil: 'domcontentloaded' });
  ```
  The `orgnizationManagement` route path is `organization_management`
  (`useManagementRoutes.ts:265`). Wrap in `expect(...).toPass()` if a preceding org
  switch can race the redirect (see `logoManagementPage.js:89-93`).

- **Read the org list (API, for asserting the after-state / finding a target org):**
  ```js
  // copy of createOrgPage.getAdminOrgs (createOrgPage.js:226-252)
  fetch(`${process.env.INGESTION_URL}/api/_meta/organizations?page_size=1000000`, {
    headers: { Authorization: `Basic ${Buffer.from(`${ZO_ROOT_USER_EMAIL}:${ZO_ROOT_USER_PASSWORD}`).toString('base64')}` }
  });
  // response body is { data: [ { identifier, browser_steps_used, browser_steps_limit,
  //   protocol_steps_used, protocol_steps_limit, ... } ] }  — NOTE envelope is `.data`, NOT `.list`
  ```
  ⚠️ `org.spec.js:550` asserts `.list` — that is **stale and incorrect** (backend returns
  `{ data: [...] }`, `org.rs:281`). Copy `.data`, not `.list`.

- **Set a quota limit (API, for the `needs_api` cases and for restore):**
  ```js
  // mirrors web service organizations.ts:84-90
  fetch(`${process.env.INGESTION_URL}/api/_meta/quota/${pool}/usage_limit`, {
    method: 'PUT',
    headers: { Authorization: `Basic ...`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ org_id: '<target-org-identifier>', limit: N }),
  });
  // pool ∈ 'synthetics_browser_steps' | 'synthetics_protocol_steps' | 'ai_credits'
  // 200 body: { pool, mode, used, limit, remaining, requires_additional_credits }
  ```

- **UI navigation to the page (settings → Organization Management tab):**
  - Settings nav: `[data-test="menu-link-/settings-item"]` (`managementPage.js:14`,
    `goToManagement` pattern `managementPage.js:32-44`).
  - Org Management tab: `[data-test="organization-management-tab"]` (`index.vue:371`).
  - After navigating, **wait for the table** `[data-test="org-management-list-table"]`
    rows before interacting (the list fetch is async; the loading toast is dismissible).

## Preconditions / toggles

- No feature flag toggles required beyond the cloud gate (no `synthetics_enabled` check on
  this page). The synthetics *locations* tab is `meta && synthetics_enabled !== false`
  (`index.vue:350`) but is unrelated to the quota dialog.
- The AI-credits tab is the dialog default; the steps form only mounts after clicking a
  synthetics tab — the spec must click `org-management-set-synthetics-browser-steps-btn`
  (or `-protocol-steps-btn`) **before** asserting `synthetics-steps-limit-input`.

## Gotchas (so the Healer/Engineer don't rediscover them)

1. **`limit` is a ceiling, not an increment** (`organization.rs:230`). A test asserting
   "used went up" is wrong; assert "limit == the value I sent".
2. **Browser and protocol share the `data-test="synthetics-steps-limit-input"`** — the
   same selector resolves to two different pools depending on the active tab. Scope every
   assertion by the active tab.
3. **The org list `getData()` is async with a loading toast** — assert against the table
   only after rows render, or the quota cells read empty/absent.
4. **The dialog primary label is dynamic** ("Save Credits" vs "Save Steps"); the
   `data-test` is the stable `o-dialog-primary-btn` scoped under
   `organization-management-usage-limits-dialog`. Do not match on the label text.
5. **Deletion of orgs is not supported** in this environment (`org.spec.js:59,110`), so
   don't plan per-test org creation/cleanup; reuse an existing org and restore its quota.
6. **The endpoint is `#[cfg(feature = "cloud")]`** — an OSS backend returns 404 for the
   PUT, and the whole page is absent. The `isCloudEnvironment()` gate is mandatory.
7. **Restore-after-write**: since other parallel workers may also touch `default`'s quota,
   restore the pre-test limit in a `finally` via the PUT (idempotent), or use a
   dedicated-but-persistent child org to isolate.
