// rumPage.js
import { expect } from '@playwright/test';


export class RumPage {
    constructor(page) {
        this.page = page;
        this.rumPageMenu = page.locator('[data-test="menu-link-\\/rum-item"]');

        // Error Tracking selectors
        this.dateTimeDropdown = '[data-test="logs-search-bar-date-time-dropdown"]';
        this.runQueryButton = '[data-test="errors-run-query-button"]';
        this.errorTrackingTab = 'text=Error Tracking';
        this.errorsTab = 'text=Errors';
        this.appTableContainer = '[data-test="rum-app-errors-table"]';
        this.tableBody = '[data-test="o2-table-body"]';
        this.tableRow = '[data-test^="o2-table-row-"]';
        // #12764 (scoped scss styles removal) moved this from a `.error-viewer-container`
        // class to a data-test attribute; the `.error-stacks` class below still exists.
        this.errorViewerContainer = '[data-test="error-viewer-container"]';
        this.errorStacksSection = '.error-stacks';

        // Store first error data from query response
        this.firstErrorId = null;
        this.firstErrorTimestamp = null;

        // ===== SESSIONS DASHBOARD SELECTORS =====
        // KPI metrics strip
        this.sessionsMetricsStrip = '[data-test="rum-sessions-metrics-strip"]';
        this.sessionsMetricSessionsCard = '[data-test="rum-sessions-metric-sessions-card"]';
        this.sessionsMetricSessionsValue = '[data-test="rum-sessions-metric-sessions-value"]';
        this.sessionsMetricErrorsCard = '[data-test="rum-sessions-metric-errors-card"]';
        this.sessionsMetricErrorsValue = '[data-test="rum-sessions-metric-errors-value"]';
        this.sessionsMetricFrustratedCard = '[data-test="rum-sessions-metric-frustrated-card"]';
        this.sessionsMetricFrustratedValue = '[data-test="rum-sessions-metric-frustrated-value"]';
        this.sessionsMetricDurationCard = '[data-test="rum-sessions-metric-duration-card"]';
        this.sessionsMetricDurationValue = '[data-test="rum-sessions-metric-duration-value"]';
        this.sessionsMetricBouncedCard = '[data-test="rum-sessions-metric-bounced-card"]';
        this.sessionsMetricBouncedValue = '[data-test="rum-sessions-metric-bounced-value"]';
        // Sessions run query
        this.sessionsRunQueryBtn = '[data-test="sessions-run-query-button"]';
        // Segment filters
        this.segmentFiltersContainer = '[data-test="rum-app-sessions-segment-filters"]';
        this.segmentHealthAll = '[data-test="rum-app-sessions-health-all"]';
        this.segmentHealthErrors = '[data-test="rum-app-sessions-health-errors"]';
        this.segmentHealthFrustrated = '[data-test="rum-app-sessions-health-frustrated"]';
        this.segmentHealthClean = '[data-test="rum-app-sessions-health-clean"]';
        this.segmentTypeAll = '[data-test="rum-app-sessions-type-all"]';
        this.segmentTypeEngaged = '[data-test="rum-app-sessions-type-engaged"]';
        this.segmentTypeBounced = '[data-test="rum-app-sessions-type-bounced"]';
        this.segmentDeviceAll = '[data-test="rum-app-sessions-device-all"]';
        this.segmentDeviceDesktop = '[data-test="rum-app-sessions-device-desktop"]';
        this.segmentDeviceMobile = '[data-test="rum-app-sessions-device-mobile"]';
        this.segmentDeviceTablet = '[data-test="rum-app-sessions-device-tablet"]';
        // Sessions table
        this.sessionsTable = '[data-test="rum-sessions-table"]';
        this.sessionIdText = '[data-test="rum-app-sessions-session-id-text"]';
        this.bouncedText = '[data-test="rum-app-sessions-bounced-text"]';
        this.activeText = '[data-test="rum-app-sessions-active-text"]';
        // Segment empty state
        this.segmentEmpty = '[data-test="rum-app-sessions-segment-empty"]';
        this.resetSegmentsBtn = '[data-test="rum-app-sessions-reset-segments-btn"]';
        // Health cell badges
        this.healthCell = '[data-test="rum-session-health-cell"]';
        this.healthErrorTag = '[data-test="rum-session-health-error-tag"]';
        this.healthFrustrationTag = '[data-test="rum-session-health-frustration-tag"]';
        this.healthCleanTag = '[data-test="rum-session-health-clean-tag"]';
        // Activity sparkline
        this.activityBounced = '[data-test="rum-session-activity-bounced"]';
        this.activitySparkline = '[data-test="rum-session-activity-sparkline"]';
        this.activityLoading = '[data-test="rum-session-activity-loading"]';
        this.activityEventsText = '[data-test="rum-session-activity-events-text"]';
        // Insight banner
        this.insightBanner = '[data-test="rum-sessions-insight-banner"]';
        this.insightText = '[data-test="rum-sessions-insight-text"]';
        this.insightApplyBtn = '[data-test="rum-sessions-insight-apply-btn"]';
        this.insightFilterBtn = '[data-test="rum-sessions-insight-filter-btn"]';
        this.insightOpenErrorTrackingBtn = '[data-test="rum-sessions-insight-open-error-tracking-btn"]';
    }

