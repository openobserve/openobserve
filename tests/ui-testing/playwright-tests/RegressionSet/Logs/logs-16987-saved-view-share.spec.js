const {
  test,
  expect,
  navigateToBase,
} = require("../../utils/enhanced-baseFixtures.js");
const testLogger = require("../../utils/test-logger.js");
const PageManager = require("../../../pages/page-manager.js");

const ORG = process.env.ORGNAME || "default";
const RUN = Date.now().toString(36);
const MINUTE_US = 60 * 1e6;
const HOUR_US = 60 * MINUTE_US;

test.describe(
  "Saved views and live share links keep the asked time range and query (#16987)",
  {
    tag: ["@bug-16987", "@P2", "@regression", "@logsRegression", "@savedViews"],
  },
  () => {
    test.describe.configure({ mode: "serial" });
    const stream = `e2e_sv_share_${RUN}`;
    const missingStream = `e2e_sv_gone_${RUN}`;
    // One row every 10 minutes over the last 5 hours, 5 minutes off the hour so no row sits on a window edge.
    const nowUs = Math.floor(Date.now() / 60000) * MINUTE_US;
    const rows = Array.from({ length: 30 }, (_, k) => ({
      _timestamp: nowUs - (5 + 10 * k) * MINUTE_US,
      seq: k,
      k: k < 3 ? "x" : "y",
    }));
    const created = { views: [] };
    let pm;

    test.beforeAll(async ({ browser }) => {
      const page = await browser.newPage();
      try {
        const seed = new PageManager(page);
        await seed.logsPage.ingestLogs(ORG, stream, rows);
        await seed.logsPage.waitForStreamRowCount(ORG, stream, 6);
      } finally {
        await page.close();
      }
    });

    test.beforeEach(async ({ page }, testInfo) => {
      testLogger.testStart(testInfo.title, testInfo.file);
      await navigateToBase(page);
      pm = new PageManager(page);
    });

    test.afterAll(async ({ browser }) => {
      const page = await browser.newPage();
      try {
        const cleanup = new PageManager(page);
        for (const id of created.views)
          await cleanup.logsPage.deleteSavedViewViaApi(id);
        await cleanup.logsPage.deleteStream(stream);
      } finally {
        await page.close();
      }
    });

    test("a saved view that fails to apply keeps the SQL query, SQL mode and its results", async ({
      page,
    }) => {
      const viewName = `sv_missing_stream_${RUN}`;
      created.views.push(
        await pm.logsPage.createSavedViewViaApi(viewName, {
          data: {
            stream: {
              selectedStream: [missingStream],
              streamType: "logs",
              selectedFields: [],
            },
            resultGrid: { columns: [] },
          },
          meta: {},
        }),
      );
      const sql = `SELECT * FROM "${stream}" WHERE k = 'x'`;
      await pm.logsPage.openLogsWithSqlQuery(stream, sql, "6h");
      await pm.logsPage.runQueryAndWaitForResults();
      expect(
        await pm.logsPage.getResultHitsCount(),
        "Setup: the SQL query returns the 3 x rows",
      ).toBe(3);

      await pm.logsPage.applySavedViewByName(viewName);
      await expect(pm.logsPage.toastByVariant("error")).toBeVisible({
        timeout: 15000,
      });

      expect((await pm.logsPage.getQueryEditorText()).trim()).toBe(sql);
      expect(await pm.logsPage._isSqlModeEnabledViaVue()).toBe(true);
      await expect(pm.logsPage.toastByVariant("error")).toHaveAttribute(
        "data-test-message",
        new RegExp(missingStream),
      );
      await pm.logsPage.runQueryAndWaitForResults();
      expect(await pm.logsPage.getResultHitsCount()).toBe(3);
    });

    test("a saved view wider than the max query range keeps its own end and says it was shortened", async ({
      page,
    }) => {
      const viewName = `sv_wide_${RUN}`;
      const viewEnd = nowUs - HOUR_US;
      const viewStart = viewEnd - 3 * HOUR_US;
      await pm.logsPage.openLogsWithParams(stream, {
        from: String(viewStart),
        to: String(viewEnd),
      });
      await pm.logsPage.runQueryAndWaitForResults();
      expect(
        await pm.logsPage.getResultHitsCount(),
        "Setup: the 3-hour view window holds 18 rows",
      ).toBe(18);
      await pm.logsPage.clickSaveViewButton();
      await pm.logsPage.fillSavedViewName(viewName);
      await pm.logsPage.clickSavedViewDialogSave();
      created.views.push(await pm.logsPage.findSavedViewIdViaApi(viewName));

      await pm.logsPage.setStreamMaxQueryRangeViaApi(stream, 2);
      await pm.logsPage.openLogsWithParams(stream, { period: "15m" });
      const windows = pm.logsPage.trackSearchWindows();
      await pm.logsPage.applySavedViewByName(viewName);

      await expect(pm.logsPage.toastByVariant("warning")).toHaveAttribute(
        "data-test-message",
        /shortened to the last 2 hours/,
        { timeout: 15000 },
      );
      await expect
        .poll(() => windows().at(-1), { timeout: 30000 })
        .toEqual({ start: viewEnd - 2 * HOUR_US, end: viewEnd });
      expect(await pm.logsPage.getResultHitsCount()).toBe(12);
      await pm.logsPage.setStreamMaxQueryRangeViaApi(stream, 0);
    });

    test("a share link taken with auto refresh on carries the relative period, not a frozen window", async ({
      page,
    }) => {
      await pm.logsPage.setStreamMaxQueryRangeViaApi(stream, 0);
      await pm.logsPage.openLogsWithParams(stream, {
        period: "6h",
        refresh: "60",
      });
      await pm.logsPage.runQueryAndWaitForResults();
      const target = pm.logsPage.waitForShortUrlTarget();
      await pm.logsPage.clickShareLinkButton();
      const shared = new URL(await target).searchParams;

      expect({
        period: shared.get("period"),
        refresh: shared.get("refresh"),
        from: shared.get("from"),
        to: shared.get("to"),
      }).toEqual({ period: "6h", refresh: "60", from: null, to: null });
    });
  },
);
