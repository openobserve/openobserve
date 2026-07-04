# Test Setup Contract: Pipelines Preview Popup Overflow  (area: General)

## Streams / data the spec must establish

Tag each item by SCOPE so the Engineer puts it in the right place:
- **`[shared/read-only]`** — every test just READS it the same way → set up ONCE / use a pre-seeded stream.
- **`[per-test]`** — only one test needs it, or a test MUTATES it → set up INSIDE that test, uniquely named.

- **`e2e_automate`** (logs stream) **[shared/read-only]** — fields: `kubernetes_container_name`, `kubernetes_host`, `log`, `stream`. Why: all tests need at least one pipeline to exist in the list. The pipeline list must be non-empty for the preview popup to be triggerable. This is the pre-seeded stream used by all existing pipeline E2E specs.
- **`e2e_automate1`, `e2e_automate2`, `e2e_automate3`** (logs streams) **[shared/read-only]** — fields: same as `e2e_automate`. Why: used by the existing pipeline creation tests; pre-seeded data.

## How to create it (copy these EXACT patterns — do NOT invent setup)

- **Ingest**: `await pageManager.pipelinesPage.bulkIngestToStreams(streamNames, logsdata)` — see `tests/ui-testing/playwright-tests/Pipelines/pipelines.spec.js:36`
- **Auth/org**: `ORGNAME=default`; use stored auth state `tests/ui-testing/playwright-tests/utils/auth/user.json` via `storageState` in `test.use()` — see `tests/ui-testing/playwright-tests/Pipelines/pipelines.spec.js:11-18`
- **Pipeline creation** (if a test needs a fresh specific pipeline for preview): use `pageManager.pipelinesPage.addPipeline()`, then `pageManager.pipelinesPage.selectStream()`, etc. — see `pipelines.spec.js:48-57` for the pattern.
- **Navigation to pipelines list**: `await openNavFlyoutChild(this.page, 'pipeline')` — see `tests/ui-testing/pages/pipelinesPages/pipelinesPage.js:338` or `tests/ui-testing/pages/pipelinesPages/pipelinesEP.js:48`
- **Watch for pipeline list load**: Wait for the pipeline list page container `[data-test="pipeline-list-page"]` to be visible.
- **Timing**: Wait for the OTable rows to render (the pipeline list table uses lazy-loaded data from the pipelines API). Wait for `[data-test="pipeline-list-table"]` with at least one row visible before interacting.

## Preconditions / toggles

- The pipeline list must have at least **one** pipeline row for the preview/view button to exist and be interactable.
- The pipeline must have at least **one input node and one output node** (connected) for the PipelineView popup to render a meaningful graph. A pipeline with just source + destination nodes is sufficient.
- The OTooltip `max-width="none"` styling on the view button means the popup can be wider than the default tooltip width — the PipelineView component's `tw:w-125 tw:h-75` (500px × 300px) constrains it internally.
- Ensure the test viewport is wide enough to see the tooltip without viewport-clipping. Recommended: viewport ≥ 1280×800.

## Gotchas (so the Healer/Engineer don't rediscover them)

- The preview popup is an **OTooltip** that opens on hover of the visibility button — not a click. Tests must use `hover()` not `click()` to trigger it.
- The tooltip uses `max-width="none"` and the PipelineView is inside it. The popup may appear off-screen if the pipeline row is near the bottom/right edge of the viewport.
- The PipelineView uses `tw:overflow-auto` — scrolling inside the popup requires the mouse to be within the popup bounds.
- Pipeline list data is fetched asynchronously from the API. The view button's `pipeline` prop (`:pipeline="row"`) depends on the row having nodes and edges. If the API response hasn't loaded yet, the tooltip may show an empty graph.
- Action buttons (delete, etc.) inside the preview popup are hidden via CSS (`.pipeline-view-tooltip .node-action-buttons { display: none !important; }`) — the preview is intentionally read-only.
- The error dialog (`data-test="pipelines-list-error-dialog"`) only appears when a pipeline has `last_error` data — this requires a pipeline that has actually failed.
