// Dashboard Lazy Panel Mounting Page Object Model
// Locators + assertions for the component-mount lazy gate: off-screen panels
// render a lightweight placeholder ([data-test="dashboard-panel-placeholder-<id>"])
// and the full PanelContainer mounts only when the panel's .grid-stack-item tile
// enters the viewport. Mounting is one-way (scrolling away never unmounts).

import { expect } from "@playwright/test";
import {
  SELECTORS,
  getPanelPlaceholder,
  getPanelContainerById,
  getSectionHeaderById,
} from "./dashboard-selectors.js";

export default class DashboardLazyMounting {
  constructor(page) {
    this.page = page;
  }

  /**
   * Get a panel's grid slot by index. Present for every panel — mounted or
   * placeholder — because the `.grid-stack-item` root carries `:gs-id="item.id"`.
   * @param {number} index - 0-based index (creation order)
   * @returns {import('@playwright/test').Locator}
   */
  getGridStackItem(index = 0) {
    return this.page.locator(SELECTORS.GRID_STACK_ITEM).nth(index);
  }

  /**
   * Get the lazy placeholder card for a panel by ID.
   * @param {string} panelId
   * @returns {import('@playwright/test').Locator}
   */
  getPanelPlaceholder(panelId) {
    return this.page.locator(getPanelPlaceholder(panelId));
  }

  /**
   * Get the mounted PanelContainer for a panel by ID.
   * @param {string} panelId
   * @returns {import('@playwright/test').Locator}
   */
  getPanelContainerById(panelId) {
    return this.page.locator(getPanelContainerById(panelId));
  }

  /**
   * Get the bare section-header heading for an `o2SectionHeader` panel.
   * @param {string} panelId
   * @returns {import('@playwright/test').Locator}
   */
  getSectionHeaderById(panelId) {
    return this.page.locator(getSectionHeaderById(panelId));
  }

  /**
   * Read a panel's id from its grid slot's `gs-id` attribute. Works for both
   * mounted and placeholder panels (the placeholder carries no data-test-panel-id).
   * @param {number} index - 0-based grid slot index
   * @returns {Promise<string>} panel id
   */
  async getPanelIdFromGridSlot(index = 0) {
    const item = this.getGridStackItem(index);
    await item.waitFor({ state: "attached", timeout: 15000 });
    const panelId = await item.getAttribute("gs-id");
    if (!panelId) {
      throw new Error(`Grid slot ${index} has no gs-id attribute`);
    }
    return panelId;
  }

  /**
   * Scroll a panel's grid slot into the viewport (mounts a placeholder panel).
   * @param {number} index - 0-based grid slot index
   */
  async scrollGridSlotIntoView(index = 0) {
    await this.getGridStackItem(index).scrollIntoViewIfNeeded();
  }

  /**
   * Scroll the dashboard back to the top (used to assert one-way mounting).
   */
  async scrollDashboardToTop() {
    await this.page.evaluate(() => {
      window.scrollTo(0, 0);
      const container = document.querySelector(".dashboard-panels-container");
      if (container) {
        container.scrollTop = 0;
        container.scrollLeft = 0;
      }
    });
  }

  // ===== Assertion helpers (all real — no tautologies) =====

  async expectPlaceholderVisible(panelId, timeout = 15000) {
    await expect(this.getPanelPlaceholder(panelId)).toBeVisible({ timeout });
  }

  async expectPlaceholderCount(panelId, count) {
    await expect(this.getPanelPlaceholder(panelId)).toHaveCount(count);
  }

  async expectContainerVisible(panelId, timeout = 15000) {
    await expect(this.getPanelContainerById(panelId)).toBeVisible({ timeout });
  }

  async expectContainerCount(panelId, count) {
    await expect(this.getPanelContainerById(panelId)).toHaveCount(count);
  }

  async expectPlaceholderContainsTitle(panelId, title) {
    await expect(this.getPanelPlaceholder(panelId)).toContainText(title);
  }

  /**
   * Assert the placeholder renders no chart/table/no-data renderer — a real
   * assertion that the async renderer chunk was not mounted for this panel.
   * @param {string} panelId
   */
  async expectNoRendererInsidePlaceholder(panelId) {
    const renderers = this.getPanelPlaceholder(panelId).locator(
      SELECTORS.PANEL_RENDERERS
    );
    await expect(renderers).toHaveCount(0);
  }

  /**
   * Assert a data renderer (chart / table / no-data) appears inside the mounted
   * panel — proves the second lazy gate (data fetch on visibility) resolved.
   * @param {string} panelId
   */
  async expectRendererVisibleInPanel(panelId, timeout = 30000) {
    const renderers = this.getPanelContainerById(panelId).locator(
      SELECTORS.PANEL_RENDERERS
    );
    await expect(renderers.first()).toBeVisible({ timeout });
  }

  async expectSectionHeaderVisible(panelId, timeout = 15000) {
    await expect(this.getSectionHeaderById(panelId)).toBeVisible({ timeout });
  }
}
