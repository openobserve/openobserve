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

// No stream is created: with nothing ready the gallery opens unfiltered, so every card stays on screen.
test.describe('Alert Library Anomaly Alerts testcases', () => {
  test.describe.configure({ mode: 'parallel' });
  let pm;
  let lib;
  let scheduled;
  let anomalyAlert;
  let anomalyMissing;

  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    pm = new PageManager(page);
    lib = pm.alertLibraryPage;

    const rand = pm.alertsPage.generateRandomString().toLowerCase();
    const stream = `pw_lib_absent_${rand}`;
    const streamMissing = `pw_lib_absent_anom_${rand}`;

    scheduled = makeEntry(1, {
      name: `pw_lib_sched_${rand}`, title: 'PW Scheduled Alert', severity: 'critical',
      pack: 'observability', category: 'scheduled-signals', stream,
      required_streams: [stream],
    });
    anomalyAlert = makeEntry(2, {
      name: `pw_lib_anom_${rand}`, title: 'PW Anomaly Alert', severity: 'warning',
      pack: 'observability', category: 'anomaly-signals', stream,
      required_streams: [stream],
    });
    anomalyMissing = makeEntry(3, {
      name: `pw_lib_anom_missing_${rand}`, title: 'PW Anomaly Missing Alert', severity: 'info',
      pack: 'observability', category: 'anomaly-signals', stream: streamMissing,
      required_streams: [streamMissing],
    });

    // The page stamps alert_type from the array an entry came from, so anomaly entries carry none.
    const manifest = {
      ...buildManifest([scheduled]),
      format_version: '1.1.0',
      anomaly_alert_count: 2,
      anomaly_alerts: [anomalyAlert, anomalyMissing],
    };

    await routeLibrary(page, { manifest, entries: [scheduled, anomalyAlert, anomalyMissing] });
  });

  test(
    'the alert-type facet appears and filtering to Anomaly narrows to anomaly cards only',
    { tag: ['@alert-library-anomaly', '@alerts', '@P0', '@all'] },
    async () => {
      await lib.openViaUrl();
      await lib.expectAlertTypeToggleVisible();
      await lib.pickAlertType('anomaly');
      await lib.expectCardVisible(anomalyAlert.id);
      await lib.expectCardAbsent(scheduled.id);
      await lib.pickAlertType('all');
      await lib.expectCardVisible(scheduled.id);
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
      await lib.expectCardVisible(scheduled.id);
      await lib.expectAlertTypeToggleAbsent();
      await lib.expectNoAnomalyCard();
    },
  );

  test.describe('locked anomaly cards on an OSS build', () => {
    // The UI also locks an enterprise bundle on an OSS backend; CI never pairs them, so build_type alone decides.
    test.beforeEach(async () => {
      const buildType = await lib.detectBuildType();
      test.skip(buildType !== 'opensource', `Anomaly access is "locked" only on OSS (build_type=${buildType})`);
    });

    test(
      'anomaly alerts render locked with Anomaly + Enterprise tags; scheduled cards stay unlocked',
      { tag: ['@alert-library-anomaly', '@alerts', '@P0', '@all'] },
      async () => {
        await lib.openViaUrl();
        await lib.expectCardVisible(anomalyAlert.id);
        await lib.expectCardAnomalyTag(anomalyAlert.id);
        await lib.expectCardEnterpriseTag(anomalyAlert.id);
        await lib.expectNoEnterpriseTag(scheduled.id);
      },
    );

    test(
      'clicking a locked anomaly card opens the upgrade dialog, not the drawer',
      { tag: ['@alert-library-anomaly', '@alerts', '@P0', '@all'] },
      async () => {
        await lib.openViaUrl();
        await lib.clickCardTitle(anomalyAlert.id);
        await lib.expectUpgradeDialogVisible();
        await lib.expectDrawerClosed();
      },
    );

    test(
      'ticking a locked anomaly card opens the upgrade dialog and never selects it',
      { tag: ['@alert-library-anomaly', '@alerts', '@P1', '@all'] },
      async () => {
        await lib.openViaUrl();
        await lib.selectCard(anomalyAlert.id);
        await lib.expectUpgradeDialogVisible();
        await lib.closeUpgradeDialog();
        await lib.expectCardNotSelected(anomalyAlert.id);
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
        await lib.expectCardNotSelected(anomalyAlert.id);
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
      'a locked anomaly card on a missing stream shows both needs-data and the enterprise lock',
      { tag: ['@alert-library-anomaly', '@alerts', '@P2', '@all'] },
      async () => {
        await lib.openViaUrl();
        await lib.expectCardNeedsData(anomalyMissing.id);
        await lib.expectCardEnterpriseTag(anomalyMissing.id);
      },
    );
  });

  test.fixme(
    'anomaly drawer shows the training note and detection KV — needs an entitled build with anomaly_detection_enabled',
    { tag: ['@alert-library-anomaly', '@alerts', '@all'] },
    async () => {
      await lib.openViaUrl();
      await lib.clickCardTitle(anomalyAlert.id);
      await lib.expectDrawerAnomalyNote();
      await lib.expectDrawerDetection();
    },
  );

  test.fixme(
    'anomaly alerts are omitted from the catalog — needs an entitled build with anomaly_detection_enabled off',
    { tag: ['@alert-library-anomaly', '@alerts', '@all'] },
    async () => {
      await lib.openViaUrl();
      await lib.expectNoAnomalyCard();
      await lib.expectAlertTypeToggleAbsent();
    },
  );
});
