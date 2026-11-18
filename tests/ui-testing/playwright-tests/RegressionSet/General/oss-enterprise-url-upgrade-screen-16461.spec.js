const { test, navigateToBase } = require('../../utils/enhanced-baseFixtures.js');
const testLogger = require('../../utils/test-logger.js');
const PageManager = require('../../../pages/page-manager.js');

// #16856 (#16461): pages the PR newly sent to the upgrade screen; Alert Calibration and Backfill are covered by their own specs.
const LOCKED_PAGES = [
  { route: 'logs/inspector', key: 'searchInspector', pitch: 'Inspect how a search job ran, step by step' },
  { route: 'logs/search-scheduler', key: 'scheduledSearch', pitch: 'Run a saved search automatically on a schedule' },
  { route: 'downtimes', key: 'downtimes', pitch: 'Silence alerts during planned maintenance windows.' },
  { route: 'alert-sources', key: 'incidents', pitch: 'Turn firing alerts into tracked incidents automatically.' },
  { route: 'alerts/anomaly/add', key: 'anomalyDetection', pitch: 'Catch unusual metric behavior automatically' },
  { route: 'alerts/import-semantic-groups', key: 'semanticGroups', pitch: 'Import semantic groups so related alerts correlate' },
  { route: 'ai/shared/regression-token', key: 'aiAssistant', pitch: 'Ask AI to write queries and explain your data' },
  { route: 'synthetic/private-locations/regression-location', key: 'privateLocations', pitch: 'Run synthetic checks from agents inside your own network.' },
  { route: 'infra/databases/deadlocks', key: 'dbmInsights', pitch: 'Find deadlocks, blocked queries and unhealthy tables' },
  { route: 'infra/databases/blocking', key: 'dbmInsights', pitch: 'Find deadlocks, blocked queries and unhealthy tables' },
  { route: 'infra/databases/table-health', key: 'dbmInsights', pitch: 'Find deadlocks, blocked queries and unhealthy tables' },
];

test.describe("OSS Enterprise page upgrade screen Regression", () => {
  test.describe.configure({ mode: 'parallel' });
  let pm;

  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    await navigateToBase(page);
    pm = new PageManager(page);
    const edition = await pm.editionFeaturesPage.detectEdition();
    test.skip(edition !== 'opensource', `Runs only on an OSS build (detected: ${edition})`);
  });

  for (const { route, key, pitch } of LOCKED_PAGES) {
    test(`/${route} opened by URL lands on the ${key} upgrade screen @bug-16461 @P2 @regression @oss`, async () => {
      await pm.routeGuardPage.gotoAppRoute(route);
      await pm.routeGuardPage.expectEnterpriseLocked(key, pitch);
      testLogger.info(`/${route} -> enterprise-locked?feature=${key}`);
    });
  }
});
