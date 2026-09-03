# Test Setup Contract: Workflows Live Test Dispatch (area: Workflows)

Spec under test: `tests/ui-testing/playwright-tests/Workflows/workflows-delivery.spec.js`
(spec group `Workflows`, enterprise-gated — must run where `O2_WORKFLOWS_ENABLED=true`; the page
object's `assertEnabled()` fails loudly otherwise).

## Streams / data the spec must establish

Tag each item by SCOPE so the Engineer puts it in the right place:
- **`[shared/read-only]`** — set up ONCE / pre-seeded, every test just READS it.
- **`[per-test]`** — only one test needs it, or the test MUTATES it → set up INSIDE that test, uniquely named.

- `wf_auto_del_<id>` **workflow** **[per-test]** — node graph: `workflow_trigger` (`alert_fired`)
  → `destination` (remote, forced-type `custom`). Why: DEL-01/DEL-02 run the whole graph and
  assert the destination + trigger both pass (`expectNodeTestPassed`).
- `wf_auto_dest_<id>` **destination** **[per-test]** — a remote/custom destination created
  INLINE inside the Destination node drawer, with URL = the self-ingest sink and an
  `Authorization: Basic <b64>` header. Why: the live dispatch must deliver to a reachable,
  authenticated endpoint.
- `wf_auto_sink_<id>` **stream** **[per-test, auto-created]** — the sink target. It is created
  IMPLICITLY by OpenObserve on the destination's `/_json` POST (streams auto-create on ingest).
  No explicit `createStream` step is required. Why: DEL-02 asserts the delivered payload was
  actually ingested (`status[0].successful > 0`, `failed === 0`).

Nothing is shared/read-only: every artifact is uniquely namespaced per test and swept by
`cleanup.spec.js` (prefixes `wf_auto_*` / `wf_auto_sink_*`).

## How to create it (copy these EXACT patterns — do NOT invent setup)

- **Build + publish the workflow + destination in one call**:
  `await pm.workflowsPage.buildTriggerToDestinationAndSave({ name, destName, url, headers })`
  — see `tests/ui-testing/pages/workflowsPages/workflowsPage.js:736-744` and its live use at
  `tests/ui-testing/playwright-tests/Workflows/workflows-delivery.spec.js:61-66`.
  It does: `goToAdd('alert_fired')` → `setName` → `addNodeFromPalette('destination')` →
  `createDestinationInline` → `saveNodeDrawer` → `publishAndExpectAccepted` → `skipLinkAlerts`.
- **Self-ingest sink URL / auth** — copy from the spec (`workflows-delivery.spec.js:30-38`):
  ```js
  const orgId = () => process.env.ORGNAME || 'default';
  const sinkStream = (id) => `wf_auto_sink_${id}`;
  const sinkUrl = (id) => `${process.env.ZO_BASE_URL}/api/${orgId()}/${sinkStream(id)}/_json`;
  const basicAuth = () => 'Basic ' + Buffer.from(
    `${process.env.ZO_ROOT_USER_EMAIL}:${process.env.ZO_ROOT_USER_PASSWORD}`).toString('base64');
  ```
  Pass `headers: { Authorization: basicAuth() }` to `buildTriggerToDestinationAndSave`.
- **Re-open the published workflow before testing** (published workflows paint the
  *rehearsal* badge, and the run needs `workflowObj.currentSelectedWorkflow.isDraft === false`):
  ```js
  await pm.workflowsPage.goToList();
  await pm.workflowsPage.openEdit(name);   // workflowPage.js:770-777
  ```
- **Run the live test** — `await pm.workflowsPage.testRunFromEditor({ liveSend: true })`
  (`workflowsPage.js:537-550`). It clicks `workflow-editor-test`, waits for
  `workflow-test-drawer`, flips the suppress switch OFF only if `aria-checked === 'true'`
  (targets `workflow-test-suppress-destinations-btn`), then clicks the ODrawer primary
  (`workflow-test-drawer [data-test="o-drawer-primary-btn"]`).
- **Auth / org**: worker auth state via `navigateToBase(page)` in `beforeEach` (the
  `enhanced-baseFixtures.js` pattern); `ORGNAME` defaults to `default`. `assertEnabled()` runs
  once per worker (`workflowsPage.js:191-199`).

## Preconditions / toggles

- The Destination node MUST be configured (a real `destination_id`), otherwise the node is
  `meta.incomplete` and its badge reads `skipped`, not `passed` (`useWorkflowCanvas.ts:1307`,
  `WorkflowNode.vue:353`). `createDestinationInline` waits for the bound value
  (`data-test-selected-value === name`) before closing — see `workflowsPage.js:529-530`.
- `liveSend: true` must actually flip the suppress switch. The switch is OFF by default
  (`suppressDestinations !== false` → `true`, `WorkflowTestDialog.vue:299-302`); the toggle is
  the ONLY path to a real dispatch. Asserting `expectNodeTestPassed('destination')` WITHOUT
  live send would only prove a suppressed rehearsal.

## Assertions (timing + shape)

- Pass badge: `await pm.workflowsPage.expectNodeTestPassed('destination')` (and
  `'workflow_trigger'`) — matches `-test-ok` OR `-test-rehearsal` (`workflowsPage.js:608-611`).
  Use `expectNodeTestPassed`, NOT `expectNodeTestOk` (green-✓ only) — a published workflow
  renders the flask.
- Delivery receipt: `await pm.workflowsPage.destinationIngestReceipt()`
  (`workflowsPage.js:594-599`) → `{ code, status:[{ name, successful, failed }] }`. It clicks the
  destination node, opens the NDV, reads `workflow-ndv-output` via `window.monaco`. Assert
  `status[0].name === sinkStream(id)`, `successful > 0`, `failed === 0` (`workflows-delivery.spec.js:93-98`).
- Error badge (dead URL): `await pm.workflowsPage.expectNodeTestError('destination')`
  (`workflowsPage.js:554-557`, 60s timeout) — used by NEG-06.

## Gotchas (so the Healer/Engineer don't rediscover them)

- **OSwitch selector**: the consumer `data-test="workflow-test-suppress-destinations"` lands on
  a NON-interactive wrapper; the clickable element is `-btn`
  (`workflow-test-suppress-destinations-btn`). Read state via `aria-checked`, not `checked`.
  (`OSwitch.vue:117`.)
- **OBanner selector**: `data-test="workflow-test-dispatch-warning"` is consumed as OBanner's
  `dataTest` PROP and re-emitted onto the banner root `<div>` — it IS a real DOM `data-test`,
  safe to assert (`OBanner.vue:32,116`; camelCase prop → kebab attr matching).
- **Rehearsal vs ✓**: a published workflow's pass is `-test-rehearsal` (flask), never
  `-test-ok`. The delivery spec correctly uses `expectNodeTestPassed` for both nodes.
- **Destination output is nested**: node output = array of JSON strings (one per send). Two
  `JSON.parse` calls are needed — `destinationIngestReceipt()` already handles it; do NOT regex
  the escaped text.
- **K10 list slowness** (~16–20s live): `openEdit` filters by name then waits (45s list
  timeout); don't scan the virtualized table unfiltered.
- **K9 Save/Publish tooltip interception**: `clickPublish`/`clickSave` use JS `.click()` via
  `evaluate()` to bypass a transient overlay (`workflowsPage.js:281-295`); the delivery spec
  relies on `buildTriggerToDestinationAndSave` → `publishAndExpectAccepted`, which uses that path.
- **Suppressed run ≠ delivery**: default suppression returns the `{"suppressed": true, ...}`
  preview as the destination output and creates NO sink stream. Only `liveSend: true` exercises
  real dispatch (the DEL-* headline).
- **Run-from defaults to the beginning**; upstream nodes get no badge when a middle node is
  chosen. Delivery tests don't set a run-from, so both trigger and destination are reachable.
