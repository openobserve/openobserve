/**
 * Alerts & Incidents Tabs - E2E Tests
 *
 * ENTERPRISE FEATURE: This entire test suite validates the Alerts/Incidents
 * tab separation feature which is only available in OpenObserve Enterprise.
 * The Incidents view and all incident-related functionality require enterprise license.
 *
 * Test Suite: Validates the Alerts/Incidents tab separation feature
 * Module: Alerts
 * Priority: High (Core UX Enhancement)
 *
 * Feature: Users can switch between Alerts (configuration) and Incidents (events)
 * using distinct tabs with proper conditional rendering of view-specific UI elements.
 *
 * Consolidated Test Coverage:
 * - Test 1: View mode UI validation (tabs, elements, switching) [ENTERPRISE]
 * - Test 2: Search functionality in both views [ENTERPRISE]
 * - Test 3: Edge cases (empty states, page refresh) [ENTERPRISE]
 * - Test 4: Incident lifecycle actions (acknowledge, resolve, reopen) [ENTERPRISE - SKIPPED]
 * - Test 5: Incident detail drawer validation [ENTERPRISE - SKIPPED]
 *
 * Note: Tests 4-5 are skipped because they require incidents to exist in the system.
 * Incidents are created automatically when alerts fire on an enterprise environment.
 */

const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const PageManager = require('../../pages/page-manager.js');
const logData = require('../../fixtures/log.json');

