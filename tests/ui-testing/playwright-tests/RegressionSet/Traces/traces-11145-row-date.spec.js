const {
  test,
  expect,
  navigateToBase,
  generateUUID,
} = require("../../utils/enhanced-baseFixtures.js");
const testLogger = require("../../utils/test-logger.js");
const PageManager = require("../../../pages/page-manager.js");
const { ingestOtlpTraces, waitForStreamRows, deleteStream } = require("../../utils/traces-api.js");
const { generateSpansAt } = require("../../utils/service-graph-ingestion.js");

const HOUR_MS = 60 * 60 * 1000;

test.describe("Traces list shows the real date (#11145)", () => {
  let pm;
  let stream;

  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    pm = new PageManager(page);
    stream = `e2e_11145_${generateUUID().slice(0, 8)}`;
  });

  test.afterEach(async ({ page }, testInfo) => {
    await deleteStream(page.request, stream);
    testLogger.testEnd(testInfo.title, testInfo.status);
  });

  test(
    "two spans either side of midnight show their own dates, not Today",
    {
      tag: ["@bug-11145", "@P2", "@regression", "@tracesRegression"],
    },
    async ({ page }) => {
      const newerMs = Date.now() - 60 * 1000;
      const olderMs = newerMs - 2 * HOUR_MS;
      const { zone, offsetHours } = await pm.tracesPage.pinTimezoneWithMidnightBefore(newerMs);
      const newer = pm.tracesPage.formatInZoneOffset(newerMs, offsetHours);
      const older = pm.tracesPage.formatInZoneOffset(olderMs, offsetHours);
      expect(
        newer.slice(0, 10),
        "Precondition: the spans must fall on two dates in this timezone",
      ).not.toBe(older.slice(0, 10));

      await navigateToBase(page);
      const spans = generateSpansAt("e2e-11145", [
        { name: "newer", ms: newerMs },
        { name: "older", ms: olderMs },
      ]);
      await ingestOtlpTraces(page.request, stream, spans.payload);
      await waitForStreamRows(page.request, stream, spans.metadata.spanCount, {
        startUs: (olderMs - HOUR_MS) * 1000,
      });

      await pm.tracesPage.navigateToTracesTab(stream, "spans", "6h");
      await pm.tracesPage.expectResultRowCount(2);

      const shown = await pm.tracesPage.getResultTimestamps();
      testLogger.info("Timestamps in the list", { zone, shown });
      for (const expected of [newer, older]) {
        expect(
          shown.some((text) => text.startsWith(expected)),
          `Bug #11145: the list must show ${expected}, got ${shown}`,
        ).toBe(true);
      }
      for (const text of shown)
        expect(text, "a relative day must not replace the date").not.toMatch(/today|yesterday/i);
    },
  );
});