    async gotoRumPage() {
        await this.rumPageMenu.click();
    }

    async rumPageDefaultOrg() {
        await this.page.locator('[data-test="navbar-organizations-select"]').getByText('arrow_drop_down').click();
        await this.page.getByText('default', { exact: true }).first().click();
    }

    async rumPageDefaultMultiOrg() {
        await this.page.locator('[data-test="navbar-organizations-select"]').getByText('arrow_drop_down').click();
        await this.page.getByRole('option', { name: 'defaulttestmulti' }).locator('div').nth(2).click();
    }

    async rumPageURLValidation() {
        // TODO: Fix this test
        // await expect(this.page).not.toHaveURL(/default/);
    }

    async rumURLValidation() {
        await expect(this.page).toHaveURL(/rum/);
    }

    // ===== ERROR TRACKING PAGE METHODS =====

    async navigateToErrorTracking() {
        await this.page.locator(this.errorTrackingTab).or(this.page.locator(this.errorsTab)).first().click();
        await this.page.waitForTimeout(2000);
    }

    async expectErrorTrackingPageLoaded() {
        await expect(this.page.locator(this.dateTimeDropdown)).toBeVisible({ timeout: 10000 });
        await expect(this.page.locator(this.runQueryButton)).toBeVisible({ timeout: 5000 });
    }

    async openDateTimePicker() {
        await this.page.locator(this.dateTimeDropdown).click();
        await this.page.waitForTimeout(500);
    }

    async selectPastOneHour() {
        // The CustomDateTimePicker renders relative-time buttons with
        // data-test="date-time-relative-{value}-{unit}-btn".  "1 hour" is
        // [data-test="date-time-relative-1-h-btn"].
        const pastHourOption = this.page.locator('[data-test="date-time-relative-1-h-btn"]');
        await pastHourOption.click();
        await this.page.waitForTimeout(1000);
    }

    async clickRunQuery() {
        // Set up response listener to capture first error ID
        const responsePromise = this.page.waitForResponse(
            response => response.url().includes('/_search') &&
                       response.url().includes('search_type=RUM') &&
                       response.status() === 200,
            { timeout: 30000 }
        ).catch(() => null);

        // Click run query
        await this.page.locator(this.runQueryButton).click();

        // Try to extract first error ID and timestamp from response
        const response = await responsePromise;
        if (response) {
            try {
                const data = await response.json();
                // The response contains hits with aggregated error data
                if (data.hits && data.hits.length > 0) {
                    const firstHit = data.hits[0];
                    this.firstErrorId = firstHit.latest_error_id;
                    this.firstErrorTimestamp = firstHit.zo_sql_timestamp;
                }
            } catch (e) {
                // Ignore JSON parse errors
            }
        }
    }

