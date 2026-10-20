# Test Setup Contract: Alert Library Anomaly Alerts (area: Alerts)

> Read by the **Engineer** (implements setup), the **Healer** and the **Refiner** (consult on
> data/setup failures). Concrete names + file:line only — no prose.

## Edition reality (OSS)

`useAnomalyLibraryAccess()` resolves to **`"locked"`** on any OSS backend automatically
(`build_type === "opensource"`), no toggle needed — see `web/src/composables/alerts/useAlertLibrary.ts:329-338`.
This means anomaly alerts render as **locked cards** (Anomaly tag + Enterprise lock tag), and every
interaction opens the global `enterprise-upgrade-dialog`. Do NOT try to force `"enabled"` (that needs
an enterprise build + license + `anomaly_detection_enabled`); do NOT write tests for the anomaly
drawer content or anomaly install — those are **enterprise-gated / UNWIRED in OSS** (see design doc
wiring trace). If coverage of those is wanted, park them as `test.fixme`.

## The ONE missing fixture piece

The manifest MUST contain `anomaly_alerts` for any anomaly card to exist. The existing fixture
builder does **not** emit it:

- `tests/ui-testing/playwright-tests/fixtures/alertLibraryFixture.js`
  - `makeEntry(i, o)` → a full entry **without** `alert_type` (correct: the page stamps
    `alert_type: "anomaly_detection"` for entries in `anomaly_alerts` — see
    `AlertLibrary.vue:456-465`).
  - `buildManifest(entries, o)` → emits only `{ format_version, alert_count, packs, alerts }` —
    **no `anomaly_alerts`, no `anomaly_alert_count`**.

**Engineer action:** build the manifest with `anomaly_alerts` populated. Simplest correct shape
(also used verbatim by the unit test at `web/src/views/AlertLibrary/AlertLibrary.spec.ts:1123-1128`):

```js
const scheduled = [ /* makeEntry(...) x N, normal scheduled alerts */ ];
const anomaly  = [ makeEntry(1, { name: 'pw_anomaly_...', pack: 'observability', category: 'anomaly-signals',
                    title: 'PW Anomaly Alert', severity: 'warning', stream: anomalyStream,
                    stream_type: 'logs', required_streams: [anomalyStream] }) ]; // NO alert_type field
const manifest = {
  ...buildManifest(scheduled),       // packs/alert_count from scheduled only
  format_version: '1.1.0',           // semantically consistent with anomaly_alerts (1.x all pass assertSupportedVersion)
  anomaly_alert_count: anomaly.length,
  anomaly_alerts: anomaly,
};
await routeLibrary(page, { manifest, entries: [...scheduled, ...anomaly], fileFor });
```

Requirements enforced by `assertManifest` (`useAlertLibrary.ts:194-228`): every `anomaly_alerts`
entry needs `id`, `content_hash`, `path`, `stream_type`, `required_streams` — `makeEntry` supplies
all of these. `routeLibrary`'s `fileFor` should still return `buildAlertFile(entry)` (or a custom
body) for the per-alert GET; the file body is only fetched on drawer-open, which locked cards never
reach, so the exact anomaly file body is immaterial for OSS tests.

## Streams / data the spec must establish

- **`<anomalyStream>` — `[shared/read-only]`** (e.g. `pw_lib_anom_<rand>`). A logs stream that
  EXISTS so the anomaly card reads "ready" (no `alert-library-card-needs-data` chip). Create it once
  in `beforeEach` and reuse; every test only reads it.
  - Create: `await pm.commonActions.initializeAlertTestStream(anomalyStream)` then
    `await pm.commonActions.queryStream(anomalyStream).catch(() => {})` to make it searchable —
    exact pattern at `tests/ui-testing/playwright-tests/Alerts/alert-library.spec.js:40-41`.
- **`<anomalyStreamMissing>` — `[shared/read-only]`** (e.g. `pw_lib_anom_missing_<rand>`): a name
  you deliberately **never** create, so the anomaly card reads "not ingested". Pattern at
  `alert-library.spec.js:35` (`missingStream` never created).
- **Optional `[per-test]`:** to assert the "needs-data chip + enterprise lock together" edge case
  (Edge Case 3), point ONE anomaly entry's `required_streams` at `<anomalyStreamMissing>`.

