import fs from 'fs';
import path from 'path';
import { test } from '@playwright/test';
import { expect } from '@playwright/test';
import { getAuthHeaders, getOrgIdentifier } from '../playwright-tests/utils/cloud-auth.js';
import testLogger from '../playwright-tests/utils/test-logger.js';

// Left-nav group flyouts.
// Several former top-level menu items (pipeline, functions, enrichment tables,
// ingestion, reports) were moved into hover flyout groups ("Data" and
// "Dashboards"). The group tile itself is still a navigating link
// (menu-link-/streams-item, menu-link-/dashboards-item); its absorbed children
// only appear in a flyout (teleported to <body>) after hovering the tile and
// carry a new `nav-group-item-<routeName>` data-test.
//
// `openNavFlyoutChild` hovers the owning group tile and clicks the child,
// landing on exactly the same page the old direct menu click used to.
export const NAV_GROUP_TILE = {
    data: '[data-test="menu-link-\\/streams-item"]',
    dashboards: '[data-test="menu-link-\\/dashboards-item"]',
};

// route `name` of each child within its group (matches navGroups.ts).
export const NAV_FLYOUT_CHILD = {
    pipeline: { group: 'data', name: 'pipelines' },
    functions: { group: 'data', name: 'functionList' },
    enrichment: { group: 'data', name: 'enrichmentTables' },
    ingestion: { group: 'data', name: 'ingestion' },
    streams: { group: 'data', name: 'logstreams' },
    reports: { group: 'dashboards', name: 'reports' },
};

/**
 * Hover a left-nav group tile and click one of its flyout children.
 * @param {import('@playwright/test').Page} page
 * @param {keyof typeof NAV_FLYOUT_CHILD} child - logical child key (e.g. 'pipeline')
 */
export async function openNavFlyoutChild(page, child) {
    const entry = NAV_FLYOUT_CHILD[child];
    if (!entry) throw new Error(`Unknown nav flyout child: ${child}`);
    const tile = page.locator(NAV_GROUP_TILE[entry.group]);
    await tile.waitFor({ state: 'visible', timeout: 30000 });
    const item = page.locator(`[data-test="nav-group-item-${entry.name}"]`);
    // Opening is hover-driven with a short open delay, and the flyout self-closes
    // on scroll/resize — so while the page is still settling a single hover can
    // open it only for it to be closed again before we click. Retry the
    // open-and-reveal as a unit until the child is actually visible. Move the
    // pointer away first each attempt so `hover()` always dispatches a fresh
    // `mouseenter` (a no-op move when already over the tile never re-opens it).
    await expect(async () => {
        await page.mouse.move(0, 0);
        await tile.hover();
        await expect(item).toBeVisible({ timeout: 2000 });
    }).toPass({ timeout: 30000 });
    // The pointer is still over the tile (last hover above), so the flyout stays
    // open. Force-click the child: a normal click's stability wait gives the
    // mouseleave close-timer / slide-in animation a window to detach the element
    // mid-click; force skips that wait and clicks the (already-visible) item
    // immediately on arrival, before the close timer can fire.
    await item.click({ force: true });
}

/**
 * Navigate straight to the metrics PANEL EDITOR.
 *
 * `/metrics` is the zero-query Metrics Explorer (a browse grid of metric cards);
 * the query editor — PromQL input, Apply, date picker, Add to Dashboard — now
 * lives at `/metrics/editor`. Tests that drive the editor must therefore address
 * it directly: clicking the sidebar's Metrics item lands on the explorer, which
 * has none of those controls.
 *
 * A direct `goto` rather than a sidebar click followed by an in-app hop: the
 * editor is what these tests are actually about, and one navigation is one thing
 * that can fail. Sidebar navigation itself is covered by landingPage.spec.
 */
export async function gotoMetricsEditor(page) {
    // Carry the org the page is CURRENTLY on, rather than pinning the default.
    // The sidebar click this replaced preserved the selected org, and the
    // change-org tests rely on that: they switch org, come here, and then assert
    // the new org id is still in the URL. Falling back to the configured org
    // covers the first navigation, when no org is in the URL yet.
    let orgIdentifier = getOrgIdentifier();
    try {
        orgIdentifier =
            new URL(page.url()).searchParams.get('org_identifier') || orgIdentifier;
    } catch {
        // about:blank and friends have no query string — keep the fallback.
    }

    await page.goto(
        `${process.env.ZO_BASE_URL}/web/metrics/editor?org_identifier=${orgIdentifier}`
    );
    await page.locator('[data-test="metrics-page"]').waitFor({ state: 'visible', timeout: 30000 });
}

