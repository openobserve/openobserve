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
// real alert API and is verified by reading the created alert back. Selectors
// and element assertions live in alertLibraryPage — never inline here.
test.describe('Alert Library', () => {
  let pm;
  let lib;
  let readyStream;
  let missingStream;
  let templateName;
  let destinationName;
  let entries;

  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    pm = new PageManager(page);
    lib = pm.alertLibraryPage;

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

  test('browse, filter, preview and install a single curated alert', async () => {
    const ready = entries[0];
    const missing = entries[1];

    // Gallery renders from the mocked manifest.
    await lib.openViaUrl();
    await lib.expectGalleryVisible();

    // Readiness: missing card shows the "not ingested" chip, ready card doesn't.
    await lib.expectCardNeedsData(missing.id);
    await lib.expectCardReady(ready.id);

    // Readiness filter (stat strip) narrows to not-ready, then back.
    await lib.filterNeedsData();
    await lib.expectCardVisible(missing.id);
    await lib.expectCardAbsent(ready.id);
    await lib.filterAll();

    // Search narrows to the ready alert by title.
    await lib.search('PW Ready');
    await lib.expectCardVisible(ready.id);

    // Drawer: opens, lazy-loads the (mocked) file, shows preview + install.
    await lib.openCard(ready.id);
    await lib.expectDrawerPreviewVisible();

    // Install wizard: destination → alerts → folder(default) → tune → run.
    await lib.installFromDrawer();
    await lib.expectNextDisabled(); // F2: cannot advance until a destination is chosen
    await lib.pickDestination(destinationName);
    await lib.expectNextEnabled();
    await lib.next(); // → alerts
    await lib.next(); // → folder
    await lib.next(); // → tune
    await lib.enableTune();
    await lib.setFrequency(15);
    await lib.setSilence(20);
    await lib.next(); // → review
    await lib.run();
    await lib.waitResult(ready.id, 'installed');
    await lib.done();

    // Verify via API the transformations the UI never shows.
    const created = await lib.getInstalledAlert(ready.name);
    expect(created, 'installed alert should be readable via API').toBeTruthy();
    // I2 destination overridden (author's o2_to_slack replaced)
    expect(created.destinations).toContain(destinationName);
    // I3 provenance stamped
    expect(JSON.stringify(created.tags || [])).toContain(`pack:${ready.pack}`);
    expect(created.context_attributes?.library_id).toBe(ready.id);
    expect(created.context_attributes?.library_hash).toBe(ready.content_hash);
    // I4 severity critical → priority 1 (integer on the wire)
    expect(created.priority).toBe(1);
    // I5 owner is the installing user
    expect(typeof created.owner === 'string' && created.owner.length).toBeTruthy();
    // I7 tuning applied
    expect(created.trigger_condition?.frequency).toBe(15);
    expect(created.trigger_condition?.silence).toBe(20);
  });

  test('bulk select via select-all-in-view triggers the >50 large-batch guard', async () => {
    await lib.openViaUrl();

    // Select every card in view (1 ready + 1 missing + 51 bulk = 53 > 50).
    await lib.selectAllInViewToggle();
    expect(await lib.selectedCountInBar()).toBeGreaterThan(50);

    await lib.addSelected();
    await lib.pickDestination(destinationName);
    await lib.next(); // alerts
    await lib.next(); // folder
    await lib.next(); // tune
    await lib.next(); // review

    // Guard: confirm checkbox present, Run disabled until it is ticked.
    await lib.expectLargeConfirmVisible();
    await lib.expectRunDisabled();
    await lib.confirmLargeBatch();
    await lib.expectRunEnabled();

    // H5: the confirmation auto-resets when the run's shape changes (here, the
    // alert selection), so it always describes the run about to happen.
    await lib.back(); // → tune
    await lib.back(); // → folder
    await lib.back(); // → alerts
    await lib.clearInDialog();
    await lib.selectAllInDialog();
    await lib.next(); // folder
    await lib.next(); // tune
    await lib.next(); // review
    await lib.expectRunDisabled();
  });

  test('readiness surfaces on the card and in the drawer (fresh vs missing)', async () => {
    const ready = entries[0];
    const missing = entries[1];

    await lib.openViaUrl();

    // Card: missing → "not ingested" chip; fresh → none.
    await lib.expectCardNeedsData(missing.id);
    await lib.expectCardReady(ready.id);

    // Drawer: missing → availability warning banner; fresh → preview renders.
    await lib.openCard(missing.id);
    await lib.expectDrawerNeedsData();
    await lib.expectDrawerAvailability();
    await lib.closeDrawer();

    // The ready card's drawer renders the preview. (Its exact availability
    // sub-state — fresh vs stale — depends on stream-stats propagation timing,
    // which is covered deterministically by the useAlertLibrary unit tests.)
    await lib.openCard(ready.id);
    await lib.expectDrawerPreviewVisible();
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
      if (i === 0) await lib.openViaUrl();
      else await page.reload();
      // Distinct error surface with a retry, never a silent empty catalog.
      await lib.expectErrorState(m.label);
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
    await lib.expectEmptyCatalog();

    // B7: restoring a good manifest and hitting Retry recovers the gallery.
    await page.unroute(MANIFEST_GLOB);
    await page.route(MANIFEST_GLOB, (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(buildManifest(entries)) }),
    );
    await lib.clickEmptyCatalogRetry();
    await lib.expectGalleryVisible();
  });

  test('Customize opens the alert editor prefilled from the library file', async ({ page }) => {
    const ready = entries[0];

    await lib.openViaUrl();
    await lib.openCard(ready.id);
    await lib.customizeFromDrawer();

    // Customize hands the alert to the full editor via the library prefill
    // (route "addAlert" with ?prefill=library) — not a customizeFailed toast.
    await expect(page).toHaveURL(/prefill=library/, { timeout: 15000 });
  });

  test('the rail filters the gallery by severity and by category', async () => {
    const ready = entries[0]; // critical, category ready-signals
    const missing = entries[1]; // info, category absent-signals
    const bulk = entries[2]; // warning, category bulk-signals

    await lib.openViaUrl();

    // Severity is single-select: critical → only the critical card.
    await lib.selectSeverity('critical');
    await lib.expectCardVisible(ready.id);
    await lib.expectCardAbsent(missing.id);
    await lib.selectSeverity('all'); // widen back
    await lib.expectCardVisible(missing.id);

    // Category search narrows the rail list (nothing selected yet).
    await lib.searchCategories('bulk');
    await lib.expectRailCategoryVisible('bulk-signals');
    await lib.expectRailCategoryAbsent('absent-signals');
    await lib.searchCategories('');

    // Category multi-select filters the gallery; clear resets it.
    await lib.toggleCategory('bulk-signals');
    await lib.expectCardVisible(bulk.id);
    await lib.expectCardAbsent(ready.id);
    await lib.clearCategories();
    await lib.expectCardVisible(ready.id);

    // C13: a search matching nothing shows the no-results state.
    await lib.search('zzz_no_such_alert_zzz');
    await lib.expectNoResults();
  });

  test('bulk install a small selection runs each alert and reports success', async () => {
    const picks = [entries[2], entries[3], entries[4]]; // three bulk cards on the ready stream

    await lib.openViaUrl();
    for (const e of picks) await lib.selectCard(e.id);
    expect(await lib.selectedCountInBar()).toBe(picks.length);

    await lib.addSelected();
    await lib.pickDestination(destinationName);
    await lib.next(); // alerts
    // F5: clearing the selection blocks advancing until at least one is re-picked
    // (re-check the three specific rows — select-all would pull the whole gallery).
    await lib.clearInDialog();
    await lib.expectNextDisabled();
    for (const e of picks) await lib.toggleAlertInDialog(e.id);
    await lib.expectNextEnabled();
    await lib.next(); // folder
    await lib.next(); // tune
    await lib.next(); // review
    await lib.expectLargeConfirmAbsent(); // <= 50, so no confirm required
    await lib.run();
    for (const e of picks) await lib.waitResult(e.id, 'installed');
    await lib.done();

    // Spot-check one installed alert via API.
    const created = await lib.getInstalledAlert(picks[0].name);
    expect(created, 'a bulk-installed alert should be readable via API').toBeTruthy();
    expect(created.destinations).toContain(destinationName);
    expect(created.context_attributes?.library_id).toBe(picks[0].id);
  });

  test('opens from the section tab and shows the header actions', async ({ page }) => {
    const base = process.env.ZO_BASE_URL || 'http://localhost:5080';
    await page.goto(`${base}/web/alerts?org_identifier=${getOrgIdentifier()}`);
    await lib.openViaTab();
    await lib.expectPageHeaderVisible();
  });

  test('selection persists across filters via group-select, off-screen count and clear', async () => {
    await lib.openViaUrl();

    // G2: a group's select button selects that group's cards.
    await lib.firstSelectGroup();
    expect(await lib.selectedCountInBar()).toBeGreaterThan(0);
    await lib.clearSelection();
    expect(await lib.selectedCountInBar()).toBe(0);

    // G4: a selected card that a filter pushes out of view is reported off-screen.
    await lib.selectCard(entries[2].id); // a warning bulk card
    await lib.selectSeverity('critical'); // hides warning cards
    expect(await lib.offscreenCountInBar()).toBeGreaterThan(0);

    // G5: clear empties the selection.
    await lib.selectSeverity('all');
    await lib.clearSelection();
    expect(await lib.selectedCountInBar()).toBe(0);
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

    await lib.openViaUrl();
    await lib.selectCard(a.id);
    await lib.selectCard(b.id);
    await lib.addSelected();
    await lib.pickDestination(destinationName);
    await lib.next(); // alerts
    await lib.next(); // folder
    await lib.next(); // tune
    await lib.next(); // review
    await lib.run();

    // H6: exactly one installed, one failed, with the server message shown.
    await lib.expectInstallResultCount('installed', 1);
    await lib.expectInstallResultCount('failed', 1);
    await lib.expectInstallErrorVisible();

    // H7: the failed row can be retried (it collides again and stays failed).
    await lib.expectRetryVisible();
    await lib.retryFailed();
    await lib.expectInstallResultCount('failed', 1);
  });

  test('install blocks when the org has no usable destinations', async ({ page }) => {
    const ready = entries[0];

    // F4: destinations fail to load → failed banner + retry.
    await page.route('**/api/*/alerts/destinations**', (route) =>
      route.fulfill({ status: 500, contentType: 'application/json', body: '{}' }),
    );
    await lib.openViaUrl();
    await lib.openCard(ready.id);
    await lib.installFromDrawer();
    await lib.expectDestinationsFailed();
    await lib.expectDestinationsRetryVisible();

    // F3: retry against an empty list → the no-destinations banner + open-destinations.
    await page.unroute('**/api/*/alerts/destinations**');
    await page.route('**/api/*/alerts/destinations**', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }),
    );
    await lib.clickDestinationsRetry();
    await lib.expectDestinationsEmpty();
    await lib.expectOpenDestinationsVisible();
  });
});
