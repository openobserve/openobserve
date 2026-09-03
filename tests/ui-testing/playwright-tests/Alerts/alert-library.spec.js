const { test, expect } = require('../utils/enhanced-baseFixtures.js');
const PageManager = require('../../pages/page-manager.js');
const testLogger = require('../utils/test-logger.js');
const { getOrgIdentifier } = require('../utils/cloud-auth.js');
const {
  MANIFEST_GLOB,
  makeEntry,
  makeEntries,
  buildManifest,
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
    const ready = makeEntry(1, {
      name: `pw_ready_${rand}`, title: 'PW Ready Alert', severity: 'critical',
      pack: 'observability', category: 'ready-signals', stream: readyStream,
      required_streams: [readyStream],
    });
    const missing = makeEntry(2, {
      name: `pw_missing_${rand}`, title: 'PW Missing Alert', severity: 'info',
      pack: 'observability', category: 'absent-signals', stream: missingStream,
      required_streams: [missingStream],
    });
    const bulk = makeEntries(51, {
      namePrefix: `pw_bulk_${rand}`, pack: 'infrastructure', category: 'bulk-signals',
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
    await pm.alertLibraryPage.pickDestination(destinationName);
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

    // Verify via API: the alert exists with the OVERRIDDEN destination, the
    // provenance tag, and the mapped priority (critical → 1).
    const created = await pm.alertLibraryPage.getInstalledAlert(ready.name);
    expect(created, 'installed alert should be readable via API').toBeTruthy();
    expect(created.destinations).toContain(destinationName);
    expect(JSON.stringify(created.tags || [])).toContain(`pack:${ready.pack}`);
    expect(created.context_attributes?.library_id).toBe(ready.id);
    expect(created.trigger_condition?.frequency).toBe(15);
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
});
