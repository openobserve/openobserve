import { expect } from '@playwright/test';

export class TraceFlameGraphPage {
  constructor(page) {
    this.page = page;
    this.flameGraphTab = '[data-test="trace-details-flame-graph-tab"]';
    this.chartWrapper = '[data-test="flame-graph-view-chart-wrapper"]';
    // FlameGraphView.vue gives the ruler tick labels no data-test; this class marks them.
    this.axisLabelSelector = '[data-test="flame-graph-view-chart-wrapper"] span.text-3xs';
    this.zoomInBtn = '[data-test="flame-graph-zoom-in"]';
    this.fitBtn = '[data-test="flame-graph-fit-screen"]';
  }

  async openTraceDetails(baseUrl, org, stream, traceId, fromUs, toUs) {
    await this.page.evaluate(() => localStorage.removeItem('o2_trace_active_tab'));
    await this.page.goto(`${baseUrl}/web/traces/trace-details?stream=${stream}&trace_id=${traceId}&from=${fromUs}&to=${toUs}&org_identifier=${org}`);
  }

  async openFlameGraph() {
    await this.page.locator(this.flameGraphTab).click({ timeout: 30000 });
    await this.page.locator(this.chartWrapper).waitFor({ state: 'visible', timeout: 30000 });
  }

  async axisLabels() {
    const texts = (await this.page.locator(this.axisLabelSelector).allInnerTexts()).map((t) => t.trim()).filter(Boolean);
    return { first: texts[0], last: texts[texts.length - 1], all: texts.join(' | ') };
  }

  async expectZoomInVisible() {
    await expect(this.page.locator(this.zoomInBtn)).toBeVisible();
  }

  async zoomIn(times = 1) {
    for (let i = 0; i < times; i++) await this.page.locator(this.zoomInBtn).click();
  }

  async fitToScreen() {
    await this.page.locator(this.fitBtn).click();
  }
}

export default TraceFlameGraphPage;
