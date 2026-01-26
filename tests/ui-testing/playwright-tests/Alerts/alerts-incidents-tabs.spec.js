/**
 * Alerts & Incidents Pages - E2E Tests
 *
 * ENTERPRISE FEATURE: This test suite validates the Alerts and Incidents
 * pages which are available in OpenObserve Enterprise.
 * The Incidents page and all incident-related functionality require enterprise license.
 *
 * Test Suite: Validates navigation between Alerts and Incidents pages
 * Module: Alerts
 * Priority: High (Core UX)
 *
 * Feature: Users can navigate between Alerts (configuration) and Incidents (events)
 * using the sidebar menu. Each page has its own UI elements and functionality.
 *
 * Consolidated Test Coverage:
 * - Test 1: Page navigation and UI validation [ENTERPRISE]
 * - Test 2: Search functionality in both pages [ENTERPRISE]
 * - Test 3: Edge cases (empty states, page refresh) [ENTERPRISE]
 * - Test 4: Incident lifecycle actions (acknowledge, resolve, reopen) [ENTERPRISE - SKIPPED]
 * - Test 5: Incident detail drawer validation [ENTERPRISE - SKIPPED]
 *
 * Note: Tests 4-5 are skipped because they require incidents to exist in the system.
 * Incidents are created automatically when alerts fire on an enterprise environment.
 */

