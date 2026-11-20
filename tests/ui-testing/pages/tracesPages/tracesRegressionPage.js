// Traces sidebar, trace-details and drill-down actions used by the merged-fix regression specs.

import { expect } from "@playwright/test";

const b64 = (s) => Buffer.from(s).toString("base64");

export class TracesRegressionPage {
  constructor(page) {
    this.page = page;
    this.countBadge = '[data-test="traces-count-badge"]';
    this.refreshButton = '[data-test="logs-search-bar-refresh-btn"]';
    this.errorBadge = '[data-test="traces-error-count-badge"]';
    this.searchError = '[data-test="traces-search-error-message"]';
    this.valuesList = '[data-test="field-values-panel-values-list"]';
    this.resultList = '[data-test="traces-search-result-list"]';
    this.resultTable = '[data-test="o2-table"]';
    this.tooltip = '[data-test="o-tooltip-content"]';
  }

  baseUrl() {
    return (process.env.ZO_BASE_URL || "").replace(/\/+$/, "");
  }

  org() {
    return process.env.ORGNAME || "default";
  }

  /** Opens Spans view of `stream` over the last 6 hours with `query` in the editor. */
  async openSpans(stream, query = "") {
    const q = query ? `&query=${encodeURIComponent(b64(query))}` : "";
    await this.page.goto(
      `${this.baseUrl()}/web/traces?org_identifier=${this.org()}&stream=${encodeURIComponent(stream)}&period=6h&tab=spans${q}`,
    );
    await this.page
      .waitForLoadState("networkidle", { timeout: 30000 })
      .catch(() => {});
    await expect(this.page.locator(this.countBadge).first()).toBeVisible({
      timeout: 30000,
    });
  }

  async editorText() {
    return this.page.evaluate(() => {
      const editors = window.monaco?.editor?.getEditors?.() ?? [];
      const target =
        editors.find((e) =>
          e.getDomNode?.()?.closest("#traces-query-editor"),
        ) || editors[0];
      return (target?.getValue?.() ?? "").replace(/\s+/g, " ").trim();
    });
  }

  async spansFound() {
    const text =
      (await this.page
        .locator(this.countBadge)
        .first()
        .textContent()
        .catch(() => "")) || "";
    const m = text.match(/(\d+)\s+Spans?/i);
    return m ? Number(m[1]) : null;
  }

  /** Runs the editor's query and waits until every search request it started has finished. */
  async run() {
    await this.untilSearchesSettle(() =>
      this.page.locator(this.refreshButton).click(),
    );
  }

  /** Performs `action`, then waits until every search it started has finished and no result table is loading. */
  async untilSearchesSettle(action, timeout = 30000) {
    const inFlight = new Set();
    const isSearch = (r) => r.method() === "POST" && /\/_search/.test(r.url());
    const onStart = (r) => isSearch(r) && inFlight.add(r);
    const onEnd = (r) => inFlight.delete(r);
    const firstSearch = this.page
      .waitForRequest(isSearch, { timeout: 3000 })
      .catch(() => null);
    this.page.on("request", onStart);
    this.page.on("requestfinished", onEnd);
    this.page.on("requestfailed", onEnd);
    try {
      await action();
      // An action that changes nothing starts no search.
      if (!(await firstSearch)) return;
      await expect
        .poll(
          async () =>
            inFlight.size +
            (await this.page
              .locator(`${this.resultTable}[data-test-loading="true"]`)
              .count()),
          { timeout, message: "the searches the action started must finish" },
        )
        .toBe(0);
    } finally {
      this.page.off("request", onStart);
      this.page.off("requestfinished", onEnd);
      this.page.off("requestfailed", onEnd);
    }
  }

  async expectSpansFound(n, message) {
    await expect
      .poll(() => this.spansFound(), { timeout: 10000, message })
      .toBe(n);
  }

  async searchErrorText() {
    const el = this.page.locator(this.searchError);
    return (await el.isVisible().catch(() => false))
      ? (await el.innerText()).trim()
      : "";
  }

  async expandField(field) {
    await this.page
      .locator(`[data-test="log-search-expand-${field}-field-btn"]`)
      .click();
  }

  /** The `<=` (or `>=`) button on a duration percentile row such as Max or P25. */
  durationPercentileButton(label, op) {
    const row = this.page
      .locator("div")
      .filter({ has: this.page.getByText(label, { exact: true }) })
      .filter({ has: this.page.locator(`button[title^="duration ${op}"]`) })
      .last();
    return row.locator(`button[title^="duration ${op}"]`);
  }

  async clickDurationPercentile(label, op) {
    const btn = this.durationPercentileButton(label, op);
    await expect(
      btn,
      `duration panel must show a ${op} button on the ${label} row`,
    ).toBeVisible({ timeout: 15000 });
    await btn.click();
  }

  async clickFieldValue(field, value) {
    const box = this.page.locator(
      `[data-test="logs-search-subfield-add-${field}-${value}"]`,
    );
    await expect(box).toBeVisible({ timeout: 15000 });
    await box.click();
  }

