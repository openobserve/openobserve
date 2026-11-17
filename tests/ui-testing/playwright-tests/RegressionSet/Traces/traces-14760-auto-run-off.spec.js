const {
  test,
  expect,
  navigateToBase,
  generateUUID,
} = require("../../utils/enhanced-baseFixtures.js");
const testLogger = require("../../utils/test-logger.js");
const PageManager = require("../../../pages/page-manager.js");
const { ingestSequencedErrorSpans } = require("../../utils/trace-ingestion.js");
const { deleteStream } = require("../../utils/traces-api.js");

test.describe("Traces with Auto Run off (#14760)", () => {
  let pm;
  let streamA;
  let streamB;

  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    pm = new PageManager(page);
    await pm.tracesPage.pinAutoQueryEnabled(true);
    await navigateToBase(page);
    const suffix = generateUUID().slice(0, 8);
    streamA = `e2e_14760_a_${suffix}`;
    streamB = `e2e_14760_b_${suffix}`;
    for (const stream of [streamA, streamB]) {
      const ingest = await ingestSequencedErrorSpans(page, stream, 3);
      expect(ingest.status, "Precondition: seeded spans must ingest").toBe(200);
    }
    await pm.tracesPage.storeAutoRunOffWithLastStream(streamA);
    // Opens on Home with a cold page, which is the load path the bug was on.
    await page.reload();
  });

  test.afterEach(async ({ page }, testInfo) => {
    await deleteStream(page.request, streamA);
    await deleteStream(page.request, streamB);
    testLogger.testEnd(testInfo.title, testInfo.status);
  });

  test(
    "opening Traces restores the last stream without searching, and Run Query loads it",
    {
      tag: ["@bug-14760", "@P1", "@regression", "@tracesRegression"],
    },
    async () => {
      const { requests, stop } = pm.tracesPage.captureSearchRequests();

      await pm.tracesPage.navigateToTraces();
      await pm.tracesPage.expectSelectedStream(streamA);
      await pm.tracesPage.expectSearchNotStartedState();
      await pm.tracesPage.expectNoSearchRequest(requests);

      await pm.tracesPage.runTraceSearch();
      await expect(
        pm.tracesPage.getTraceResultItems().first(),
        "Run Query must load the restored stream",
      ).toBeVisible({ timeout: 30000 });
      expect(
        requests.some((r) => r.panel === "results" && r.sql.includes(streamA)),
        "Run Query must search the restored stream",
      ).toBe(true);
      stop();
    },
  );

  test(
    "changing the stream does not search, and does once Auto Run is on",
    {
      tag: ["@bug-14760", "@P1", "@regression", "@tracesRegression"],
    },
    async () => {
      await pm.tracesPage.navigateToTraces();
      await pm.tracesPage.expectSelectedStream(streamA);
      await pm.tracesPage.expectSearchNotStartedState();
      const { requests, stop } = pm.tracesPage.captureSearchRequests();

      await pm.tracesPage.selectTraceStream(streamB);
      await pm.tracesPage.expectSelectedStream(streamB);
      await pm.tracesPage.expectNoSearchRequest(requests);
      await pm.tracesPage.expectSearchNotStartedState();

      expect(await pm.tracesPage.setLiveMode(true), "Auto Run must be available").toBe(true);
      await pm.tracesPage.selectTraceStream(streamA);
      await expect
        .poll(() => requests.some((r) => r.sql.includes(streamA)), {
          timeout: 30000,
          message: "with Auto Run on, a stream change must search",
        })
        .toBe(true);
      stop();
    },
  );

  test(
    "a shared link with a stream still loads its results",
    {
      tag: ["@bug-14760", "@P1", "@regression", "@tracesRegression"],
    },
    async () => {
      const { requests, stop } = pm.tracesPage.captureSearchRequests();

      await pm.tracesPage.navigateToTracesUrlWithStream(streamB);

      await pm.tracesPage.expectSelectedStream(streamB);
      await expect(
        pm.tracesPage.getTraceResultItems().first(),
        "a shared link must show results without Run Query",
      ).toBeVisible({ timeout: 30000 });
      expect(requests.some((r) => r.panel === "results" && r.sql.includes(streamB))).toBe(true);
      stop();
    },
  );
});
