// Dashboard panel-notice chips, tooltips and Query Inspector notice banners.
//
// Every selector here mirrors the data-test attributes in
// web/src/components/dashboards/PanelErrorButtons.vue, PanelNoticeContent.vue and
// QueryInspector.vue. The spec never touches these selectors directly — it calls
// the locator getters / action methods below through `pm.dashboardNotices`.
import { expect } from "@playwright/test";
const testLogger = require("../../playwright-tests/utils/test-logger.js");

export default class DashboardNotices {
  /**
   * @param {import('@playwright/test').Page} page
   */
  constructor(page) {
    this.page = page;

    // Static panel-header selectors.
    this.noticesContainer = page.locator('[data-test="panel-notice-chips"]');
    this.lastRefreshed = page.locator('[data-test="panel-last-refreshed-at"]');
    this.errorIcon = page.locator('[data-test="panel-error-data"]');
    // Only the Panel Editor wires this; the dashboard view never passes the prop.
    this.xAliasWarning = page.locator('[data-test="panel-x-alias-inconsistency-warning"]');
    this.copyErrorBtn = page.locator('[data-test="panel-notice-action-copy-error"]');

    // Query Inspector dialog. The dashboard host (PanelContainer.vue) passes
    // data-test="query-inspector-dialog" onto the QueryInspector root, which
    // overrides the inner ODialog's own data-test="query-inspector".
    this.inspectorDialog = page.locator('[data-test="query-inspector-dialog"]');
  }

  // ---------------------------------------------------------------------------
  // Locator getters (dynamic ids / per-query indexes)
  // ---------------------------------------------------------------------------

  /** Notice chip tag, e.g. noticeChip("series-cap"). */
  noticeChip(id) {
    return this.page.locator(`[data-test="panel-notice-chip-${id}"]`);
  }

  /** Notice tooltip body, e.g. noticeContent("series-cap"). */
  noticeContent(id) {
    return this.page.locator(`[data-test="panel-notice-content-${id}"]`);
  }

  /** Verbatim server detail line(s), e.g. noticeDetail("function-error"). */
  noticeDetail(id) {
    return this.page.locator(`[data-test="panel-notice-detail-${id}"]`);
  }

  /** Notice action button, e.g. noticeAction("use-top-n") / ("refresh") / ("edit-function"). */
  noticeAction(id) {
    return this.page.locator(`[data-test="panel-notice-action-${id}"]`);
  }

  /** Query Inspector notice banner, e.g. inspectorNotice("series-cap", 0). */
  inspectorNotice(kind, index) {
    return this.page.locator(`[data-test="query-inspector-notice-${kind}-${index}"]`);
  }

  /** Query Inspector original-query block for a query index. */
  inspectorOriginalQuery(index) {
    return this.page.locator(`[data-test="query-inspector-original-query-${index}"]`);
  }

  /** Query Inspector executed-query block for a query index. */
  inspectorExecutedQuery(index) {
    return this.page.locator(`[data-test="query-inspector-executed-query-${index}"]`);
  }

  // ---------------------------------------------------------------------------
  // Interactions
  // ---------------------------------------------------------------------------

  /**
   * Hover a notice chip and wait for its tooltip body to open.
   * The chip only appears after the panel's async diagnostics have settled, so
   * callers gate on panel idle before invoking this.
   * @param {string} id
   */
  async openNoticeTooltip(id) {
    const chip = this.noticeChip(id);
    await chip.waitFor({ state: "visible", timeout: 15000 });
    await chip.hover();
    await this.noticeContent(id).waitFor({ state: "visible", timeout: 5000 });
    return this.noticeContent(id);
  }