  /** Reads the badge's own tooltip, which offers to clear the filter only while errors-only is on. */
  async isErrorsOnlyOn() {
    const badge = this.page.locator(this.errorBadge);
    if (!(await badge.isVisible().catch(() => false))) return false;
    await badge.hover();
    const tip = this.page.locator(this.tooltip).filter({ visible: true });
    await expect(tip, "the errors-only badge must show its tooltip").toHaveText(
      /clear error filter|filter by errors/i,
      { timeout: 10000 },
    );
    const on = /clear error filter/i.test(await tip.innerText());
    await this.page.mouse.move(0, 0);
    return on;
  }

  async clickErrorsOnly() {
    await this.page.locator(this.errorBadge).click();
  }

  async valueListTexts() {
    return this.page
      .locator(`${this.valuesList} [data-test^="logs-search-subfield-add-"]`)
      .evaluateAll((els) => els.map((e) => e.getAttribute("data-test")));
  }

  async resultOperationNames() {
    return this.page
      .locator(`${this.resultList} [data-test="trace-row-operation-name"]`)
      .allInnerTexts();
  }

  durationHeader() {
    return this.page
      .locator(`${this.resultList} th[data-test="o2-table-th-duration"]`)
      .first();
  }

  async durationSortOrder() {
    return this.durationHeader()
      .getAttribute("aria-sort")
      .catch(() => null);
  }

  /** Waits until the result table has no search loading, since the list ignores sort and paging clicks while it loads. */
  async waitForResultsIdle() {
    await expect(
      this.page.locator(`${this.resultList} ${this.resultTable}`).first(),
    ).toHaveAttribute("data-test-loading", "false", { timeout: 30000 });
  }

  /** Clicks the Duration header until it sorts descending, waiting for each click to take effect. */
  async sortByDurationDescending() {
    for (let i = 0; i < 3; i++) {
      await this.waitForResultsIdle();
      const before = await this.durationSortOrder();
      if (before === "descending") return;
      await this.untilSearchesSettle(() =>
        this.durationHeader()
          .locator('[data-test="o2-table-th-sort-trigger"]')
          .click(),
      );
      await expect
        .poll(() => this.durationSortOrder(), { timeout: 10000 })
        .not.toBe(before);
    }
  }

  async setRecordsPerPage(size) {
    await this.waitForResultsIdle();
    await this.page
      .locator('[data-test="traces-search-result-records-per-page-trigger"]')
      .click();
    await this.page
      .getByRole("option", { name: String(size), exact: true })
      .click();
  }

  async goToPage(n) {
    await this.page
      .locator(`[data-test="traces-search-result-pagination-page-${n}"]`)
      .click();
  }

  async openTraceDetails(stream, traceId, fromUs, toUs) {
    await this.page.goto(
      `${this.baseUrl()}/web/traces/trace-details?stream=${encodeURIComponent(stream)}&trace_id=${traceId}&from=${fromUs}&to=${toUs}&org_identifier=${this.org()}`,
    );
    await this.page
      .waitForLoadState("networkidle", { timeout: 30000 })
      .catch(() => {});
  }

  async waterfallOperationNames() {
    return this.page
      .locator('[data-test^="trace-tree-span-operation-name-"]')
      .evaluateAll((els) =>
        [
          ...new Set(
            els
              .map((e) => e.innerText.trim().split("\n").pop().trim())
              .filter(Boolean),
          ),
        ].sort(),
      );
  }

  async headerTraceId() {
    return (
      (await this.page
        .locator('[data-test="trace-details-trace-id"]')
        .first()
        .innerText()
        .catch(() => "")) || ""
    ).trim();
  }

  async clickWaterfallSpan(operationName) {
    await this.page
      .locator('[data-test^="trace-tree-span-operation-name-"]')
      .filter({ hasText: operationName })
      .first()
      .click();
  }

  async openLinksTab() {
    await this.page
      .locator('[data-test="trace-details-sidebar-tabs-links"]')
      .click();
  }

  async clickSpanLink(index = 0) {
    const link = this.page.locator(
      `[data-test="trace-details-sidebar-links-table"] [data-test="trace-event-detail-link-${index}"]`,
    );
    await expect(link, "the Links tab must list the span link").toBeVisible({
      timeout: 15000,
    });
    await link.click();
  }

  async openLogs(stream, query = "") {
    const q = query ? `&query=${encodeURIComponent(b64(query))}` : "";
    await this.page.goto(
      `${this.baseUrl()}/web/logs?stream_type=logs&stream=${encodeURIComponent(stream)}&period=6h&sql_mode=false&org_identifier=${this.org()}${q}`,
    );
    await this.page
      .waitForLoadState("networkidle", { timeout: 30000 })
      .catch(() => {});
  }

  async runLogsSearch() {
    await this.untilSearchesSettle(() =>
      this.page.locator(this.refreshButton).click(),
    );
  }

