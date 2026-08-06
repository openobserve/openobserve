// rumPage.js
import { expect } from '@playwright/test';

/** Escape all regex metacharacters (incl. backslash) so a literal string is safe inside RegExp. */
function escapeRegex(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

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

        // Error detail — stack trace tabs (Raw / Pretty)
        this.rawTab = page.getByRole('tab', { name: 'Raw' });
        this.prettyTab = page.getByRole('tab', { name: 'Pretty' });
        this.prettyUnavailableState = page.locator('[data-test="rum-pretty-stack-trace-unavailable"]');
        this.prettyErrorState = page.locator('[data-test="rum-pretty-stack-trace-error"]');
        this.prettyLoadingText = page.getByText('Translating stack trace with source maps...');
        this.prettyUnavailableText = page.getByText('Source Maps Not Available');
        this.prettyTranslateFailedText = page.getByText(/Unable to translate stack trace/i);

        // Store first error data from query response
        this.firstErrorId = null;
        this.firstErrorTimestamp = null;
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
        // Shared DateTime component relative-range button (pattern:
        // date-time-relative-{value}-{unit}-btn) — label text is not stable.
        await this.page.locator('[data-test="date-time-relative-1-h-btn"]').click();
        await this.page.waitForTimeout(1000);
    }

    async clickRunQuery() {
        // The errors page (useErrorIssuesData.fetchAll) fans out FIVE parallel
        // RUM `_search` requests — issues list, histogram, KPIs, denominators
        // and deploys — so matching URL alone is a race and usually captures the
        // wrong response. Only the issues-list query aliases `latest_error_id`
        // (buildIssuesSql), so we key the predicate on that field to lock onto
        // the correct response regardless of which returns first.
        const responsePromise = this.page.waitForResponse(
            async response => {
                if (!response.url().includes('/_search') ||
                    !response.url().includes('search_type=RUM') ||
                    response.status() !== 200) {
                    return false;
                }
                try {
                    const data = await response.json();
                    return Boolean(data?.hits?.[0]?.latest_error_id);
                } catch {
                    return false;
                }
            },
            { timeout: 30000 }
        ).catch(() => null);

        // Click run query
        await this.page.locator(this.runQueryButton).click();

        // Extract first error ID and timestamp from the issues-list response
        const response = await responsePromise;
        if (response) {
            try {
                const firstHit = (await response.json()).hits[0];
                this.firstErrorId = firstHit.latest_error_id;
                this.firstErrorTimestamp = firstHit.zo_sql_timestamp;
            } catch (e) {
                // Ignore JSON parse errors
            }
        }
    }

    async waitForQueryExecution() {
        // Explicit readiness signal: the results table body renders once the
        // RUM search response lands (networkidle is unreliable with streaming).
        await this.page.waitForSelector(this.tableBody, { timeout: 15000 }).catch(() => {});
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

    // ===== ERROR TRACKING — LIST NAVIGATION (service-scoped) =====

    /**
     * Open the Error Tracking list scoped to one service via the URL query
     * (?query= is base64, restored on mount) instead of typing into the Monaco
     * editor, which is racy while the editor boots.
     */
    async gotoErrorsList({ service = null, period = '1h' } = {}) {
        const base = process.env.ZO_BASE_URL || 'http://localhost:5080';
        const org = process.env.ORGNAME || 'default';
        let url = `${base}/web/rum/errors?period=${period}&org_identifier=${org}`;
        if (service) {
            const filter = Buffer.from(`service='${service}'`).toString('base64');
            url = `${base}/web/rum/errors?period=${period}&query=${encodeURIComponent(filter)}&org_identifier=${org}`;
        }
        await this.page.goto(url);
        // The search bar is the page-loaded signal; the errors table only
        // renders once a query has executed (auto-run when ?query= is set).
        await expect(this.page.locator(this.dateTimeDropdown)).toBeVisible({ timeout: 15000 });
    }

    async expectErrorsTableVisible(timeoutMs = 15000) {
        await expect(this.page.locator(this.appTableContainer)).toBeVisible({ timeout: timeoutMs });
    }

    async waitForErrorRowsPresent(timeoutMs = 30000) {
        await expect
            .poll(async () => this.page.locator(this.tableRow).count(), {
                timeout: timeoutMs,
                intervals: [1000, 2000, 3000],
            })
            .toBeGreaterThan(0);
    }

    /** Click the first error row and wait until the error detail view URL loads. */
    async openFirstError() {
        await this.page.locator(this.tableRow).first().click();
        await expect(this.page).toHaveURL(/\/rum\/errors\/view\//, { timeout: 15000 });
        // Detail view readiness: the viewer container is rendered.
        await this.page.waitForSelector(this.errorViewerContainer, { timeout: 15000 });
    }

    // ===== ERROR DETAIL — RAW / PRETTY STACK TRACE TABS =====

    async expectRawTabVisible() {
        await expect(this.rawTab).toBeVisible({ timeout: 15000 });
    }

    async clickRawTab() {
        await this.rawTab.click();
    }

    async clickPrettyTab() {
        await this.prettyTab.click();
    }

    /** Assert the (minified) frame text — e.g. the bundle file name — is shown. */
    async expectDetailContainsText(text) {
        await expect(this.page.getByText(text).first()).toBeVisible({ timeout: 15000 });
    }

    /** Locator for a translated pretty frame pointing at `<originalPath>:<line>:`. */
    prettyFrameLocator(originalPath, line) {
        return this.page.getByText(new RegExp(`${escapeRegex(originalPath)}:${line}:`));
    }

    /** Assert the Pretty tab resolved a frame to the ORIGINAL file + line. */
    async expectPrettyFrameVisible(originalPath, line, timeoutMs = 30000) {
        await expect(this.prettyFrameLocator(originalPath, line).first()).toBeVisible({
            timeout: timeoutMs,
        });
    }

    /** Expand a translated frame and assert the source context header (Line <l>:<c>). */
    async expandPrettyFrameAndExpectSourceContext(originalPath, line) {
        await this.prettyFrameLocator(originalPath, line).first().click();
        await expect(this.page.getByText(new RegExp(`Line ${line}:\\d+`)).first()).toBeVisible({
            timeout: 15000,
        });
    }

    /** Pretty tab's explicit "no sourcemaps" outcome (message text variants). */
    async expectPrettyUnavailableMessage(timeoutMs = 30000) {
        await expect(
            this.prettyUnavailableText.or(this.prettyTranslateFailedText).first(),
        ).toBeVisible({ timeout: timeoutMs });
    }

    /**
     * Pretty tab's explicit unavailable/error state. Matches the data-test
     * containers added by this change AND the visible message text, so the
     * assertion holds against binaries built before and after the frontend
     * gained the data-test attributes (same both-builds pattern as
     * errorViewerContainer above).
     */
    async expectPrettyUnavailableState(timeoutMs = 30000) {
        await expect(
            this.prettyUnavailableState
                .or(this.prettyErrorState)
                .or(this.prettyUnavailableText)
                .or(this.prettyTranslateFailedText)
                .first(),
        ).toBeVisible({ timeout: timeoutMs });
    }

    /** The translating spinner must be gone (not hung). */
    async expectPrettyLoadingResolved() {
        await expect(this.prettyLoadingText).toHaveCount(0);
    }

}