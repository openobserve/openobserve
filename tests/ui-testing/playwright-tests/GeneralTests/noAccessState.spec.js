/**
 * Access Denied (403) Empty State for Lists
 *
 * Verifies the generic OTable `forbidden` branch: when a list's backing fetch
 * returns HTTP 403, OTable swaps to the "You don't have access" empty state
 * (lock illustration + neutral copy, no CTA) instead of the first-run empty
 * state. Covered through the two primary, already-wired consumers — Dashboards
 * and Alerts — by intercepting the list API with `page.route` and returning
 * 403, plus a negative control proving an authorized (200) list does NOT show it.
 *
 * The 403 is produced in-test via interception because RBAC role/denial setup is
 * enterprise-only; the OSS CI run must fake the denial. No data ingestion needed.
 */

const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const PageManager = require('../../pages/page-manager.js');
const { gotoWithRetry } = require('../utils/navigation.js');
const { getOrgIdentifier } = require('../utils/cloud-auth.js');

const TAG = ['@access-denied-empty-state', '@all'];

test.describe('Access Denied (403) Empty State for Lists', () => {
  test.describe.configure({ mode: 'parallel' });
  let pm;

  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    await navigateToBase(page);
    pm = new PageManager(page);
    testLogger.info('Test setup completed');
  });

  test('should render the no-access empty state on the dashboards list when the list API returns 403', {
    tag: TAG,
  }, async ({ page }) => {
    testLogger.info('Intercepting dashboards list with 403 before navigation');
    await pm.noAccessStatePage.interceptDashboardsList403();

    const org = getOrgIdentifier();
    await gotoWithRetry(
      page,
      `${process.env.ZO_BASE_URL}/web/dashboards?org_identifier=${org}&folder=default`,
      { waitUntil: 'domcontentloaded' },
    );

    testLogger.info('Asserting forbidden state replaces the first-run empty state');
    await pm.noAccessStatePage.expectDashboardsForbiddenVisible();
    await pm.noAccessStatePage.expectForbiddenCopyVisible(pm.noAccessStatePage.dashboardsForbidden());
    await pm.noAccessStatePage.expectForbiddenIllustrationVisible(pm.noAccessStatePage.dashboardsForbidden());
    await pm.noAccessStatePage.expectNoActionInForbidden(pm.noAccessStatePage.dashboardsForbidden());
    await pm.noAccessStatePage.expectDashboardsEmptyAbsent();
    await pm.noAccessStatePage.expectDashboardsFirstRunTitleAbsent();
    testLogger.info('Test completed');
  });

  test('should render the no-access empty state on the alerts list when the list API returns 403', {
    tag: TAG,
  }, async ({ page }) => {
    testLogger.info('Intercepting alerts list with 403 before navigation');
    await pm.noAccessStatePage.interceptAlertsList403();

    const org = getOrgIdentifier();
    await gotoWithRetry(
      page,
      `${process.env.ZO_BASE_URL}/web/alerts?org_identifier=${org}`,
      { waitUntil: 'domcontentloaded' },
    );

    testLogger.info('Asserting forbidden state renders with copy and no CTA');
    await pm.noAccessStatePage.expectAlertsForbiddenVisible();
    await pm.noAccessStatePage.expectForbiddenCopyVisible(pm.noAccessStatePage.alertsForbidden());
    await pm.noAccessStatePage.expectNoActionInForbidden(pm.noAccessStatePage.alertsForbidden());
    await pm.noAccessStatePage.expectAlertsEmptyAbsent();
    testLogger.info('Test completed');
  });

  test('should not render the no-access state for an authorized dashboards list', {
    tag: TAG,
  }, async ({ page }) => {
    testLogger.info('Navigating to dashboards without a 403 intercept');

    const org = getOrgIdentifier();
    await gotoWithRetry(
      page,
      `${process.env.ZO_BASE_URL}/web/dashboards?org_identifier=${org}&folder=default`,
      { waitUntil: 'domcontentloaded' },
    );

    testLogger.info('Asserting the authorized list settles and no-access is absent');
    await pm.noAccessStatePage.expectDashboardsListSettled();
    await pm.noAccessStatePage.expectDashboardsForbiddenAbsent();
    testLogger.info('Test completed');
  });
});