    async waitForQueryExecution() {
        await this.page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
    }

    async expectErrorTableVisible() {
        await this.page.waitForSelector(this.tableBody, { timeout: 10000 }).catch(() => {});
    }

    async getErrorRowCount() {
        const rows = this.page.locator(this.tableRow);
        return await rows.count();
    }

    async clickFirstErrorRow() {
        // Wait for first data row to be visible
        await this.page.waitForSelector(this.tableRow, { state: 'visible', timeout: 10000 });

        // Workaround: Playwright clicks don't trigger Vue @click handlers (known Vue 3 + Playwright limitation)
        // Navigate to error detail by constructing URL from captured API response data
        if (!this.firstErrorId || !this.firstErrorTimestamp) {
            throw new Error('No error data available - make sure clickRunQuery was called first and captured error ID');
        }

        const currentUrl = this.page.url();
        const url = new URL(currentUrl);
        const org = url.searchParams.get('org_identifier') || process.env.ORGNAME || 'default';

        // Navigate to error detail view using error ID and timestamp
        // Route pattern: /web/rum/errors/view/:id?timestamp=<timestamp>&org_identifier=<org>
        await this.page.goto(
            `${process.env.ZO_BASE_URL}/web/rum/errors/view/${this.firstErrorId}?timestamp=${this.firstErrorTimestamp}&org_identifier=${org}`
        );

        // Wait for page to load
        await this.page.waitForTimeout(2000);
    }

    async expectErrorDetailViewLoaded() {
        await this.page.waitForSelector(this.errorViewerContainer, { timeout: 10000 });

        // Wait for loading to complete
        const loadingSpinner = this.page.locator('text=Loading').or(this.page.locator('[data-test="error-viewer-loading-indicator"]'));
        await loadingSpinner.waitFor({ state: 'hidden', timeout: 15000 }).catch(() => {});
    }

    async expectTagsSectionVisible() {
        // #12764 (scoped scss styles removal) dropped the `.tags-title` class from the
        // RUM error-detail sections; the Tags section title now carries a data-test hook.
        const tagsSection = this.page.locator('[data-test="error-tags-title"]').first();
        await expect(tagsSection).toBeVisible({ timeout: 5000 });
    }

    async getErrorViewerContainerText() {
        return await this.page.locator(this.errorViewerContainer).textContent();
    }

    async expectStackTraceVisible() {
        const stackTraceTitle = this.page.locator('text=Error Stack').or(this.page.locator('text=Stack Trace'));
        await expect(stackTraceTitle).toBeVisible({ timeout: 5000 });
    }

    async getStackTraceText() {
        const stackTraceSection = this.page.locator(this.errorStacksSection).or(this.page.locator('.error_stack')).first();
        if (await stackTraceSection.isVisible().catch(() => false)) {
            return await stackTraceSection.textContent();
        }
        return null;
    }

    async hasErrorRows() {
        await this.page.waitForSelector(this.tableRow, { timeout: 10000 }).catch(() => {});
        const rows = this.page.locator(this.tableRow);
        return (await rows.count()) > 0;
    }

    async getFirstErrorRowText() {
        const firstRow = this.page.locator(this.tableRow).first();
        return await firstRow.textContent();
    }

    // ===== SESSIONS DASHBOARD METHODS =====

    /**
     * Navigate directly to the RUM Sessions page.
     */
    async navigateToSessions() {
        await this.page.goto(`${process.env.ZO_BASE_URL}/web/rum/sessions?org_identifier=${process.env.ORGNAME || 'default'}`);
        await this.page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
    }

