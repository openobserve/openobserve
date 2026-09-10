// aiObservabilityPage.js
import { expect } from '@playwright/test';
const { getAuthHeaders, getOrgIdentifier } = require('../../playwright-tests/utils/cloud-auth.js');

/**
 * Page object for the OSS "AI Observability" Monitor module (`/web/ai`): the
 * LLM Insights dashboard and the Sessions list/detail. Navigation mirrors
 * `tracesPage.navigateToTracesUrl` (full `page.goto` with `org_identifier`).
 *
 * Selectors are verified against the Vue sources:
 *   - AiPageShell.vue / LLMInsightsPage.vue / SessionsPage.vue (page roots)
 *   - LLMInsightsDashboard.vue + KpiCardRow.vue + LLMErrorTable.vue (KPI strip,
 *     recent-errors table, empty/error states)
 *   - SessionsList.vue + SessionDetails.vue (table, status badge, detail)
 *   - Index.vue + SectionRail.vue (the module's left section rail)
 *   - MainLayout.vue + MenuLink.vue (`menu-link-/ai-item` nav entry)
 */
export class AiObservabilityPage {
  constructor(page) {
    this.page = page;

    // Primary nav entry (inserted directly after Traces on OSS).
    this.aiNavItem = '[data-test="menu-link-/ai-item"]';

    // Module section rail (Index.vue → SectionRail).
    this.sectionRail = '[data-test="section-rail"]';
    this.railLlmInsights = '[data-test="ai-secondary-nav-llm-insights"]';
    this.railSessions = '[data-test="ai-secondary-nav-sessions"]';
    this.railAgentGraph = '[data-test="ai-secondary-nav-agent-graph"]';
    this.railQuality = '[data-test="ai-secondary-nav-quality"]';
    this.railScoreConfigs = '[data-test="ai-secondary-nav-score-configs"]';
    this.railExperiments = '[data-test="ai-secondary-nav-experiments"]';

    // LLM Insights page (AiPageShell + LLMInsightsDashboard).
    this.llmInsightsPage = '[data-test="ai-llm-insights-page"]';
    this.llmInsightsRefreshBtn = '[data-test="ai-llm-insights-refresh-btn"]';
    this.llmInsightsLastRefreshed = '[data-test="ai-llm-insights-last-refreshed"]';
    this.llmInsightsFilterMode = '[data-test="llm-insights-filter-mode"]';
    this.llmInsightsStreamSelector = '[data-test="llm-insights-stream-selector"]';
    this.kpiCardRow = '[data-test="kpi-card-row"]';
    this.kpiCard = '[data-test="kpi-card-row"] > div';
    this.recentErrorsTable = '[data-test="llm-recent-errors-table"]';
    this.llmInsightsEmpty = '[data-test="llm-insights-empty"]';
    this.llmInsightsError = '[data-test="llm-insights-empty-error"]';

    // Sessions page (AiPageShell + SessionsList).
    this.sessionsPage = '[data-test="ai-sessions-page"]';
    this.sessionsTable = '[data-test="sessions-list-table"]';
    this.sessionsEmptyNoStreams = '[data-test="sessions-empty-no-streams"]';
    this.sessionsFilterMode = '[data-test="sessions-list-filter-mode"]';
    this.sessionsStreamSelector = '[data-test="sessions-list-stream-selector"]';
    this.sessionRow = '[data-test="sessions-list-table"] [data-test^="o2-table-row-"]:not([data-test="o2-table-row-drag-handle"])';

    // Session detail (SessionDetails.vue).
    this.sessionDetailHeader = '[data-test="session-detail-header"]';
    this.sessionTurnRow = '[data-test^="session-turn-row-"]';
  }

  // ===== Navigation =====

  async navigateToLlmInsights() {
    const org = process.env['ORGNAME'] || 'default';
    const baseUrl = (process.env['ZO_BASE_URL'] || '').replace(/\/+$/, '');
    await this.page.goto(`${baseUrl}/web/ai/llm-insights?org_identifier=${org}`);
    await this.page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
  }

