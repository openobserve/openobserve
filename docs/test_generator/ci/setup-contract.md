# Test Setup Contract: Synthetics Extension Setup Checklist (area: Synthetics)

## Streams / data the spec must establish

**No streams or ingestion data are needed for this feature.** The Extension Setup Checklist is a pure UI component that gates on a Chrome extension connection probe. No OpenObserve backend data (streams, logs, metrics) is consumed or required.

## How to access the feature

The feature lives inside two host contexts — the tests must reach one of them:

1. **CreateBrowserTest page — `extension-setup` phase** (direct checklist in the page body)
   - URL: `{baseURL}/web/synthetics/add?org_identifier={org}&type=browser&url=https://example.com&name=TestCheck&setup=1`
   - This is the primary test surface: a full-page checklist embedded in the CreateBrowserTest wizard, reached by clicking "Record Journey" on the gate page when the browser extension is not installed.
   - Route name: `synthetics-add` via `useEnterpriseRoutes.ts:189`
   - Component: `CreateBrowserTest.vue` (phase `extension-setup`, lines 966-1019)

2. **ExtensionSetupDialog** (checklist inside a modal dialog)
   - Opened by clicking Record or Replay in `BrowserJourney.vue` when `extensionReady` is `false`
   - The dialog wraps `ExtensionSetupChecklist` and adds a Continue footer + progress badge.
   - Route: appears as a dialog overlay while on the Journey step of the create/edit wizard.

**Precondition for both**: The Chrome Recorder extension must NOT be installed/connected (otherwise the setup UI is skipped entirely). In an E2E environment this is the natural state — the extension is never available.

## How to create the access state (copy these EXACT patterns)

### Navigate to CreateBrowserTest gate → enter URL → click Record Journey

The `extension-setup` phase is the most self-contained surface because it lives in the page body (not in a dialog that requires first loading the Journey step). The setup query param puts the wizard directly into this phase:

```
await page.goto(`${baseURL}/web/synthetics/add?org_identifier=${orgId}&type=browser&url=https://example.com&name=TestCheck&setup=1`);
await page.waitForLoadState('networkidle');
```

On mount, `CreateBrowserTest.vue:onMounted` fires `probeExtension()` which returns `false` (no extension), setting `extensionReady = false`. The `onRecordClick` handler has already committed the gate and written the `setup` query param. The `route.query[SETUP_QUERY_PARAM] === "1"` check (line 395) re-enters the `extension-setup` phase directly.

If the developer-written deep-link approach above does not work (the auth guard or store hydration may interfere), the fallback is to navigate programmatically through the full gate flow:
1. Navigate to `/web/synthetics/add?org_identifier={orgId}&type=browser`
2. Fill `[data-test="synthetics-create-url-input"]` with a URL
3. Fill `[data-test="synthetics-create-name-input"]` with a name
4. Click `[data-test="synthetics-create-record-btn"]`
5. The `probeExtension()` check fails → the wizard enters the `extension-setup` phase.

### Navigate to the ExtensionSetupDialog (modal)

For tests of the dialog variant:
1. Navigate to the editor phase (gate → extension-setup → skip → editor, or directly via `?type=browser&url=...&name=...` with extension installed mock)
2. In the Journey step, click `[data-test="synthetics-journey-record-btn"]` when `extensionReady` is false → the dialog opens.

**Gotcha**: Since `extensionReady` is always `false` in E2E (no Chrome extension), the Record/Replay buttons will always open the dialog. But first you must reach the Journey step, which means navigating past the extension-setup phase (via Skip link: `[data-test="synthetics-setup-skip-link"]` in the direct checklist, or `[data-test="synthetics-setup-dialog-skip"]` in the dialog).

## Auth / Organization

- **`[shared/read-only]`** — No special org setup is needed. The test uses the standard authenticated session (provided by `global-setup.js` with saved auth state). The org comes from `store.state.selectedOrganization.identifier`.
- **Pattern**: Same as `landingPage.spec.js:70` — `const logsUrl = \`\${logData.logsUrl}?org_identifier=\${getOrgIdentifier()}\`;` — the org is read from the same auth context.

## Preconditions / toggles

- **Extension NOT installed**: This is the default in CI — no Chrome Recorder extension is loaded. The `useSyntheticsRecorder.detectExtension()` call always returns `false`. No mocking is needed.
- **No `zoConfig.synthetics_recorder_extension_url` in store**: If missing, the Web Store button falls back to `CHROME_WEB_STORE_URL` (line 51 of ExtensionSetupChecklist.vue). Tests should not depend on this config being set.

## Gotchas (so the Healer/Engineer don't rediscover them)

1. **The extension probe is asynchronous**: `probeExtension()` runs on mount and takes ~500ms (the bridge probe settle time). If the test navigates too fast and checks for checklist elements, the phase guard may still be resolving. Wait for a checklist selector to be visible before asserting.

2. **`connected` (= `extensionReady`) is ALWAYS false in E2E**: There is no Chrome Recorder extension loaded in CI browsers, so:
   - Task 1 (Install) will NEVER auto-complete via detection — only via the `installAck` checkbox
   - Task 3 (Connect) will NEVER reach "done" state — it stays in the waiting (spinner) state
   - The Continue/Record button will NEVER enable (it requires `connected && incognitoDone`)
   - The Skip link (`[data-test="synthetics-setup-skip-link"]`) is the only way to exit the checklist

3. **Task 2 (Incognito) is locked until Task 1 completes**: The `v-if="!installDone"` guard on Task 2 means the test must first check the `[data-test="synthetics-setup-install-ack"]` checkbox before the incognito controls become interactive. The lock state renders with `opacity-60` and a lock icon.

4. **The "refresh page" button in Task 3 actually navigates away**: `[data-test="synthetics-setup-refresh-btn"]` calls `refreshPage()` which strips the `setup` query param and does `window.location.replace()`. This will navigate the test page away — don't click it unless the test handles the navigation.

5. **No existing Synthetics page objects or test helpers exist**: This is the first Synthetics E2E test. There is no `syntheticsPage.js`, no Synthetics test data, and no `tests/ui-testing/playwright-tests/Synthetics/` directory. The spec file itself will need to inline all selectors and helpers.

6. **The dialog variant lives inside BrowserJourney which lives inside OStepper**: To reach the ExtensionSetupDialog, the test must first get past the gate AND the extension-setup phase (by clicking Skip), then the Journey step renders with BrowserJourney, and only then does clicking Record open the dialog.