  /**
   * Hover a notice chip and click one of its tooltip action buttons.
   *
   * The tooltip fades + zooms in and reka's hoverable trigger can close it again
   * while Playwright moves the pointer from the chip to the button, so a plain
   * `click()` intermittently sees an unstable/detached target. We re-open, let
   * the entrance animation settle, then click normally (and retry on a close
   * race). A normal click keeps Playwright's actionability checks intact; the
   * retry loop already moves the pointer away and re-hovers, which is the
   * correct recovery from the reka-ui close race.
   * @param {string} noticeId - notice id, e.g. "series-cap" / "function-error".
   * @param {string} actionId - action button id, e.g. "use-top-n" / "edit-function".
   */
  async clickNoticeAction(noticeId, actionId) {
    const action = this.noticeAction(actionId);
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        await this.openNoticeTooltip(noticeId);
        await action.waitFor({ state: "visible", timeout: 5000 });
        await this.page.waitForTimeout(500);
        await action.click({ timeout: 5000 });
        return;
      } catch (error) {
        testLogger.warn(`Notice action "${actionId}" click attempt ${attempt + 1} failed, retrying`, {
          error: error.message,
        });
        // Move the pointer away so the next hover re-triggers the tooltip open.
        await this.page.mouse.move(0, 0).catch(() => {});
      }
    }
    throw new Error(`Could not click notice action "${actionId}" after 3 attempts`);
  }

  /** Close the Query Inspector dialog opened from a panel's "Inspector" menu action. */
  async closeInspector() {
    await this.inspectorDialog
      .locator('[data-test="o-dialog-close-btn"]')
      .click();
    await this.inspectorDialog
      .waitFor({ state: "hidden", timeout: 5000 })
      .catch((error) =>
        testLogger.warn("Query Inspector dialog did not close cleanly", {
          error: error.message,
        }),
      );
  }

  /**
   * Add a VRL function to the panel editor's function editor so the panel query
   * carries a `vrlFunctionQuery` (the classifier only routes `function_error`
   * server messages to the function-error notice when one is present).
   *
   * Mirrors the panel-editor VRL toggle + Monaco fill pattern; the toggle is the
   * OSwitch at data-test="logs-search-bar-show-query-toggle-btn".
   * @param {string} body - VRL function source.
   */
  async addPanelVrlFunction(body) {
    const toggle = this.page.locator(
      '[data-test="logs-search-bar-show-query-toggle-btn"]',
    );
    await toggle.waitFor({ state: "visible", timeout: 10000 });
    await toggle.click();

    const editor = this.page.locator('[data-test="dashboard-vrl-function-editor"]');
    await editor.waitFor({ state: "visible", timeout: 10000 });
    await editor.locator(".monaco-editor").click();
    // Monaco ignores .inputarea fills, so type it and confirm the editor shows it.
    await this.page.keyboard.type(body, { delay: 50 });
    await expect(editor.locator(".view-lines")).toContainText(body, { timeout: 5000 });
    testLogger.info("Panel VRL function entered", { body });
  }

  // ---------------------------------------------------------------------------
  // Search response mocks
  // ---------------------------------------------------------------------------
  // The dashboard search is an HTTP streaming (SSE) request to
  // _search_stream / _search_multi_stream, parsed by web/src/workers/streamWorker.js.
  // Injecting a `search_response_metadata` event with the desired `results` shape
  // is how a test deterministically drives the notice state without a real
  // backend failure. `route.fulfill` below replaces the whole stream.

  /**
   * Fulfill the next dashboard search with a 500, surfacing the legacy query-error
   * icon (the same route-mock pattern dashboard-exemplars.spec.js uses for its 500).
   */
  async installSearchErrorMock() {
    await this.page.route("**/api/**/_search**", (route) =>
      route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({ message: "search failed", code: 500 }),
      }),
    );
    testLogger.info("Search 500 mock installed");
  }

  /**
   * Fulfill the dashboard search with a minimal SSE stream whose
   * `search_response_metadata` event carries the given `results` partition.
   * @param {Object} results - e.g. { is_partial: true } or { function_error: [...] }.
   */
  async installSearchResultMetaMock(results) {
    const metadata = JSON.stringify({ results: { query_index: 0, ...results } });
    const hits = JSON.stringify({ results: { query_index: 0, hits: [] } });
    const body =
      "event: search_response_metadata\n" +
      `data: ${metadata}\n\n` +
      "event: search_response_hits\n" +
      `data: ${hits}\n\n`;

    await this.page.route("**/api/**/_search**", (route) =>
      route.fulfill({
        status: 200,
        contentType: "text/event-stream",
        body,
      }),
    );
    testLogger.info("Search result-metadata mock installed", { results });
  }
}