  async openDrillDown() {
    await this.page.locator('[data-test="logs-drilldown-toggle"]').click();
    await expect(
      this.page.locator('[data-test="logs-drill-down-page"]'),
    ).toBeVisible({ timeout: 15000 });
  }

  async waitForDrillDownDashboard() {
    await expect(
      this.page.locator('[data-test="dimension-selector-sidebar"]'),
      "the Drill down dimension list must load",
    ).toBeVisible({ timeout: 30000 });
  }

  dimensionCheckbox(field) {
    return this.page.locator(`[data-test="dimension-checkbox-${field}"]`);
  }

  async isDimensionSelected(field) {
    return this.dimensionCheckbox(field).evaluate((el) => {
      const box = el.matches("[role=checkbox]")
        ? el
        : el.querySelector("[role=checkbox]");
      return box?.getAttribute("aria-checked") === "true";
    });
  }

  /** Clicks the dimension's name, not its checkbox. */
  async clickDimensionName(field) {
    const row = this.page.locator("li.dimension-list-item", {
      has: this.dimensionCheckbox(field),
    });
    await row.locator(".dimension-label").click();
  }

  async selectedDimensionNames() {
    return this.page
      .locator('[data-test^="dimension-checkbox-"]')
      .evaluateAll((els) =>
        els
          .filter(
            (el) =>
              (el.matches("[role=checkbox]")
                ? el
                : el.querySelector("[role=checkbox]")
              )?.getAttribute("aria-checked") === "true",
          )
          .map((el) =>
            el.getAttribute("data-test").replace("dimension-checkbox-", ""),
          ),
      );
  }

  /** Records each canvas's last-frame fillText boxes, since chart text is drawn on canvas and has no DOM. Call before navigating. */
  async recordCanvasText() {
    await this.page.addInitScript(() => {
      const frames = new Map();
      window.__e2eCanvasText = frames;
      const proto = CanvasRenderingContext2D.prototype;
      const clearRect = proto.clearRect;
      proto.clearRect = function (x, y, w, h) {
        if (
          x <= 0 &&
          y <= 0 &&
          w >= this.canvas.width &&
          h >= this.canvas.height
        )
          frames.set(this.canvas, []);
        return clearRect.apply(this, arguments);
      };
      const fillText = proto.fillText;
      proto.fillText = function (text, x, y) {
        try {
          const m = this.getTransform();
          const t = this.measureText(text);
          const corners = [
            [x - t.actualBoundingBoxLeft, y - t.actualBoundingBoxAscent],
            [x + t.actualBoundingBoxRight, y - t.actualBoundingBoxAscent],
            [x + t.actualBoundingBoxRight, y + t.actualBoundingBoxDescent],
            [x - t.actualBoundingBoxLeft, y + t.actualBoundingBoxDescent],
          ].map(([px, py]) => [
            m.a * px + m.c * py + m.e,
            m.b * px + m.d * py + m.f,
          ]);
          if (!frames.has(this.canvas)) frames.set(this.canvas, []);
          frames.get(this.canvas).push({
            text: String(text),
            corners,
            rotated: Math.abs(m.b) > 1e-6,
          });
        } catch {
          // a failed measurement must never break the chart's own drawing
        }
        return fillText.apply(this, arguments);
      };
    });
  }

  /** Per visible chart canvas: its drawn texts as page-pixel polygons. */
  async canvasTextBoxes() {
    return this.page.evaluate(() =>
      [...(window.__e2eCanvasText?.entries() ?? [])]
        .filter(([c]) => c.isConnected && c.getBoundingClientRect().width > 0)
        .map(([c, texts]) => {
          const r = c.getBoundingClientRect();
          const sx = r.width / c.width;
          const sy = r.height / c.height;
          return texts.map((t) => ({
            ...t,
            corners: t.corners.map(([x, y]) => [r.x + x * sx, r.y + y * sy]),
          }));
        }),
    );
  }

  /** Drags across the Logs histogram from one fraction of its width to another. */
  async brushLogsHistogram(startRatio, endRatio) {
    const box = await this.page
      .locator('[data-test="logs-search-result-bar-chart"]')
      .boundingBox();
    expect(box, "Precondition: the Logs histogram is drawn").toBeTruthy();
    const y = box.y + box.height * 0.5;
    const pinBackdrop = this.page.locator(".oo-pin-backdrop");
    // A drag before the chart arms its brush lands as a click and pins a bar tooltip, so close it and drag again.
    for (let attempt = 0; attempt < 3; attempt++) {
      await this.page.mouse.move(box.x + box.width * startRatio, y);
      await this.page.mouse.down();
      await this.page.mouse.move(box.x + box.width * endRatio, y, {
        steps: 20,
      });
      await this.page.mouse.up();
      if (!(await pinBackdrop.isVisible())) return;
      await pinBackdrop.click();
      await expect(pinBackdrop).toBeHidden();
    }
    throw new Error("the Logs histogram never accepted a brush");
  }
}
