const { test, expect } = require('../utils/enhanced-baseFixtures.js');
const PageManager = require('../../pages/page-manager.js');
const testLogger = require('../utils/test-logger.js');
const {
  MANIFEST_GLOB,
  FILE_GLOB,
  makeEntry,
  buildManifest,
  routeLibrary,
} = require('../fixtures/alertLibraryFixture.js');

// Anomaly-alert coverage for the Alert Library. On OSS `useAnomalyLibraryAccess()`
// resolves to "locked", so anomaly alerts are listed (stamped alert_type
// "anomaly_detection" from the manifest's anomaly_alerts array) but every
// interaction routes to the enterprise upgrade dialog. The manifest + files are
// mocked; selectors and assertions live in alertLibraryPage — never inline here.
test.describe('Alert Library Anomaly Alerts testcases', () => {
  test.describe.configure({ mode: 'parallel' });
  let pm;
  let lib;
  let anomalyStream;
  let anomalyStreamMissing;
  let scheduled;
  let anomalyReady;
  let anomalyMissing;

  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    pm = new PageManager(page);
    lib = pm.alertLibraryPage;

    const rand = pm.alertsPage.generateRandomString().toLowerCase();
    anomalyStream = `pw_lib_anom_${rand}`.toLowerCase();
    anomalyStreamMissing = `pw_lib_anom_missing_${rand}`.toLowerCase(); // never created → "not ingested"

    // A logs stream that EXISTS so the anomaly card reads "ready".
    await pm.commonActions.initializeAlertTestStream(anomalyStream);
    await pm.commonActions.queryStream(anomalyStream).catch(() => {}); // let it become searchable

    // One scheduled (unlocked) entry + two anomaly (locked on OSS) entries: one
    // on the ready stream, one on a stream we deliberately never create.
    scheduled = makeEntry(1, {
      name: `pw_lib_sched_${rand}`, title: 'PW Scheduled Alert', severity: 'critical',
      pack: 'observability', category: 'scheduled-signals', stream: anomalyStream,
      required_streams: [anomalyStream],
    });
    anomalyReady = makeEntry(2, {
      name: `pw_lib_anom_${rand}`, title: 'PW Anomaly Alert', severity: 'warning',
      pack: 'observability', category: 'anomaly-signals', stream: anomalyStream,
      required_streams: [anomalyStream],
    }); // no alert_type field — the page stamps "anomaly_detection" from the array it came from
    anomalyMissing = makeEntry(3, {
      name: `pw_lib_anom_missing_${rand}`, title: 'PW Anomaly Missing Alert', severity: 'info',
      pack: 'observability', category: 'anomaly-signals', stream: anomalyStreamMissing,
      required_streams: [anomalyStreamMissing],
    }); // no alert_type field

    // Anomaly entries live in `anomaly_alerts` (NOT `alerts`); `packs`/`alert_count`
    // are derived from the scheduled entries only, and format_version stays major 1.
    const manifest = {
      ...buildManifest([scheduled]),
      format_version: '1.1.0',
      anomaly_alert_count: 2,
      anomaly_alerts: [anomalyReady, anomalyMissing],
    };

    await routeLibrary(page, { manifest, entries: [scheduled, anomalyReady, anomalyMissing] });
  });

  test(
    'anomaly alerts render locked with Anomaly + Enterprise tags; scheduled cards stay unlocked',
    { tag: ['@alert-library-anomaly', '@alerts', '@P0', '@all'] },
    async () => {
      await lib.openViaUrl();
      await lib.expectCardVisible(anomalyReady.id);
      await lib.expectCardAnomalyTag(anomalyReady.id);
      await lib.expectCardEnterpriseTag(anomalyReady.id);
      await lib.expectNoEnterpriseTag(scheduled.id);
    },
  );

  test(
    'the alert-type facet appears and filtering to Anomaly narrows to anomaly cards only',
    { tag: ['@alert-library-anomaly', '@alerts', '@P0', '@all'] },
    async () => {
      await lib.openViaUrl();
      await lib.expectAlertTypeToggleVisible();
      await lib.pickAlertType('anomaly');
      await lib.expectCardVisible(anomalyReady.id);
      await lib.expectCardAbsent(scheduled.id);
      await lib.pickAlertType('all');
      await lib.expectCardVisible(scheduled.id);
    },
  );

  test(
    'clicking a locked anomaly card opens the upgrade dialog, not the drawer',
    { tag: ['@alert-library-anomaly', '@alerts', '@P0', '@all'] },
    async () => {
      await lib.openViaUrl();
      await lib.clickCardTitle(anomalyReady.id);
      await lib.expectUpgradeDialogVisible();
      await lib.expectDrawerClosed();
    },
  );

  test(
    'ticking a locked anomaly card opens the upgrade dialog and never selects it',
    { tag: ['@alert-library-anomaly', '@alerts', '@P1', '@all'] },
    async () => {
      await lib.openViaUrl();
      await lib.selectCard(anomalyReady.id);
      await lib.expectUpgradeDialogVisible();
      await lib.closeUpgradeDialog();
      await lib.expectCardNotSelected(anomalyReady.id);
      expect(await lib.selectedCountInBar()).toBe(0);
    },
  );

  test(
    'select-all-in-view selects only the scheduled cards and leaves the anomaly card unselected',
    { tag: ['@alert-library-anomaly', '@alerts', '@P1', '@all'] },
    async () => {
      await lib.openViaUrl();
      await lib.selectAllInViewToggle();
      expect(await lib.selectedCountInBar()).toBe(1);
      await lib.expectCardNotSelected(anomalyReady.id);
    },
  );

  test(
    'select-all-in-view is disabled when only locked anomaly cards are visible',
    { tag: ['@alert-library-anomaly', '@alerts', '@P1', '@all'] },
    async () => {
      await lib.openViaUrl();
      await lib.pickAlertType('anomaly');
      await lib.expectSelectAllDisabled();
      expect(await lib.selectedCountInBar()).toBe(0);
    },
  );

  test(
    'the alert-type toggle is absent when the manifest has no anomaly alerts',
    { tag: ['@alert-library-anomaly', '@alerts', '@P1', '@all'] },
    async ({ page }) => {
      await page.unroute(MANIFEST_GLOB);
      await page.unroute(FILE_GLOB);
      await routeLibrary(page, { manifest: buildManifest([scheduled]), entries: [scheduled] });
      await lib.openViaUrl();
      await lib.expectAlertTypeToggleAbsent();
      await lib.expectNoAnomalyCard();
    },
  );

  test(
    'a locked anomaly card on a missing stream shows both needs-data and the enterprise lock',
    { tag: ['@alert-library-anomaly', '@alerts', '@P2', '@all'] },
    async () => {
      await lib.openViaUrl();
      await lib.expectCardNeedsData(anomalyMissing.id);
      await lib.expectCardEnterpriseTag(anomalyMissing.id);
    },
  );

  // ── enterprise-gated / UNWIRED in OSS — parked so the pipeline surfaces them
  // as a feature gap, not a red run. Bodies stay intact for when they wire up.

  test.fixme(
    'anomaly drawer shows the training note and detection KV — not wired: LibraryDrawer.vue:99-135',
    { tag: ['@alert-library-anomaly', '@alerts', '@all'] },
    async () => {
      // Requires anomalyAccess === "enabled"; openEntry then opens the drawer
      // instead of routing locked cards to the upgrade dialog.
      await lib.openViaUrl();
      await lib.clickCardTitle(anomalyReady.id);
      await lib.expectDrawerAnomalyNote();
      await lib.expectDrawerDetection();
    },
  );

  test.fixme(
    'anomaly install runs the anomaly config and surfaces the review note — not wired: LibraryInstallDialog.vue:548-549',
    { tag: ['@alert-library-anomaly', '@alerts', '@all'] },
    async () => {
      // Requires an entitled build; an anomaly batch then installs via
      // saveAnomalyConfigMutation and the review step shows the anomaly note.
      await lib.openViaUrl();
      await lib.expectAnomalyInstallNote();
    },
  );

  test.fixme(
    'anomaly alerts are omitted from the catalog when hidden — not wired: useAlertLibrary.ts:336',
    { tag: ['@alert-library-anomaly', '@alerts', '@all'] },
    async () => {
      await lib.openViaUrl();
      await lib.expectNoAnomalyCard();
      await lib.expectAlertTypeToggleAbsent();
    },
  );
});
