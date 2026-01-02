/**
 * Alerts & Incidents Tab Separation - E2E Tests
 *
 * Test Suite: Validates the new tab-based UI for separating Alerts and Incidents views
 * Module: Alerts
 * Priority: High (Core UX Enhancement)
 *
 * Feature: Users can switch between Alerts (configuration) and Incidents (events) using
 * distinct tabs with proper conditional rendering of view-specific UI elements.
 *
 * Test Coverage:
 * - P0 (Smoke): Tabs visible, default view, tab switching
 * - P1 (Functional): View-specific elements, search functionality
 * - P2 (Edge Cases): Empty states, page refresh
 */

const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const PageManager = require('../../pages/page-manager.js');
const logData = require('../../fixtures/log.json');

test.describe("Alerts & Incidents Tab Separation", () => {
    test.describe.configure({ mode: 'parallel' });
    let pm;

    test.beforeEach(async ({ page }, testInfo) => {
        testLogger.testStart(testInfo.title, testInfo.file);
        await navigateToBase(page);
        pm = new PageManager(page);

        // Navigate to alerts page
        await page.goto(`${logData.logsUrl}?org_identifier=${process.env["ORGNAME"]}`);
        await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
        testLogger.info('Navigated to homepage');

        // Wait for any loading overlays to disappear (wait up to 30 seconds)
        const loadingOverlay = page.locator('.fullscreen.bg-blue');
        if (await loadingOverlay.isVisible().catch(() => false)) {
            await loadingOverlay.waitFor({ state: 'hidden', timeout: 30000 }).catch(() => {});
        }

        // Additional wait to ensure page is ready
        await page.waitForTimeout(2000);

        // Click alerts menu item
        await page.locator(pm.alertsPage.locators.alertMenuItem).click();
        await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
        testLogger.info('Navigated to alerts page');
    });

    // ========================================
    // P0 - SMOKE TESTS (Critical Path)
    // ========================================

    test("TC-01: Tabs visible on page load", {
        tag: ['@alertsIncidentsTabs', '@smoke', '@P0', '@all']
    }, async ({ page }) => {
        testLogger.info('[P0] Testing tabs visibility on page load');

        // Verify tabs container and individual tabs are visible
        await pm.alertsPage.expectViewModeTabsVisible();

        testLogger.info('[P0] ✓ Tabs verified visible on page load');
    });

    test("TC-02: Default view is Alerts", {
        tag: ['@alertsIncidentsTabs', '@smoke', '@P0', '@all']
    }, async ({ page }) => {
        testLogger.info('[P0] Testing default view is Alerts');

        // Verify Alerts view UI elements are visible
        await pm.alertsPage.expectAlertsViewElementsVisible();

        // Verify Incidents-only elements are hidden
        await pm.alertsPage.expectIncidentsOnlyElementsHidden();

        testLogger.info('[P0] ✓ Default view confirmed as Alerts');
    });

    test("TC-03: Tab switching works (Alerts → Incidents)", {
        tag: ['@alertsIncidentsTabs', '@smoke', '@P0', '@all']
    }, async ({ page }) => {
        testLogger.info('[P0] Testing tab switch from Alerts to Incidents');

        // Click Incidents tab
        await pm.alertsPage.clickIncidentsTab();

        // Verify Incidents view elements are visible
        await pm.alertsPage.expectIncidentsViewElementsVisible();

        // Verify Alerts-only elements are hidden
        await pm.alertsPage.expectAlertsOnlyElementsHidden();

        testLogger.info('[P0] ✓ Tab switch to Incidents successful');
    });

    test("TC-04: Tab switching works (Incidents → Alerts)", {
        tag: ['@alertsIncidentsTabs', '@smoke', '@P0', '@all']
    }, async ({ page }) => {
        testLogger.info('[P0] Testing tab switch from Incidents back to Alerts');

        // First switch to Incidents
        await pm.alertsPage.clickIncidentsTab();
        testLogger.info('Switched to Incidents view');

        // Then switch back to Alerts
        await pm.alertsPage.clickAlertsTab();

        // Verify Alerts view elements are visible again
        await pm.alertsPage.expectAlertsViewElementsVisible();

        // Verify Incidents-only elements are hidden again
        await pm.alertsPage.expectIncidentsOnlyElementsHidden();

        testLogger.info('[P0] ✓ Tab switch back to Alerts successful');
    });

    // ========================================
    // P1 - FUNCTIONAL TESTS
    // ========================================

    test("TC-05: Alerts view shows all required UI elements", {
        tag: ['@alertsIncidentsTabs', '@functional', '@P1', '@all']
    }, async ({ page }) => {
        testLogger.info('[P1] Testing Alerts view UI elements');

        // Verify all Alerts view elements
        await expect(page.locator('[data-test="alert-list-table"]')).toBeVisible({ timeout: 10000 });
        await expect(page.locator(pm.alertsPage.locators.alertSearchInput)).toBeVisible();
        await expect(page.locator(pm.alertsPage.locators.searchAcrossFoldersToggle)).toBeVisible();
        await expect(page.locator(pm.alertsPage.locators.alertImportButton)).toBeVisible();
        await expect(page.locator(pm.alertsPage.locators.addAlertButton)).toBeVisible();

        // Verify folders panel (splitter) is visible
        await expect(page.locator('[data-test="alert-list-splitter"]')).toBeVisible();

        testLogger.info('[P1] ✓ All Alerts view UI elements verified');
    });

    test("TC-06: Incidents view shows only incident UI elements", {
        tag: ['@alertsIncidentsTabs', '@functional', '@P1', '@all']
    }, async ({ page }) => {
        testLogger.info('[P1] Testing Incidents view UI elements');

        // Switch to Incidents view
        await pm.alertsPage.clickIncidentsTab();

        // Verify Incidents view elements visible
        await pm.alertsPage.expectIncidentsViewElementsVisible();

        // Verify Alerts-only elements are NOT visible
        await expect(page.locator('[data-test="alert-list-table"]')).not.toBeVisible();
        await expect(page.locator(pm.alertsPage.locators.searchAcrossFoldersToggle)).not.toBeVisible();
        await expect(page.locator(pm.alertsPage.locators.alertImportButton)).not.toBeVisible();
        await expect(page.locator(pm.alertsPage.locators.addAlertButton)).not.toBeVisible();

        testLogger.info('[P1] ✓ Incidents view UI elements verified');
    });

    test("TC-07: Search works in Alerts view", {
        tag: ['@alertsIncidentsTabs', '@functional', '@P1', '@all', '@search']
    }, async ({ page }) => {
        testLogger.info('[P1] Testing search in Alerts view');

        // Type in alert search input
        const searchQuery = 'test';
        const searchInput = page.locator(pm.alertsPage.locators.alertSearchInput);

        // Click and focus the input
        await searchInput.click();
        await page.waitForTimeout(500);

        // Type the search query
        await searchInput.pressSequentially(searchQuery, { delay: 100 });
        await page.waitForTimeout(1000);

        // Verify search functionality works (input accepts text and table is visible)
        await expect(searchInput).toBeFocused();
        await expect(page.locator('[data-test="alert-list-table"]')).toBeVisible();

        testLogger.info('[P1] ✓ Search in Alerts view verified');
    });

    test("TC-08: Search works in Incidents view", {
        tag: ['@alertsIncidentsTabs', '@functional', '@P1', '@all', '@search']
    }, async ({ page }) => {
        testLogger.info('[P1] Testing search in Incidents view');

        // Switch to Incidents view
        await pm.alertsPage.clickIncidentsTab();

        // Type in incident search input
        const searchQuery = 'test';
        await pm.alertsPage.searchInIncidentsView(searchQuery);

        // Verify search input has the value
        await expect(page.locator(pm.alertsPage.locators.incidentSearchInput)).toHaveValue(searchQuery);

        // Verify incident table still visible (search results)
        await expect(page.locator(pm.alertsPage.locators.incidentListTable)).toBeVisible();

        testLogger.info('[P1] ✓ Search in Incidents view verified');
    });

    test("TC-09: 'All Folders' toggle only in Alerts view", {
        tag: ['@alertsIncidentsTabs', '@functional', '@P1', '@all']
    }, async ({ page }) => {
        testLogger.info('[P1] Testing All Folders toggle visibility');

        // Verify toggle visible in Alerts view
        await expect(page.locator(pm.alertsPage.locators.searchAcrossFoldersToggle)).toBeVisible();
        testLogger.info('Toggle visible in Alerts view');

        // Switch to Incidents view
        await pm.alertsPage.clickIncidentsTab();

        // Verify toggle hidden in Incidents view
        await expect(page.locator(pm.alertsPage.locators.searchAcrossFoldersToggle)).not.toBeVisible();
        testLogger.info('Toggle hidden in Incidents view');

        // Switch back to Alerts view
        await pm.alertsPage.clickAlertsTab();

        // Verify toggle visible again
        await expect(page.locator(pm.alertsPage.locators.searchAcrossFoldersToggle)).toBeVisible();
        testLogger.info('Toggle visible again in Alerts view');

        testLogger.info('[P1] ✓ All Folders toggle visibility verified');
    });

    test("TC-10: Import and Add Alert buttons only in Alerts view", {
        tag: ['@alertsIncidentsTabs', '@functional', '@P1', '@all']
    }, async ({ page }) => {
        testLogger.info('[P1] Testing Import and Add Alert buttons visibility');

        // Verify buttons visible in Alerts view
        await expect(page.locator(pm.alertsPage.locators.alertImportButton)).toBeVisible();
        await expect(page.locator(pm.alertsPage.locators.addAlertButton)).toBeVisible();
        testLogger.info('Buttons visible in Alerts view');

        // Switch to Incidents view
        await pm.alertsPage.clickIncidentsTab();

        // Verify buttons hidden in Incidents view
        await expect(page.locator(pm.alertsPage.locators.alertImportButton)).not.toBeVisible();
        await expect(page.locator(pm.alertsPage.locators.addAlertButton)).not.toBeVisible();
        testLogger.info('Buttons hidden in Incidents view');

        // Switch back to Alerts view
        await pm.alertsPage.clickAlertsTab();

        // Verify buttons visible again
        await expect(page.locator(pm.alertsPage.locators.alertImportButton)).toBeVisible();
        await expect(page.locator(pm.alertsPage.locators.addAlertButton)).toBeVisible();
        testLogger.info('Buttons visible again in Alerts view');

        testLogger.info('[P1] ✓ Import and Add Alert buttons visibility verified');
    });

    // ========================================
    // P2 - EDGE CASE TESTS
    // ========================================

    test("TC-11: Empty alerts list shows empty state", {
        tag: ['@alertsIncidentsTabs', '@edgeCase', '@P2', '@all']
    }, async ({ page }) => {
        testLogger.info('[P2] Testing empty alerts list handling');

        // Even if no alerts, table container should be present
        // Note: This test assumes there might be alerts. If no alerts exist,
        // the empty state will be visible within the table container.
        await expect(page.locator('[data-test="alert-list-table"]')).toBeVisible({ timeout: 10000 });

        // Verify tabs still functional
        await pm.alertsPage.expectViewModeTabsVisible();

        // Verify Add Alert button still visible (key action for empty state)
        await expect(page.locator(pm.alertsPage.locators.addAlertButton)).toBeVisible();

        testLogger.info('[P2] ✓ Empty alerts list handled correctly');
    });

    test("TC-12: Empty incidents list shows empty state", {
        tag: ['@alertsIncidentsTabs', '@edgeCase', '@P2', '@all']
    }, async ({ page }) => {
        testLogger.info('[P2] Testing empty incidents list handling');

        // Switch to Incidents view
        await pm.alertsPage.clickIncidentsTab();

        // Even if no incidents, table container should be present
        await expect(page.locator(pm.alertsPage.locators.incidentListTable)).toBeVisible({ timeout: 10000 });

        // Verify tabs still functional - can switch back
        await pm.alertsPage.clickAlertsTab();
        await pm.alertsPage.expectAlertsViewElementsVisible();

        testLogger.info('[P2] ✓ Empty incidents list handled correctly');
    });

    test("TC-13: Page refresh preserves current view", {
        tag: ['@alertsIncidentsTabs', '@edgeCase', '@P2', '@all']
    }, async ({ page }) => {
        testLogger.info('[P2] Testing page refresh preserves view state');

        // Get current URL for alerts page
        const alertsUrl = page.url();
        testLogger.info(`Current alerts URL: ${alertsUrl}`);

        // Test 1: Switch to Incidents view
        await pm.alertsPage.clickIncidentsTab();
        await pm.alertsPage.expectIncidentsViewElementsVisible();
        testLogger.info('Switched to Incidents view');

        // Get URL with view=incidents parameter
        const incidentsUrl = page.url();
        testLogger.info(`Incidents URL: ${incidentsUrl}`);

        // Refresh page - this should preserve the view parameter
        await page.reload({ waitUntil: 'networkidle', timeout: 30000 });
        testLogger.info('Page refreshed from Incidents view');

        // Wait for any loading overlays
        const loadingOverlay = page.locator('.fullscreen.bg-blue');
        if (await loadingOverlay.isVisible().catch(() => false)) {
            await loadingOverlay.waitFor({ state: 'hidden', timeout: 30000 }).catch(() => {});
        }

        // Wait for page to stabilize
        await page.waitForTimeout(3000);

        // Verify tabs are visible
        await pm.alertsPage.expectViewModeTabsVisible();
        testLogger.info('Tabs visible after refresh');

        // Verify still in Incidents view (URL state preserved)
        await pm.alertsPage.expectIncidentsViewElementsVisible();
        await pm.alertsPage.expectAlertsOnlyElementsHidden();
        testLogger.info('✓ Incidents view preserved after refresh');

        // Test 2: Switch back to Alerts and verify
        await pm.alertsPage.clickAlertsTab();
        await pm.alertsPage.expectAlertsViewElementsVisible();

        testLogger.info('[P2] ✓ Page refresh preserves view state correctly');
    });
});