// Common Locator exports
export var dateTimeButtonLocator='[data-test="date-time-btn"]';
export var relative30SecondsButtonLocator='[data-test="date-time-relative-30-s-btn"]';
export var absoluteTabLocator='[data-test="date-time-absolute-tab"]';
export var Past30SecondsValue='Past 30 Seconds';
export var startTimeValue='01:01:01';
export var endTimeValue='02:02:02';
export var startDateTimeValue='2024/10/01 01:01:01';
export var endDateTimeValue='2024/10/01 02:02:02';

export class CommonActions {
    constructor(page) {
        this.page = page;
        
        // Navigation locators
        this.alertsMenuItem = '[data-test="menu-link-\\/alerts-item"]';
        this.settingsMenuItem = '[data-test="menu-link-/settings-item"]';
        this.homeMenuItem = '[data-test="menu-link-\\/-item"]';
    }

    async navigateToAlerts() {
        await this.page.locator(this.alertsMenuItem).click();
        await this.page.waitForTimeout(2000);
        // Check for alerts page loaded - use alert list page element
        await expect(this.page.locator('[data-test="alert-list-page"]')).toBeVisible();
    }

    async navigateToSettings() {
        await this.page.locator(this.settingsMenuItem).click();
        await this.page.waitForTimeout(2000);
    }

    async navigateToHome() {
        await this.page.locator(this.homeMenuItem).click();
        await this.page.waitForTimeout(2000);
    }

    /**
     * Helper method to scroll through a dropdown to find and click an option
     * @param {string} optionName - Name of the option to find
     * @param {string} optionType - Type of option ('template' or 'folder')
     * @returns {Promise<boolean>} - Whether the option was found
     */
    async scrollAndFindOption(optionName, optionType) {
        // Target the visible dropdown — OSelect (Reka Listbox) post-migration,
        // legacy select pre-migration.
        const dropdown = this.page.locator('[data-test$="-popover"]').first();

        // Fast path for the migrated OSelect: it renders a ListboxFilter search input
        // (`[data-test$="-search"]`) plus per-option rows whose NAME is on
        // `data-test-label` (data-test-value carries the option's value/id, which for
        // folders is a hash, not the name). Filtering by search makes the target render
        // without manual scroll — the legacy scroll loop below can't drive a
        // virtualized/searchable OSelect (e.g. folder-move + template dropdowns on newer
        // builds). Fall through to scrolling if no search input is present.
        const searchInput = dropdown.locator('[data-test$="-search"], input[type="search"], input[type="text"]').first();
        if (await searchInput.isVisible({ timeout: 1500 }).catch(() => false)) {
            for (let attempt = 1; attempt <= 3; attempt++) {
                await searchInput.fill('');
                await searchInput.fill(optionName);
                await this.page.waitForTimeout(800);
                // Match by label (name), then value, then visible text.
                const candidates = [
                    dropdown.locator(`[data-test-label="${optionName}"]`).first(),
                    dropdown.locator(`[data-test-value="${optionName}"]`).first(),
                    dropdown.getByText(optionName, { exact: true }).first(),
                ];
                for (const option of candidates) {
                    if (await option.isVisible({ timeout: 1500 }).catch(() => false)) {
                        await option.click();
                        testLogger.debug(`Found ${optionType} via OSelect search: ${optionName}`);
                        await this.page.waitForTimeout(500);
                        return true;
                    }
                }
            }
            testLogger.warn(`OSelect search did not surface ${optionType} "${optionName}", falling back to scroll`, {});
        }

        let optionFound = false;
        let maxScrolls = 50;
        let scrollAmount = 1000;
        let totalScrolled = 0;

        while (!optionFound && maxScrolls > 0) {
            try {
                // Try to find and click the option — scope to the dropdown so a stray
                // page-wide text match (list rows behind the form, echoed search text)
                // can't be clicked and falsely reported as a successful selection.
                const option = optionType === 'template'
                    ? dropdown.getByText(optionName, { exact: true })
                    : dropdown.getByRole('option', { name: optionName });
                
                if (await option.isVisible()) {
                    if (optionType === 'template') {
                        await option.click();
                    } else {
                        await option.locator('span').click();
                    }
                    optionFound = true;
                    testLogger.debug(`Found ${optionType} after scrolling: ${optionName}`);
                    await this.page.waitForTimeout(500);
                } else {
                    // Get the current scroll position and height
                    const { scrollTop, scrollHeight, clientHeight } = await dropdown.evaluate(el => ({
                        scrollTop: el.scrollTop,
                        scrollHeight: el.scrollHeight,
                        clientHeight: el.clientHeight
                    }));

                    // If we've scrolled to the bottom, start from the top again
                    if (scrollTop + clientHeight >= scrollHeight) {
                        await dropdown.evaluate(el => el.scrollTop = 0);
                        totalScrolled = 0;
                        await this.page.waitForTimeout(500);
                    } else {
                        // Scroll down
                        await dropdown.evaluate((el, amount) => el.scrollTop += amount, scrollAmount);
                        totalScrolled += scrollAmount;
                        await this.page.waitForTimeout(500);
                    }
                    maxScrolls--;
                }
            } catch (error) {
                // If option not found, scroll and try again
                await dropdown.evaluate((el, amount) => el.scrollTop += amount, scrollAmount);
                totalScrolled += scrollAmount;
                await this.page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
                maxScrolls--;
            }
        }

        if (!optionFound) {
            testLogger.error(`Failed to find ${optionType} ${optionName} after scrolling ${totalScrolled}px`);
            throw new Error(`${optionType} ${optionName} not found in dropdown after scrolling`);
        }

        return optionFound;
    }

