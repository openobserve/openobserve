# Test Setup Contract: Alert Template Link URL Validation  (area: Alerts)

## Streams / data the spec must establish
**NONE required.** This feature operates entirely within the alert template editor UI.
No streams, ingestion, or pre-existing data are needed — the link URL validator
(`linkUrlBadScheme`) is a pure function with no dependencies on backend state.

The only prerequisite is an authenticated session + access to the alert templates
page (`/web/alert-templates?org_identifier=<default>`).

## How to create it (copy these EXACT patterns — do NOT invent setup)

### Navigation
```js
// Navigate directly via URL (fastest, most reliable)
const baseUrl = process.env.ZO_BASE_URL || 'http://localhost:5080';
const org = process.env.ORGNAME || 'default';
await page.goto(`${baseUrl}/web/alert-templates?org_identifier=${org}`, { waitUntil: 'domcontentloaded' });

// Then click the "Add Template" button
await pm.alertTemplatesPage.clickAddTemplateBtn();
// Wait for the add-template form to render
await pm.alertsPage.getAddTemplateModeTabs().waitFor({ state: 'visible', timeout: 10000 });
```
Reference: `tests/ui-testing/playwright-tests/Alerts/alerts-content-templates.spec.js:104-112`

### Auth / org
ORGNAME=default (standard OSS test org). The worker auth state / login pattern from
`tests/ui-testing/playwright-tests/Alerts/alerts-content-templates.spec.js:104`.

### Page Manager
```js
const pm = new PageManager(page);
```
The `PageManager` (`tests/ui-testing/pages/page-manager.js`) wires up all page objects.
Its `alertsPage` property provides the selectors below.

## Preconditions / toggles

1. **Editor mode MUST be "content"** — the Link URL validation applies only to
   content-kind templates. A brand-new template defaults to "content" mode, so
   no explicit mode switch is needed for new-template tests. If testing against
   an existing template, verify `editorMode === 'content'` via the mode tabs.

2. **"Add to this template" disclosable MUST be open** — the Links section lives
   inside `content-template-form-optional-collapsible`, which starts CLOSED for
   a freshly seeded new template (because `isSeeded=true`, making
   `hasOptionalContentInitially` false). Open it before interacting with links:
   ```js
   const optionalDisclosure = pm.alertsPage.getContentTemplateOptionalCollapsible();
   if ((await optionalDisclosure.getAttribute('data-state')) !== 'open') {
     await optionalDisclosure.click();
     await page.waitForTimeout(300);
   }
   ```
   Reference: `tests/ui-testing/playwright-tests/Alerts/alerts-content-templates.spec.js:165-169`

3. **No email/title dependency** — link validation is type-agnostic; the test
   does not need the email title field filled. The default `type: "http"` is fine.

## Gotchas (so the Healer/Engineer don't rediscover them)

- **Collapsible auto-close on new template**: the Links section (`content-template-form-links-*`)
  is inside `content-template-form-optional-collapsible`. For a brand-new template, this
  collapsible defaults to CLOSED (the seed has `hasOptionalContent=true` but the spec
  marks it as `isSeeded`, suppressing auto-open). Always explicitly open it before
  interacting with link inputs, or the selectors will be invisible.

- **Inline error vs save-time toast**: There are TWO layers of URL validation:
  1. **Inline** (`ContentFieldsEditor.vue:160-166`): `valueErrorFor()` returns an error
     message rendered as OInput's `error-message`, bound reactively to the input value.
     This shows/hides as the user types — no save needed. The input element is
     `content-template-form-links-row-{index}-value-input` and the error lives on the
     same OInput wrapper (the OInput component renders its own error div inline).
  2. **Save-time** (`AddTemplate.vue:685-704`): `saveTemplate()` iterates all links and
     shows a toast (not inline) if any URL is bad. This aborts the save entirely.
  Inline errors should be visible for invalid entries; the save-time toast acts as a
  second-chance gate that catches links the user hasn't fixed yet.

- **OForm wrapper error vs child error**: The OInput `error`/`error-message` props are
  passed from `ContentFieldsEditor.vue` to the `OInput` component. The error message
  appears as text within the OInput wrapper. The data-test pattern for OInput renders
  `{data-test}-field` for the native input and `{data-test}-error` for the error text —
  but the exact suffix depends on the OInput implementation version. The test should
  target the value input field for filling, then assert error text visibility nearby.

- **No API call triggers the validator**: `linkUrlBadScheme` is a pure frontend function
  — it never hits the backend. The test can fill a link URL and observe inline errors
  with no network wait. The save-time block also triggers purely client-side; the API
  is only called after validation passes.
