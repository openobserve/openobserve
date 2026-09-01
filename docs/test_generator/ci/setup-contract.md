# Test Setup Contract: Workflows (area: Workflows)

> Read by the **Engineer** (implements setup), the **Healer** and the **Refiner** (consult on
> data/setup failures). Scope tags tell the Engineer where each piece goes:
> `[shared/read-only]` = set up ONCE; `[per-test]` = set up inside that test, uniquely named.
>
> **Bottom line for this feature: there is NO stream/log ingestion and NO pre-existing alert or
> destination to seed.** The workflow operates on the trigger's in-memory sample payload
> (`buildTestSample` / `buildIncidentSample` in `web/src/plugins/workflows/*Sample.ts`), and the
> Destination is created **inline** inside the node config dialog. Every precondition below is
> either the enterprise flag/auth (shared) or a self-created `wf_auto_*` artifact (per-test).

## Feature enablement (the one true precondition)
- **`[shared/read-only]`** Enterprise build with `O2_WORKFLOWS_ENABLED=true` (backend flag
  `workflows_enabled`, surfaced in `/config` as `zoConfig.workflows_enabled`).
  - Enforced up-front, per worker, by `pm.workflowsPage.assertEnabled()` →
    `GET /api/{org}/workflows` must NOT return 404/403 (`workflowsPage.js:113-140`).
  - This is what turns a flipped default / dropped env / broken route into a loud failure instead
    of a selector timeout or a silent skip. Do NOT add a runtime `test.skip` — these specs are
    enterprise-only and must fail loudly when the feature is missing.

## Auth / organization
- **`[shared/read-only]`** Org identifier from `getOrgIdentifier()` —
  `tests/ui-testing/playwright-tests/utils/cloud-auth.js`. The default org is `default`
  (`process.env.ORGNAME || 'default'`).
- Navigation uses `navigateToBase(page)` then `pm.workflowsPage.goToList()` /
  `goToAdd()` / `goToAddEmpty()` which build `/web/workflows(/?add)?org_identifier=<org>`.
- Copy the auth pattern from any existing ENT spec; the Workflows specs themselves
  (`workflows-crud.spec.js:24-32`) already wire `navigateToBase` + `assertEnabled` in `beforeEach`.

## Streams / data the spec must establish
Tag each item by SCOPE so the Engineer puts it in the right place.

- **No shared stream or alert is required.** The Workflows specs in scope (`workflows-crud`,
  `workflows-negative`) only need:
  - `wf_auto_<rand>` **[per-test]** — the workflow under test (created via the UI).
  - `wf_auto_dest_<rand>` **[per-test]** — the remote HTTP destination (created INLINE in the node
    drawer; only the happy-path/NEG-06 specs create one).
  - `wf_auto_fn_<rand>` **[per-test]** — the JS function created inline by NEG-05 (invalid-code
    case is expected to FAIL creation, so no persistent function is expected there).
- The destination URL used by the happy path points at a local sink that doesn't need to resolve:
  `http://localhost:5080/api/${org}/wf_auto_sink/_json` (see `workflows-crud.spec.js:76`). NEG-06
  deliberately uses `http://127.0.0.1:1/dead` (closed port → fast connection-refused).

## How to create it (copy these EXACT patterns — do NOT invent setup)
- **Workflow + destination (happy path):** `pm.workflowsPage.buildTriggerToDestinationAndSave({ name, destName, url })`
  — see `workflowsPage.js:458-466`. It chains `goToAdd()` → `setName` → `addNodeFromPalette('destination')`
  → `createDestinationInline({name, url})` → `saveNodeDrawer()` → `publishAndExpectAccepted()` →
  `skipLinkAlerts()`.
- **Inline destination creation:** `pm.workflowsPage.createDestinationInline({name, url})` —
  `workflowsPage.js:316-332`. It toggles `destination-picker-create-toggle`, fills
  `add-destination-name-input-field` + `add-destination-url-input-field`, submits
  `add-destination-submit-btn`, then waits for the OSelect trigger to carry
  `data-test-selected-value` == the destination name (the select binds AFTER the post-create
  refetch resolves — see the gotchas).
