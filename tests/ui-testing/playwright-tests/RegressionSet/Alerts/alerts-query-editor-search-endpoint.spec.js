const { test, expect, navigateToBase } = require('../../utils/enhanced-baseFixtures.js');
const testLogger = require('../../utils/test-logger.js');
const PageManager = require('../../../pages/page-manager.js');
const { seedNotificationDestination } = require('../../utils/slo-seed.js');

const RUN_ID = Date.now().toString(36).slice(-6);
const PREFIX = `e2e_alert_11167_${RUN_ID}`;
const STREAM = 'e2e_automate';

// Run Query and Apply VRL share `triggerQuery`, so the endpoint it picks is the contract.
test.describe('Alerts query editor picks the right search endpoint', () => {
  test.describe.configure({ mode: 'serial' });
  let pm;

  test.beforeAll(async ({ browser }) => {
    const context = await browser.newContext({ storageState: 'playwright-tests/utils/auth/user.json' });
    const page = await context.newPage();
    // The self-ingest sink is loopback, which the SSRF guard refuses; this
    // destination only has to exist so Add Alert is enabled.
    await seedNotificationDestination(page, PREFIX, { url: 'https://example.com/webhook' });
    await context.close();
  });

  test.beforeEach(async ({ page }) => {
    pm = new PageManager(page);
    await navigateToBase(page);
    await pm.alertsPage.navigateToAlertsPage();
  });

  test('single-window Run Query goes to _search, never _search_multi', {
    tag: ['@bug-11167', '@P2', '@regression', '@alertsRegression', '@alertsRegressionQueryEditor']
  }, async () => {
    await pm.alertsPage.setupScheduledAlertWizardToStep2(STREAM, `${PREFIX}_single`);
    await pm.alertsPage.captureSearchRequests();

    await pm.alertsPage.clickSqlTab();
    await pm.alertsPage.clickViewEditorButton();
    await pm.alertsPage.typeSqlInEditor(`SELECT COUNT(*) as cnt FROM "${STREAM}"`);
    await pm.alertsPage.clickRunQueryAndWait();

    const endpoints = pm.alertsPage.getCapturedSearchEndpoints();
    expect(endpoints, 'Run Query must issue a search request').not.toEqual([]);
    expect(endpoints).toContain('_search');
    expect(endpoints).not.toContain('_search_multi');
    testLogger.info('Single-window query used _search', { endpoints });
  });

  test('the all-time-windows badge stays hidden without comparison windows', {
    tag: ['@bug-11167', '@P2', '@regression', '@alertsRegression', '@alertsRegressionQueryEditor']
  }, async () => {
    await pm.alertsPage.setupScheduledAlertWizardToStep2(STREAM, `${PREFIX}_badge`);

    await pm.alertsPage.clickSqlTab();
    await pm.alertsPage.clickViewEditorButton();
    await pm.alertsPage.typeSqlInEditor(`SELECT COUNT(*) as cnt FROM "${STREAM}"`);
    await pm.alertsPage.clickRunQueryAndWait();

    await expect(pm.alertsPage.getMultiWindowBadge()).toHaveCount(0);
    testLogger.info('Multi-window badge correctly absent');
  });
});
