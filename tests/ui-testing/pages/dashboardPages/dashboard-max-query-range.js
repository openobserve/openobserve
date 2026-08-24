import { expect } from "@playwright/test";
const testLogger = require("../../playwright-tests/utils/test-logger.js");

const DEFAULT_STREAM = "e2e_max_query_range";

export default class DashboardMaxQueryRange {
  /** Matches either backend wording for a max-query-range restriction. */
  static RANGE_RESTRICTION_RE =
    /Query duration is modified due to query range restriction|reached max query range limit/;

  /**
   * @param {import('@playwright/test').Page} page
   */
  constructor(page) {
    this.page = page;
    this.warningIcon = page.locator('[data-test="panel-max-duration-warning"]');
    this.tooltip = page.locator('[data-test="o-tooltip-content"]');
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

    // Fail loudly. Swallowing a non-200 left the stream unrestricted, and every
    // downstream assertion then failed as "warning icon not visible" — blaming the
    // panel rather than the setup call that actually broke. A setup failure must
    // not be able to masquerade as a product bug.
    if (result.status !== 200) {
      throw new Error(
        `setMaxQueryRange(${hours}) failed for stream "${streamName}": ` +
          `HTTP ${result.status} — ${String(result.body).slice(0, 300)}`
      );
    }
    testLogger.info("Max query range set via API", { hours, stream: streamName });

    // Read the setting back rather than sleeping 1s and hoping it propagated.
    await this.waitForMaxQueryRangeApplied(hours, streamName);
  }

  /**
   * Poll the stream schema until `max_query_range` actually reports `hours`.
   *
   * The PUT returning 200 only means the write was accepted; the tests then
   * immediately assert on UI driven by that setting, so this closes the gap
   * deterministically instead of with a fixed sleep that is simultaneously too
   * long on an idle machine and too short under parallel load.
   *
   * @param {number} hours
   * @param {string} [streamName]
   */
  async waitForMaxQueryRangeApplied(hours, streamName = DEFAULT_STREAM) {
    const orgId = process.env.ORGNAME || "default";

    await expect
      .poll(
        async () =>
          this.page.evaluate(
            async ({ orgId, streamName, hours }) => {
              const r = await fetch(
                `/api/${orgId}/streams/${streamName}/schema?type=logs`,
                { headers: { Accept: "application/json" } }
              );
              // A stream that does not exist yet cannot be carrying a
              // restriction, so treat that as already-reset rather than failing
              // the afterEach cleanup on a test that never got as far as
              // ingesting.
              if (!r.ok) return hours === 0 ? 0 : null;
              const body = await r.json();
              return body?.settings?.max_query_range ?? null;
            },
            { orgId, streamName, hours }
          ),
        {
          timeout: 15000,
          intervals: [200, 400, 800, 1500, 3000],
          message: `stream "${streamName}" never reported max_query_range=${hours}`,
        }
      )
      .toBe(hours);
  }

  /**
   * Wait until the stream is queryable after ingestion.
   *
   * Replaces the fixed 2s sleep the spec used to run after ingestion(): the
   * ingest -> queryable delay is load-dependent, so a constant wait is the wrong
   * shape for it in both directions.
   *
   * @param {string} [streamName]
   */
  async waitForStreamReady(streamName = DEFAULT_STREAM) {
    const orgId = process.env.ORGNAME || "default";
    await expect
      .poll(
        async () =>
          this.page.evaluate(
            async ({ orgId, streamName }) => {
              const r = await fetch(
                `/api/${orgId}/streams/${streamName}/schema?type=logs`,
                { headers: { Accept: "application/json" } }
              );
              return r.ok;
            },
            { orgId, streamName }
          ),
        {
          timeout: 30000,
          intervals: [300, 600, 1200, 2000],
          message: `stream "${streamName}" did not become queryable after ingestion`,
        }
      )
      .toBe(true);
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
   * Wait until no panel on the dashboard view is still loading.
   *
   * createSearchResponsePromise() only proves the search STARTED — it resolves on
   * response headers, while streaming bodies deliver the max-query-range metadata
   * at the end. Pair the two: headers to confirm the request fired, this to
   * confirm it finished. (Reading the body is not an option: the SQL executor
   * aborts its controller on completion, so response.text() rejects.)
   *
   * Idle = no cancel button, and a refresh button that is not disabled.
   *
   * @param {number} timeout
   */
  async waitForPanelsIdle(timeout = 45000) {
    await this.page.waitForFunction(
      () => {
        if (document.querySelector('[data-test="dashboard-cancel-btn"]')) return false;
        const refresh = document.querySelector('[data-test="dashboard-refresh-btn"]');
        if (!refresh) return false;
        return !refresh.disabled && refresh.getAttribute("aria-disabled") !== "true";
      },
      { timeout }
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
  createNSearchResponsesPromise(n, timeout = 45000) {
    const orgName = process.env.ORGNAME || "default";
    return new Promise((resolve, reject) => {
      let remaining = n;

      // Without this the promise could never settle: if even one panel's search
      // did not fire, the await sat there until the whole test timed out, and the
      // report blamed the test rather than saying how many responses were missing.
      const timer = setTimeout(() => {
        this.page.off("response", handler);
        reject(
          new Error(
            `Expected ${n} search responses, but only ${n - remaining} arrived ` +
              `within ${timeout}ms`
          )
        );
      }, timeout);

      const handler = (response) => {
        if (
          response.url().includes(`/api/${orgName}/`) &&
          response.url().includes("_search") &&
          response.url().includes("type=logs") &&
          response.status() === 200
        ) {
          remaining--;
          if (remaining === 0) {
            clearTimeout(timer);
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
   * Assert a tooltip reports a range restriction, whichever backend produced it.
   *
   * Non-streaming says "Query duration is modified due to query range restriction
   * of N hours"; streaming says "reached max query range limit". Asserting either
   * literal pins the test to one deployment mode. Both carry "Data returned for:".
   *
   * @param {Function} expect - Playwright expect
   * @param {string} tooltipText
   */
  expectRangeRestrictionTooltip(expect, tooltipText) {
    expect(
      DashboardMaxQueryRange.RANGE_RESTRICTION_RE.test(tooltipText),
      `tooltip did not report a max-query-range restriction in either the ` +
        `streaming or non-streaming wording. Received: ${tooltipText}`,
    ).toBe(true);
    expect(tooltipText).toContain("Data returned for:");
  }

  /**
   * True when the tooltip names the limit in hours — only the non-streaming
   * backend does, so an hours assertion is only meaningful when this is true.
   *
   * @param {string} tooltipText
   */
  static statesRestrictionHours(tooltipText) {
    return /restriction of \d+ hours?/.test(tooltipText);
  }

    /**
   * Hover over the first warning icon and return the tooltip text.
   * @returns {Promise<string>}
   */
  async getWarningTooltipText() {
    await this.warningIcon.first().hover();
    const content = this.page
      .locator('[data-test="panel-max-duration-warning-content"]')
      .first();
    await expect(content).toBeVisible({ timeout: 5000 });
    const text = await content.textContent();
    testLogger.info("Warning tooltip text", { text });
    return text;
  }
}