test.describe("Alerts & Incidents Tabs", { tag: '@enterprise' }, () => {
    test.describe.configure({ mode: 'parallel' });
    let pm;
    let sharedRandomValue;

    test.beforeEach(async ({ page }, testInfo) => {
        testLogger.testStart(testInfo.title, testInfo.file);
        await navigateToBase(page);
        pm = new PageManager(page);

        // Generate shared random value for test isolation
        if (!sharedRandomValue) {
            sharedRandomValue = pm.alertsPage.generateRandomString();
            testLogger.info('Generated shared random value', { sharedRandomValue });
        }

        // Navigate directly to alerts page
        await page.goto(`${logData.alertUrl}?org_identifier=${process.env["ORGNAME"]}`);
        await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
        testLogger.info('Navigated to alerts page');

        // Wait for any loading overlays to disappear
        await pm.alertsPage.waitForLoadingOverlayToDisappear();

        // Wait for alert list page to be ready
        await pm.alertsPage.waitForAlertListPageReady();

        // Wait for view mode buttons to be visible
        await pm.alertsPage.waitForViewTabsReady();
        testLogger.info('Alert page with view buttons loaded successfully');
    });

    /**
     * Test 1: View Mode UI Validation
     * Consolidates: TC-01 through TC-06, TC-09, TC-10
     *
     * Validates:
     * - Tabs visible on page load
     * - Default view is Alerts with correct elements
     * - Incidents elements hidden in Alerts view
     * - Switch to Incidents shows correct elements
     * - Alerts elements hidden in Incidents view
     * - Bidirectional tab switching works
     * - Toggle and buttons visibility across view switches
     */
    test("View mode UI validation - tabs, elements, and switching", {
        tag: ['@alertsIncidentsTabs', '@smoke', '@P0', '@all']
    }, async ({ page }) => {
        testLogger.info('=== PHASE 1: Verify Alerts view on load ===');

        // 1.1 Verify tabs are visible
        await pm.alertsPage.expectViewModeTabsVisible();
        testLogger.info('✓ Both view tabs visible');

        // 1.2 Verify all Alerts view elements
        await pm.alertsPage.expectAlertListTableVisible();
        await pm.alertsPage.expectSearchAcrossFoldersToggleVisible();
        await pm.alertsPage.expectImportButtonVisible();
        await pm.alertsPage.expectAddAlertButtonVisible();
        await pm.alertsPage.expectAlertListSplitterVisible();
        testLogger.info('✓ All Alerts view elements visible');

        // 1.3 Verify Incidents-only elements are hidden
        await pm.alertsPage.expectIncidentsOnlyElementsHidden();
        testLogger.info('✓ Incidents elements hidden in Alerts view');

        testLogger.info('=== PHASE 2: Switch to Incidents view ===');

        // 2.1 Click Incidents tab
        await pm.alertsPage.clickIncidentsTab();

        // 2.2 Verify Incidents view elements
        await pm.alertsPage.expectIncidentsViewElementsVisible();
        testLogger.info('✓ Incidents view elements visible');

        // 2.3 Verify Alerts-only elements are hidden
        await pm.alertsPage.expectAlertListTableHidden();
        await pm.alertsPage.expectSearchAcrossFoldersToggleHidden();
        await pm.alertsPage.expectImportButtonHidden();
        await pm.alertsPage.expectAddAlertButtonHidden();
        testLogger.info('✓ Alerts elements hidden in Incidents view');

        testLogger.info('=== PHASE 3: Switch back to Alerts view ===');

        // 3.1 Click Alerts tab
        await pm.alertsPage.clickAlertsTab();

        // 3.2 Verify Alerts view elements restored
        await pm.alertsPage.expectAlertsViewElementsVisible();
        testLogger.info('✓ Alerts view elements restored');

        // 3.3 Verify toggle visible again
        await pm.alertsPage.expectSearchAcrossFoldersToggleVisible();
        testLogger.info('✓ Toggle visible in Alerts view');

        // 3.4 Verify buttons visible again
        await pm.alertsPage.expectImportButtonVisible();
        await pm.alertsPage.expectAddAlertButtonVisible();
        testLogger.info('✓ Import and Add buttons visible in Alerts view');

        // 3.5 Verify Incidents elements hidden again
        await pm.alertsPage.expectIncidentsOnlyElementsHidden();
        testLogger.info('✓ Incidents elements hidden again');

        testLogger.info('=== View mode UI validation COMPLETE ===');
    });

    /**
     * Test 2: Search Functionality in Both Views
     * Consolidates: TC-07, TC-08
     *
     * Validates:
     * - Search input works in Alerts view
     * - Search input works in Incidents view
     */
    test("Search functionality works in both views", {
        tag: ['@alertsIncidentsTabs', '@functional', '@P1', '@all', '@search']
    }, async ({ page }) => {
        const searchQuery = 'test';

        testLogger.info('=== PHASE 1: Search in Alerts view ===');

        // 1.1 Type in alert search input
        await pm.alertsPage.typeInAlertSearchInput(searchQuery);

        // 1.2 Verify search works
        await pm.alertsPage.expectAlertSearchInputFocused();
        await pm.alertsPage.expectAlertListTableVisible();
        testLogger.info('✓ Search in Alerts view works');

        testLogger.info('=== PHASE 2: Search in Incidents view ===');

        // 2.1 Switch to Incidents view
        await pm.alertsPage.clickIncidentsTab();

        // 2.2 Type in incident search input
        await pm.alertsPage.searchInIncidentsView(searchQuery);

        // 2.3 Verify search input has value and table visible
        await pm.alertsPage.expectIncidentSearchInputValue(searchQuery);
        await pm.alertsPage.expectIncidentListTableVisible();
        testLogger.info('✓ Search in Incidents view works');

        testLogger.info('=== Search functionality COMPLETE ===');
    });

    /**
     * Test 3: Edge Cases - Empty States and Page Refresh
     * Consolidates: TC-11, TC-12, TC-13
     *
     * Validates:
     * - Empty alerts list shows table container and add button
     * - Empty incidents list shows table container
     * - Page refresh preserves current view (URL state)
     */
    test("Edge cases - empty states and page refresh", {
        tag: ['@alertsIncidentsTabs', '@edgeCase', '@P2', '@all']
    }, async ({ page }) => {
        testLogger.info('=== PHASE 1: Empty Alerts state ===');

        // 1.1 Verify table container present (even if empty)
        await pm.alertsPage.expectAlertListTableVisible();

        // 1.2 Verify tabs functional
        await pm.alertsPage.expectViewModeTabsVisible();

        // 1.3 Verify Add Alert button visible (key action for empty state)
        await pm.alertsPage.expectAddAlertButtonVisible();
        testLogger.info('✓ Empty alerts state handled correctly');

        testLogger.info('=== PHASE 2: Empty Incidents state ===');

        // 2.1 Switch to Incidents view
        await pm.alertsPage.clickIncidentsTab();

        // 2.2 Verify incident table container present
        await pm.alertsPage.expectIncidentListTableVisible();
        testLogger.info('✓ Empty incidents state handled correctly');

        testLogger.info('=== PHASE 3: Page refresh preserves view ===');

        // 3.1 Verify we're in Incidents view
        await pm.alertsPage.expectIncidentsViewElementsVisible();
        const incidentsUrl = page.url();
        testLogger.info(`Incidents URL: ${incidentsUrl}`);

        // 3.2 Refresh page
        await page.reload({ waitUntil: 'networkidle', timeout: 30000 });
        testLogger.info('Page refreshed');

        // 3.3 Wait for page to stabilize
        await pm.alertsPage.waitForLoadingOverlayToDisappear();
        await page.waitForTimeout(3000);

        // 3.4 Verify still in Incidents view (URL state preserved)
        await pm.alertsPage.expectViewModeTabsVisible();
        await pm.alertsPage.expectIncidentsViewElementsVisible();
        await pm.alertsPage.expectAlertsOnlyElementsHidden();
        testLogger.info('✓ Incidents view preserved after refresh');

        // 3.5 Verify can switch back to Alerts
        await pm.alertsPage.clickAlertsTab();
        await pm.alertsPage.expectAlertsViewElementsVisible();
        testLogger.info('✓ Can switch back to Alerts after refresh');

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
            testLogger.info('=== PHASE 1: Setup - Navigate to Incidents view ===');

            // Switch to Incidents view
            await pm.alertsPage.clickIncidentsTab();
            await pm.alertsPage.waitForIncidentsToLoad();
            testLogger.info('Switched to Incidents view');

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
            testLogger.info('=== PHASE 1: Navigate to Incidents view ===');

            // Switch to Incidents view
            await pm.alertsPage.clickIncidentsTab();
            await pm.alertsPage.waitForIncidentsToLoad();
            testLogger.info('Switched to Incidents view');

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
