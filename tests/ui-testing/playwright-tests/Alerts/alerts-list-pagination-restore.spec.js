// Copyright 2026 OpenObserve Inc.

/**
 * List Pagination & Back-Navigation State Restoration — Alerts (store-backed)
 *
 * The Alerts list restores pagination via Vuex (alertListFilters.currentPage /
 * perPage), NOT via a URL `page` query param. These tests round-trip into an
 * alert's detail page and back and assert the list lands back on the page (and
 * page size) the user left — reading the pagination footer, never the URL.
 *
 * All UI selectors live in page objects (pm.alertsPage); shared API plumbing
 * lives in ../utils/alerts-api-helpers.js.
 */

const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const PageManager = require('../../pages/page-manager.js');
const { getOrgIdentifier } = require('../utils/cloud-auth.js');
const {
    BASE, uniq, simpleAlert, createAlert, findAlertId, deleteAlerts, seedAlertFixtures,
} = require('../utils/alerts-api-helpers.js');

const TOTAL_ALERTS = 25;

/**
 * Seed `count` scheduled alerts in the default folder via the API and return
 * their names + ids. Names carry a per-test unique prefix so parallel tests
 * cannot collide. Ids come from the create responses (per the setup contract),
 * falling back to a name lookup if the response omits it.
 */
async function seedAlerts(page, count) {
    const prefix = uniq('pgrestore');
    const names = Array.from({ length: count }, (_, i) => `${prefix}_${i}`);
    const ids = [];
    for (const name of names) {
        const resp = await createAlert(page, simpleAlert(name));
        expect(resp.ok(), `alert create failed for ${name}: ${resp.status()}`).toBeTruthy();
        const body = await resp.json().catch(() => ({}));
        const id = body.id || (await findAlertId(page, name));
        ids.push(id);
    }
    return { names, ids };
}

test.describe('List Pagination & Back-Navigation State Restoration (Alerts)', () => {
    test.describe.configure({ mode: 'parallel' });
    let pm;
    const createdIds = [];

    test.beforeEach(async ({ page }, testInfo) => {
        testLogger.testStart(testInfo.title, testInfo.file);
        await navigateToBase(page);
        pm = new PageManager(page);
        await seedAlertFixtures(page);
    });

    test.afterEach(async ({ page }) => {
        await deleteAlerts(page, createdIds);
        createdIds.length = 0;
    });

    test('alerts list restores page 2 after navigating to a detail page and back', {
        tag: ['@list-pagination-restore', '@all', '@alerts'],
    }, async ({ page }) => {
        const { ids } = await seedAlerts(page, TOTAL_ALERTS);
        createdIds.push(...ids);

        await page.goto(`${BASE}/web/alerts?org_identifier=${getOrgIdentifier()}`);
        await pm.alertsPage.waitForAlertListLoaded();

        await pm.alertsPage.clickNextPage();
        await pm.alertsPage.expectPaginationRange(/\b21\s*-\s*\d+/);

        // Open a page-2 alert's detail page; gate that we left the list.
        await pm.alertsPage.clickFirstVisibleAlertRow();
        await pm.alertsPage.expectAlertDetailsDialogVisible();

        await pm.alertsPage.clickHeaderBack();
        await pm.alertsPage.expectPaginationRange(/\b21\s*-\s*\d+/);
        testLogger.info('Page 2 restored after the detail round trip');
    });

    test('alerts list restores the 50-per-page size after navigating to a detail page and back', {
        tag: ['@list-pagination-restore', '@all', '@alerts'],
    }, async ({ page }) => {
        const { ids } = await seedAlerts(page, TOTAL_ALERTS);
        createdIds.push(...ids);

        await page.goto(`${BASE}/web/alerts?org_identifier=${getOrgIdentifier()}`);
        await pm.alertsPage.waitForAlertListLoaded();

        await pm.alertsPage.setPageSize(50);
        await pm.alertsPage.expectPageSizeSelected(50);

        await pm.alertsPage.clickFirstVisibleAlertRow();
        await pm.alertsPage.expectAlertDetailsDialogVisible();

        await pm.alertsPage.clickHeaderBack();
        await pm.alertsPage.expectPageSizeSelected(50);
        await pm.alertsPage.expectPaginationRange(/\b1\s*-\s*\d+/);
        testLogger.info('Page size 50 restored after the detail round trip');
    });

    test('restored page clamps to a valid single page when the list shrinks past it', {
        tag: ['@list-pagination-restore', '@all', '@alerts'],
    }, async ({ page }) => {
        const { names, ids } = await seedAlerts(page, TOTAL_ALERTS);
        createdIds.push(...ids);

        await page.goto(`${BASE}/web/alerts?org_identifier=${getOrgIdentifier()}`);
        await pm.alertsPage.waitForAlertListLoaded();

        await pm.alertsPage.clickNextPage();
        await pm.alertsPage.expectPaginationRange(/\b21\s*-\s*\d+/);

        // Shrink the list to one page, keeping the row we'll click next.
        const survivor = await pm.alertsPage.getFirstVisibleAlertName();
        const toDelete = ids.filter((_, i) => names[i] !== survivor).slice(0, 10);
        await deleteAlerts(page, toDelete);

        await pm.alertsPage.clickFirstVisibleAlertRow();
        await pm.alertsPage.expectAlertDetailsDialogVisible();

        await pm.alertsPage.clickHeaderBack();
        // The store still holds page 2, but the remaining rows no longer reach it.
        await pm.alertsPage.expectPaginationRange(/\b1\s*-\s*\d+/);
        testLogger.info('Restored page clamped to the available single page');
    });
});