    async ingestTestData(streamName) {
        const headers = getAuthHeaders();
        const baseUrl = process.env["ZO_BASE_URL"];
        const orgName = getOrgIdentifier();
        const data = [{"level":"info","job":"test","log":"test message for openobserve. this data ingestion has been done using a playwright automation script."}];
        const ingestUrl = `${baseUrl}/api/${orgName}/${streamName}/_json`;
        const listUrl = `${baseUrl}/api/${orgName}/streams?type=logs`;

        // Ingest with a retry loop around the "stream is being deleted" race.
        // Shared fixed-name streams (e.g. auto_playwright_stream) are deleted by
        // cleanup.spec.js at the start of the shard, and OpenObserve deletes streams
        // ASYNCHRONOUSLY. An ingest that lands while the background deletion is still in
        // progress is rejected with:
        //   400 {"message":"Error# stream [<name>] is being deleted"}
        // Previously the response status was never checked, so this 400 was silently
        // swallowed: the stream was never (re)created, the alert wizard's stream dropdown
        // stayed empty, and the whole test burned ~8 min of dropdown retries before timing
        // out. Here we detect the in-flight deletion, wait for it to clear, then re-POST to
        // recreate the stream so callers get a stream that actually exists.
        let responseData;
        let ingested = false;
        const maxIngestAttempts = 12; // ~55s worst case; deletion under load can be slow
        for (let attempt = 1; attempt <= maxIngestAttempts; attempt++) {
            const response = await this.page.request.post(ingestUrl, { headers, data });
            responseData = await response.json().catch(() => ({ error: 'Failed to parse JSON' }));
            testLogger.debug('Ingestion response', { response: responseData, status: response.status(), attempt });

            if (response.ok()) { ingested = true; break; }

            const msg = (responseData && responseData.message) || '';
            if (/is being deleted/i.test(msg)) {
                // Stream is mid-deletion. Wait for it to fully drop out of the list before
                // retrying, so the next POST recreates it fresh instead of being rejected.
                testLogger.warn('Stream is mid-deletion, waiting for it to clear before re-ingesting', { streamName, attempt });
                await this.page.waitForTimeout(5000);
                continue;
            }
            // Any other error is not something a retry can fix — stop and let the poll below
            // surface the missing stream.
            testLogger.warn('Ingestion returned an unexpected error', { streamName, status: response.status(), response: responseData });
            break;
        }
        if (!ingested) {
            testLogger.warn('Ingest did not succeed after retries', { streamName });
        }

        // Poll the streams API until this stream is registered before returning. Callers
        // open the alert wizard right after and pick this stream from the dropdown; under
        // concurrent CI load the wizard's stream-list fetch can run before registration
        // completes, so the freshly-ingested stream never renders as an option (the exact
        // failure seen for auto_playwright_stream). Mirrors initializeAlertTestStream.
        // 90s budget to match initializeAlertTestStream — cloud stream registration under
        // concurrent full-suite load can exceed 60s; a late-but-present stream avoids the
        // downstream "wizard stream dropdown empty" flake. Returns immediately once registered.
        let registered = false;
        for (let i = 0; i < 90 && !registered; i++) {
            const listResp = await this.page.request.get(listUrl, { headers }).catch(() => null);
            if (listResp && listResp.ok()) {
                const body = await listResp.json().catch(() => null);
                registered = (body?.list || []).some(s => s.name === streamName);
            }
            if (!registered) await this.page.waitForTimeout(1000);
        }
        if (!registered) {
            testLogger.warn('Stream not confirmed in streams list after ingest', { streamName });
        }

        testLogger.info('Successfully ingested test data', { streamName, registered });
        return responseData;
    }