    /**
     * Assert the full sessions dashboard (KPI strip, filters, table) is visible.
     */
    async expectSessionsDashboardVisible() {
        await expect(this.page.locator(this.sessionsMetricsStrip)).toBeVisible({ timeout: 15000 });
        await expect(this.page.locator(this.segmentFiltersContainer)).toBeVisible({ timeout: 10000 });
        await expect(this.page.locator(this.sessionsTable)).toBeVisible({ timeout: 15000 });
    }

    /**
     * Assert the "Discover Sessions" empty state is visible (when _sessionreplay is absent).
     */
    async expectDiscoverSessionsEmptyState() {
        await expect(this.page.getByText('Discover Session')).toBeVisible({ timeout: 10000 });
    }

    /**
     * Click the sessions Run Query button and wait for query to settle.
     */
    async clickRunSessionsQuery() {
        await this.page.locator(this.sessionsRunQueryBtn).click();
        await this.page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
    }

    /**
     * Wait for the sessions table to be fully loaded (not empty/loading).
     */
    async waitForSessionsTableLoaded() {
        await this.page.locator(this.sessionsTable).waitFor({ state: 'visible', timeout: 15000 });
        // Wait for loading to resolve
        await this.page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    }

    /**
     * Get the numeric value text of a KPI metric card by key.
     * @param {'sessions'|'errors'|'frustrated'|'duration'|'bounced'} key
     * @returns {Promise<string>}
     */
    async getKpiMetricValue(key) {
        const selectorMap = {
            sessions: this.sessionsMetricSessionsValue,
            errors: this.sessionsMetricErrorsValue,
            frustrated: this.sessionsMetricFrustratedValue,
            duration: this.sessionsMetricDurationValue,
            bounced: this.sessionsMetricBouncedValue,
        };
        const selector = selectorMap[key];
        if (!selector) throw new Error(`Unknown KPI metric key: ${key}`);
        return await this.page.locator(selector).textContent();
    }

    /**
     * Click a specific KPI card by key.
     * @param {'sessions'|'errors'|'frustrated'|'bounced'} key
     */
    async clickKpiCard(key) {
        const selectorMap = {
            sessions: this.sessionsMetricSessionsCard,
            errors: this.sessionsMetricErrorsCard,
            frustrated: this.sessionsMetricFrustratedCard,
            bounced: this.sessionsMetricBouncedCard,
        };
        const selector = selectorMap[key];
        if (!selector) throw new Error(`Unknown KPI card key: ${key}`);
        await this.page.locator(selector).click();
    }

    /**
     * Assert a KPI card is visually selected (aria-pressed="true").
     * @param {'sessions'|'errors'|'frustrated'|'bounced'} key
     */
    async expectKpiCardSelected(key) {
        const selectorMap = {
            sessions: this.sessionsMetricSessionsCard,
            errors: this.sessionsMetricErrorsCard,
            frustrated: this.sessionsMetricFrustratedCard,
            bounced: this.sessionsMetricBouncedCard,
        };
        const selector = selectorMap[key];
        if (!selector) throw new Error(`Unknown KPI card key: ${key}`);
        await expect(this.page.locator(selector)).toHaveAttribute('aria-pressed', 'true');
    }

    // --- Segment filter helpers ---

    /**
     * Click a health segment toggle.
     * @param {'all'|'errors'|'frustrated'|'clean'} segment
     */
    async clickHealthSegment(segment) {
        const map = {
            all: this.segmentHealthAll,
            errors: this.segmentHealthErrors,
            frustrated: this.segmentHealthFrustrated,
            clean: this.segmentHealthClean,
        };
        const selector = map[segment];
        if (!selector) throw new Error(`Unknown health segment: ${segment}`);
        await this.page.locator(selector).click();
        await this.page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    }

    /**
     * Click a type segment toggle.
     * @param {'all'|'engaged'|'bounced'} segment
     */
    async clickTypeSegment(segment) {
        const map = {
            all: this.segmentTypeAll,
            engaged: this.segmentTypeEngaged,
            bounced: this.segmentTypeBounced,
        };
        const selector = map[segment];
        if (!selector) throw new Error(`Unknown type segment: ${segment}`);
        await this.page.locator(selector).click();
        await this.page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    }

