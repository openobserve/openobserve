import { expect } from '@playwright/test';

export class AlertPromqlEditorDialogPage {
  constructor(page) {
    this.page = page;
    this.panelContainer = '[data-test="dashboard-panel-container"]';
    this.panelMenuTrigger = '[data-test^="dashboard-edit-panel-"][data-test$="-dropdown"]';
    this.createAlertFromPanel = '[data-test="dashboard-create-alert-from-panel"]';
    this.promqlModeBtn = '[data-test="query-mode-promql"]';
    this.viewEditorBtn = '[data-test="step2-view-editor-btn"]';
    this.runQueryBtn = '[data-test="alert-run-query-btn"]';
    this.dialogCard = '[data-test="query-editor-dialog-card"]';
    this.dialogRoot = '[data-test="query-editor-dialog"]';
    // The dialog holds two editors; the output pane's one sits inside sql-output-editor.
    this.promqlEditor = `${this.dialogCard} [data-test="query-editor"]:not([data-test="sql-output-editor"] [data-test="query-editor"])`;
    this.editorLine = '.view-line';
  }

  editor() {
    return this.page.locator(this.promqlEditor);
  }

  firstEditorLine() {
    return this.editor().locator(this.editorLine).first();
  }

  async openFromDashboardPanel(baseUrl, org, dashboardId) {
    await this.page.goto(`${baseUrl}/web/dashboards/view?org_identifier=${org}&dashboard=${dashboardId}&folder=default&tab=default`);
    const panel = this.page.locator(this.panelContainer).first();
    await expect(panel).toBeVisible({ timeout: 30000 });
    await panel.hover();
    await panel.locator(this.panelMenuTrigger).click();
    const createAlert = this.page.locator(this.createAlertFromPanel);
    await expect(createAlert).toBeEnabled({ timeout: 15000 });
    await createAlert.click();
    await this.page.waitForURL(/alerts\/add.*prefill=panel/, { timeout: 30000 });
    await expect(this.page.locator(this.promqlModeBtn)).toHaveAttribute('aria-pressed', 'true', { timeout: 30000 });
    await this.page.locator(this.viewEditorBtn).click();
    await expect(this.editor()).toBeVisible({ timeout: 30000 });
  }

  async expectEditorText(text) {
    await expect(this.firstEditorLine()).toHaveText(text);
  }

  /** Clicks Run query and returns the PromQL range-query response it triggers. */
  async runQueryAndCaptureRangeResponse() {
    const responsePromise = this.page.waitForResponse((res) => res.url().includes('/prometheus/api/v1/query_range'), { timeout: 30000 });
    await this.page.locator(this.runQueryBtn).click();
    return responsePromise;
  }

  async expectEventsFound(timeout = 30000) {
    await expect(this.page.locator(this.dialogCard)).toContainText(/[1-9]\d* events found/, { timeout });
  }

  /** Editor height plus the summed scrollTop of its ancestors inside the dialog. */
  async measureEditor() {
    return this.editor().evaluate((el, rootSel) => {
      let scrolled = 0;
      for (let p = el.parentElement; p && !p.matches(rootSel); p = p.parentElement) {
        scrolled += p.scrollTop;
      }
      return { height: Math.round(el.getBoundingClientRect().height), scrolled };
    }, this.dialogRoot);
  }

  async wheelOverEditor(times, deltaY, pauseMs) {
    const box = await this.editor().boundingBox();
    await this.page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    for (let i = 0; i < times; i++) {
      await this.page.mouse.wheel(0, deltaY);
      // Spaced wheels give a ResizeObserver feedback loop time to grow the editor between events.
      await this.page.waitForTimeout(pauseMs);
    }
  }

  async expectFirstLineInsideEditor() {
    await expect(this.firstEditorLine()).toBeInViewport();
    const lineBox = await this.firstEditorLine().boundingBox();
    const editorBox = await this.editor().boundingBox();
    expect(lineBox.y).toBeGreaterThanOrEqual(editorBox.y);
    expect(lineBox.y + lineBox.height).toBeLessThanOrEqual(editorBox.y + editorBox.height);
  }
}

export default AlertPromqlEditorDialogPage;
