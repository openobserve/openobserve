// llmInsightsPage.js
// Page object for the LLM Insights dashboard (AI Observability module).
// Selectors verified against:
//   web/src/enterprise/views/AIObservability/LLMInsightsPage.vue
//   web/src/plugins/traces/LLMInsightsDashboard.vue
//   web/src/plugins/traces/config/llmInsightsPanels.ts (panel title keys)
// The model-grouped panels (cost-trend, token-trend, latency-by-model,
// spans-by-model, tokens-by-model) render through the shared dashboards
// PanelSchemaRenderer and must scope to spans carrying gen_ai_response_model —
// no synthetic "unknown" model bucket.

import { expect } from '@playwright/test';

export class LLMInsightsPage {
  constructor(page) {
    this.page = page;

    // Page shell (AiPageShell wrapper) — LLMInsightsPage.vue
    this.shell = '[data-test="ai-llm-insights"]';
    // Terminal states — LLMInsightsDashboard.vue
    this.emptyState = '[data-test="llm-insights-empty"]';
    this.emptyErrorState = '[data-test="llm-insights-empty-error"]';
    this.agentEmptyState = '[data-test="llm-insights-agent-empty"]';
    // Panel card titles (i18n-resolved) — llmInsightsPanels.ts title keys.
    // cost-trend is the first panel in LLM_INSIGHTS_PANELS, so its title is the
    // cheapest signal that the dashboard content (not the empty state) rendered.
    this.costTrendTitle = 'Cost trend';
    this.latencyByModelTitle = 'Latency by model';
    this.spansByModelTitle = 'Spans by model';
    this.tokensByModelTitle = 'Tokens by model';
  }

  /**
   * Navigate directly to the LLM Insights dashboard with the org in the URL.
   * The route lives under the AI Observability shell (/web/ai/llm-insights).
   * @param {string} orgName - Organization identifier (defaults to ORGNAME env).
   */
  async navigateToLLMInsights(orgName = null) {
    const org = orgName || process.env['ORGNAME'] || 'default';
    const baseUrl = (process.env['ZO_BASE_URL'] || '').replace(/\/+$/, '');
    await this.page.goto(`${baseUrl}/web/ai/llm-insights?org_identifier=${org}`);
    await this.page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
  }

  async expectShellVisible() {
    await expect(this.page.locator(this.shell)).toBeVisible({ timeout: 30000 });
  }

  async expectEmptyStateVisible() {
    await expect(this.page.locator(this.emptyState)).toBeVisible({ timeout: 30000 });
  }

  // True once the dashboard settled into a terminal state: panel content (LLM
  // data present) or one of the empty/error states (no LLM data in this
  // org/window). The skeleton/loading states are deliberately excluded so a
  // poll on this only resolves once the fetch actually finished.
  async isTerminalStateVisible() {
    if (await this.page.locator(this.emptyState).isVisible().catch(() => false)) return true;
    if (await this.page.locator(this.emptyErrorState).isVisible().catch(() => false)) return true;
    if (await this.page.locator(this.agentEmptyState).isVisible().catch(() => false)) return true;
    return this.page
      .getByText(this.costTrendTitle, { exact: true })
      .isVisible()
      .catch(() => false);
  }

  async expectSpansByModelPanelVisible() {
    await expect(this.page.getByText(this.spansByModelTitle, { exact: true })).toBeVisible({
      timeout: 30000,
    });
  }

  async expectTokensByModelPanelVisible() {
    await expect(this.page.getByText(this.tokensByModelTitle, { exact: true })).toBeVisible({
      timeout: 30000,
    });
  }

  async expectLatencyByModelPanelVisible() {
    await expect(this.page.getByText(this.latencyByModelTitle, { exact: true })).toBeVisible({
      timeout: 30000,
    });
  }
}