    /**
     * Ingest test data with a unique identifier for alert trigger validation
     * This allows us to identify specific test data in the validation stream
     * @param {string} streamName - Name of the stream to ingest data into
     * @param {string} uniqueId - Unique identifier for this test run (e.g., randomValue)
     * @param {string} triggerField - Field name that the alert condition will check (default: 'city')
     * @param {string} triggerValue - Value that will trigger the alert condition (default: 'bangalore')
     * @returns {Promise<{uniqueId: string, timestamp: number}>}
     */
    async ingestTestDataWithUniqueId(streamName, uniqueId, triggerField = 'city', triggerValue = 'bangalore') {
        const timestamp = Date.now();
        const testData = {
            city: triggerField === 'city' ? triggerValue : 'mumbai',
            country: 'india',
            status: 'active',
            age: 25,
            test_run_id: uniqueId,
            test_timestamp: timestamp,
            message: `Alert trigger test - run_id: ${uniqueId}`
        };

        const headers = getAuthHeaders();
        const baseUrl = process.env["ZO_BASE_URL"];
        const orgName = getOrgIdentifier();

        testLogger.debug(`Ingesting test data with unique ID: ${uniqueId}`, { streamName, triggerField, triggerValue });

        const response = await this.page.request.post(`${baseUrl}/api/${orgName}/${streamName}/_json`, {
            headers,
            data: [testData]
        });
        const responseData = await response.json().catch(() => ({ error: 'Failed to parse JSON' }));
        testLogger.debug('Ingested test data response', { response: responseData });
        testLogger.info(`Successfully ingested test data with unique ID: ${uniqueId}`);
        return { uniqueId, timestamp };
    }

    /**
     * Create and initialize a dedicated alert test stream with custom columns
     * This ensures we have predictable columns for alert condition testing
     * @param {string} streamName - Name of the stream to create/initialize
     * @returns {Promise<{streamName: string, columns: string[]}>}
     */
    async initializeAlertTestStream(streamName) {
        const headers = getAuthHeaders();
        const baseUrl = process.env["ZO_BASE_URL"];
        const orgName = getOrgIdentifier();

        const initialData = [
            {
                city: 'delhi',
                country: 'india',
                status: 'inactive',
                age: 30,
                test_run_id: 'init',
                test_timestamp: Date.now(),
                message: 'Stream initialization record'
            }
        ];

        testLogger.info(`Initializing alert test stream: ${streamName}`);

        const response = await this.page.request.post(`${baseUrl}/api/${orgName}/${streamName}/_json`, {
            headers,
            data: initialData
        });
        const responseData = await response.json().catch(() => ({ error: 'Failed to parse JSON' }));
        testLogger.debug('Stream initialization response', { response: responseData });
        if (!response.ok()) {
            throw new Error(`Stream initialization ingest failed for ${streamName}: ${response.status()} ${JSON.stringify(responseData)}`);
        }

        // Poll the streams API until the new stream is registered. Consumers reload the
        // page immediately after this call; if the SPA fetches its stream list before
        // registration completes, the stale list is cached and the alert wizard's
        // stream dropdown never shows the stream.
        // Registration MUST complete before the caller's page load — the alert wizard's
        // stream dropdown is populated from the SPA's stream-list fetch at page load, so a
        // stream that registers after that never renders as an option. Budget = 90s (was 15s):
        // on the shared cloud alpha org the streams-list registration routinely exceeds 60s
        // while the full multi-shard suite ingests concurrently (global-setup budgets 90s for
        // the same indexing). Empirically ~40% of the self-seeded alert_e2e_* / alert_import_*
        // streams missed a 60s window under full load; 90s matches the proven global-setup cap.
        // Returns the instant the stream registers, so the healthy case stays fast.
        //
        // NON-FATAL on timeout: don't throw. The stream IS ingested and will register shortly;
        // the caller does template/folder setup (tens of seconds) then reloads before the
        // wizard opens, giving registration extra real time. Throwing here turned a slow-but-
        // recoverable registration into a hard test failure in beforeEach. Surface it as a
        // warning and let the point-of-use stream selection be the real gate.
        const listUrl = `${baseUrl}/api/${orgName}/streams?type=logs`;
        const maxWaitSeconds = 90;
        let registered = false;
        for (let i = 0; i < maxWaitSeconds && !registered; i++) {
            const listResp = await this.page.request.get(listUrl, { headers }).catch(() => null);
            if (listResp && listResp.ok()) {
                const body = await listResp.json().catch(() => null);
                registered = (body?.list || []).some(s => s.name === streamName);
            }
            if (!registered) await this.page.waitForTimeout(1000);
        }
        if (!registered) {
            testLogger.warn(`Stream ${streamName} not confirmed in streams list within ${maxWaitSeconds}s of ingestion — proceeding; point-of-use selection will retry`, { streamName });
        }

        testLogger.info(`Initialized stream: ${streamName}`, { registered });
        return {
            streamName,
            registered,
            columns: ['city', 'country', 'status', 'age', 'test_run_id', 'test_timestamp', 'message']
        };
    }