- **Function node:** `pm.workflowsPage.addNodeFromPalette('function')` then
  `pm.workflowsPage.attemptCreateFunction({name, code})` — `workflowsPage.js:383-414`. It drives the
  real Monaco textarea (`[data-test="logs-vrl-function-editor"]`) via `MonacoEditorHelper`, waits the
  800ms `update:query` debounce, then routes through `wf-function-save-btn` → `wf-saved-function-name-input`
  → `o-dialog-primary-btn`.
- **Test dry-run:** `pm.workflowsPage.testRunFromEditor()` — `workflowsPage.js:338-345` (opens
  `workflow-test-drawer`, clicks `o-drawer-primary-btn`). Per-node results assert via
  `expectNodeTestError('destination')` / `expectNodeTestOk('workflow_trigger')`.
- **Cleanup (already handled, do NOT re-implement):** `tests/ui-testing/playwright-tests/cleanup.spec.js:71-82`
  drives `pm.apiCleanup.completeCascadeCleanup(...)` with workflowPrefixes defaulting to
  `['wf_auto_']`, plus `cleanupFunctionsInOrg(activeOrg, [/^wf_auto_fn_/, /^wf_auto_/])` and
  `cleanupStreams([/^wf_auto_stream_/, /^wf_auto_sink_/], ['default'])`. Keep every artifact
  namespaced `wf_auto_*` so the sweep finds it.

## Preconditions / toggles
- **Node palette is COLLAPSED by default** (`workflowObj.showNodePalette=false`). Open it via
  `ensureNodePaletteOpen()` (`workflowsPage.js:282-287`) before clicking palette cards.
- **New workflow shows `Save as Draft` + `Publish`** (not the single `Save` button — that only
  renders for an already-published workflow). The page object's `saveAndCaptureResult()` uses
  `clickPublish()` (`workflow-editor-publish`).
- **Non-SQL / quick-mode state is irrelevant here** — no logs query surface is touched.

## Gotchas (so the Healer/Engineer don't rediscover them)
- **K10 — list GET is slow (~16–20s live).** Readiness waits on `workflows-list-page` (the page
  container, OTable-version-agnostic), NOT an OTable internal like `o2-table-root`. Row lookup uses
  filter-then-wait (`isPresent`/`openEdit` call `search(name)` first because the table is virtualized).
  Use the page object's 45s `LIST_TIMEOUT_MS`, not a shorter default.
- **K9 — Save tooltip interception.** The editor Save/Publish has no tooltip of its own, but a
  transient/adjacent overlay can swallow a plain Playwright `.click()`. The page object bypasses it
  with `evaluate(() => el.click())` (`clickSave`/`clickPublish`). Interception is NON-deterministic
  in headless CI → `normalSaveClickIsIntercepted()` is an informational canary, never a hard assert.
- **Destination select binds ASYNC after inline create.** `onDestinationCreated` only STAGES the name
  (`pendingSelection`); the OSelect binds after the refetch resolves. Waiting for the create toggle to
  flip back races (the drawer can close first → empty `destination_id` → Publish rejects with
  "1 step needs setup"). Wait for `data-test-selected-value` on `destination-picker-select-trigger`
  instead (`workflowsPage.js:330-331`).
- **O2 component data-test lands on a NON-interactive wrapper.** `OInput`/`OSelect`/`OTable` put the
  consumer's `data-test` on a `<div>`; the fillable `<input>` is `<name>-field`, the select trigger is
  `-trigger`, the switch click target is `-btn`. Always target the inner element for `fill()`/`click()`
  (documented at the top of `workflowsPage.js`).
- **Function editor save is debounced.** `AddFunction` only updates its model after a 500ms
  `update:query` debounce; the page object waits 800ms before clicking save, else the untouched seed
  template is what gets saved and an invalid-code test silently asserts nothing.
- **Trigger-only / empty-name validation fires via Publish, not Save.** The warning toast renders
  `[role="alert"]` (`.q-notification__message` is a legacy fallback). Exact copy: "Add At Least One
  Step After The Trigger" (`workflow.addStepRequired`) and "Name Is Required" (`workflow.nameRequired`).
- **No `goToAdd` without a trigger.** `goToAdd()` chooses the alert trigger via the empty-canvas start
  card; `goToAddEmpty()` leaves the untouched two-slot scaffold for specs that need it.
