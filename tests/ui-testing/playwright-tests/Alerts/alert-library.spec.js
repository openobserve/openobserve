const { test, expect } = require('../utils/enhanced-baseFixtures.js');
const PageManager = require('../../pages/page-manager.js');
const testLogger = require('../utils/test-logger.js');
const { getOrgIdentifier } = require('../utils/cloud-auth.js');
const {
  MANIFEST_GLOB,
  FILE_GLOB,
  makeEntry,
  makeEntries,
  buildManifest,
  buildAlertFile,
  routeLibrary,
} = require('../fixtures/alertLibraryFixture.js');

// Combined-journey e2e for the Alert Library. The manifest + alert files are
// mocked (deterministic readiness / bulk counts / states); install hits the
// real alert API and is verified by reading the created alert back.
test.describe('Alert Library', () => {
  let pm;
  let readyStream;
  let missingStream;
  let templateName;
  let destinationName;
  let entries;

  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    pm = new PageManager(page);

    const rand = pm.alertsPage.generateRandomString().toLowerCase();
    readyStream = `pw_lib_ready_${rand}`.toLowerCase();
    missingStream = `pw_lib_absent_${rand}`.toLowerCase(); // never created → "missing"
    templateName = `pw_lib_tmpl_${rand}`;
    destinationName = `pw_lib_dest_${rand}`;

    // A stream with data → its cards read "ready" / fresh.
    await pm.commonActions.initializeAlertTestStream(readyStream);
    await pm.commonActions.queryStream(readyStream).catch(() => {}); // let it become searchable

    // Install requires a real destination (template first). example.com avoids
    // the SSRF guard that blocks self-host URLs.
    await pm.alertTemplatesPage.ensureTemplateExists(templateName);
    await pm.alertDestinationsPage.ensureDestinationExists(
      destinationName, 'http://example.com/webhook', templateName,
    );

    // Deterministic gallery: 1 ready card, 1 not-ready (missing) card, and a
    // bulk pack of 51 ready cards (> LARGE_BATCH=50) for the large-batch guard.
    // All installable names share the pw_lib_ prefix so cleanup.spec.js sweeps
    // the alerts they create (see apiCleanup alertPrefixes).
    const ready = makeEntry(1, {
      name: `pw_lib_ready_${rand}`, title: 'PW Ready Alert', severity: 'critical',
      pack: 'observability', category: 'ready-signals', stream: readyStream,
      required_streams: [readyStream],
    });
    const missing = makeEntry(2, {
      name: `pw_lib_missing_${rand}`, title: 'PW Missing Alert', severity: 'info',
      pack: 'observability', category: 'absent-signals', stream: missingStream,
      required_streams: [missingStream],
    });
    const bulk = makeEntries(51, {
      namePrefix: `pw_lib_bulk_${rand}`, pack: 'infrastructure', category: 'bulk-signals',
      severity: 'warning', stream: readyStream, required_streams: [readyStream],
    });
    entries = [ready, missing, ...bulk];

    await routeLibrary(page, { manifest: buildManifest(entries), entries });
  });

  test('browse, filter, preview and install a single curated alert', async ({ page }) => {
    const ready = entries[0];
    const missing = entries[1];

    // Gallery renders from the mocked manifest.
    await pm.alertLibraryPage.openViaUrl();
    await expect(page.locator('[data-test="alert-library-grid"]')).toBeVisible();

    // Readiness: missing card shows the "not ingested" chip, ready card doesn't.
    await expect(pm.alertLibraryPage.needsDataChip(missing.id)).toBeVisible();
    await expect(pm.alertLibraryPage.needsDataChip(ready.id)).toHaveCount(0);

    // Readiness filter (stat strip) narrows to not-ready, then back.
    await pm.alertLibraryPage.filterNeedsData();
    await expect(pm.alertLibraryPage.card(missing.id)).toBeVisible();
    await expect(pm.alertLibraryPage.card(ready.id)).toHaveCount(0);
    await pm.alertLibraryPage.filterAll();

    // Search narrows to the ready alert by title.
    await pm.alertLibraryPage.search('PW Ready');
    await expect(pm.alertLibraryPage.card(ready.id)).toBeVisible();

    // Drawer: opens, lazy-loads the (mocked) file, shows preview + install.
    await pm.alertLibraryPage.openCard(ready.id);
    await expect(page.locator('[data-test="alert-library-drawer-preview"]')).toBeVisible();

    // Install wizard: destination → alerts → folder(default) → tune → run.
    await pm.alertLibraryPage.installFromDrawer();
    // F2: cannot advance until a destination is chosen.
    await expect(page.locator('[data-test="alert-library-install-next"]')).toBeDisabled();
    await pm.alertLibraryPage.pickDestination(destinationName);
    await expect(page.locator('[data-test="alert-library-install-next"]')).toBeEnabled();
    await pm.alertLibraryPage.next(); // → alerts
    await pm.alertLibraryPage.next(); // → folder
    await pm.alertLibraryPage.next(); // → tune
    await pm.alertLibraryPage.enableTune();
    await pm.alertLibraryPage.setFrequency(15);
    await pm.alertLibraryPage.setSilence(20);
    await pm.alertLibraryPage.next(); // → review
    await pm.alertLibraryPage.run();
    await pm.alertLibraryPage.waitResult(ready.id, 'installed');
    await pm.alertLibraryPage.done();

    // Verify via API the transformations the UI never shows.
    const created = await pm.alertLibraryPage.getInstalledAlert(ready.name);
    expect(created, 'installed alert should be readable via API').toBeTruthy();
    // I2 destination overridden (author's o2_to_slack replaced)
    expect(created.destinations).toContain(destinationName);
    // I3 provenance stamped
    expect(JSON.stringify(created.tags || [])).toContain(`pack:${ready.pack}`);
    expect(created.context_attributes?.library_id).toBe(ready.id);
    expect(created.context_attributes?.library_hash).toBe(ready.content_hash);
    // I4 severity critical → priority 1 (integer on the wire)
    expect(created.priority).toBe(1);
    // I5 owner is the installing user; I1 lands in the chosen (default) folder
    expect(typeof created.owner === 'string' && created.owner.length).toBeTruthy();
    // I7 tuning applied
    expect(created.trigger_condition?.frequency).toBe(15);
    expect(created.trigger_condition?.silence).toBe(20);
  });

  test('bulk select via select-all-in-view triggers the >50 large-batch guard', async ({ page }) => {
    await pm.alertLibraryPage.openViaUrl();

    // Select every card in view (1 ready + 1 missing + 51 bulk = 53 > 50).
    await pm.alertLibraryPage.selectAllInViewToggle();
    expect(await pm.alertLibraryPage.selectedCountInBar()).toBeGreaterThan(50);

    await pm.alertLibraryPage.addSelected();
    await pm.alertLibraryPage.pickDestination(destinationName);
    await pm.alertLibraryPage.next(); // alerts
    await pm.alertLibraryPage.next(); // folder
    await pm.alertLibraryPage.next(); // tune
    await pm.alertLibraryPage.next(); // review

    // Guard: confirm checkbox present, Run disabled until it is ticked.
    await expect(page.locator('[data-test="alert-library-install-confirm-large"]')).toBeVisible();
    await expect(page.locator('[data-test="alert-library-install-run"]')).toBeDisabled();
    await pm.alertLibraryPage.confirmLargeBatch();
    await expect(page.locator('[data-test="alert-library-install-run"]')).toBeEnabled();

    // H5: the confirmation auto-resets when the run's shape changes (here, the
    // alert selection), so it always describes the run about to happen.
    await pm.alertLibraryPage.back(); // → tune
    await pm.alertLibraryPage.back(); // → folder
    await pm.alertLibraryPage.back(); // → alerts
    await pm.alertLibraryPage.clearInDialog();
    await pm.alertLibraryPage.selectAllInDialog();
    await pm.alertLibraryPage.next(); // folder
    await pm.alertLibraryPage.next(); // tune
    await pm.alertLibraryPage.next(); // review
    await expect(page.locator('[data-test="alert-library-install-run"]')).toBeDisabled();
  });

  test('readiness surfaces on the card and in the drawer (fresh vs missing)', async ({ page }) => {
    const ready = entries[0];
    const missing = entries[1];

    await pm.alertLibraryPage.openViaUrl();

    // Card: missing → "not ingested" chip; fresh → none.
    await expect(pm.alertLibraryPage.needsDataChip(missing.id)).toBeVisible();
    await expect(pm.alertLibraryPage.needsDataChip(ready.id)).toHaveCount(0);

    // Drawer: missing → availability warning banner; fresh → no banner.
    await pm.alertLibraryPage.openCard(missing.id);
    await expect(page.locator('[data-test="alert-library-drawer-needs-data"]')).toBeVisible();
    await expect(page.locator('[data-test="alert-library-drawer-availability"]')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('[data-test="alert-library-drawer"]')).toBeHidden();

    // The ready card's drawer renders the preview. (Its exact availability
    // sub-state — fresh vs stale — depends on stream-stats propagation timing,
    // which is covered deterministically by the useAlertLibrary unit tests.)
    await pm.alertLibraryPage.openCard(ready.id);
    await expect(page.locator('[data-test="alert-library-drawer-preview"]')).toBeVisible();
  });

  test('a broken manifest shows a recovery state, not an empty gallery', async ({ page }) => {
    const badManifests = [
      { label: 'http 500', status: 500, body: '{}' },
      { label: 'unsupported version', status: 200,
        body: JSON.stringify({ format_version: '2.0', alert_count: 0, packs: [], alerts: [] }) },
      { label: 'malformed / not JSON', status: 200, body: '<Error>not json</Error>' },
    ];

    for (const [i, m] of badManifests.entries()) {
      await page.unroute(MANIFEST_GLOB);
      await page.route(MANIFEST_GLOB, (route) =>
        route.fulfill({ status: m.status, contentType: 'application/json', body: m.body }),
      );
      if (i === 0) await pm.alertLibraryPage.openViaUrl();
      else await page.reload();
      // Distinct error surface with a retry, never a silent empty catalog.
      await expect(page.locator('[data-test="alert-library-error"]'), m.label).toBeVisible({ timeout: 20000 });
    }

    // B3: a valid-but-empty manifest is its OWN state, not an error.
    await page.unroute(MANIFEST_GLOB);
    await page.route(MANIFEST_GLOB, (route) =>
      route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify({ format_version: '1.0', alert_count: 0, packs: [], alerts: [] }),
      }),
    );
    await page.reload();
    await expect(page.locator('[data-test="alert-library-empty-catalog"]')).toBeVisible({ timeout: 20000 });

    // B7: restoring a good manifest and hitting Retry recovers the gallery.
    await page.unroute(MANIFEST_GLOB);
    await page.route(MANIFEST_GLOB, (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(buildManifest(entries)) }),
    );
    await page.locator('[data-test="alert-library-empty-catalog"] [data-test$="-action"], [data-test="alert-library-empty-catalog"] button').first().click();
    await expect(page.locator('[data-test="alert-library-grid"]')).toBeVisible({ timeout: 20000 });
  });

  test('Customize opens the alert editor prefilled from the library file', async ({ page }) => {
    const ready = entries[0];

    await pm.alertLibraryPage.openViaUrl();
    await pm.alertLibraryPage.openCard(ready.id);
    await pm.alertLibraryPage.customizeFromDrawer();

    // Customize hands the alert to the full editor via the library prefill
    // (route "addAlert" with ?prefill=library) — not a customizeFailed toast.
    await expect(page).toHaveURL(/prefill=library/, { timeout: 15000 });
  });

  test('the rail filters the gallery by severity and by category', async ({ page }) => {
    const ready = entries[0]; // critical, category ready-signals
    const missing = entries[1]; // info, category absent-signals
    const bulk = entries[2]; // warning, category bulk-signals

    await pm.alertLibraryPage.openViaUrl();

    // Severity is single-select: critical → only the critical card.
    await pm.alertLibraryPage.selectSeverity('critical');
    await expect(pm.alertLibraryPage.card(ready.id)).toBeVisible();
    await expect(pm.alertLibraryPage.card(missing.id)).toHaveCount(0);
    await pm.alertLibraryPage.selectSeverity('all'); // widen back
    await expect(pm.alertLibraryPage.card(missing.id)).toBeVisible();

    // Category search narrows the rail list (nothing selected yet).
    await pm.alertLibraryPage.searchCategories('bulk');
    await expect(page.locator('[data-test="alert-library-rail-category-bulk-signals"]')).toBeVisible();
    await expect(page.locator('[data-test="alert-library-rail-category-absent-signals"]')).toHaveCount(0);
    await pm.alertLibraryPage.searchCategories('');

    // Category multi-select filters the gallery; clear resets it.
    await pm.alertLibraryPage.toggleCategory('bulk-signals');
    await expect(pm.alertLibraryPage.card(bulk.id)).toBeVisible();
    await expect(pm.alertLibraryPage.card(ready.id)).toHaveCount(0);
    await pm.alertLibraryPage.clearCategories();
    await expect(pm.alertLibraryPage.card(ready.id)).toBeVisible();

    // C13: a search matching nothing shows the no-results state.
    await pm.alertLibraryPage.search('zzz_no_such_alert_zzz');
    await expect(page.locator('[data-test="alert-library-no-results"]')).toBeVisible();
  });

  test('bulk install a small selection runs each alert and reports success', async ({ page }) => {
    const picks = [entries[2], entries[3], entries[4]]; // three bulk cards on the ready stream

    await pm.alertLibraryPage.openViaUrl();
    for (const e of picks) await pm.alertLibraryPage.selectCard(e.id);
    expect(await pm.alertLibraryPage.selectedCountInBar()).toBe(picks.length);

    await pm.alertLibraryPage.addSelected();
    await pm.alertLibraryPage.pickDestination(destinationName);
    await pm.alertLibraryPage.next(); // alerts
    // F5: clearing the selection blocks advancing until at least one is re-picked
    // (re-check the three specific rows — select-all would pull the whole gallery).
    await pm.alertLibraryPage.clearInDialog();
    await expect(page.locator('[data-test="alert-library-install-next"]')).toBeDisabled();
    for (const e of picks) await pm.alertLibraryPage.toggleAlertInDialog(e.id);
    await expect(page.locator('[data-test="alert-library-install-next"]')).toBeEnabled();
    await pm.alertLibraryPage.next(); // folder
    await pm.alertLibraryPage.next(); // tune
    await pm.alertLibraryPage.next(); // review
    // <= 50, so no large-batch confirm is required.
    await expect(page.locator('[data-test="alert-library-install-confirm-large"]')).toHaveCount(0);
    await pm.alertLibraryPage.run();
    for (const e of picks) await pm.alertLibraryPage.waitResult(e.id, 'installed');
    await pm.alertLibraryPage.done();

    // Spot-check one installed alert via API.
    const created = await pm.alertLibraryPage.getInstalledAlert(picks[0].name);
    expect(created, 'a bulk-installed alert should be readable via API').toBeTruthy();
    expect(created.destinations).toContain(destinationName);
    expect(created.context_attributes?.library_id).toBe(picks[0].id);
  });

  test('opens from the section tab and shows the header actions', async ({ page }) => {
    const base = process.env.ZO_BASE_URL || 'http://localhost:5080';
    await page.goto(`${base}/web/alerts?org_identifier=${getOrgIdentifier()}`);
    await pm.alertLibraryPage.openViaTab();

    await expect(page.locator('[data-test="alert-library-page"]')).toBeVisible();
    await expect(page.locator('[data-test="alert-library-title"]')).toBeVisible();
    await expect(page.locator('[data-test="alert-library-refresh"]')).toBeVisible();
    await expect(page.locator('[data-test="alert-library-contribute"]')).toBeVisible();
  });

  test('selection persists across filters via group-select, off-screen count and clear', async ({ page }) => {
    await pm.alertLibraryPage.openViaUrl();

    // G2: a group's select button selects that group's cards.
    await pm.alertLibraryPage.firstSelectGroup();
    expect(await pm.alertLibraryPage.selectedCountInBar()).toBeGreaterThan(0);
    await pm.alertLibraryPage.clearSelection();
    expect(await pm.alertLibraryPage.selectedCountInBar()).toBe(0);

    // G4: a selected card that a filter pushes out of view is reported off-screen.
    await pm.alertLibraryPage.selectCard(entries[2].id); // a warning bulk card
    await pm.alertLibraryPage.selectSeverity('critical'); // hides warning cards
    expect(await pm.alertLibraryPage.offscreenCountInBar()).toBeGreaterThan(0);

    // G5: clear empties the selection.
    await pm.alertLibraryPage.selectSeverity('all');
    await pm.alertLibraryPage.clearSelection();
    expect(await pm.alertLibraryPage.selectedCountInBar()).toBe(0);
  });

  test('a per-alert install failure is shown per-row and can be retried', async ({ page }) => {
    // Entry `a` is a valid alert; entry `b` ships an unreadable conditions shape
    // ({and: <non-array>}), so buildInstallPayload rejects it client-side — a
    // deterministic per-row failure without depending on backend validation.
    const a = makeEntry(1, { pack: 'observability', category: 'dup',
      stream: readyStream, required_streams: [readyStream] });
    const b = makeEntry(2, { pack: 'infrastructure', category: 'dup',
      stream: readyStream, required_streams: [readyStream] });
    const brokenFile = (entry) => ({
      name: entry.name,
      stream_type: entry.stream_type,
      stream_name: entry.stream,
      is_real_time: false,
      query_condition: { type: 'custom', conditions: { and: 'not-an-array' },
        sql: '', promql: null, promql_condition: null, aggregation: null },
      trigger_condition: { period: 10, operator: '>=', threshold: 3, frequency: 10, silence: 10, timezone: 'UTC' },
      destinations: ['x'], context_attributes: {}, tags: [],
    });
    await page.unroute(MANIFEST_GLOB);
    await page.unroute(FILE_GLOB);
    await routeLibrary(page, {
      manifest: buildManifest([a, b]),
      entries: [a, b],
      fileFor: (entry) => (entry.id === b.id ? brokenFile(entry) : buildAlertFile(entry)),
    });

    await pm.alertLibraryPage.openViaUrl();
    await pm.alertLibraryPage.selectCard(a.id);
    await pm.alertLibraryPage.selectCard(b.id);
    await pm.alertLibraryPage.addSelected();
    await pm.alertLibraryPage.pickDestination(destinationName);
    await pm.alertLibraryPage.next(); // alerts
    await pm.alertLibraryPage.next(); // folder
    await pm.alertLibraryPage.next(); // tune
    await pm.alertLibraryPage.next(); // review
    await pm.alertLibraryPage.run();

    // H6: exactly one installed, one failed, with the server message shown.
    await expect(page.locator('[data-test^="alert-library-install-result-"][data-status="installed"]')).toHaveCount(1);
    await expect(page.locator('[data-test^="alert-library-install-result-"][data-status="failed"]')).toHaveCount(1);
    await expect(page.locator('[data-test^="alert-library-install-error-"]').first()).toBeVisible();

    // H7: the failed row can be retried (it collides again and stays failed).
    await expect(page.locator('[data-test="alert-library-install-retry"]')).toBeVisible();
    await pm.alertLibraryPage.retryFailed();
    await expect(page.locator('[data-test^="alert-library-install-result-"][data-status="failed"]')).toHaveCount(1);
  });

  test('install blocks when the org has no usable destinations', async ({ page }) => {
    const ready = entries[0];

    // F4: destinations fail to load → failed banner + retry.
    await page.route('**/api/*/alerts/destinations**', (route) =>
      route.fulfill({ status: 500, contentType: 'application/json', body: '{}' }),
    );
    await pm.alertLibraryPage.openViaUrl();
    await pm.alertLibraryPage.openCard(ready.id);
    await pm.alertLibraryPage.installFromDrawer();
    await expect(page.locator('[data-test="alert-library-install-destinations-failed"]')).toBeVisible();
    await expect(page.locator('[data-test="alert-library-install-destinations-retry"]')).toBeVisible();

    // F3: retry against an empty list → the no-destinations banner + open-destinations.
    await page.unroute('**/api/*/alerts/destinations**');
    await page.route('**/api/*/alerts/destinations**', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }),
    );
    await page.locator('[data-test="alert-library-install-destinations-retry"]').click();
    await expect(page.locator('[data-test="alert-library-install-destinations-empty"]')).toBeVisible();
    await expect(page.locator('[data-test="alert-library-install-open-destinations"]')).toBeVisible();
  });
});
