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
  const storedNames = new Set();

  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    await navigateToBase(page);
    pm = new PageManager(page);
    testLogger.info('Test setup completed');
  });

  test.afterEach(async ({ page }, testInfo) => {
    // Cleanup: Delete test streams
    for (const name of new Set([...TEST_STREAMS.map((s) => s.name), ...storedNames])) {
      try {
        await pm.streamsPage.deleteStreamViaAPI(name, 'logs');
        testLogger.info('Cleaned up stream', { streamName: name });
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
    test.skip(isCloudEnvironment(), 'Cloud runs ZO_FORMAT_STREAM_NAME_TO_LOWERCASE=true (default) — stream names are always lowercased');

    testLogger.info('Testing stream name casing preservation');

    // PR CI declares the server flag false, so a lowercased name there is a real regression rather than a server setting.
    const casingDeclaredPreserved = process.env.ZO_FORMAT_STREAM_NAME_TO_LOWERCASE === 'false';
    const streams = [];
    for (const stream of TEST_STREAMS) {
      const storedName = await pm.streamsPage.ingestTestData(stream.name);
      if (storedName) storedNames.add(storedName);
      const lowercasedByServer = storedName !== stream.name && storedName?.toLowerCase() === stream.name.toLowerCase();
      test.skip(!casingDeclaredPreserved && lowercasedByServer, 'server lowercases stream names (ZO_FORMAT_STREAM_NAME_TO_LOWERCASE)');
      expect(storedName, 'ingest response stream name').toBe(stream.name);
      streams.push(storedName);
      testLogger.info('Ingested test data', { streamName: stream.name, storedName });
    }

    // Wait for indexing
    await page.waitForTimeout(2000);

    // Validate streams in Stream Explorer
    for (const streamName of streams) {
      await pm.streamsPage.navigateToStreamExplorer();
      await pm.streamsPage.searchStream(streamName);
      await pm.streamsPage.verifyStreamNameVisibility(streamName);
      await pm.streamsPage.exploreStream();
      await pm.streamsPage.verifyStreamExploration();
      await pm.streamsPage.goBack();
      testLogger.info('Verified stream casing', { streamName });
    }

    testLogger.info('Stream name casing preservation test completed');
  });
}); 