/**
 * Query Editor Keyboard Accessibility — Escape / focus E2E tests
 *
 * Covers the Monaco query editor's "Escape as a keyboard exit" contract:
 *   1. Escape in the non-fullscreen editor leaves it and lands on the next tabbable control.
 *   2. Escape in the expanded (fullscreen) editor collapses it and keeps focus inside.
 *   3. Escape while the suggest widget owns the key closes the widget first (two-Escape split).
 *   4. Escape with a text selection collapses the selection first (two-Escape split).
 *
 * Data: one shared/read-only stream seeded in beforeAll (ingestRows), navigated to via
 * URL query params (no UI click-through). Each test is independent and runs in parallel.
 */

const { test, expect, navigateToBase } = require("../utils/enhanced-baseFixtures.js");
const { ingestRows, waitForSearchable } = require("../utils/auto-run-helpers.js");
const { getAuthHeaders } = require("../utils/cloud-auth.js");
const testLogger = require("../utils/test-logger.js");
const PageManager = require("../../pages/page-manager.js");

const ORG = `kbd${Date.now()}`;
const STREAM = "kbd_logs";
const TOTAL = 5;
const API_BASE = (process.env.INGESTION_URL || process.env.ZO_BASE_URL).replace(/\/$/, "");

const LOGS_URL =
  `/web/logs?org_identifier=${ORG}&stream=${STREAM}&stream_type=logs&period=15m&refresh=0` +
  `&sql_mode=false&quick_mode=false&show_histogram=false&query=`;

test.describe("Query Editor Keyboard Accessibility testcases", () => {
  test.describe.configure({ mode: "parallel" });
  let pm;

  test.beforeAll(async ({ request }) => {
    const now = Date.now() * 1000;
    await ingestRows(
      request,
      ORG,
      STREAM,
      Array.from({ length: TOTAL }, (_, i) => ({
        _timestamp: now - i * 60e6,
        message: `kbd-${i}`,
      })),
    );
    // Gate on the stream being searchable before any test navigates, otherwise a
    // freshly-ingested stream can answer the entry search with zero rows.
    await waitForSearchable(request, ORG, STREAM, 1);
  });

  // Remove the fresh kbd<ts> org this spec seeds — the shared-org sweep never lists it.
  test.afterAll(async ({ request }) => {
    await request
      .delete(`${API_BASE}/api/organizations/${ORG}`, { headers: getAuthHeaders() })
      .catch(() => {});
  });

  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    await navigateToBase(page);
    await page.evaluate(() => {
      for (const key of Object.keys(localStorage)) {
        if (/^oo_(toggle_auto_run|logs_|selected_stream_)/.test(key)) localStorage.removeItem(key);
      }
    });
    pm = new PageManager(page);
    await page.goto(LOGS_URL);
    await page.waitForLoadState("networkidle", { timeout: 30000 }).catch(() => {});
    await pm.logsPage.ensureQueryEditorReady();
    await pm.logsPage.clickRefreshButton();
    await expect(pm.logsPage.logResultsRow(0)).toBeAttached({ timeout: 60000 });
    testLogger.info("Test setup completed");
  });

  test(
    "should move focus to the next control when Escape is pressed in the non-fullscreen editor",
    {
      tag: ["@query-editor-keyboard-accessibility", "@logs", "@a11y", "@all"],
    },
    async ({ page }) => {
      testLogger.info("Focus the editor, then press Escape");
      await pm.logsPage.clickQueryEditor();
      await page.keyboard.press("Escape");
      await pm.logsPage.expectFocusOnFollowingControl();
      testLogger.info("Test completed");
    },
  );

  test(
    "should collapse the fullscreen editor and keep focus inside on Escape",
    {
      tag: ["@query-editor-keyboard-accessibility", "@logs", "@a11y", "@all"],
    },
    async ({ page }) => {
      testLogger.info("Expand the editor fullscreen, focus it, then press Escape");
      await pm.logsPage.clickQueryEditorFullScreenBtn();
      await pm.logsPage.expectQueryEditorExpanded();
      await pm.logsPage.focusQueryEditorMonaco();
      await page.keyboard.press("Escape");
      await pm.logsPage.expectQueryEditorCollapsed();
      await pm.logsPage.expectFocusInsideEditor();
      testLogger.info("Test completed");
    },
  );

  test(
    "should close the suggest widget on the first Escape and move focus to the next control on the second",
    {
      tag: ["@query-editor-keyboard-accessibility", "@logs", "@a11y", "@all"],
    },
    async ({ page }) => {
      testLogger.info("Open the suggest widget, then press Escape twice");
      await pm.logsPage.openSuggestWidget();
      await page.keyboard.press("Escape");
      await pm.logsPage.expectSuggestWidgetHidden();
      await pm.logsPage.expectFocusInsideEditor();
      await page.keyboard.press("Escape");
      await pm.logsPage.expectFocusOnFollowingControl();
      testLogger.info("Test completed");
    },
  );

  test(
    "should collapse a text selection on the first Escape and move focus to the next control on the second",
    {
      tag: ["@query-editor-keyboard-accessibility", "@logs", "@a11y", "@all"],
    },
    async ({ page }) => {
      testLogger.info("Select the query text, then press Escape twice");
      await pm.logsPage.setQueryEditorValue(`SELECT * FROM "${STREAM}"`);
      await page.keyboard.press("ControlOrMeta+a");
      await pm.logsPage.expectEditorSelectionActive();
      await page.keyboard.press("Escape");
      await pm.logsPage.expectEditorSelectionCollapsed();
      await pm.logsPage.expectFocusInsideEditor();
      await page.keyboard.press("Escape");
      await pm.logsPage.expectFocusOnFollowingControl();
      testLogger.info("Test completed");
    },
  );
});
