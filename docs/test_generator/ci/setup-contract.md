# Test Setup Contract: Dashboard Table Column Format Override  (area: Dashboards)

## Streams / data the spec must establish

### `[shared/read-only]` — `e2e_table_format`
- **Stream name**: `e2e_table_format`
- **Fields**: `timestamp` (timestamp), `level` (string), `message` (string), `response_ms` (number), `bytes_sent` (number), `status` (string), `city` (string)
- **Why**: Every test reads this stream for table data; the panel queries it, shows columns with both numeric (`response_ms`, `bytes_sent`) and text fields (`level`, `message`, `status`, `city`). The column formatting controls need at least one numeric column and one text column. No test mutates the stream.
- **Used by**: TC-01 (open dialog from header), TC-02 (open dialog from ConfigPanel), TC-03 (add numeric override), TC-04 (add text override), TC-05 (remove override), TC-06 (save persists to panel)

### `[per-test]` — none
All tests share the same read-only stream. No per-test data isolation needed.

## How to create it (copy these EXACT patterns — do NOT invent setup)

- **Ingest**: Use the existing `ingestion` helper from `tests/ui-testing/playwright-tests/Dashboards/utils/dashIngestion.js`. Pass a custom stream name and a custom payload:
  ```js
  import { ingestJson } from "../utils/dashIngestion.js"; // see dashIngestion.js for the fetch pattern
  // OR more directly, use the API pattern from data-ingestion.js:
  const { ingestTestData } = require('../utils/data-ingestion.js');
  // but with a custom payload — create a small helper:
  const payload = [
    {"timestamp":"2026-08-07T10:00:00.000Z","level":"info","message":"request completed","response_ms":145,"bytes_sent":2048,"status":"200","city":"New York"},
    {"timestamp":"2026-08-07T10:01:00.000Z","level":"error","message":"timeout","response_ms":5000,"bytes_sent":512,"status":"500","city":"London"},
    {"timestamp":"2026-08-07T10:02:00.000Z","level":"warn","message":"slow response","response_ms":1200,"bytes_sent":8192,"status":"200","city":"Tokyo"},
    {"timestamp":"2026-08-07T10:03:00.000Z","level":"info","message":"ok","response_ms":89,"bytes_sent":1024,"status":"200","city":"Paris"},
    {"timestamp":"2026-08-07T10:04:00.000Z","level":"debug","message":"trace info","response_ms":38,"bytes_sent":256,"status":"200","city":"Berlin"}
  ];
  // See: tests/ui-testing/playwright-tests/Dashboards/utils/dashIngestion.js:24-57 for the ingestion pattern
  // See: tests/ui-testing/playwright-tests/utils/data-ingestion.js:11-31 for the page.request.post pattern
  ```
- **Auth/org**: `ORGNAME=default` (in CI env). Use the same login/auth flow as other dashboard tests — see `tests/ui-testing/playwright-tests/Dashboards/dashboard-config-table.spec.js` for the login + dashboard creation pattern.
- **Timing**: After ingest, wait for stream to appear in the stream list and for its schema to hydrate. The stream list in the query builder polls; use the existing wait pattern from dashboard tests.

## Preconditions / toggles

- A **dashboard** with a **table-type panel** must exist. The table panel must:
  - Be in **edit mode** (the PanelEditor opens when creating or editing a panel)
  - Use a **SQL query** (not PromQL) against the `e2e_table_format` stream
  - Have at least one numeric field and one text field in the query output
  - The config panel must be open so users can access the "Field Overrides" section
- For the header format-icon path: the table must have rendered data (rows present), so the column headers are visible.

## Gotchas (so the Healer/Engineer don't rediscover them)

1. **Column format icon only appears in PanelEditor, not in ViewPanel**: The `enableColumnFormat` prop is passed as `true` only from `PanelEditor.vue` (line 258). The dashboard `PanelContainer` does NOT set `enableColumnFormat`. So tests must be run in the **panel edit/add** screen, not the dashboard view.
2. **The OverrideConfig component is async-loaded** (`defineAsyncComponent` at line 658-660 of PanelEditor.vue). Wait for it to mount before interacting.
3. **Format icon only on non-row-field and non-total columns**: `TableRenderer` sets `formattable` (line 251) only when `enableColumnFormat && !col._isRowField && !col._isTotalColumn`. Ensure the table is not a pivot table for format-column tests.
4. **Dialogs render in portals**: The OverrideConfigPopup opens in an `ODialog` which renders in a portal. Use Playwright's `page.locator` with document-level queries rather than scoped locators.
5. **Panel must have data for the table to render**: The `@format-column` emit comes from the OTable header, which only renders when data rows exist.
