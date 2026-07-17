# Execution Report: Alpha1 Cloud E2E — SDR / GeneralTests / Metrics stabilization

## Run Details
- Date: 2026-07-17
- Branch: `fix/sdr-general-metrics-alpha1-e2e` (from `origin/main`)
- Source CI failure analysed: o2-enterprise run **29481437880** ("Run E2E Tests on Alpha1 (Cloud)")
- Environment: alpha1 **cloud**, `playwright-alpha1.config.js`, CI override `--workers=5`, actionTimeout ≈ 45000ms, 2 retries
- Shards targeted: SDR (1 failed, 1 flaky), GeneralTests (21 failed, 2 flaky), Metrics (passed — proactive de-flake)

## Root Causes & Fixes

### 1. SDR — `scrollIntoViewIfNeeded` 45s timeout (test-sync)
`multipleSDRPatterns.spec.js:137` (failed), `queryTimeDrop.spec.js:92` (flaky). The bare
`scrollIntoViewIfNeeded()` calls in `streamAssociationPage.js` (addPatternButton, viewPatternsLink,
detailButton) inherit the 45s actionTimeout and spin on attached+stable polling because the
revamped Reka streams/schema table re-renders rows mid-animation. Element was already `waitFor`-visible
at 5s → not a data/backend regression.
- **Fix** (`pages/streamsPages/streamAssociationPage.js`): assert `expect(el).toBeVisible()` (real
  precondition), then instant native `el.evaluate(e => e.scrollIntoView({block:'center'}))` which
  resolves once and returns immediately. Removed two `waitForTimeout(500)` sleeps.

### 2. GeneralTests / cipherKeys ×6 — settings-hub navigation (test-sync) — AGENT DIAGNOSIS OVERRIDDEN
`navigateToCipherKeyTab` waited 45s for `[data-test="management-cipher-key-tab"]`. The sub-agent
concluded the feature is enterprise-only and absent on cloud, and proposed `test.skip`. **Rejected**:
`cipher-keys` and `regex_patterns` share the *identical* `visible: isEnt` gate
(`settings/index.vue:236`/`:246`), and the SDR shard's regex-management tests **pass on this same
alpha1 cloud env** — so `isEnterprise` is `true` on cloud and the cipher tab **does** render. Skipping
would have masked a real, fixable nav bug. The true cause: clicking the Settings menu lands on the
SectionHub where per-tab data-tests aren't rendered; the working regex sibling uses a **direct goto**
to its sub-route.
- **Fix** (`pages/generalPages/cipherKeys.js`): `navigateToSettingsMenu()` now does
  `page.goto('/web/settings/cipher_keys?org_identifier=<ORGNAME>')` + `waitForLoadState`, mirroring
  `regexPatternsPage.navigateToRegexPatterns()`. `navigateToCipherKeyTab()` asserts the tab visible
  (bounded) then clicks. Spec reverted to origin (no skip).

### 3. GeneralTests / enrichment ×7 — fragile flyout→pipelines→section-tab nav (test-sync)
All failed on `enrichmentTableTabLocator.click({force:true})` (45s). Selector
`pipeline-section-tab-enrichmentTables` still exists (`PipelineSectionTabs.vue`) — no app regression.
The tab only mounts after the pipelines page header renders; on cloud a slow/missed flyout click left
it unattached and `force` can't help.
- **Fix** (`pages/pipelinesPages/pipelinesPage.js` `navigateToAddEnrichmentTable`): direct SPA nav via
  the dedicated `openNavFlyoutChild('enrichment')` child + `waitForURL(/pipeline\/enrichment-tables/)`,
  with a hard `page.goto` fallback (same recovery as `enrichmentPage.gotoEnrichmentTablesWithOrg`), then
  wait for `enrichment-tables-list-page` visible and a `expect(...).toPass()` settle-retry Add-button
  click that re-resolves the locator and short-circuits if the form already opened.