  async navigateToSessions() {
    const org = process.env['ORGNAME'] || 'default';
    const baseUrl = (process.env['ZO_BASE_URL'] || '').replace(/\/+$/, '');
    await this.page.goto(`${baseUrl}/web/ai/sessions?org_identifier=${org}`);
    await this.page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
  }

  // ===== Stream selection (parallel tests each own a unique stream) =====

  /**
   * Select a stream in an AI scope-bar picker. OSelect renders options as
   * `[data-test="<picker>-option"][data-test-value="<value>"]` (listbox mode),
   * mounted only while the popover is open — same contract as
   * `tracesPage.selectTraceStream`.
   */
  async _selectStream(pickerDataTest, streamName) {
    const wrapper = this.page.locator(`[data-test="${pickerDataTest}"]`);
    await wrapper.waitFor({ state: 'visible', timeout: 15000 });
    const trigger = wrapper.locator('button[type="button"]').first();
    await trigger.click();

    const option = this.page
      .locator(`[data-test="${pickerDataTest}-option"][data-test-value="${streamName}"]`)
      .first();
    await option.waitFor({ state: 'visible', timeout: 15000 });
    await option.click();
    await this.page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
  }

  /**
   * Navigate to LLM Insights and select the freshly-ingested stream, then wait
   * for the KPI strip. The `is_llm_stream` auto-mark can land after the search
   * index has the span, so one re-navigation re-fetches the stream list if the
   * stream is absent from the picker on first mount.
   */
  async navigateToLlmInsightsForStream(streamName) {
    for (let attempt = 1; attempt <= 2; attempt++) {
      await this.navigateToLlmInsights();
      const selected = await this._selectStream('llm-insights-stream-selector', streamName)
        .then(() => true)
        .catch(() => false);
      if (selected) {
        await expect(this.page.locator(this.kpiCardRow)).toBeVisible({ timeout: 30000 });
        return;
      }
      if (attempt === 2) {
        throw new Error(`LLM stream "${streamName}" did not appear in the picker after re-navigation`);
      }
    }
  }

  /**
   * Navigate to Sessions and select the freshly-ingested stream (same
   * `is_llm_stream` auto-mark lag rationale as the LLM Insights navigation).
   */
  async navigateToSessionsForStream(streamName) {
    for (let attempt = 1; attempt <= 2; attempt++) {
      await this.navigateToSessions();
      const selected = await this._selectStream('sessions-list-stream-selector', streamName)
        .then(() => true)
        .catch(() => false);
      if (selected) return;
      if (attempt === 2) {
        throw new Error(`Session stream "${streamName}" did not appear in the picker after re-navigation`);
      }
    }
  }

  // ===== Primary nav =====

  async expectAiNavItemVisible() {
    await expect(this.page.locator(this.aiNavItem)).toBeVisible({ timeout: 15000 });
  }

  async clickAiNavItem() {
    await this.page.locator(this.aiNavItem).click();
  }

  // ===== LLM Insights page =====

  async expectLlmInsightsPageVisible() {
    await expect(this.page.locator(this.llmInsightsPage)).toBeVisible({ timeout: 15000 });
  }

  async expectKpiCardRowVisible() {
    await expect(this.page.locator(this.kpiCardRow)).toBeVisible({ timeout: 30000 });
  }

  async expectKpiCardCount(count) {
    await expect(this.page.locator(this.kpiCard)).toHaveCount(count, { timeout: 30000 });
  }

  async expectRecentErrorsTableVisible() {
    await expect(this.page.locator(this.recentErrorsTable)).toBeVisible({ timeout: 15000 });
  }

  async expectLlmEmptyStateVisible() {
    await expect(this.page.locator(this.llmInsightsEmpty)).toBeVisible({ timeout: 30000 });
  }

