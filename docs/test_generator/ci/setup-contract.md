# Test Setup Contract: Workflows E2E Coverage (branch node, canvas actions, draft lifecycle, test drawer)

Area: **Workflows**  ·  Specs: `tests/ui-testing/playwright-tests/Workflows/{workflows-branch,workflows-canvas,workflows-lifecycle,workflows-test-dialog}.spec.js`

## Key fact up front: NO stream/data ingestion is required for these four specs

Workflows operate on **alert / incident event payloads**, not on stored streams. None of
the four specs in this slice runs a live delivery — every destination is pointed at a
stub URL (`https://example.com/wf-*`) and the Test drawer is exercised *without running*.
So there is **no `ingest` / `createStream` / `_json` precondition** to establish. The
only "data" is the workflow graph + its destination, both authored inline per test.

## Preconditions / toggles

- **Enterprise flag — the one hard precondition.** The feature is gated on the backend
  `/config` flag `workflows_enabled` (enterprise `O2_WORKFLOWS_ENABLED`). Every spec's
  `beforeEach` calls `await pm.workflowsPage.assertEnabled()` **first** — it probes
  `GET /api/{org}/workflows` once per worker and **throws** (not skips) if the build
  answers 403/404. Reference:
  - `tests/ui-testing/pages/workflowsPages/workflowsPage.js:244-272` (`isAvailable` + `assertEnabled`)
  - `tests/ui-testing/playwright-tests/Workflows/workflows-branch.spec.js:33` (and the other three specs' `beforeEach`)
  - CI shard: `ci_matrix.ent.json` `Workflows` group; `playwright.yml` pins `O2_WORKFLOWS_ENABLED=true`.

- **Auth/org**: `navigateToBase(page)` (from `utils/enhanced-baseFixtures.js`) restores the
  saved storage state `auth/user.json`; org is `default` (`getOrgIdentifier()` in
  `utils/cloud-auth.js`). Nothing else to configure.

## Workflow + destination setup (per-test, inside the test — established inline)

These specs are fully self-provisioning; each test creates and names its own artifacts
with a `wf_auto_*` prefix. Copy the exact page-object helpers below — do NOT invent setup.

| Condition needed by | Helper to call (exact) | Reference |
|---------------------|------------------------|-----------|
| A named workflow on an empty canvas with an Alert trigger | `await pm.workflowsPage.goToAdd(); await pm.workflowsPage.setName(name);` (branch) / `await pm.workflowsPage.goToAdd()` (canvas) — `goToAdd()` = `goToAddEmpty()` + `chooseTrigger('alert_fired')` | `workflowsPage.js:287-308` |
| A complete publishable graph (trigger → destination) | `buildGraph(name)` helper: `goToAdd() + setName + addNodeFromPalette('destination') + createDestinationInline({name,url:URL_STUB}) + saveNodeDrawer()` | `workflows-lifecycle.spec.js:36-42`, `workflows-test-dialog.spec.js:31-36` |
| A Branch node with drawer open | `await pm.workflowsPage.addBranchFromPalette()` | `workflowsPage.js:442-450` |
| A configured Condition node | `await pm.workflowsPage.addNodeFromPalette('condition')` then `setCondition({column,operator,value})` | `workflowsPage.js:421-435,904-912` |
| A real (custom) destination bound to a node | `await pm.workflowsPage.createDestinationInline({ name: \`wf_auto_dest_${uniq()}\`, url: 'https://example.com/wf' })` — toggles the create form (forced-type "custom", opens at step 2), fills `add-destination-name-input`/`-url-input`, submits, then waits for the select to carry `data-test-selected-value` | `workflowsPage.js:954-973` |
| Wire a Branch arm to a destination | `await pm.workflowsPage.wireArmToDestination(nth, { destName, url, existing })` | `workflowsPage.js:532-545` |

### SCOPE tags (put each in the right place)
- **`[per-test]`** — *everything*: each workflow + destination is unique (`wf_auto_*` +
  `uniq()` = timestamp+random) and created inside the test. There is no shared/read-only
  seed to reuse. A destination created in one test is not reused by another (each test
  calls `createDestinationInline` with a fresh name).

## Timing / hydration gotchas (so the Healer/Engineer don't rediscover them)

- **K10 — the list GET is slow (~16-20s).** `waitForListReady()` waits for
  `workflows-list-page` (visible) + "Loading data" (detached) with `LIST_TIMEOUT_MS = 45000`.
  After any create/save that returns to the list, or before row lookups, always go through
  `search(name)` + the row-prefix locator — never scan the full (virtualized) table.
  Reference: `workflowsPage.js:310-315,1241-1249`.
- **K9 — the editor Save/Publish buttons can be intercepted by a transient tooltip overlay**
  in headless CI. `clickSave()`/`clickPublish()`/`clickTest()` dispatch via
  `page.evaluate(btn.click)`, NOT `locator.click()`. Reference: `workflowsPage.js:353-395`.
- **Node drawer close IS save.** The node config panel is an `ODialog` with no Save button;
  `saveNodeDrawer()` clicks `o-dialog-close-btn` and waits for `workflow-node-drawer` to
  detach. `applyNodeConfig` runs on close. Reference: `workflowsPage.js:1055-1061`.
- **Node actions are hover-only.** `hoverNode(type)` must run before the delete/disable
  buttons are targeted; the rail paints only while the pointer is over the node.
  Reference: `workflowsPage.js:636-646`.
- **The palette rail is COLLAPSED by default.** `ensureNodePaletteOpen()` (clicks
  `workflow-palette-collapse-btn`) must run before palette node buttons are used.
  Reference: `workflowsPage.js:414-419`.
- **Append `+` on a Branch arm is hover-only and indexes *open* (unwired) handles.**
  Wire arms left-to-right (`wireArmToDestination(0, …)` twice) so `nth(0)` stays
  predictable. Reference: `workflowsPage.js:532-545`.
- **O2 wrapper vs inner element**: OInput/OSelect/OSwitch/OToggle put the consumer
  `data-test` on a non-interactive wrapper — fill/click the `-field` / `-trigger` /
  `-btn` child. OTable's container is `o2-table-root` (but use `workflows-list-page`
  for readiness). Reference: `workflowsPage.js:5-10`.
- **Unary condition operators remove the value input from the DOM** (`v-if`, not
  hidden) — `expectConditionValueAbsent()` asserts `toHaveCount(0)`.
  Reference: `web/src/components/alerts/FilterCondition.vue:78`.

## Cleanup (already handled — do not re-implement)

Artifacts are self-cleaning via `tests/ui-testing/playwright-tests/cleanup.spec.js`,
which sweeps by prefix: `wf_auto_dest_` / `wf_auto_` (lines 43-44), and `wf_auto_fn_`
functions / `wf_auto_stream_` / `wf_auto_sink_` streams (lines 83-84). Tests only need to
keep their own names under `wf_auto_*` — the sweep removes workflows *after* their linked
alerts (delete-protection), so a workflow linked to an alert is still cleaned up.

## If a needed precondition has no existing pattern

None in this slice: every setup step maps to an existing helper (`goToAdd`,
`addNodeFromPalette`, `addBranchFromPalette`, `createDestinationInline`,
`wireArmToDestination`, `setCondition`, `saveAsDraft`, `publishAndExpectAccepted`) and an
existing spec that uses it. The only thing that cannot be "established" in-test is the
enterprise build flag — that is a matrix/env prerequisite, surfaced by `assertEnabled()`.
