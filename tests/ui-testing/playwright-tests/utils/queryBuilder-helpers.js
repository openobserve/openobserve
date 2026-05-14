const testLogger = require('./test-logger.js');
const logData = require('../../fixtures/log.json');
const { ingestTestData } = require('./data-ingestion.js');
const { getOrgIdentifier } = require('./cloud-auth.js');

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

async function initQueryBuilderTest(page, pm) {
    await page.waitForLoadState('domcontentloaded');
    await ingestTestData(page);
    await page.waitForLoadState('domcontentloaded');
    await page.goto(`${logData.logsUrl}?org_identifier=${getOrgIdentifier()}`);
    await pm.logsPage.selectStream("e2e_automate");
    await applyQueryButton(pm);
}

module.exports = { applyQueryButton, setupQueryAndSwitchToBuild, initQueryBuilderTest };
