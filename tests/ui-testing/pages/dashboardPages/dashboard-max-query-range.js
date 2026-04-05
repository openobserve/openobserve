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
   * Returns a Promise that resolves when the next matching search response
   * arrives. Call this BEFORE triggering the action that fires the request
   * to avoid a race condition.
   *
   * Non-async so the listener is registered synchronously the moment you
   * call the method — no hidden await to accidentally skip past.
   *
   * Usage:
   *   const searchDone = mqr.createSearchResponsePromise();
   *   await pm.dateTimeHelper.setRelativeTimeRange("6-w");  // triggers search
   *   await searchDone;
   *
   * @returns {Promise<void>}
   */
  createSearchResponsePromise() {
    const orgName = process.env.ORGNAME || "default";
    return this.page.waitForResponse(
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
   * Prefer createSearchResponsePromise() when the listener must be
   * registered before the triggering action.
   */
  async waitForSearchResponse() {
    return this.createSearchResponsePromise();
  }

  /**
   * Returns a Promise that resolves only after N DISTINCT matching search
   * responses have arrived. Uses a shared counter on a single page event
   * listener so each response is counted exactly once regardless of how
   * many panels are on the page.
   *
   * Usage:
   *   const allDone = mqr.createNSearchResponsesPromise(3);
   *   await pm.dateTimeHelper.setRelativeTimeRange("6-w");
   *   await allDone;
   *
   * @param {number} n - number of distinct search responses to wait for
   * @returns {Promise<void>}
   */
  createNSearchResponsesPromise(n) {
    const orgName = process.env.ORGNAME || "default";
    return new Promise((resolve) => {
      let remaining = n;
      const handler = (response) => {
        if (
          response.url().includes(`/api/${orgName}/`) &&
          response.url().includes("_search") &&
          response.url().includes("type=logs") &&
          response.status() === 200
        ) {
          remaining--;
          if (remaining === 0) {
            this.page.off("response", handler);
            resolve();
          }
        }
      };
      this.page.on("response", handler);
    });
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
