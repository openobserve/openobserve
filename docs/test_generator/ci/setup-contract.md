# Test Setup Contract: Alert Content Templates  (area: Alerts)

## Streams / data the spec must establish
Tag each item by SCOPE so the Engineer puts it in the right place:
- **`[shared/read-only]`** — every test just READS it the same way → set up ONCE / use a pre-seeded stream.
- **`[per-test]`** — only one test needs it, or a test MUTATES it → set up INSIDE that test, uniquely named.

- `<none needed for content-only template management tests>` **[shared/read-only]** — Template list page (CRUD, filtering, bulk delete) and the template editor (content + custom mode, preview panel, variable guide) operate on templates alone. Templates have no dependency on streams, alerts, or ingested data. The TemplatePreviewPanel fetches preview data from the backend's `/templates/preview` endpoint, which ships synthetic sample rows — no real data required.

- **`alert_content_e2e_<random>`** **[per-test: E2E multi-channel rendering]** — fields: `city`, `country`, `status`, `age`, `test_run_id`, `test_timestamp`, `message`. Why: the full E2E test (content-template author-once → destinations → alert fire → assert per-channel payloads) requires a real log stream so an alert can fire. The existing spec already handles this.

## How to create it (copy these EXACT patterns — do NOT invent setup)
- **Templates CRUD**: Use API-based template creation/deletion via `alertTemplatesPage.createTemplateViaApi(templateName)` and `alertTemplatesPage.deleteTemplateViaApi(templateName)` — see `tests/ui-testing/pages/alertsPages/alertTemplatesPage.js:365-395` and `:270-288`. Templates are entirely API-managed; no stream/data prerequisite.
- **Stream for E2E test**: `pm.commonActions.initializeAlertTestStream(streamName)` — see `tests/ui-testing/pages/commonActions.js:358-426`. Already used in the existing spec at `alerts-content-templates.spec.js:284`.
- **Auth/org**: ORGNAME=default; the worker auth state from the enhanced base fixtures handles login.
- **Navigation**: `pm.alertTemplatesPage.navigateToTemplates()` — see `alertTemplatesPage.js:70-139`. Uses URL-based navigation first, falls back to NavFlyout (Reliability group).

## Preconditions / toggles
- New templates default to **"content"** editor mode (kind="content") — no toggle needed.
- Switching to **"custom"** mode shows the raw-payload editor (Monaco with json/markdown language). Switch via `[data-test="add-template-mode-tabs"]` clicks.
- The preview panel loads automatically on spec changes (debounced 300ms). Assert visibility with `[data-test="add-template-preview-panel"]` (the parent override, not the child's `template-preview-panel`).
- When testing the content-template form with the optional disclosure (fields/links/rows/chart sections), the disclosure starts CLOSED for fresh templates — must click `[data-test="content-template-form-optional-collapsible"]` to open it before interacting with its contents.

## Gotchas (so the Healer/Engineer don't rediscover them)
- **Monaco editor interaction**: Content-template body editor uses `[data-test="content-template-form-body-editor"] .view-lines`. Monaco's DOM is generated at runtime — use `click({ force: true })` on `.view-lines`, then `page.keyboard.insertText()` rather than `fill()`. Select-all is `Meta+A` on Mac, `Control+A` otherwise.
- **Preview panel `data-test` override**: AddTemplate.vue composes TemplatePreviewPanel with its own `data-test="add-template-preview-panel"` attribute, which overrides the child's root `data-test="template-preview-panel"` via Vue's attribute fallthrough. The existing spec already documents this at `alerts-content-templates.spec.js:138-141`.
- **Content mode `body` validation**: In content mode, the form's `body` field is serialized ContentSpec JSON — it is always valid JSON. The schema's `superRefine` (AddTemplate.schema.ts:62-73) requires non-empty title OR body in the parsed spec. An otherwise-empty template with only a body message (no title) is valid.
- **Custom mode JSON validation**: In custom mode with `type="http"`, the form validates the body is valid JSON (with template placeholders) at submit time — NOT at the schema level. This is a toast side-effect, not a field error.
- **Email title requirement**: When `type="email"`, the `title` field is required (superRefine in AddTemplate.schema.ts:48-53).
- **Prebuilt templates are read-only**: The edit and delete buttons are disabled for prebuilt templates. The clone button remains enabled. Individual row checkboxes and the select-all header must exclude prebuilt rows from the bulk-delete selection.
- **Template list tabs**: Three toggle-group tabs filter the list: "all", "prebuilt", "custom". These filter client-side by `isPrebuilt` flag.
- **Clone mode**: When cloning a template, the editor pre-fills the source template's data but treats the save as a CREATE. The template name defaults to `Copy_of_<original>`. The `name` field is editable (not locked like in update mode).
- **Update mode locks the name**: When editing an existing template, the `name` input is `readonly` and `disabled` — cannot be changed.
