const testLogger = require('./test-logger.js');
const logData = require('../../fixtures/log.json');
const logsdata = require('../../../test-data/logs_data.json');
const { getOrgIdentifier, getAuthHeaders } = require('./cloud-auth.js');

/**
 * Ingest test data via Playwright request fixture (for beforeAll).
 * Uses the request APIRequestContext — no browser page needed.
 */
async function ingestForQueryBuilderTest(request, streamName = "e2e_automate") {
    const orgId = getOrgIdentifier();
    const headers = getAuthHeaders();
    const baseUrl = process.env.INGESTION_URL.endsWith('/')
        ? process.env.INGESTION_URL.slice(0, -1)
        : process.env.INGESTION_URL;

    const response = await request.post(`${baseUrl}/api/${orgId}/${streamName}/_json`, {
        headers: headers,
        data: logsdata
    });
    if (!response.ok()) throw new Error(`Ingestion failed: ${response.status()} ${await response.text()}`);
    const responseData = await response.json();
    testLogger.debug('Test data ingestion response', { response: responseData, streamName });
    return responseData;
}

async function applyQueryButton(pm) {
    const searchPromise = pm.page.waitForResponse(
        response => response.url().includes('/_search') && response.status() === 200,
        { timeout: 60000 }
    );

    await pm.logsPage.clickRefreshButton();

    try {
        await searchPromise;
        testLogger.info('Search query completed successfully');
    } catch (error) {
        testLogger.warn('Search response wait timed out, continuing test');
        await pm.page.waitForLoadState('networkidle').catch(() => {});
    }
}

async function setupQueryAndSwitchToBuild(pm, page, query) {
    await pm.logsPage.enableSqlModeIfNeeded();
    await page.waitForLoadState('domcontentloaded');
    await pm.logsPage.setQueryEditorContent(query);
    await pm.logsPage.runQueryAndWaitForResults();
    await pm.logsPage.clickBuildToggle();
    await pm.logsPage.waitForBuildTabLoaded();
}

/**
 * Full init: navigate, select stream, run initial match_all query.
 * Ingestion is handled by ingestForQueryBuilderTest in beforeAll.
 */
async function initQueryBuilderTest(page, pm) {
    await page.waitForLoadState('domcontentloaded');
    await page.goto(`${logData.logsUrl}?org_identifier=${getOrgIdentifier()}`);
    await pm.logsPage.selectStream("e2e_automate");
    await applyQueryButton(pm);
}

/**
 * Lite init: navigate and select stream, then wait for auto-search to complete.
 * For tests that call setupQueryAndSwitchToBuild (which runs their own query).
 * The applyQueryButton call ensures the stream's auto-triggered search has
 * completed and data is primed before the test runs its own query.
 */
async function initQueryBuilderTestLite(page, pm) {
    await page.waitForLoadState('domcontentloaded');
    await page.goto(`${logData.logsUrl}?org_identifier=${getOrgIdentifier()}`);
    await pm.logsPage.selectStream("e2e_automate");
    await applyQueryButton(pm);
}

module.exports = {
    ingestForQueryBuilderTest,
    applyQueryButton,
    setupQueryAndSwitchToBuild,
    initQueryBuilderTest,
    initQueryBuilderTestLite,
};
