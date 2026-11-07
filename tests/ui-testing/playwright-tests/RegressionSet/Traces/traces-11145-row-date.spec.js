const {
  test,
  expect,
  navigateToBase,
  generateUUID,
} = require("../../utils/enhanced-baseFixtures.js");
const testLogger = require("../../utils/test-logger.js");
const PageManager = require("../../../pages/page-manager.js");
const { ingestOtlpTraces, deleteStream, stringAttr } = require("../../utils/traces-api.js");
const { generateHexId } = require("../../utils/trace-ingestion.js");

const HOUR_MS = 60 * 60 * 1000;

// The ingest window is only 5 hours, so the user's timezone is what puts midnight between two recent spans.
function zoneWithMidnightBefore(ms) {
  const utcHour = new Date(ms).getUTCHours();
  const offsetHours = utcHour <= 12 ? -utcHour : 24 - utcHour;
  const zone =
    offsetHours === 0 ? "Etc/UTC" : `Etc/GMT${offsetHours > 0 ? "-" : "+"}${Math.abs(offsetHours)}`;
  return { zone, offsetHours };
}

const inZone = (ms, offsetHours) =>
  new Date(ms + offsetHours * HOUR_MS).toISOString().slice(0, 19).replace("T", " ");

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
      const { zone, offsetHours } = zoneWithMidnightBefore(newerMs);
      const newer = inZone(newerMs, offsetHours);
      const older = inZone(olderMs, offsetHours);
      expect(
        newer.slice(0, 10),
        "Precondition: the spans must fall on two dates in this timezone",
      ).not.toBe(older.slice(0, 10));

      await page.addInitScript((tz) => localStorage.setItem("timezone", tz), zone);
      await navigateToBase(page);
      const span = (name, ms) => ({
        traceId: generateHexId(16),
        spanId: generateHexId(8),
        name,
        kind: 2,
        startTimeUnixNano: `${ms}000000`,
        endTimeUnixNano: `${ms + 5}000000`,
        attributes: [],
        status: { code: 1 },
      });
      await ingestOtlpTraces(page.request, stream, {
        resourceSpans: [
          {
            resource: { attributes: [stringAttr("service.name", "e2e-11145")] },
            scopeSpans: [
              { scope: { name: "e2e" }, spans: [span("newer", newerMs), span("older", olderMs)] },
            ],
          },
        ],
      });

      await pm.tracesPage.navigateToTracesTab(stream, "spans", "6h");
      await pm.tracesPage.expectResultRowCount(2);

      const shown = await pm.tracesPage.getResultTimestamps();
      testLogger.info("Timestamps in the list", { zone, shown });
      const matched = (expected) => shown.some((text) => text.startsWith(expected));
      expect(matched(newer), `Bug #11145: the list must show ${newer}, got ${shown}`).toBe(true);
      expect(matched(older), `Bug #11145: the list must show ${older}, got ${shown}`).toBe(true);
      for (const text of shown)
        expect(text, "a relative day must not replace the date").not.toMatch(/today|yesterday/i);
    },
  );
});