    async ingestCustomTestData(streamName) {
        const headers = getAuthHeaders();
        const baseUrl = process.env["ZO_BASE_URL"];
        const orgName = getOrgIdentifier();

        // Read custom test data from file (equivalent to curl -d @utils/td150.json)
        const dataPath = path.resolve(__dirname, '..', 'utils', 'td150.json');
        const data = JSON.parse(fs.readFileSync(dataPath, 'utf-8'));

        const response = await this.page.request.post(`${baseUrl}/api/${orgName}/${streamName}/_json`, {
            headers,
            data
        });
        const responseData = await response.json().catch(() => ({ error: 'Failed to parse JSON' }));
        testLogger.debug('Custom test data response', { response: responseData });
        testLogger.info('Successfully ingested custom test data');
        return responseData;
    }

    /**
     * Helper method to conditionally ingest test data based on test title
     * Skips data ingestion for scheduled alert tests
     * @param {string} testTitle - The title of the current test
     * @param {string} streamName - The stream name for data ingestion
     */
    async skipDataIngestionForScheduledAlert(testTitle, streamName = 'auto_playwright_stream') {
        // Skip data ingestion for scheduled alert test
        if (!testTitle.includes('Scheduled Alert')) {
            // Ingest test data using common actions
            await this.ingestTestData(streamName);
        }
    }

    // Dismiss any blocking overlays/modals that might intercept clicks
    async dismissBlockingOverlays() {
        for (let i = 0; i < 3; i += 1) {
            const dialog = this.page.locator('[data-test$="-dialog"]');
            const count = await dialog.count();
            const visible = count > 0 ? await dialog.first().isVisible().catch(() => false) : false;
            if (!visible) break;
            await this.page.locator('body').click({ position: { x: 10, y: 10 } }).catch(() => {});
            await dialog.first().waitFor({ state: 'hidden', timeout: 1000 }).catch(() => {});
            await this.page.waitForTimeout(150);
        }
    }

    // Return boolean streaming state from Organization settings toggle
    async getStreamingState() {
        const root = this.page.locator('[data-test="general-settings-enable-streaming"]').first();
        await root.waitFor({ state: 'visible', timeout: 10000 });
        const ariaChecked = await root.getAttribute('aria-checked');
        return ariaChecked === 'true';
    }

    // Flip streaming toggle, save, wait for toast, reload, and verify state
    async flipStreaming() {
        await this.dismissBlockingOverlays();
        try {
            await this.page.locator('[data-test="menu-link-/settings-item"]').click();
        } catch {
            await this.page.reload().catch(() => {});
            await this.page.waitForTimeout(300);
            await this.dismissBlockingOverlays();
            await this.page.locator('[data-test="menu-link-/settings-item"]').click();
        }
        const isOn = await this.getStreamingState();
        await this.page.locator('[data-test="general-settings-enable-streaming"] div').nth(2).click();
        await this.page.locator('[data-test="dashboard-add-submit"]').click();
        await this.page.getByText('Organization settings updated', { exact: false }).waitFor({ timeout: 15000 });
        await this.page.reload();
        const newState = await this.getStreamingState();
        testLogger.info(`[Streaming Toggle] ${isOn ? 'ON' : 'OFF'} -> ${newState ? 'ON' : 'OFF'}`);
    }