  async expectLlmEmptyStateNotVisible() {
    await expect(this.page.locator(this.llmInsightsEmpty)).not.toBeVisible({ timeout: 15000 });
  }

  async expectLlmErrorStateNotVisible() {
    await expect(this.page.locator(this.llmInsightsError)).not.toBeVisible({ timeout: 15000 });
  }

  async clickLlmRefresh() {
    await this.page.locator(this.llmInsightsRefreshBtn).click();
  }

  // ===== Module section rail (OSS gating) =====

  async expectSectionRailVisible() {
    await expect(this.page.locator(this.sectionRail)).toBeVisible({ timeout: 15000 });
  }

  async expectRailMonitorOnly() {
    await expect(this.page.locator(this.railLlmInsights)).toBeVisible({ timeout: 15000 });
    await expect(this.page.locator(this.railSessions)).toBeVisible({ timeout: 15000 });
    await expect(this.page.locator(this.railAgentGraph)).toHaveCount(0);
    await expect(this.page.locator(this.railQuality)).toHaveCount(0);
    await expect(this.page.locator(this.railScoreConfigs)).toHaveCount(0);
    await expect(this.page.locator(this.railExperiments)).toHaveCount(0);
  }

  async expectAgentToggleHidden() {
    await expect(this.page.locator(this.llmInsightsFilterMode)).toHaveCount(0);
  }

  // ===== Sessions page =====

  async expectSessionsPageVisible() {
    await expect(this.page.locator(this.sessionsPage)).toBeVisible({ timeout: 15000 });
  }

  async expectSessionsTableVisible() {
    await expect(this.page.locator(this.sessionsTable)).toBeVisible({ timeout: 30000 });
  }

  async expectSessionsNoStreamsEmptyVisible() {
    await expect(this.page.locator(this.sessionsEmptyNoStreams)).toBeVisible({ timeout: 30000 });
  }

  async expectSessionStatusBadgeVisible(sessionId) {
    await expect(this.page.locator(`[data-test="sessions-list-status-${sessionId}"]`)).toBeVisible({ timeout: 30000 });
  }

  async expectSessionStatusBadgeError(sessionId) {
    await expect(this.page.locator(`[data-test="sessions-list-status-${sessionId}"]`)).toContainText('Error', { timeout: 30000 });
  }

  async clickSessionRow(sessionId) {
    const badge = this.page.locator(`[data-test="sessions-list-status-${sessionId}"]`);
    const row = this.page.locator(this.sessionRow, { has: badge });
    await row.first().click();
  }

  // ===== Session detail =====

  async expectSessionDetailVisible() {
    await expect(this.page.locator(this.sessionDetailHeader)).toBeVisible({ timeout: 30000 });
  }

  async expectSessionTurnCountAtLeast(minTurns) {
    await expect(this.page.locator(this.sessionTurnRow).first()).toBeVisible({ timeout: 30000 });
    const count = await this.page.locator(this.sessionTurnRow).count();
    expect(count).toBeGreaterThanOrEqual(minTurns);
  }

  // ===== Data probes (used to guard the no-streams empty-state tests) =====

  /**
   * Whether any traces stream is LLM-marked (settings.is_llm_stream !== false),
   * matching the exact filter `useLlmTraceStreams` uses to build the picker.
   * Used to skip the "no LLM streams" empty-state tests when the shared org
   * already has LLM streams (other shard tests ingest gen_ai data in parallel).
   */
  async llmStreamsExist() {
    const headers = getAuthHeaders();
    const baseUrl = process.env['ZO_BASE_URL'];
    const orgName = getOrgIdentifier();
    const response = await this.page.request.get(`${baseUrl}/api/${orgName}/streams?type=traces`, { headers });
    if (!response.ok()) return true;
    const data = await response.json().catch(() => null);
    const list = data?.list || [];
    return list.some((stream) => stream?.settings?.is_llm_stream !== false);
  }
}
