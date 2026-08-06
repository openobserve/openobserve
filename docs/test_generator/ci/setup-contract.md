# Test Setup Contract: Alert Template Mode Tab Roundtrip (area: Alerts)

## Streams / data the spec must establish
This feature operates on the **template editor form** (create / edit / clone). No stream ingestion is needed — templates are a pure configuration resource (name + body payload). The tests exercise form state, mode-tab switching, payload preservation, validation, and CRUD lifecycle.

Tag each item by SCOPE so the Engineer puts it in the right place:

- **`[shared/read-only]`** — every test just READS it the same way → set up ONCE / use a pre-seeded stream.
- **`[per-test]`** — only one test needs it, or a test MUTATES it → set up INSIDE that test, uniquely named.

No stream data is needed. Only template resources:

- **`auto_roundtrip_custom_<suffix>` [per-test: TC-01, TC-02]** — a custom-kind template (raw JSON payload) created via API before the test opens the editor. Why: the roundtrip test MUST start with an existing custom template and verify its body survives a Content → Custom mode tab roundtrip.
- **`auto_roundtrip_content_<suffix>` [per-test: TC-03]** — a content-kind template created via API. Why: verify that editing a content template shows the content form, not the raw editor, and that switching to Custom mode uses the roundtrip stash.

## How to create it (copy these EXACT patterns — do NOT invent setup)

- **Navigate to templates page**: `pm.alertTemplatesPage.navigateToTemplatesPage()` — see `tests/ui-testing/playwright-tests/Alerts/alerts-template-prebuilt-guard.spec.js:26`
- **Create template via API**: `await pm.alertTemplatesPage.createTemplateViaApi(templateName, body)` — see `tests/ui-testing/pages/alertsPages/alertTemplatesPage.js:365`
- **Ensure template exists (create if missing)**: `await pm.alertTemplatesPage.ensureTemplateExists(templateName)` — see `tests/ui-testing/pages/alertsPages/alertTemplatesPage.js:433`
- **Delete template via API**: `await pm.alertTemplatesPage.deleteTemplateViaApi(templateName)` — see `tests/ui-testing/pages/alertsPages/alertTemplatesPage.js:270`
- **Auth/org**: `<ORGNAME=default>` (process.env.ORGNAME || 'default'); the worker auth state / login pattern from `tests/ui-testing/playwright-tests/utils/enhanced-baseFixtures.js`
- **PageManager**: `new PageManager(page)` — provides `pm.alertTemplatesPage` (see `tests/ui-testing/playwright-tests/Alerts/alerts-template-prebuilt-guard.spec.js:25`)

### Example custom template body for API creation
```json
{"text": "{alert_name} fired on {stream_name} — observed {alert_agg_value} ({alert_operator} {alert_threshold}). {alert_url}"}
```
This is a non-content template (no `kind` field → server treats as custom). Editor opens in custom mode for this template.

### Example content template body for API creation
To create a content-kind template, you must send `kind: "content"` and a body that is a valid ContentSpec JSON. The simplest way is to let the API path handle it; alternatively, create via UI in content mode.

## Preconditions / toggles

- **Default editor mode for new templates**: content mode (starter spec with `kind: "content"`)
- **AppTabs for mode switching**: rendered as `[data-test="add-template-mode-tabs"]` with two tabs: "Content" and "Custom" (i18n-key `alert_templates.kindContent` / `alert_templates.kindCustom`)
- **Legacy banner**: only renders when `isUpdatingTemplate=true` AND `editorMode === "custom"` — only for EXISTING custom templates (not new ones)
- **Name field readonly in edit**: the `[data-test="add-template-name-input-field"]` has `readonly` attribute when editing existing templates
- **Clone mode**: name is prefixed with `Copy_of_`; save creates a new template, not overwrites the original

## Gotchas (so the Healer/Engineer don't rediscover them)

1. **Monaco editor async mounting**: `CodeQueryEditor` is `defineAsyncComponent`. After clicking a mode tab, wait for editor content to settle before asserting its text. The `:key="bodyLanguage"` on the raw-body editor forces a remount on type change.
2. **Mode tabs are AppTabs, not `<select>`**: use `page.locator('[data-test="add-template-mode-tabs"]').getByRole(...)` or click individual tab elements. The active tab's text derives from i18n.
3. **Custom body stash is per-component-instance**: clearing it happens in `applyTemplateData()` (line 550), which runs `onActivated` and on `props.template` watch. A fresh load always starts with a null stash.
4. **Content-mode body is serialized ContentSpec JSON**: when in content mode, `form.body` contains `serializeContentSpec(contentSpec)` — NOT the user-visible body text. Switching to custom mode on a fresh new template uses `RAW_PAYLOAD_STARTER` (a Slack-compatible example) instead.
5. **Save button loading state**: `isSubmitting` from OForm v-slot drives the spinner; the button has `:loading="isSubmitting"`. Assert button is not in loading state after save completes or fails.