    /**
     * Query a stream via OpenObserve API to search for specific data
     * Used for validating alert triggers by searching the validation_stream
     * @param {string} streamName - Name of the stream to query
     * @param {string} searchQuery - SQL query to execute (e.g., "SELECT * FROM stream_name")
     * @param {number} timeRangeMinutes - How far back to search (default: 15 minutes)
     * @returns {Promise<{success: boolean, hits: number, data: any[]}>}
     */
    async queryStream(streamName, searchQuery = null, timeRangeMinutes = 15) {
        const headers = getAuthHeaders();
        const baseUrl = process.env["ZO_BASE_URL"];
        const orgName = getOrgIdentifier();

        const query = searchQuery || `SELECT * FROM "${streamName}"`;

        const endTime = Date.now() * 1000; // microseconds
        const startTime = endTime - (timeRangeMinutes * 60 * 1000 * 1000); // microseconds

        const searchPayload = {
            query: {
                sql: query,
                start_time: startTime,
                end_time: endTime,
                from: 0,
                size: 100
            }
        };

        try {
            const response = await this.page.request.post(`${baseUrl}/api/${orgName}/_search?type=logs`, {
                headers,
                data: searchPayload
            });
            const responseData = await response.json().catch(() => null);
            const hits = responseData?.hits || [];
            testLogger.debug(`Query stream ${streamName}: found ${hits.length} results`);
            return {
                success: true,
                hits: hits.length,
                data: hits
            };
        } catch (error) {
            testLogger.error('Error querying stream', { error: error.message });
            return { success: false, hits: 0, data: [] };
        }
    }

    /**
     * Search validation stream for alert payloads by unique ID
     * Used to verify that an alert successfully triggered and sent data
     * @param {string} validationStreamName - Name of the validation stream to search
     * @param {string} uniqueId - Unique identifier to search for in the payload
     * @param {number} maxWaitSeconds - Maximum time to wait for data (default: 60 seconds)
     * @param {number} pollIntervalSeconds - How often to poll (default: 5 seconds)
     * @returns {Promise<{found: boolean, payload: any, attempts: number}>}
     */
    async waitForAlertInValidationStream(validationStreamName, uniqueId, maxWaitSeconds = 60, pollIntervalSeconds = 5) {
        const maxAttempts = Math.ceil(maxWaitSeconds / pollIntervalSeconds);

        testLogger.info(`Waiting for "${uniqueId}" in stream "${validationStreamName}" (max ${maxWaitSeconds}s)...`);

        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
            // Query for recent data containing the search term
            // Note: The template body is stored in 'text' field, not '_all'
            const result = await this.queryStream(
                validationStreamName,
                `SELECT * FROM "${validationStreamName}" WHERE str_match_ignore_case(text, '${uniqueId}')`,
                10 // Last 10 minutes
            );

            if (result.success && result.hits > 0) {
                testLogger.info(`Found unique ID "${uniqueId}" in validation stream after ${attempt * pollIntervalSeconds}s`);
                return { found: true, payload: result.data[0], attempts: attempt };
            }

            if (attempt < maxAttempts) {
                testLogger.debug(`Attempt ${attempt}/${maxAttempts}: Unique ID not found yet, waiting ${pollIntervalSeconds}s...`);
                await new Promise(resolve => setTimeout(resolve, pollIntervalSeconds * 1000));
            }
        }

