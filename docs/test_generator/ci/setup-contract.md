# Test Setup Contract: Pipeline Destination Editor  (area: Alerts)

## Streams / data the spec must establish
Pipeline destinations are HTTP config objects (no stream/ingestion required). Each test operates on
the destination **list** for the org. Establish destinations by name via UI or API (module=pipeline).

Tag each item by SCOPE so the Engineer puts it in the right place:
- **`[shared/read-only]`** — every test just READS it the same way → set up ONCE / use a pre-seeded destination.
- **`[per-test]`** — only one test needs it, or a test MUTATES it → set up INSIDE that test, uniquely named.

- `<destination-name>` **[per-test]** — created via UI in the add flow. Fields: `name`, `url`,
  `destination_type`, `method`, `output_format`, `headers`, optional `metadata`. Why: the create
  workflow itself is the test, so each test seeds its own uniquely-named destination
  (`destination${random}` — see `pipelineImport.spec.js:126`).
- `<destination-name>` **[per-test: TC edit/delete/bulk]** — one or more destinations created (via UI
  or API) before the test so the edit/delete/bulk-delete actions have a target. Why: edit/delete/bulk
  delete need an existing row; create it in the same test with a unique name to avoid cross-test
  collisions (list is org-wide and parallel files mutate it — see `pipelinesFormValidationPage.js:468`).

> The list endpoint is scoped `module=pipeline`, so a destination created WITHOUT `?module=pipeline`
> (i.e. a plain alert destination) will NOT appear in this list. Always create pipeline destinations
> with `module=pipeline`.

## How to create it (copy these EXACT patterns — do NOT invent setup)

- **Auth/org:** reuse the stored auth state file
  (`tests/ui-testing/playwright-tests/utils/auth/user.json`) — see `pipelineImport.spec.js:12-18`
  (`test.use({ storageState: authFile })`). Org = `process.env["ORGNAME"]` (default `default`).

- **Navigate (menu):** `navigateToManagement()` → `navigateToPipelineDestinations()` in
  `tests/ui-testing/pages/pipelinesPages/pipelineDestinations.js:12-24`
  (clicks `[data-test="menu-link-/settings-item"]` then `button[data-test="pipeline-destinations-tab"]`).

- **Navigate (direct URL):** `page.goto('${ZO_BASE_URL}/web/settings/pipeline_destinations?action=add&org_identifier=${ORGNAME}')`
  — see `pipelinesFormValidationPage.js:428-436`. Passing `?action=add` auto-opens the editor
  (`updateRoute` → `editDestination(null)`), `?action=update&name=<name>` auto-opens edit.

- **Create via UI:** `PipelineDestinations.addDestination(name, url)` in
  `tests/ui-testing/pages/pipelinesPages/pipelineDestinations.js:26-42`. Canonical flow: add button →
  type card (`destination-type-card-openobserve`) → `step1-continue-btn` → fill
  `add-destination-name-input-field` + `add-destination-url-input-field` (use `{ force: true }`,
  `attached` wait) → `add-destination-submit-btn`.

- **Create/seed via API:** `POST /api/{org}/alerts/destinations?module=pipeline` with the destination
  payload (name, url, method, output_format, destination_type_name, headers, template:""). Reference
  patterns: `tests/ui-testing/playwright-tests/utils/api-helper.js:101` (createDestination) and the
  inline `page.request.post` in `alerts-content-templates.spec.js:252`.

- **List via API (assert/verify):** `GET /api/{org}/alerts/destinations?page_num=1&page_size=100000&sort_by=name&desc=false&module=pipeline`
  — see `apiCleanup.js:1522-1543` (`fetchPipelineDestinations`).

- **Delete via API (cleanup):** `DELETE /api/{org}/alerts/destinations/{name}` — see
  `apiCleanup.js:1550-1566` (`deletePipelineDestination`) and `cleanupPipelineDestinations` (:1572).

- **Bulk delete endpoint:** `DELETE /api/{org}/alerts/destinations/bulk` body `{ ids: [names] }` →
  response `{ successful:[], unsuccessful:[], err }` (confirmed `destinations.rs:553-573`).

- **Timing:** after save, the list reloads via `getDestinations()` (a network round-trip). Wait for
  the row/selector (e.g. `alert-destination-list-<name>-update-destination`) rather than a fixed
  sleep, or use the existing `verifyDestinationAdded()` (waits on the add button) before asserting rows.

## Preconditions / toggles
- **Enterprise/Cloud build required.** Route `pipelineDestinations` is registered only when
  `config.isEnterprise == "true"` (`useManagementRoutes.ts:141`); the settings tab is `visible: isEnt`
  (`settings/index.vue:265`). Tag the spec `@enterprise` (or positively probe for the tab and
  `test.skip` on OSS) — mirror `pipelineImport.spec.js:20` and the `homePage.js:805-813`
  `navigateToPipelineDestinations()` boolean probe.
- Org identifier must be passed in the query (`org_identifier`), matching the running org.

## Gotchas (so the Healer/Engineer don't rediscover them)
- **Search input has no `data-test`** — `OSearchInput` in the list toolbar is unstyled of selectors;
  the existing `pipelinesPage.js:219` selector `[data-test="destination-list-search-input"]` is STALE
  (does not exist). Add a `data-test` to the component or locate by placeholder/role.
- **List is `module=pipeline` scoped** — a plain alert destination (no module) won't show; always use
  `?module=pipeline` when seeding via API.
- **Name is immutable in edit mode** — `add-destination-name-input` is `readonly`+`disabled`; don't
  attempt to rename in the update test.
- **OFormInput native inputs use `-field` suffix** and may need `attached` + `force` to fill
  (`pipelineDestinations.js:33-39`).
- **Splunk metadata is NOT required at save** — the schema (`CreateDestinationForm.schema.ts`)
  requires only Datadog `ddsource`/`ddtags`, not Splunk fields; `canProceedStep2` is stricter but
  unused for the submit gate.
- **Parallel-file list mutation** — the destination list is org-wide; other parallel specs mutate it,
  so always use unique names and re-locate rows by name (don't assume row indices).
- **Route `?action` watcher** — clearing `action` (cancel/back) sets `showDestinationEditor=false`;
  a stale `getDestinations().then()` won't re-open the editor thanks to the guard in `updateRoute`
  (`PipelinesDestinationList.vue:382`).
