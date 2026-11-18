// Settings lists AI Toolsets under Integrations, opens the page from the menu and highlights the entry there (#16786).

const { test, navigateToBase } = require('../../utils/enhanced-baseFixtures.js');
const testLogger = require('../../utils/test-logger.js');
const PageManager = require('../../../pages/page-manager.js');
const { ORG } = require('../../utils/dashboard-auto-run-fixtures.js');

test.describe('AI Toolsets entry in the Settings menu (#16786)', { tag: '@enterprise' }, () => {
  test('the Settings menu opens AI Toolsets and marks its entry active', {
    tag: ['@bug-16786', '@P3', '@regression', '@landingRegression'],
  }, async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    await navigateToBase(page);
    const pm = new PageManager(page);
    const buildType = await pm.statusPagesPage.detectBuildType(ORG());
    test.skip(buildType !== 'enterprise', `AI Toolsets is enterprise-only; the ${buildType} build shows the entry locked or hidden`);

    await pm.aiToolsetsFormValidation.openSettingsHome();
    await pm.aiToolsetsFormValidation.openAiToolsetsFromSettingsMenu();
    await pm.aiToolsetsFormValidation.expectSettingsMenuEntryActive();
    testLogger.testEnd(testInfo.title, 'passed');
  });
});