    /**
     * Click a device segment toggle.
     * @param {'all'|'desktop'|'mobile'|'tablet'} segment
     */
    async clickDeviceSegment(segment) {
        const map = {
            all: this.segmentDeviceAll,
            desktop: this.segmentDeviceDesktop,
            mobile: this.segmentDeviceMobile,
            tablet: this.segmentDeviceTablet,
        };
        const selector = map[segment];
        if (!selector) throw new Error(`Unknown device segment: ${segment}`);
        await this.page.locator(selector).click();
        await this.page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    }

    /**
     * Assert that a segment toggle is visually active (has 'active' class or aria-pressed).
     * @param {string} segmentGroup - 'health' | 'type' | 'device'
     * @param {string} segment - the specific segment value
     */
    async expectSegmentActive(segmentGroup, segment) {
        const maps = {
            health: {
                all: this.segmentHealthAll,
                errors: this.segmentHealthErrors,
                frustrated: this.segmentHealthFrustrated,
                clean: this.segmentHealthClean,
            },
            type: {
                all: this.segmentTypeAll,
                engaged: this.segmentTypeEngaged,
                bounced: this.segmentTypeBounced,
            },
            device: {
                all: this.segmentDeviceAll,
                desktop: this.segmentDeviceDesktop,
                mobile: this.segmentDeviceMobile,
                tablet: this.segmentDeviceTablet,
            },
        };
        const groupMap = maps[segmentGroup];
        if (!groupMap) throw new Error(`Unknown segment group: ${segmentGroup}`);
        const selector = groupMap[segment];
        if (!selector) throw new Error(`Unknown segment: ${segmentGroup}.${segment}`);
        // OToggleGroup items have either aria-pressed="true" or an active class
        const locator = this.page.locator(selector);
        const isPressed = await locator.getAttribute('aria-pressed').catch(() => null);
        if (isPressed === 'true') return;
        // Fallback: check for active class
        await expect(locator).toHaveClass(/active/);
    }

    // --- Table helpers ---

    /**
     * Get the number of visible session rows in the table.
     */
    async getSessionsTableRowCount() {
        const rows = this.page.locator(`${this.sessionsTable} tbody tr`);
        return await rows.count();
    }

    /**
     * Click the first session row in the table.
     */
    async clickFirstSessionRow() {
        const firstRow = this.page.locator(`${this.sessionsTable} tbody tr`).first();
        await expect(firstRow).toBeVisible({ timeout: 10000 });
        await firstRow.click();
    }

