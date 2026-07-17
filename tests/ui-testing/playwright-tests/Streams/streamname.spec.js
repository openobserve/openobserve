const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const PageManager = require('../../pages/page-manager.js');
const testLogger = require('../utils/test-logger.js');
const { isCloudEnvironment } = require('../../pages/cloudPages/cloud-env.js');

test.describe.configure({ mode: "parallel" });

test.describe("Stream name casing preservation tests", () => {
  let pm;
  const TEST_STREAMS = [
    { name: "e2e_MyUpperStream1" },
    { name: "e2e_mylowerstream1" },
  ];

  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    await navigateToBase(page);
    pm = new PageManager(page);
    testLogger.info('Test setup completed');
  });

  test.afterEach(async ({ page }, testInfo) => {
    // Cleanup: Delete test streams
    for (const stream of TEST_STREAMS) {
      try {
        await pm.streamsPage.deleteStreamViaAPI(stream.name, 'logs');
        testLogger.info('Cleaned up stream', { streamName: stream.name });
      } catch (e) {
        // Stream may not exist, ignore
      }
    }
    if (testInfo.status) {
      testLogger.testEnd(testInfo.title, testInfo.status, testInfo.duration);
    }
  });

  test("should preserve stream name casing after ingestion and show in stream explorer", {
    tag: ['@streamName', '@casing', '@all', '@streams']
  }, async ({ page }) => {
    // Casing preservation needs the server started with
    // ZO_FORMAT_STREAM_NAME_TO_LOWERCASE=false (the local playwright.yml does
    // this); shared cloud deployments run the default (true) and lowercase
    // every ingested stream name, so the feature under test is off there.
    test.skip(isCloudEnvironment(), 'Cloud runs ZO_FORMAT_STREAM_NAME_TO_LOWERCASE=true (default) — stream names are always lowercased');

    testLogger.info('Testing stream name casing preservation');

    // Ingest data into streams
    for (const stream of TEST_STREAMS) {
      await pm.streamsPage.ingestTestData(stream.name);
      testLogger.info('Ingested test data', { streamName: stream.name });
    }

    // Wait for indexing
    await page.waitForTimeout(2000);

    // Validate streams in Stream Explorer
    for (const stream of TEST_STREAMS) {
      await pm.streamsPage.navigateToStreamExplorer();
      await pm.streamsPage.searchStream(stream.name);
      await pm.streamsPage.verifyStreamNameVisibility(stream.name);
      await pm.streamsPage.exploreStream();
      await pm.streamsPage.verifyStreamExploration();
      await pm.streamsPage.goBack();
      testLogger.info('Verified stream casing', { streamName: stream.name });
    }

    testLogger.info('Stream name casing preservation test completed');
  });
}); 