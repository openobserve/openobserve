# Test Setup Contract: Composite Alert Clone  (area: Alerts)

## Streams / data the spec must establish

Tag each item by SCOPE so the Engineer puts it in the right place:
- **`[shared/read-only]`** — every test just READS it the same way → set up ONCE per worker (idempotent).
- **`[per-test]`** — only one test needs it, or a test MUTATES it → set up INSIDE that test, uniquely named.

### Shared fixtures (idempotent, once per worker)
- **`alerts_p0_stream`** `[shared/read-only]` — logs stream with `city` + `latency` fields.
  Why: the **simple child alerts** reference it via `stream_name: STREAM`; the composite itself
  does not touch the stream, but its children must be valid scheduled alerts. Seeded by
  `seedAlertFixtures(page)` which ingests 3 rows (`bangalore/mumbai/delhi`).
- **`auto_p0_dest`** destination + **`auto_p0_tmpl`** template `[shared/read-only]` — the dogfood
  notification sink every child/composite references via `destinations: [DEST]`. Seeded by the
  same `seedAlertFixtures(page)` (create-if-absent + update).

### Per-test fixtures
- **N simple child alerts** `[per-test]` — created via `createAlert(page, simpleAlert(uniq('composite_clone_child_x')))`.
  Each is a scheduled (`is_real_time: false`) alert on `alerts_p0_stream`.
- **1 composite source alert** `[per-test]` — created via
  `createAlert(page, compositeAlert(name, [childA.id, childB.id]))`; expression
  `{childA} && {childB}`, `enabled: false`.
- **Optional target folder** `[per-test: cross-folder test]` — `createAlertFolder(page, uniq('clone_target'))`.

Cleanup (in `afterEach`): delete created alerts by id+folder (reverse order, composite before
children) then created folders. The spec's `created`/`createdFolders` arrays track this.

## How to create it (copy these EXACT patterns — do NOT invent setup)

- Ingest + destination/template seed: `await seedAlertFixtures(page)` — see
  `tests/ui-testing/playwright-tests/utils/alerts-api-helpers.js:299`; called in the spec's
  `beforeEach` at `alerts-14306-composite-clone.spec.js:40`.
- Simple child: `createAlert(page, simpleAlert(name))` then `findAlertId(page, name)` — see
  `alerts-api-helpers.js:39` (payload), `:120` (create), `:190` (find); spec `createChild` at
  `alerts-14306-composite-clone.spec.js:53-60`.
- Composite: `createAlert(page, compositeAlert(name, childIds))` then `findAlertId(page, name)` —
  see `alerts-api-helpers.js:97` (payload), spec `createCompositeFixture` at
  `alerts-14306-composite-clone.spec.js:62-73`.
- Folder: `createAlertFolder(page, uniq('clone_target'))` — `alerts-api-helpers.js:324`.
- Auth/org: `getOrgIdentifier()` / `getAuthHeaders()` from `cloud-auth.js`; navigate with
  `logData.alertUrl?org_identifier=...&folder=default` then `navigateToBase(page)`.
- Timing: after switching to the Composite tab, wait for the list refetch (the page object's
  `openListTab` already waits on `/api/v2/{org}/alerts?` 200). Assert `listBadge(id)` /
  `listChildCount(id)` only AFTER that refetch.

## Preconditions / toggles

- Open the **Composite** tab, not the default list: `pm.compositeAlertsPage.openCompositeTab()`
  (clicks `alert-list-tab-composite` and waits for the refetch; asserts `data-state="on"`).
- Composite clone does **not** require stream type/name — the dialog hides those selects. Do NOT
  attempt to fill `to-be-clone-stream-type`/`-name` for a composite clone.
- The clone is always created **disabled** — never assert `enabled` on the clone.
- SLO rows have clone disabled; these specs create only `composite` + `scheduled` alerts, so no
  SLO row is involved.

## Gotchas (so the Healer/Engineer don't rediscover them)

- **Deleting a referenced child is refused (409 `child_referenced`).** The
  "should clone a composite whose child alert was deleted" test calls
  `deleteAlertInFolder(page, child.id, 'default')`, but that helper swallows the 409
  (`alerts-api-helpers.js:233`), so the child is NOT actually deleted and the clone succeeds
  trivially. Do not "fix" this test by forcing the delete through — the backend genuinely blocks
  it, and a genuinely-missing child is rejected by `resolve_children`
  (`src/core/src/alerts/composite/service.rs:462-466`). Treat the true "stale child" scenario as a
  parked `fixme` (UNWIRED), not a green path.
- **OInput renders a `-field` suffix.** The name input's real node is
  `[data-test="to-be-clone-alert-name-field"]`, not `[data-test="to-be-clone-alert-name"]`
  (the latter is the wrapper; Playwright cannot fill a div). The page object already maps this.
- **Folder picker selector** is `[data-test="alerts-index-dropdown-stream_type"]` (prefix from
  `type="alerts"` in SelectFolderDropDown). Options resolve to
  `[data-test="alerts-index-dropdown-stream_type-option"][data-test-value="{folderId}"]`.
- **Success toast text is exactly "Alert Cloned Successfully"** (`toastMessages.alerts.alertClonedSuccessfully`),
  matched by `compositeAlertsPage.expectCloneSuccessToast()`.
- **Cross-folder lookup** uses `findAlertIdInFolder(page, name, folderId)` (folder-scoped list),
  and asserts absence with `findAlertId(page, name)` (default-folder list) returning `undefined`.
