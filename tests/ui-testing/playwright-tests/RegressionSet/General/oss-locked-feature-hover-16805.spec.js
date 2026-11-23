const { test, navigateToBase } = require('../../utils/enhanced-baseFixtures.js');
const testLogger = require('../../utils/test-logger.js');
const PageManager = require('../../../pages/page-manager.js');

const LOCKED_ROWS = [
  { group: 'reliability', item: 'incidentList', text: 'Incidents is available in OpenObserve Enterprise' },
  { group: 'reliability', item: 'onCallTeams', text: 'On-Call is available in OpenObserve Enterprise' },
  { group: 'traces', item: 'traces-service-graph', text: 'Service Graph is available in OpenObserve Enterprise' },
];

test.describe("OSS locked feature explanation Regression", () => {
  let pm;

  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    await navigateToBase(page);
    pm = new PageManager(page);
    const edition = await pm.editionFeaturesPage.detectEdition();
    test.skip(edition !== 'opensource', `Runs only on an OSS build (detected: ${edition})`);
  });

  test("the header AI button explains that it needs Enterprise @bug-16805 @P3 @regression @oss", async () => {
    await pm.editionFeaturesPage.expectAiButtonExplains('AI Assistant is available in OpenObserve Enterprise');
  });

  for (const { group, item, text } of LOCKED_ROWS) {
    test(`the locked ${item} nav row explains that it needs Enterprise @bug-16805 @P3 @regression @oss`, async () => {
      await pm.editionFeaturesPage.expectLockedNavRowExplains(group, item, text);
      testLogger.info(`${item}: "${text}"`);
    });
  }
});
