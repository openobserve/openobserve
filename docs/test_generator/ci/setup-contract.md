# Test Setup Contract: Clone Composite Alerts  (area: Alerts)

> Concrete data + exact helper references for `alerts-composite-clone.spec.js`.
> Everything below already exists in the repo — do NOT invent a setup.

## Streams / data the spec must establish

Tag each item by SCOPE so the Engineer puts it in the right place:
- **`[shared/read-only]`** — every test just READS it the same way → set up ONCE / use a pre-seeded stream.
- **`[per-test]`** — only one test needs it, or a test MUTATES it → set up INSIDE that test, uniquely named.

- `alerts_p0_stream` **[shared/read-only]** — fields: `city` (group key), `latency`, `status`.
  Why: `simpleAlert()` (the child-alert fixture) references this stream by name; the child alert
  only needs the stream to exist so the list/creation API accepts it. No special field beyond
  `city`/`latency` is required for CLONE (clone is id-based, not query-based).
  → Established by `seedAlertFixtures(page)` in the shared `beforeEach` (see below).

- Child alert `<uniq('composite_clone_child')>` **[per-test]** — a `simpleAlert(name)` created via
  `createAlert(page, payload)` (POST `/api/v2/{org}/alerts?folder=default`).
  Why: a composite references at least one child id; the composite fixture needs a stable child id.

- Composite alert `<uniq('composite_clone')>` **[per-test]** — `compositeAlert(name, [childId])`
  created via `createAlert(page, payload)`. This is the ROW whose clone button the test clicks.
  Why: the feature under test clones a composite. `enabled` defaults `false` in `compositeAlert`
  (irrelevant to clone; clone does not require the source to be enabled).

- (Implicit) cloned composite `<source name> - Copy` — created BY the feature under test, not the
  fixture. Assert its existence via `findAlertId(page, cloneName)` and/or its row selectors.

## How to create it (copy these EXACT patterns — do NOT invent setup)

- Ingest/seed stream + dogfood destination + template (shared, once per test):
  `await seedAlertFixtures(page);`
  → defined at `tests/ui-testing/playwright-tests/utils/alerts-api-helpers.js:156`.
  It POSTs: template `auto_p0_tmpl`, destination `auto_p0_dest` (self-call to this instance's
  `alerts_notify_sink`), and 3 rows into `alerts_p0_stream`.

- Build child alert:
  ```js
  const { simpleAlert, createAlert, findAlertId } = require('../utils/alerts-api-helpers.js');
  const payload = simpleAlert(name);
  const response = await createAlert(page, payload);
  expect(response.status(), await response.text()).toBe(200);
  const childId = await findAlertId(page, name);
  ```
  → EXACT reference: `tests/ui-testing/playwright-tests/Alerts/alerts-composite-ui.spec.js:47-53`
  (the `createChild` helper inside that spec).

- Build composite alert:
  ```js
  const { compositeAlert, createAlert } = require('../utils/alerts-api-helpers.js');
  const response = await createAlert(page, compositeAlert(name, [childId]));
  expect(response.status(), await response.text()).toBe(200);
  const compositeId = await findAlertId(page, name);
  ```
  → EXACT reference: `tests/ui-testing/playwright-tests/Alerts/alerts-composite-ui.spec.js:40-52`
  (`createCompositeFixture`) and payload shape at `alerts-api-helpers.js:97-116`.

- Cleanup (afterEach, reverse order — delete composite BEFORE its children):
  `await deleteAlerts(page, [...created].reverse());`
  → `alerts-api-helpers.js:141-146`.

- Auth/org: `<ORGNAME=default>`; `getOrgIdentifier()` / `getAuthHeaders()` from
  `tests/ui-testing/playwright-tests/utils/cloud-auth.js`. The worker auth state / `navigateToBase`
  pattern is in `tests/ui-testing/playwright-tests/utils/enhanced-baseFixtures.js` (import
  `{ test, expect, navigateToBase }`). Use `pm = new PageManager(page)` from
  `tests/ui-testing/pages/page-manager.js`.

- Navigation: `await navigateToBase(page);` then navigate to the alerts list (either via left-rail
  `[data-test="menu-link-\/alerts-item"]` or `page.goto('/web/alerts?org_identifier=...&folder=default')`).

## Preconditions / toggles
- Composite filter tab: click `[data-test="alert-list-tab-composite"]` (the toolbar toggle), NOT
  `[data-test="tab-composite"]` (that selector is stale — see gotchas). This filters the table to
  composite rows so the clone button for the fixture row is the visible/unique one.
- No SQL-mode / quick-mode toggle applies to this feature.
- The `Add` button disabled state (`!destinations.length || !templates.length`) does NOT gate the
  clone button; but `seedAlertFixtures` is still required so child/composite creation succeeds.

## Gotchas (so the Healer/Engineer don't rediscover them)

1. **Stale tab selector.** `compositeAlertsPage.listCompositeTab` uses `[data-test="tab-composite"]`,
   which does NOT exist in `AlertList.vue`. The real toolbar toggle is
   `[data-test="alert-list-tab-composite"]`. Do not copy the stale page-object locator.
2. **Composite clone dialog has NO stream selects.** `to-be-clone-stream-type` and
   `to-be-clone-stream-name` are behind `v-if="!toBeClonedIsComposite"` and therefore ABSENT for
   composite. A test that tries to fill them will time out. The only inputs are name + folder.
3. **Folder picker selector is shared with the move dialog.** `alerts-index-dropdown-stream_type`
   is `SelectFolderDropDown` (`type="alerts"`). Scope it to the clone dialog container
   (`[data-test="alert-list-form-dialog"]`) if a move dialog can also be present.
4. **Success toast is strict-mode-fragile.** OToast renders the message across multiple nodes;
   scope assertions to `[data-test="o-toast-message"]` and `.filter({ hasText: 'Alert Cloned Successfully' })`
   (see `alertManagement.js:89-93`).
5. **Composite clone success refreshes into the TARGET folder.** After clone, `activeFolderId` is
   set to `folderIdToBeCloned`. If the test cloned into a different folder, assert the list now shows
   that folder (or verify via API `findAlertId` instead of relying on row visibility).
6. **Regular `cloneAlert` helper is NOT for composite.** `alertManagement.cloneAlert(alertName,
   streamType, streamName)` fills stream type/name — wrong for composite. Add a dedicated
   `cloneCompositeAlert(alertName, { newName, folder })` helper (fills only name + folder).
7. **Cleanup order matters.** A composite references its child; delete the composite first
   (`[...created].reverse()` in `alerts-composite-ui.spec.js` already does this).
8. **Source composite may be `enabled: false`.** Clone does not require an enabled source; do not
   assert on run/outcome state — only on badge, child count, and name.
