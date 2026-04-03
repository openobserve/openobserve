import { expect } from "@playwright/test";
const testLogger = require("../../playwright-tests/utils/test-logger.js");

const DEFAULT_STREAM = "e2e_max_query_range";

export default class DashboardMaxQueryRange {
  /**
   * @param {import('@playwright/test').Page} page
   */
  constructor(page) {
    this.page = page;
    this.warningIcon = page.locator('[data-test="panel-max-duration-warning"]');
    this.tooltip = page.locator(".q-tooltip");
  }

  // ---------------------------------------------------------------------------
  // Stream settings API
  // ---------------------------------------------------------------------------

  /**
   * Set max_query_range on a stream via the settings API.
   * @param {number} hours - 0 to reset (no limit)
   * @param {string} [streamName]
   */
  async setMaxQueryRange(hours, streamName = DEFAULT_STREAM) {
    const orgId = process.env.ORGNAME || "default";
    const payload = { max_query_range: hours };

    const result = await this.page.evaluate(
      async ({ orgId, streamName, payload }) => {
        const r = await fetch(
          `/api/${orgId}/streams/${streamName}/settings?type=logs`,
          {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          }
        );
        const text = await r.text();
        return { status: r.status, body: text };
      },
      { orgId, streamName, payload }
    );

    if (result.status === 200) {
      testLogger.info("Max query range set via API", { hours, stream: streamName });
    } else {
      testLogger.warn("Failed to set max query range via API", { result });
    }

    await this.page.waitForTimeout(1000);
  }

  /**
   * Reset max query range to 0 (no limit).
   * @param {string} [streamName]
   */
  async resetMaxQueryRange(streamName = DEFAULT_STREAM) {
    await this.setMaxQueryRange(0, streamName);
  }

  // ---------------------------------------------------------------------------
  // Search response
  // ---------------------------------------------------------------------------

  /**
   * Register the search response listener BEFORE triggering the action that
   * fires the request, then await the returned promise after the action.
   * This avoids the race condition where a fast response is already gone by
   * the time waitForResponse() is called.
   *
   * Usage:
   *   const searchDone = mqr.createSearchResponsePromise();
   *   await pm.dateTimeHelper.setRelativeTimeRange("6-w");  // triggers search
   *   await searchDone;
   *
   * @returns {Promise<void>}
   */
  async createSearchResponsePromise() {
    const orgName = process.env.ORGNAME || "default";
    await this.page.waitForResponse(
      (resp) =>
        resp.url().includes(`/api/${orgName}/`) &&
        resp.url().includes("_search") &&
        resp.url().includes("type=logs") &&
        resp.status() === 200,
      { timeout: 30000 }
    );
  }

  /**
   * Wait for the search API response to complete (SSE or JSON).
   * Safe to use when you are certain no response has been missed yet
   * (e.g. immediately after page load before any user action).
   * Prefer createSearchResponsePromise() when registering after an action.
   */
  async waitForSearchResponse() {
    return this.createSearchResponsePromise();
  }

  /**
   * Register N search response listeners BEFORE triggering the action,
   * then await the returned promise after. Use when multiple panels will
   * each fire their own search request (e.g. a dashboard with N panels).
   *
   * Usage:
   *   const allDone = mqr.createNSearchResponsesPromise(3);
   *   await pm.dateTimeHelper.setRelativeTimeRange("6-w");
   *   await allDone;
   *
   * @param {number} n - number of search responses to wait for
   * @returns {Promise<void>}
   */
  createNSearchResponsesPromise(n) {
    return Promise.all(
      Array.from({ length: n }, () => this.createSearchResponsePromise())
    );
  }

  // ---------------------------------------------------------------------------
  // Warning tooltip
  // ---------------------------------------------------------------------------

  /**
   * Hover over the first warning icon and return the tooltip text.
   * @returns {Promise<string>}
   */
  async getWarningTooltipText() {
    await this.warningIcon.first().hover();
    await expect(this.tooltip).toBeVisible({ timeout: 5000 });
    const text = await this.tooltip.textContent();
    testLogger.info("Warning tooltip text", { text });
    return text;
  }}
