const { test, expect } = require('../utils/enhanced-baseFixtures.js');
const PageManager = require('../../pages/page-manager.js');

test.describe.configure({ mode: "parallel" });

test.describe("Stream name casing preservation tests", () => {

  test("should preserve stream name casing after ingestion and show in stream explorer", {
    tag: ['@streamName', '@casing', '@all', '@streams']
  }, async ({ page }) => {
    const pm = new PageManager(page);
    const streams = [
      { name: "MyUpperStream1" },
      { name: "mylowerstream1" },
    ];

    // Ingest data into streams
    for (const stream of streams) {
      await pm.streamsPage.ingestTestData(stream.name);
    }

    // Validate streams in Stream Explorer
    for (const stream of streams) {
      await pm.streamsPage.navigateToStreamExplorer();
      await pm.streamsPage.searchStream(stream.name);
      await pm.streamsPage.verifyStreamNameVisibility(stream.name);
      await pm.streamsPage.exploreStream();
      await pm.streamsPage.verifyStreamExploration();
      await pm.streamsPage.goBack();
    }
  });
}); 