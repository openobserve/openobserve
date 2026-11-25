// Table panel cells on a dashboard view: values, the per-cell Copy action and cell colours.
import { expect } from "@playwright/test";

export class DashboardPanelTablePage {
  constructor(page) {
    this.page = page;
    this.table = page.locator('[data-test="dashboard-panel-table"]').first();
    this.panelContainer = page.locator('[data-test="dashboard-panel-container"]').first();
  }

  async gotoDashboardView(dashboardId, { org, folder = "default", period }) {
    await this.page.goto(
      `${process.env.ZO_BASE_URL}/web/dashboards/view?org_identifier=${org}&dashboard=${dashboardId}&folder=${folder}&period=${period}`,
    );
  }

  cell(text) {
    return this.table.locator("td", { hasText: text });
  }

  copyButton(alias) {
    return this.page.locator(`[data-test="dashboard-table-cell-copy-${alias}"]`).first();
  }

  async copyCell(text, alias) {
    await this.cell(text).hover();
    const copy = this.copyButton(alias);
    await expect(copy, "the hovered time cell offers Copy").toBeVisible({ timeout: 10000 });
    await copy.click();
  }

  async cellBackgrounds(exactValue) {
    return this.cell(new RegExp(`^${exactValue}$`)).evaluateAll((tds) =>
      tds.map((td) => getComputedStyle(td).backgroundColor),
    );
  }

  async cellBackground(exactValue) {
    return this.cell(new RegExp(`^${exactValue}$`)).evaluate((td) => getComputedStyle(td).backgroundColor);
  }
}

export default DashboardPanelTablePage;