### 4. GeneralTests / landingPage ×1 + languageTranslation ×8 — browser-process OOM cascade
"Target page/context/browser has been closed" across consecutive tests = a worker's browser crashed;
the 8 language failures were fallout, not 8 bugs. Tests are already per-test-context isolated. The
driver: 10 exhaustive ~27-page full-app crawls (`test.setTimeout(360000)`, chart/monaco/websocket-heavy
views) with `mode:'parallel'` → up to **5 concurrent crawls under `--workers=5`** → OOM. (Coverage
writes are a no-op on the non-instrumented cloud build, ruled out.)
- **Fix A** (`languageTranslation.spec.js`): `mode:'parallel'` → `mode:'default'` — serialize the 10
  crawls onto one worker (≤1 resident at a time) while other GeneralTests files still parallelize; unlike
  `serial`, no skip-on-failure cascade. **Full coverage preserved.**
- **Fix B** (`languagePage.js`, `landingPage.spec.js`): stop swallowing/retrying against a dead
  page/context — `_isFatalClosedError`/`isFatalClosedError` rethrow so a crash fails fast at its true
  origin instead of cascading silently or mislabelling as "Failed after 3 attempts".

### 5. GeneralTests / schemaload — flaky stream-selector wait (test-sync)
`log-search-index-list-select-stream` not visible in 30s after large-payload ingest + reload; the OSelect
only mounts after the `streams?type=logs` list arrives.
- **Fix** (`pages/generalPages/schemaLoadPage.js`): arm `waitForResponse(/streams\?type=logs/, 200)`
  **before** `reload()`, await it, then the OSelect wait — gated on the real API signal, not a blind
  clock. Falls through if unobserved so genuine streams-API slowness still surfaces.

### 6. Metrics — proactive de-flake (green this run)
`metricsPage.js`: `selectChartType` sleep → wait for `data-selected="true"`; `switchToPromQLCustomMode`
removed two sleeps + fixed a state-detection bug (reka `OToggleGroupItem` active state is `data-state="on"`,
not a `selected` class) via `expect.poll`; `selectPromqlTableMode` bounded the scroll timeout.
`metrics-share-deep-link.spec.js`: sleep-then-assert race → `expect.poll` on the real loading state.

## Files Modified
- pages/streamsPages/streamAssociationPage.js
- pages/generalPages/cipherKeys.js
- pages/pipelinesPages/pipelinesPage.js
- pages/generalPages/languagePage.js
- pages/generalPages/schemaLoadPage.js
- pages/metricsPages/metricsPage.js
- playwright-tests/GeneralTests/languageTranslation.spec.js
- playwright-tests/GeneralTests/landingPage.spec.js
- playwright-tests/Metrics/metrics-share-deep-link.spec.js

## Verification
- Static: `node --check` passes on all 9 files; dependent selectors/methods/env-vars confirmed present
  (`enrichment-tables-list-page`, `nav-group-item-enrichmentTables`, `selected-chart-*-item`/`data-selected`,
  `isShareButtonLoading`, `ZO_BASE_URL`, `ORGNAME`).
- Runtime: requires an alpha1 cloud CI run (cloud auth/org). Not run locally. Owner to trigger CI.

## Open recommendation (infra — not a test bug)
The languageTranslation OOM is ultimately a memory-pressure condition amplified by the CI `--workers=5`
override. If the serialized crawl becomes the shard's critical path or a worker still OOMs, the durable
fix is at the workflow/config layer: lower the GeneralTests worker count (config already sets `workers:3`,
overridden to 5 in CI) and/or raise runner memory. Flagged for the owner; not changed here (CI workflow
lives in o2-enterprise).

## Final Status (target next CI run)
- SDR: 2 → 0 expected failures
- GeneralTests: 21 failed / 2 flaky → 0 expected (cipherKeys 6, enrichment 7, languageTranslation 8+
  landingPage 1, schemaload flaky all addressed)
- Metrics: green + hardened
