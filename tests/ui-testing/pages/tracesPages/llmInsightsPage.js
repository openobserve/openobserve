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

// The model-grouped panels — the horizontal-bar charts whose SQL buckets by
// `gen_ai_response_model` (`spans-by-model`, `tokens-by-model`,
// `latency-by-model`). Their `_search_stream` responses carry each bucket's
// `model` value, which is how the E2E test verifies the scoped queries drop
// spans that carry no model (no synthetic "unknown" bucket).
const MODEL_GROUPED_PANEL_IDS = [
  'llm-latency-by-model',
  'llm-spans-by-model',
  'llm-tokens-by-model',
];

// The streaming search endpoint answers in Server-Sent Events:
//   event: search_response_hits
//   data: {"hits":[{"model":"gpt-4o","count":1}, ...]}
// Pull the `model` value out of every hit in an SSE body.
function extractModelValuesFromSse(body) {
  const models = [];
  if (!body) return models;
  for (const block of body.split(/\n\n+/)) {
    const dataLine = block.split('\n').find((line) => line.startsWith('data:'));
    if (!dataLine) continue;
    const data = dataLine.slice('data:'.length).trim();
    if (!data || data === 'end' || data === '[[DONE]]') continue;
    let parsed;
    try {
      parsed = JSON.parse(data);
    } catch {
      continue;
    }
    const hits = parsed?.hits ?? parsed?.results?.hits ?? [];
    if (!Array.isArray(hits)) continue;
    for (const hit of hits) {
      if (hit && typeof hit === 'object' && 'model' in hit) models.push(hit.model);
    }
  }
  return models;
}

export class LLMInsightsPage {
  constructor(page) {
    this.page = page;

    // Page shell (AiPageShell wrapper) — LLMInsightsPage.vue passes
    // data-test="ai-llm-insights" to AiPageShell, which resolves it to its
    // `dataTest` prop and renders the header as `ai-llm-insights-page`
    // (`${dataTest}-page`). The bare prefix is never emitted to the DOM.
    this.shell = '[data-test="ai-llm-insights-page"]';
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
   * `type=stream` pins the scope bar to Stream mode: the model-grouped panels
   * are scoped to `gen_ai_response_model` on the active stream, so the test
   * exercises the model filter without depending on the agent-mapping cascade
   * (which needs `gen_ai.agent.*` attributes the harness doesn't seed).
   * @param {string} orgName - Organization identifier (defaults to ORGNAME env).
   */
  async navigateToLLMInsights(orgName = null) {
    const org = orgName || process.env['ORGNAME'] || 'default';
    const baseUrl = (process.env['ZO_BASE_URL'] || '').replace(/\/+$/, '');
    await this.page.goto(`${baseUrl}/web/ai/llm-insights?org_identifier=${org}&type=stream`);
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

  get modelGroupedPanelIds() {
    return MODEL_GROUPED_PANEL_IDS;
  }

  /**
   * Start capturing the model-grouped panels' streaming search responses.
   * Must be called BEFORE navigateToLLMInsights() so no panel query response
   * is missed. Returns an async snapshot function resolving to
   * `{ respondedPanelIds, models }` — the panel ids that have answered and the
   * distinct `model` category values those panels bucketed so far.
   */
  startModelPanelCapture() {
    const respondedPanelIds = new Set();
    const bodyPromises = [];
    const onResponse = (response) => {
      const url = response.url();
      if (!url.includes('_search_stream')) return;
      const panelId = MODEL_GROUPED_PANEL_IDS.find((id) => url.includes(`panel_id=${id}`));
      if (!panelId) return;
      respondedPanelIds.add(panelId);
      bodyPromises.push(response.text().catch(() => ''));
    };
    this.page.on('response', onResponse);

    return async () => {
      const bodies = await Promise.all(bodyPromises);
      const models = new Set();
      for (const body of bodies) {
        for (const model of extractModelValuesFromSse(body)) models.add(model);
      }
      return { respondedPanelIds: [...respondedPanelIds], models: [...models] };
    };
  }
}
