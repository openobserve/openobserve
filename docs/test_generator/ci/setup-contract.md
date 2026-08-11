# Test Setup Contract: Journey Suggestions Toolbar Chip  (area: GeneralTests)

## No data preconditions — navigation-only setup

This feature does NOT require pre-seeded streams, ingested data, API-created checks, or any server-side state. All behavior is derived locally from the journey's in-memory step list. The only setup is authentication + navigation into the Create Browser Test wizard.

---

## Auth / environment prerequisites

The test worker shares the global authentication state written by the Playwright global setup (see `tests/ui-testing/playwright-tests/utils/enhanced-baseFixtures.js:27` — `storageState: authFile`). No per-test login is needed.

- **Org**: `process.env["ORGNAME"]` — typically `"default"`. Use `navigateToBase(page)` which appends `?org_identifier=${ORGNAME}` and verifies the nav rail is visible.
- **Re-authentication**: On cloud, the shared auth token can expire. The enhanced fixtures handle re-auth automatically if `verifyAuthentication` fails.
- **Base URL**: `process.env["ZO_BASE_URL"]` + `/web/` is the SPA root.

---

## Navigation to the feature

### Path to the JourneySuggestions chip

The chip lives inside `BrowserJourney.vue` → `CreateBrowserTest.vue` → `CreateCheck.vue` → route `synthetics-add`.

**Direct URL** (no intermediate navigation needed):
```
${ZO_BASE_URL}/web/synthetics/add?type=browser&org_identifier=${ORGNAME}
```

This route:
1. Hits `CreateCheck.vue` (route `synthetics-add`) — dispatches on `?type=browser` to `CreateBrowserTest.vue`
2. `CreateBrowserTest.vue` resolves the URL → enters the editor phase → renders `BrowserJourney.vue` as the first wizard step
3. `BrowserJourney.vue` renders the toolbar with `JourneySuggestions` (gated: `v-if="!readonly"`)

### Route guard awareness

The `synthetics-add` route is registered inside `useEnterpriseRoutes.ts:186-193`, gated on `config.isCloud == "true" || config.isEnterprise == "true"` AND `store.state.zoConfig?.synthetics_enabled !== false`. In the CI environment, these flags are expected to be active (synthetics tests run in the GeneralTests group). If the route redirects home, the test page will show the main nav rail instead of the editor — the test should handle this as a prerequisite failure (the feature is not accessible in this configuration).

---

## What the test must do to trigger the chip

| Action | How | Expected result |
|--------|-----|-----------------|
| Arrive at the editor | `page.goto(syntheticsAddUrl)` | BrowserJourney renders with empty step list. No chip visible (count = 0). |
| Create a non-assert step | Click `[data-test="synthetics-journey-add-step-btn"]` | A new "click" step is appended. The suggestion chip appears with count "1". |
| Open the popover | Click `[data-test="synthetics-journey-suggestions-chip"]` | Popover opens; panel is visible. |
| Read suggestion content | Select `[data-test="synthetics-journey-suggestion-zero-assertion"]` | Title + description + action button are visible. |
| Click action | Click `[data-test="synthetics-journey-suggestion-action-zero-assertion"]` | An "assert" step is added; popover closes; chip disappears (zero-assertion resolved). |

## Timing / wait considerations

- The `CreateCheck.vue` component resolves the check type on mount (`onMounted` fetches the check type for edit mode; for create mode it resolves from `route.query.type` synchronously). This is fast — no API call in create mode.
- The `CreateBrowserTest.vue` skeleton shows briefly while the `resolvedType` is `null`. This should complete before `page.goto()` resolves.
- **Recommendation**: Wait for the `BrowserJourney` toolbar to be visible before interacting. A safe wait target is `[data-test="synthetics-journey-add-step-btn"]` (present when not recording) or the step list container.
- The popover uses `OPopover` from the O2 library. After clicking the chip, the panel renders asynchronously (teleported to the body). Wait for `[data-test="synthetics-journey-suggestions-panel"]` to be visible before asserting on its children.
- After clicking the action button, the popover closes and a new step is appended. The chip disappears because `suggestions` recomputed → empty. Wait for the chip to be hidden (`not.toBeVisible()`) rather than a fixed timeout.

## Existing patterns to copy

| Need | Pattern reference |
|------|-------------------|
| Page navigation with auth | `tests/ui-testing/playwright-tests/utils/enhanced-baseFixtures.js` — `navigateToBase(page)` function (line 134-178) |
| Direct URL navigation | `tests/ui-testing/playwright-tests/GeneralTests/landingPage.spec.js:146` — `page.goto()` with org_identifier |
| Page object pattern | `tests/ui-testing/pages/page-manager.js` — PageManager class. No synthetics page object exists yet; inline helpers in the spec are acceptable per GeneralTests conventions. |
| Test structure | `tests/ui-testing/playwright-tests/GeneralTests/landingPage.spec.js` — `test.describe` with `serial` mode, `PageManager` instantiation in `beforeEach` |
| Wait helpers | `page.waitHelpers` attached in enhanced-baseFixtures.js — use `page.waitHelpers.waitForElementVisible(selector, { timeout, description })` |

## Gotchas

1. **Synthetics routes may be enterprise-gated.** The route `synthetics-add` lives in `useEnterpriseRoutes.ts` guarded by `config.isCloud == "true" || config.isEnterprise == "true"`. If the test environment runs a vanilla OSS binary without enterprise config, the route will 404 or redirect. The test should verify prerequisite access before testing the feature.

2. **The chip requires at least one step.** An empty journey (no steps) produces no suggestions. The `zeroAssertion` producer explicitly returns `null` when `steps.length === 0`. The test must add a step first.

3. **The no-test-attribute suggestion is unreachable in UI tests.** Manual steps via "Add Step" create steps with `locator: { candidates: [] }`, which the `noTestAttribute` producer filters out entirely. This suggestion requires recorded steps (via Chrome extension) or API-created steps — neither is available in a headless UI test. Mark this behavior as `test.fixme` with a comment explaining it's reachable only through recording.

4. **Popover is teleported.** `OPopover` renders its content panel outside the component's DOM hierarchy (likely to `<body>`). Do not scope `.locator()` to a parent container when looking for `[data-test="synthetics-journey-suggestions-panel"]` — use `page.locator()`.

5. **Chip disappearance is computed, not animated.** After clicking "Add an assertion", the `onSuggestionAction` function emits `update:modelValue` → Vue reactivity recomputes `suggestions` → `count` becomes 0 → chip `v-if` is false → chip is removed from DOM. There is no transition animation. Wait for invisibility with `toBeVisible({ visible: false })` or `toBeHidden()`.

6. **No dismiss button exists.** The popover has no close button — the user must either click an action button (which closes it) or resolve the suggestion externally (which auto-closes it). If a test needs to close the popover without taking an action, it can click outside the popover (standard popover behavior) or remove the triggering condition (delete the non-assert step, add an assertion step, etc.).
