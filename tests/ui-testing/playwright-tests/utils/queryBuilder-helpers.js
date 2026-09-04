const testLogger = require('./test-logger.js');
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
    // Stream selection fires an auto-search that leaves the Run button disabled,
    // aria-busy, or swapped to "Cancel" while in flight. Clicking blind during that
    // window fails with "Element is not visible" — wait for the button to be ready
    // first. The catch falls through to the click, which then reports loudly.
    await pm.page.waitForFunction((selector) => {
        const el = document.querySelector(selector);
        if (!el) return false;
        if (el.getAttribute('aria-busy') === 'true') return false;
        if (el.hasAttribute('disabled') || el.getAttribute('aria-disabled') === 'true') return false;
        if (((el.textContent || '').trim()).includes('Cancel')) return false;
        return el.offsetParent !== null;
    }, pm.logsPage.queryButton, { timeout: 60000, polling: 100 }).catch(() => {});

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
 * Full init: select stream (selectStream navigates to the logs page itself, so no
 * separate page.goto here — that would just load the same page twice), then run
 * the initial match_all query.
 * Ingestion is handled by ingestForQueryBuilderTest in beforeAll.
 *
 * The applyQueryButton call is NOT optional setup: selecting a stream fires an
 * auto-search, and waiting for its /_search response here absorbs it before the
 * test body runs. Skipping it lets that response land mid-test and overwrite the
 * test's query state (observed as table/metric chart-type tests flaking to the
 * default bar chart under load).
 */
async function initQueryBuilderTest(page, pm) {
    await page.waitForLoadState('domcontentloaded');
    await pm.logsPage.selectStream("e2e_automate");
    await applyQueryButton(pm);
}

module.exports = {
    ingestForQueryBuilderTest,
    applyQueryButton,
    setupQueryAndSwitchToBuild,
    initQueryBuilderTest,
};