**No destination/template is needed** for the locked-card and alert-type-filter tests (install is
blocked). If a test wants to assert "the batch handed to the wizard excludes locked cards"
(Workflow 4's add-selected step), it needs a destination + template — reuse the exact pattern from
`alert-library.spec.js:43-48`:
`await pm.alertTemplatesPage.ensureTemplateExists(templateName)` +
`await pm.alertDestinationsPage.ensureDestinationExists(destinationName, 'http://example.com/webhook', templateName)`.

## How to create it (copy these EXACT patterns — do NOT invent setup)

- **Manifest/file interception:** `routeLibrary(page, { manifest, entries, fileFor })` —
  `tests/ui-testing/playwright-tests/fixtures/alertLibraryFixture.js:120-137`. Intercepts
  `**/alerts/manifest.json` (manifest) and `**/alerts/packs/**` (per-alert files).
- **Entry factory:** `makeEntry(i, overrides)` / `makeEntries(n, overrides)` — same file, lines 16-44.
- **Auth/org:** `getOrgIdentifier()` from `tests/ui-testing/playwright-tests/utils/cloud-auth.js`;
  URL from page object `openViaUrl()` → `${ZO_BASE_URL}/web/alert-library?org_identifier=<org>`
  (`tests/ui-testing/pages/alertsPages/alertLibraryPage.js:82-86`).
- **Navigation:** `lib.openViaUrl()` (or `openViaTab()` → `[data-test="alert-section-tab-alertLibrary"]`).

## Preconditions / toggles

- **Alert-type toggle is only present when `anomaly_alerts` is non-empty.** Assert its absence in a
  manifest WITHOUT anomaly alerts (`AlertLibrary.vue:662-668`).
- **Locked state is automatic on OSS** — no store/config manipulation. (The unit tests mutate
  `config.isEnterprise` + `store.state.zoConfig` to simulate `enabled`/`hidden`; e2e must NOT do that.)
- The page is considered "loaded" when the grid OR a terminal empty/error state is visible — reuse
  `waitForGallery()` (`alertLibraryPage.js:97-104`), which already avoids hanging on the skeleton.

## Page-object additions required (Engineer — in `tests/ui-testing/pages/alertsPages/alertLibraryPage.js`)

The DOM selectors all exist; the page object is missing anomaly helpers. Add (with assertions colocated):

- `l.alertType = '[data-test="alert-library-alert-type"]'`
- `l.alertTypeAll / alertTypeScheduled / alertTypeAnomaly` → `alert-library-alert-type-{all,scheduled,anomaly}`
- `pickAlertType(id)` → click `alert-library-alert-type-${id}`
- `cardAnomaly(id)` → `this.card(id).locator('[data-test="alert-library-card-anomaly"]')`
- `cardEnterprise(id)` → `this.card(id).locator('[data-test="alert-library-card-enterprise"]')`
- `expectCardAnomalyTag(id)` / `expectCardEnterpriseTag(id)` / `expectNoEnterpriseTag(id)`
- `expectAlertTypeToggleAbsent()` → `toHaveCount(0)`
- `expectUpgradeDialogVisible()` → `[data-test="enterprise-upgrade-dialog"]` visible
- `expectDrawerClosed()` → `[data-test="alert-library-drawer"]` `toHaveCount(0)` / hidden
- `expectSelectAllDisabled()` → the `[data-test="alert-library-select-all-in-view"] [role="checkbox"]`
  has `disabled`

## Gotchas (so the Healer/Engineer don't rediscover them)

- **`anomaly_alerts` is the only source of anomaly entries.** Putting an `alert_type:
  "anomaly_detection"` entry into `manifest.alerts` is wrong — the page stamps anomaly type from the
  ARRAY it came from, and `assertManifest`/`entries` treat `alerts` as scheduled. Keep anomaly
  entries in `anomaly_alerts` **without** an `alert_type` field.
- **`format_version` must stay major `1`.** `assertSupportedVersion` rejects a non-`1` major with
  `unsupported_version` → full error state. Use `"1.1.0"` (matches the unit-test fixture).
- **Card ids contain `/`.** `alert-library-card-{pack}/{name}` → quote the selector / use
  `page.locator('[data-test="..."]')`, never `getByTestId` with an unescaped slash assumption.
- **`packs` in the manifest does not drive rendering.** `categoryFacets`/`groupedEntries` are computed
  from `entries` (which includes anomalies), so passing only scheduled entries to `buildManifest` and
  spreading `anomaly_alerts` on top is safe.
- **`zoConfig` is backend-supplied.** Don't attempt to override `build_type` in the browser; on the
  OSS test server it is already `"opensource"` → locked.
- **Upgrade dialog is global/singleton.** It is mounted once in the app shell; asserting
  `enterprise-upgrade-dialog` visible after clicking a locked card is sufficient. Close it (Escape or
  its close button) between tests to avoid leakage into the next assertion.