const { test, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const PageManager = require('../../pages/page-manager.js');
const logData = require('../../fixtures/log.json');

test.describe("Alerts & Incidents Pages", { tag: '@enterprise' }, () => {
    test.describe.configure({ mode: 'parallel' });
    let pm;

    test.beforeEach(async ({ page }, testInfo) => {
        testLogger.testStart(testInfo.title, testInfo.file);
        await navigateToBase(page);
        pm = new PageManager(page);

        // Navigate directly to alerts page
        await page.goto(`${logData.alertUrl}?org_identifier=${process.env["ORGNAME"]}`);
        await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
        testLogger.info('Navigated to alerts page');

        // Wait for any loading overlays to disappear
        await pm.alertsPage.waitForLoadingOverlayToDisappear();

        // Wait for alert list page to be ready
        await pm.alertsPage.waitForAlertListPageReady();
        testLogger.info('Alert page loaded successfully');
    });

    /**
     * Test 1: Page Navigation and UI Validation
     *
     * Validates:
     * - Alerts page elements visible on load
     * - Sidebar menu shows both Alerts and Incidents links
     * - Navigate to Incidents page shows correct elements
     * - Navigate back to Alerts page restores elements
     */
    test("Page navigation and UI validation - Alerts and Incidents", {
        tag: ['@alertsIncidentsTabs', '@smoke', '@P0', '@all']
    }, async ({ page }) => {
        testLogger.info('=== PHASE 1: Verify Alerts page on load ===');

        // 1.1 Verify sidebar menu items are visible
        await pm.alertsPage.expectSidebarMenuItemsVisible();
        testLogger.info('✓ Sidebar menu items visible');

        // 1.2 Verify all Alerts page elements
        await pm.alertsPage.expectAlertListTableVisible();
        await pm.alertsPage.expectSearchAcrossFoldersToggleVisible();
        await pm.alertsPage.expectImportButtonVisible();
        await pm.alertsPage.expectAddAlertButtonVisible();
        await pm.alertsPage.expectAlertListSplitterVisible();
        testLogger.info('✓ All Alerts page elements visible');

        // 1.3 Verify Incidents-only elements are hidden on Alerts page
        await pm.alertsPage.expectIncidentsOnlyElementsHidden();
        testLogger.info('✓ Incidents elements hidden on Alerts page');

        testLogger.info('=== PHASE 2: Navigate to Incidents page ===');

        // 2.1 Navigate to Incidents page via sidebar menu
        await pm.alertsPage.navigateToIncidentsPage();

        // 2.2 Verify Incidents page elements
        await pm.alertsPage.expectIncidentsViewElementsVisible();
        testLogger.info('✓ Incidents page elements visible');

        // 2.3 Verify Alerts-only elements are hidden on Incidents page
        await pm.alertsPage.expectAlertsOnlyElementsHidden();
        testLogger.info('✓ Alerts elements hidden on Incidents page');

        testLogger.info('=== PHASE 3: Navigate back to Alerts page ===');

        // 3.1 Navigate back to Alerts page via sidebar menu
        await pm.alertsPage.navigateToAlertsPage();

        // 3.2 Verify Alerts page elements restored
        await pm.alertsPage.expectAlertsViewElementsVisible();
        testLogger.info('✓ Alerts page elements restored');

        // 3.3 Verify toggle visible
        await pm.alertsPage.expectSearchAcrossFoldersToggleVisible();
        testLogger.info('✓ Toggle visible on Alerts page');

        // 3.4 Verify buttons visible
        await pm.alertsPage.expectImportButtonVisible();
        await pm.alertsPage.expectAddAlertButtonVisible();
        testLogger.info('✓ Import and Add buttons visible on Alerts page');

        // 3.5 Verify Incidents elements hidden again
        await pm.alertsPage.expectIncidentsOnlyElementsHidden();
        testLogger.info('✓ Incidents elements hidden again');

        testLogger.info('=== Page navigation UI validation COMPLETE ===');
    });

    /**
     * Test 2: Search Functionality in Both Pages
     *
     * Validates:
     * - Search input works on Alerts page
     * - Search input works on Incidents page
     */
    test("Search functionality works in both pages", {
        tag: ['@alertsIncidentsTabs', '@functional', '@P1', '@all', '@search']
    }, async ({ page }) => {
        const searchQuery = 'test';

        testLogger.info('=== PHASE 1: Search on Alerts page ===');

        // 1.1 Type in alert search input
        await pm.alertsPage.typeInAlertSearchInput(searchQuery);

        // 1.2 Verify search works
        await pm.alertsPage.expectAlertSearchInputFocused();
        await pm.alertsPage.expectAlertListTableVisible();
        testLogger.info('✓ Search on Alerts page works');

        testLogger.info('=== PHASE 2: Search on Incidents page ===');

        // 2.1 Navigate to Incidents page
        await pm.alertsPage.navigateToIncidentsPage();

        // 2.2 Type in incident search input
        await pm.alertsPage.searchInIncidentsView(searchQuery);

        // 2.3 Verify search input has value and table visible
        await pm.alertsPage.expectIncidentSearchInputValue(searchQuery);
        await pm.alertsPage.expectIncidentListTableVisible();
        testLogger.info('✓ Search on Incidents page works');

        testLogger.info('=== Search functionality COMPLETE ===');
    });

    /**
     * Test 3: Edge Cases - Empty States and Page Refresh
     *
     * Validates:
     * - Empty alerts list shows table container and add button
     * - Empty incidents list shows table container
     * - Page refresh preserves current page (URL state)
     */
    test("Edge cases - empty states and page refresh", {
        tag: ['@alertsIncidentsTabs', '@edgeCase', '@P2', '@all']
    }, async ({ page }) => {
        testLogger.info('=== PHASE 1: Empty Alerts state ===');

        // 1.1 Verify table container present (even if empty)
        await pm.alertsPage.expectAlertListTableVisible();

        // 1.2 Verify sidebar navigation functional
        await pm.alertsPage.expectSidebarMenuItemsVisible();

        // 1.3 Verify Add Alert button visible (key action for empty state)
        await pm.alertsPage.expectAddAlertButtonVisible();
        testLogger.info('✓ Empty alerts state handled correctly');

        testLogger.info('=== PHASE 2: Empty Incidents state ===');

        // 2.1 Navigate to Incidents page
        await pm.alertsPage.navigateToIncidentsPage();

        // 2.2 Verify incident table container present
        await pm.alertsPage.expectIncidentListTableVisible();
        testLogger.info('✓ Empty incidents state handled correctly');

        testLogger.info('=== PHASE 3: Page refresh preserves page ===');

        // 3.1 Verify we're on Incidents page
        await pm.alertsPage.expectIncidentsViewElementsVisible();
        const incidentsUrl = page.url();
        testLogger.info(`Incidents URL: ${incidentsUrl}`);

        // 3.2 Refresh page
        await page.reload({ waitUntil: 'networkidle', timeout: 30000 });
        testLogger.info('Page refreshed');

        // 3.3 Wait for page to stabilize
        await pm.alertsPage.waitForLoadingOverlayToDisappear();
        await page.waitForTimeout(3000);

        // 3.4 Verify still on Incidents page (URL state preserved)
        await pm.alertsPage.expectIncidentsViewElementsVisible();
        await pm.alertsPage.expectAlertsOnlyElementsHidden();
        testLogger.info('✓ Incidents page preserved after refresh');

        // 3.5 Verify can navigate to Alerts
        await pm.alertsPage.navigateToAlertsPage();
        await pm.alertsPage.expectAlertsViewElementsVisible();
        testLogger.info('✓ Can navigate to Alerts after refresh');

        testLogger.info('=== Edge cases COMPLETE ===');
    });

    /**
     * Enterprise Incident Tests (SKIPPED)
     *
     * SKIP REASON: Incidents is an enterprise-only feature. The test environment
     * (test.internal.zinclabs.dev) does not have incidents available. These tests
     * require an environment where:
     * 1. Enterprise features are enabled
     * 2. Alerts have fired and created incidents
     *
     * To enable these tests:
     * 1. Run on an enterprise environment with existing incidents
     * 2. Remove the test.describe.skip() wrapper
     *
     * Feature reference: src/service/alerts/incidents.rs
     * "Alert Incident Correlation Service (Enterprise only)"
     */
    test.describe.skip("Enterprise Incident Actions", { tag: '@enterprise' }, () => {
        test.describe.configure({ mode: 'serial' });

        /**
         * Test 4: Incident Lifecycle Actions (Enterprise Feature)
         *
         * Validates the full incident status transition cycle:
         * - Open → Acknowledged (via acknowledge button)
         * - Acknowledged → Resolved (via resolve button)
         * - Resolved → Open (via reopen button)
         *
         * PREREQUISITE: Incidents must exist on the test environment.
         * Run alert tests that trigger incidents before running this test.
         */
        test("Incident lifecycle actions - acknowledge, resolve, reopen", {
            tag: ['@alertsIncidentsTabs', '@incidentActions', '@P0', '@all', '@requiresIncidents']
        }, async ({ page }) => {
            testLogger.info('=== PHASE 1: Setup - Navigate to Incidents page ===');

            // Navigate to Incidents page
            await pm.alertsPage.navigateToIncidentsPage();
            await pm.alertsPage.waitForIncidentsToLoad();
            testLogger.info('Navigated to Incidents page');

            // Check if incidents exist on this environment
            const hasIncidents = await pm.alertsPage.hasIncidents();
            if (!hasIncidents) {
                testLogger.error('No incidents found on this environment');
                throw new Error(
                    'PREREQUISITE NOT MET: No incidents found on this test environment.\n\n' +
                    'This test requires incidents to exist. Incidents are created automatically when alerts fire.\n' +
                    'To create incidents:\n' +
                    '1. Create an alert with a condition that matches your data\n' +
                    '2. Ingest data that triggers the alert condition\n' +
                    '3. Wait for the alert to fire and create an incident\n\n' +
                    'Alternatively, run this test on an environment where alerts have already fired.'
                );
            }
            testLogger.info('✓ Incidents exist in the system');

            testLogger.info('=== PHASE 2: Acknowledge an open incident ===');

            // Click acknowledge button on first open incident
            await pm.alertsPage.clickAcknowledgeOnFirstOpenIncident();
            await pm.alertsPage.waitForStatusUpdateNotification();
            testLogger.info('✓ Clicked acknowledge button');

            // Verify acknowledge button is now hidden (status changed)
            await pm.alertsPage.expectAcknowledgeButtonHidden();
            testLogger.info('✓ Acknowledge button hidden after status change');

            // Verify resolve button is still visible
            await pm.alertsPage.expectResolveButtonVisible();
            testLogger.info('✓ Resolve button visible for acknowledged incident');

            testLogger.info('=== PHASE 3: Resolve the incident ===');

            // Click resolve button
            await pm.alertsPage.clickResolveOnFirstIncident();
            await pm.alertsPage.waitForStatusUpdateNotification();
            testLogger.info('✓ Clicked resolve button');

            // Verify resolve button is now hidden
            await pm.alertsPage.expectResolveButtonHidden();
            testLogger.info('✓ Resolve button hidden after status change');

            // Verify reopen button is now visible
            await pm.alertsPage.expectReopenButtonVisible();
            testLogger.info('✓ Reopen button visible for resolved incident');

            testLogger.info('=== PHASE 4: Reopen the incident ===');

            // Click reopen button
            await pm.alertsPage.clickReopenOnFirstResolvedIncident();
            await pm.alertsPage.waitForStatusUpdateNotification();
            testLogger.info('✓ Clicked reopen button');

            // Verify reopen button is now hidden
            await pm.alertsPage.expectReopenButtonHidden();
            testLogger.info('✓ Reopen button hidden after status change');

            // Verify acknowledge and resolve buttons are visible again (back to open state)
            await pm.alertsPage.expectAcknowledgeButtonVisible();
            await pm.alertsPage.expectResolveButtonVisible();
            testLogger.info('✓ Acknowledge and resolve buttons visible again');

            testLogger.info('=== Incident lifecycle actions COMPLETE ===');
        });

        /**
         * Test 5: Incident Detail Drawer Validation (Enterprise Feature)
         *
         * Validates the incident detail drawer functionality:
         * - Clicking incident row opens drawer
         * - Drawer shows incident title
         * - URL contains incident_id parameter
         * - Close button closes drawer
         * - URL cleaned up after close
         *
         * PREREQUISITE: Incidents must exist on the test environment.
         * Run alert tests that trigger incidents before running this test.
         */
        test("Incident detail drawer - open, view, and close", {
            tag: ['@alertsIncidentsTabs', '@incidentDrawer', '@P1', '@all', '@requiresIncidents']
        }, async ({ page }) => {
            testLogger.info('=== PHASE 1: Navigate to Incidents page ===');

            // Navigate to Incidents page
            await pm.alertsPage.navigateToIncidentsPage();
            await pm.alertsPage.waitForIncidentsToLoad();
            testLogger.info('Navigated to Incidents page');

            // Check if incidents exist on this environment
            const hasIncidents = await pm.alertsPage.hasIncidents();
            if (!hasIncidents) {
                throw new Error(
                    'PREREQUISITE NOT MET: No incidents found on this test environment.\n\n' +
                    'This test requires incidents to exist. Incidents are created automatically when alerts fire.\n' +
                    'To create incidents:\n' +
                    '1. Create an alert with a condition that matches your data\n' +
                    '2. Ingest data that triggers the alert condition\n' +
                    '3. Wait for the alert to fire and create an incident\n\n' +
                    'Alternatively, run this test on an environment where alerts have already fired.'
                );
            }
            testLogger.info('✓ Incidents exist in the system');

            testLogger.info('=== PHASE 2: Open incident detail drawer ===');

            // Click on first incident row
            await pm.alertsPage.clickFirstIncidentRow();
            testLogger.info('Clicked first incident row');

            // Verify drawer is open
            await pm.alertsPage.expectIncidentDrawerOpen();
            testLogger.info('✓ Incident drawer opened');

            // Verify URL contains incident_id
            await pm.alertsPage.expectUrlContainsIncidentId();
            testLogger.info('✓ URL contains incident_id parameter');

            testLogger.info('=== PHASE 3: Close incident detail drawer ===');

            // Close drawer
            await pm.alertsPage.closeIncidentDrawer();
            testLogger.info('Clicked close button');

            // Verify drawer is closed
            await pm.alertsPage.expectIncidentDrawerClosed();
            testLogger.info('✓ Incident drawer closed');

            // Verify URL no longer contains incident_id
            await pm.alertsPage.expectUrlNotContainsIncidentId();
            testLogger.info('✓ URL cleaned up (no incident_id)');

            testLogger.info('=== Incident detail drawer COMPLETE ===');
        });
    });
});
