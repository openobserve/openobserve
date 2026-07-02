# Test Setup Contract: Dashboard Report CSV Media Type  (area: Reports)

## Streams / data the spec must establish
Tag each item by SCOPE so the Engineer puts it in the right place:
- **`e2e_automate`** **[shared/read-only]** — standard stream with fields: `kubernetes`, `log`, `stream`, `job`, `timestamp`. Ingested by the base `beforeEach` in existing Reports specs via `pm.ingestionPage.ingestion()`. This is sufficient for creating a dashboard + report; the CSV-media-type feature works on the *report configuration* itself (no special data fields required).

*(No additional streams are required. The CSV media type feature is a UI-configuration-only feature: selecting "CSV (Data)" from the report-type dropdown and observing the conditional hiding of the attachment-type and custom-dimensions sections. It does not exercise the downstream report-server CSV collection pipeline.)*

## How to create it (copy these EXACT patterns — do NOT invent setup)
- **Ingest (base data):** `await pageManager.ingestionPage.ingestion()` — triggers `POST /api/{org}/e2e_automate/_json` with the standard `logsdata` payload. See `tests/ui-testing/playwright-tests/Reports/reportsScheduleNow.spec.js:29`.
- **Dashboard creation (per spec):** `await pageManager.dashboardPage.navigateToDashboards()` then `await pageManager.dashboardPage.createDashboard()`. See `tests/ui-testing/playwright-tests/Reports/reportsScheduleNow.spec.js:34-36`.
- **Auth/org:** `<ORGNAME=default>`; the worker auth state from `baseFixtures.js` handles login. Standard pattern: `await pageManager.loginPage.gotoLoginPage(); await pageManager.loginPage.loginAsInternalUser(); await pageManager.loginPage.login()`.
- **Report navigation:** `await page.goto(process.env["ZO_BASE_URL"] + "/web/reports?org_identifier=" + process.env["ORGNAME"])` or `await pageManager.reportsPage.goToReports()`. See `reportsScheduleNow.spec.js:37`.

## Preconditions / toggles
- A dashboard must exist in the `default` folder (created in the test).
- Non-SQL mode is not relevant to this feature. No quick-mode toggle needed.
- The `OSelect` popover patterns use `data-test="<parentDataTest>-option"` with `data-test-value` attributes. The report-type `OSelect` at `data-test="add-report-type-select"` does **not** have explicit per-option `data-test` attributes in the template, but options are auto-attributed by the OSelect component with `data-test-value` — use visible text matching as a fallback or the OSelect pattern from `reportsPage.js`.

## Gotchas (so the Healer/Engineer don't rediscover them)
- The `add-report-type-select` OSelect options are `{ label: 'CSV (Data)', value: 'csv' }`. The OSelect component renders `[data-test="add-report-type-select-option"]` with `data-test-value="csv"` for each option.
- The attachment type select (`add-report-attachment-type-select`) is hidden (`v-if`) when `dashboard.report_type === 'csv'`. The custom dimensions section (`add-report-custom-dimensions-section`) is also hidden. Both visibility conditions are driven by `dashboard.report_type` which is directly bound to the OSelect v-model — **fully wired**.
- The `report_type` field defaults to `"pdf"` in the `defaultReport` object (`CreateReport.vue:811`). Tests must explicitly select CSV after reaching step 1.
- The label for the CSV option is `"CSV (Data)"` (not just `"csv"` or `"CSV"`). Use the label text for matching in the dropdown.
