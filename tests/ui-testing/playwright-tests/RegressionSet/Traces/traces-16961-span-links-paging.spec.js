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

const TIE_SPANS = 60;
const TIED = 40;
const PAGE_SIZE = 25;

test.describe("Traces span links and span paging (#16961)", () => {
  test.describe.configure({ mode: "serial" });
  const stream = uniqueTraceStream("16961");
  const nowNs = BigInt(Date.now()) * 1000000n;
  const traceA = hexId(16);
  const traceB = hexId(16);
  const rootA = hexId(8);
  const rootB = hexId(8);
  let tr;

  test.beforeAll(async ({ playwright }) => {
    const svcB = [
      otlpSpan({
        traceId: traceB,
        spanId: rootB,
        name: "B-root-op",
        nowNs,
        agoMs: 300000,
        durationNs: 50000000,
      }),
      otlpSpan({
        traceId: traceB,
        parentSpanId: rootB,
        name: "B-child-op",
        nowNs,
        agoMs: 299000,
        durationNs: 20000000,
      }),
    ];
    const svcA = [
      otlpSpan({
        traceId: traceA,
        spanId: rootA,
        name: "A-root-op",
        nowNs,
        agoMs: 400000,
        durationNs: 80000000,
        links: [
          {
            traceId: traceB,
            spanId: rootB,
            attributes: [otlpAttr("link.kind", "follows")],
          },
        ],
      }),
      otlpSpan({
        traceId: traceA,
        parentSpanId: rootA,
        name: "A-child-op",
        nowNs,
        agoMs: 399000,
        durationNs: 30000000,
      }),
    ];
    // Tied durations need a tiebreak column, or Duration-sorted pages overlap.
    const svcTie = Array.from({ length: TIE_SPANS }, (_, i) =>
      otlpSpan({
        traceId: hexId(16),
        name: `tie-op-${String(i).padStart(2, "0")}`,
        nowNs,
        agoMs: 500000 + i * 1000,
        durationNs: i < TIED ? 2600000000 : 1000000000 + i * 10000000,
      }),
    );
    const request = await playwright.request.newContext();
    await ingestSpansAndWait(request, stream, { svcA, svcB, svcTie });
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
    "following a span link to another trace shows that trace's spans, and Back restores the first",
    {
      tag: ["@bug-16961", "@P2", "@regression", "@tracesRegression"],
    },
    async ({ page }) => {
      const fromUs = Number(nowNs / 1000n) - 3600e6;
      const toUs = Number(nowNs / 1000n) + 60e6;
      await tr.openTraceDetails(stream, traceA, fromUs, toUs);
      await expect
        .poll(() => tr.waterfallOperationNames(), {
          timeout: 20000,
          message: "Precondition: trace A opens with its own spans",
        })
        .toEqual(["A-child-op", "A-root-op"]);

      await tr.clickWaterfallSpan("A-root-op");
      await tr.openLinksTab();
      await tr.clickSpanLink(0);

      await expect
        .poll(() => new URL(page.url()).searchParams.get("trace_id"), {
          message: "the link must navigate to trace B",
        })
        .toBe(traceB);
      await expect
        .poll(() => tr.headerTraceId(), { timeout: 20000 })
        .toContain(traceB);
      await expect
        .poll(() => tr.waterfallOperationNames(), {
          timeout: 20000,
          message:
            "after following the link the waterfall must show trace B's spans, not trace A's",
        })
        .toEqual(["B-child-op", "B-root-op"]);

      await page.goBack();
      await expect
        .poll(() => tr.waterfallOperationNames(), {
          timeout: 20000,
          message: "Back must show trace A's spans again",
        })
        .toEqual(["A-child-op", "A-root-op"]);
      await expect
        .poll(() => tr.headerTraceId(), { timeout: 20000 })
        .toContain(traceA);
    },
  );

  test(
    "sorting spans by Duration gives pages that never repeat a span",
    {
      tag: ["@bug-16961", "@P2", "@regression", "@tracesRegression"],
    },
    async () => {
      await tr.openSpans(stream, "service_name='svcTie'");
      await tr.expectSpansFound(
        TIE_SPANS,
        "Precondition: all tie spans are listed",
      );
      await tr.untilSearchesSettle(() => tr.setRecordsPerPage(PAGE_SIZE));

      await tr.sortByDurationDescending();
      expect(
        await tr.durationSortOrder(),
        "Precondition: spans are sorted by Duration, descending",
      ).toBe("descending");

      const seen = [];
      for (const n of [1, 2, 3]) {
        if (n > 1) await tr.untilSearchesSettle(() => tr.goToPage(n));
        const names = await tr.resultOperationNames();
        expect(
          names.length,
          `page ${n} must hold its share of the ${TIE_SPANS} spans`,
        ).toBe(n < 3 ? PAGE_SIZE : TIE_SPANS - 2 * PAGE_SIZE);
        seen.push(...names);
      }
      expect(
        new Set(seen).size,
        "the three pages together must show every span exactly once",
      ).toBe(TIE_SPANS);
    },
  );
});
