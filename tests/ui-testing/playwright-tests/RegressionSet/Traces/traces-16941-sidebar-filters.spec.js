const {
  test,
  expect,
  navigateToBase,
} = require("../../utils/enhanced-baseFixtures.js");
const testLogger = require("../../utils/test-logger.js");
const {
  TracesRegressionPage,
} = require("../../../pages/tracesPages/tracesRegressionPage.js");
const {
  hexId,
  otlpAttr,
  otlpSpan,
  uniqueTraceStream,
  ingestSpansAndWait,
  deleteTraceStream,
} = require("../../../pages/tracesPages/tracesFixtures.js");

// The slowest span (15) lasts 1.234567 s, so a Max bound rounded to the label's 1.23s would drop it.
const SPAN_COUNT = 16;
const NULL_STATUS = [0, 4, 8, 12];
const STATUS_500 = [3, 6, 9, 15];
const ERRORS = [0, 5, 10, 15];
const service = (i) => (i < 6 ? "a" : i < 11 ? "b" : "c");

function seedSpans() {
  const nowNs = BigInt(Date.now()) * 1000000n;
  const byService = {};
  for (let i = 0; i < SPAN_COUNT; i++) {
    const attributes = NULL_STATUS.includes(i)
      ? []
      : [otlpAttr("http_status_code", STATUS_500.includes(i) ? "500" : "200")];
    const span = otlpSpan({
      traceId: hexId(16),
      name: `fb-op-${String(i).padStart(2, "0")}`,
      nowNs,
      agoMs: 600000 + i * 1000,
      durationNs: i === 15 ? 1234567000 : 100000000 + i * 50000000,
      statusCode: ERRORS.includes(i) ? 2 : 0,
      attributes,
    });
    (byService[service(i)] ||= []).push(span);
  }
  return byService;
}

test.describe("Traces sidebar filters (#16941)", () => {
  test.describe.configure({ mode: "serial" });
  const stream = uniqueTraceStream("16941");
  let tr;

  test.beforeAll(async ({ playwright }) => {
    const request = await playwright.request.newContext();
    await ingestSpansAndWait(request, stream, seedSpans());
    await request.dispose();
  });

  test.afterAll(async ({ playwright }) => {
    const request = await playwright.request.newContext();
    await deleteTraceStream(request, stream);
    await request.dispose();
  });

  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    await navigateToBase(page);
    tr = new TracesRegressionPage(page);
  });

  test(
    "Duration <= Max keeps the slowest span",
    {
      tag: ["@bug-16941", "@P2", "@regression", "@tracesRegression"],
    },
    async () => {
      await tr.openSpans(stream);
      await tr.expectSpansFound(
        SPAN_COUNT,
        "Precondition: all seeded spans are listed",
      );

      await tr.expandField("duration");
      await tr.clickDurationPercentile("Max", "<=");
      await expect
        .poll(() => tr.editorText(), {
          message: "the Max button must write a duration bound",
        })
        .toMatch(/duration\s*<=/);
      await tr.run();
      await tr.expectSpansFound(
        SPAN_COUNT,
        "duration <= Max must keep every span, including the slowest",
      );
    },
  );

  test(
    "errors-only is off for an OR filter, and on then off restores the filter",
    {
      tag: ["@bug-16941", "@P2", "@regression", "@tracesRegression"],
    },
    async () => {
      const filter = "service_name='a' OR span_status='ERROR'";
      await tr.openSpans(stream, filter);
      // a (6) plus the ERROR spans of b and c (10, 15).
      await tr.expectSpansFound(
        8,
        "Precondition: the OR filter returns 8 spans",
      );
      expect(
        await tr.isErrorsOnlyOn(),
        "errors-only must show off: the OR filter also returns non-error spans",
      ).toBe(false);

      await tr.clickErrorsOnly();
      await tr.run();
      await tr.expectSpansFound(
        4,
        "errors-only must apply to the whole OR filter",
      );

      await tr.clickErrorsOnly();
      await expect
        .poll(() => tr.editorText(), {
          message: "turning errors-only off must give back the original filter",
        })
        .toBe(filter);
      await tr.run();
      expect(
        await tr.searchErrorText(),
        "the restored filter must run without an error",
      ).toBe("");
      await tr.expectSpansFound(
        8,
        "the restored filter returns its 8 spans again",
      );
    },
  );

  test(
    "ticking null and another value keeps the rows with no value",
    {
      tag: ["@bug-16941", "@P2", "@regression", "@tracesRegression"],
    },
    async () => {
      await tr.openSpans(stream);
      await tr.expandField("http_status_code");
      await tr.clickFieldValue("http_status_code", "null");
      await tr.clickFieldValue("http_status_code", "200");
      await tr.run();
      // 4 spans without the field plus 8 with '200'.
      await tr.expectSpansFound(
        12,
        "null + 200 must return the spans missing the field as well as the 200 spans",
      );
    },
  );

  test(
    "a bracketed OR filter still loads field values, and unticking inside brackets keeps the bracket",
    {
      tag: ["@bug-16941", "@P2", "@regression", "@tracesRegression"],
    },
    async ({ page }) => {
      await tr.openSpans(
        stream,
        "(service_name='a' AND span_status='ERROR') OR duration > 1000",
      );
      const valuesStatus = page
        .waitForResponse(
          (r) =>
            /_values|_search/.test(r.url()) &&
            /service_name/.test(r.request().postData() || r.url()),
          { timeout: 20000 },
        )
        .then((r) => r.status())
        .catch(() => null);
      await tr.expandField("service_name");
      expect(
        await valuesStatus,
        "the field-values lookup must not be rejected",
      ).toBe(200);
      await expect
        .poll(() => tr.valueListTexts(), {
          timeout: 15000,
          message: "the service_name values must be listed",
        })
        .toEqual(
          expect.arrayContaining([
            "logs-search-subfield-add-service_name-a",
            "logs-search-subfield-add-service_name-c",
          ]),
        );

      await tr.openSpans(
        stream,
        "service_name='c' AND (http_status_code='500' OR span_status='ERROR')",
      );
      await tr.expandField("service_name");
      await tr.clickFieldValue("service_name", "c");
      await expect
        .poll(() => tr.editorText(), {
          message: "unticking c must remove only the service_name condition",
        })
        .toBe("(http_status_code='500' OR span_status='ERROR')");
      await tr.run();
      // 500 on 3,6,9,15 or ERROR on 0,5,10,15.
      await tr.expectSpansFound(
        7,
        "the bracketed OR left behind must still return its 7 spans",
      );
    },
  );
});