        testLogger.warn(`Unique ID "${uniqueId}" not found in validation stream "${validationStreamName}" after ${maxWaitSeconds}s`);
        return { found: false, payload: null, attempts: maxAttempts };
    }

    /**
     * Generate Basic auth header value
     * @param {string} username
     * @param {string} password
     * @returns {string} Basic auth header value
     */
    static generateBasicAuthHeader(username, password) {
        const credentials = Buffer.from(`${username}:${password}`).toString('base64');
        return `Basic ${credentials}`;
    }

    /**
     * Count alert notifications in validation stream
     * Used for deduplication testing to verify suppression of duplicate alerts
     * @param {string} validationStreamName - Name of the validation stream to query
     * @param {string} alertName - Alert name to search for (partial match)
     * @param {number} timeRangeMinutes - How far back to search (default: 15 minutes)
     * @returns {Promise<{success: boolean, count: number, data: any[]}>}
     */
    async countAlertNotificationsInStream(validationStreamName, alertName, timeRangeMinutes = 15) {
        const headers = getAuthHeaders();
        const baseUrl = process.env["ZO_BASE_URL"];
        const orgName = getOrgIdentifier();

        const query = `SELECT * FROM "${validationStreamName}" WHERE str_match_ignore_case(text, '${alertName}')`;

        const endTime = Date.now() * 1000; // microseconds
        const startTime = endTime - (timeRangeMinutes * 60 * 1000 * 1000); // microseconds

        const searchPayload = {
            query: {
                sql: query,
                start_time: startTime,
                end_time: endTime,
                from: 0,
                size: 1000
            }
        };

        try {
            const response = await this.page.request.post(`${baseUrl}/api/${orgName}/_search?type=logs`, {
                headers,
                data: searchPayload
            });
            const responseData = await response.json().catch(() => null);
            const hits = responseData?.hits || [];
            testLogger.debug(`Count notifications for "${alertName}" in ${validationStreamName}: found ${hits.length} notifications`);
            return {
                success: true,
                count: hits.length,
                data: hits
            };
        } catch (error) {
            testLogger.error('Error counting notifications in stream', { error: error.message });
            return { success: false, count: 0, data: [] };
        }
    }

    /**
     * Wait for exact notification count in validation stream
     * Used for deduplication testing to verify the expected number of notifications
     * @param {string} validationStreamName - Name of the validation stream
     * @param {string} alertName - Alert name to search for
     * @param {number} expectedCount - Expected number of notifications
     * @param {number} maxWaitSeconds - Maximum time to wait (default: 120 seconds)
     * @param {number} pollIntervalSeconds - How often to poll (default: 10 seconds)
     * @returns {Promise<{match: boolean, actualCount: number, attempts: number}>}
     */
    async waitForExactNotificationCount(validationStreamName, alertName, expectedCount, maxWaitSeconds = 120, pollIntervalSeconds = 10) {
        const maxAttempts = Math.ceil(maxWaitSeconds / pollIntervalSeconds);

        testLogger.info(`Waiting for exactly ${expectedCount} notifications for "${alertName}" in "${validationStreamName}" (max ${maxWaitSeconds}s)...`);

        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
            const result = await this.countAlertNotificationsInStream(validationStreamName, alertName, 15);

            if (result.success && result.count === expectedCount) {
                testLogger.info(`Found expected ${expectedCount} notifications after ${attempt * pollIntervalSeconds}s`);
                return { match: true, actualCount: result.count, attempts: attempt };
            }

            if (result.count > expectedCount) {
                testLogger.warn(`Found more notifications than expected: ${result.count} > ${expectedCount}`);
                return { match: false, actualCount: result.count, attempts: attempt };
            }

            if (attempt < maxAttempts) {
                testLogger.debug(`Attempt ${attempt}/${maxAttempts}: Found ${result.count} notifications, expected ${expectedCount}, waiting ${pollIntervalSeconds}s...`);
                await new Promise(resolve => setTimeout(resolve, pollIntervalSeconds * 1000));
            }
        }

        const finalResult = await this.countAlertNotificationsInStream(validationStreamName, alertName, 15);
        testLogger.info(`Final count: ${finalResult.count} notifications (expected ${expectedCount})`);
        return { match: finalResult.count === expectedCount, actualCount: finalResult.count, attempts: maxAttempts };
    }

    /**
     * Find elements containing specific text (case-sensitive)
     * @param {string} text - Text to search for
     * @returns {Locator}
     */
    getElementsWithText(text) {
        return this.page.locator(`text="${text}"`);
    }

    /**
     * Get page title element (h1, h2, or element with title-related class)
     * @returns {Locator}
     */
    getPageTitle() {
        return this.page.locator('h1, h2, .page-title, [class*="title"]').first();
    }

    /**
     * Get scheduled queries or query management menu item
     * @returns {Locator}
     */
    getQueryManagementMenuItem() {
        return this.page.locator('[data-test*="scheduled"], [data-test*="query-management"], text=Scheduled, text=Query Management').first();
    }
} 