    /**
     * Assert that navigation occurred to a session viewer page.
     */
    async expectNavigatedToSessionViewer() {
        await expect(this.page).toHaveURL(/\/web\/rum\/sessions\/view\//, { timeout: 10000 });
    }

    /**
     * Get the URL search params as an object. Useful for verifying query params
     * like start_time, end_time, org_identifier.
     */
    getCurrentSearchParams() {
        const url = new URL(this.page.url());
        return Object.fromEntries(url.searchParams.entries());
    }

    // --- Segment empty state ---

    /**
     * Click the "Reset Filters" button when segment-empty state is shown.
     */
    async clickResetSegmentsButton() {
        await this.page.locator(this.resetSegmentsBtn).click();
        await this.page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    }

    /**
     * Assert the segment-empty state ("No matching sessions") is visible.
     */
    async expectSegmentEmptyState() {
        await expect(this.page.locator(this.segmentEmpty)).toBeVisible({ timeout: 10000 });
    }

    /**
     * Assert the segment-empty state is NOT visible.
     */
    async expectSegmentEmptyStateNotVisible() {
        await expect(this.page.locator(this.segmentEmpty)).not.toBeVisible({ timeout: 10000 });
    }

    // --- Health cell badges ---

    /**
     * Assert that at least one error health tag is visible in the table.
     */
    async expectHealthErrorTagVisible() {
        await expect(this.page.locator(this.healthErrorTag).first()).toBeVisible({ timeout: 10000 });
    }

    /**
     * Assert that at least one frustration health tag is visible in the table.
     */
    async expectHealthFrustrationTagVisible() {
        await expect(this.page.locator(this.healthFrustrationTag).first()).toBeVisible({ timeout: 10000 });
    }

    /**
     * Assert that at least one clean health tag is visible in the table.
     */
    async expectHealthCleanTagVisible() {
        await expect(this.page.locator(this.healthCleanTag).first()).toBeVisible({ timeout: 10000 });
    }

    // --- Bounced / Active labels ---

    /**
     * Assert that the bounced label is visible (at least one row).
     */
    async expectBouncedLabelVisible() {
        await expect(this.page.locator(this.bouncedText).first()).toBeVisible({ timeout: 10000 });
    }

    /**
     * Assert that the active label is visible (at least one row).
     */
    async expectActiveLabelVisible() {
        await expect(this.page.locator(this.activeText).first()).toBeVisible({ timeout: 10000 });
    }

    // --- Activity sparkline ---

    /**
     * Assert that the activity sparkline is NOT visible on the page.
     * Used for bounced sessions, which should not render a sparkline.
     */
    async expectActivitySparklineNotVisible() {
        await expect(this.page.locator(this.activitySparkline)).not.toBeVisible({ timeout: 5000 });
    }

    // --- Insight banner ---

    /**
     * Assert the insight banner is visible.
     */
    async expectInsightBannerVisible() {
        await expect(this.page.locator(this.insightBanner)).toBeVisible({ timeout: 10000 });
    }

    /**
     * Click the "See sessions" apply button on the insight banner (frustration/error-spike).
     */
    async clickInsightApplyButton() {
        await this.page.locator(this.insightApplyBtn).click();
        await this.page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    }

    /**
     * Click the "See sessions" filter button on the insight banner (error cluster).
     */
    async clickInsightFilterButton() {
        await this.page.locator(this.insightFilterBtn).click();
        await this.page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    }

    /**
     * Assert URL has a specific query parameter set to an expected value.
     * @param {string} param - e.g. 'health', 'session_type', 'device'
     * @param {string} expectedValue
     */
    async expectUrlQueryParam(param, expectedValue) {
        const url = new URL(this.page.url());
        await expect(url.searchParams.get(param)).toBe(expectedValue);
    }

    /**
     * Assert URL has a specific query parameter (exists, regardless of value).
     * @param {string} param - e.g. 'error_message'
     */
    async expectUrlHasQueryParam(param) {
        const url = new URL(this.page.url());
        await expect(url.searchParams.has(param)).toBe(true);
    }

    /**
     * Check whether the insight banner is currently visible.
     * @returns {Promise<boolean>}
     */
    async isInsightBannerVisible() {
        return await this.page.locator(this.insightBanner).isVisible({ timeout: 5000 }).catch(() => false);
    }

    /**
     * Check whether the insight filter button is visible (error cluster variant).
     * @returns {Promise<boolean>}
     */
    async isInsightFilterBtnVisible() {
        return await this.page.locator(this.insightFilterBtn).isVisible({ timeout: 5000 }).catch(() => false);
    }

    /**
     * Check whether a health segment toggle is currently active.
     * @param {'errors'|'frustrated'} segment
     * @returns {Promise<boolean>}
     */
    async isHealthSegmentActive(segment) {
        const map = {
            errors: this.segmentHealthErrors,
            frustrated: this.segmentHealthFrustrated,
        };
        const selector = map[segment];
        if (!selector) return false;
        const isPressed = await this.page.locator(selector).getAttribute('aria-pressed').catch(() => null);
        return isPressed === 'true';
    }

}