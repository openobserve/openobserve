// aiAssistantChatPage.js - Page Object for the AI Assistant Chat feature
// Covers the gated entry points (header toggle + Home "AI" tab) that open the
// O2AIChat shell. The header toggle gate reads config.isEnterprise == 'true'
// && ai_enabled (Header.vue:227); the Home tab gate reads isEnterpriseOrCloud
// && ai_enabled (HomeView.vue:186,192). On an OSS build both are absent: the
// backend reports ai_enabled: false in OSS (enterprise_value!(false, ...)).
//
// Strict selector policy: data-test only, no text matching.
import { expect } from '@playwright/test';

export class AiAssistantChatPage {
  constructor(page) {
    this.page = page;

    // Header toggle button (Header.vue:232, data-test="menu-link-ai-item").
    this.headerAiButton = page.locator('[data-test="menu-link-ai-item"]');
    // Home "AI Assistant" tab (HomeView.vue:192, tab id "ai").
    this.homeAiTab = page.locator('[data-test="home-tab-ai"]');
    // Sidebar expand/collapse button inside the open chat shell (O2AIChat.vue:68).
    this.chatExpandBtn = page.locator('[data-test="ai-chat-expand-btn"]');
  }

  /**
   * Reads the live /config response for the exact fields the entry-point gate
   * reads (build_type + ai_enabled), mirroring StatusPagesPage.detectBuildType.
   * The backend is a separate origin from the Vite-served frontend
   * (ZO_BASE_URL) — there is no dev proxy for /api, so this targets the
   * backend directly (INGESTION_URL convention, falling back to ZO_BASE_URL).
   */
  async detectAiChatAvailability(org) {
    const orgId = org || process.env['ORGNAME'] || 'default';
    const baseUrl = (process.env['INGESTION_URL'] || process.env['ZO_BASE_URL']).replace(/\/+$/, '');
    const response = await this.page.request.get(`${baseUrl}/api/${orgId}/config`);
    if (!response.ok()) {
      throw new Error(
        `Failed to fetch AI chat gate config (/api/${orgId}/config): HTTP ${response.status()}`,
      );
    }
    const body = await response.json();
    return { buildType: body.build_type, aiEnabled: body.ai_enabled === true };
  }

  /** Asserts all three AI chat entry points are absent (count 0) — the OSS gate. */
  async expectEntryPointsHidden() {
    await expect(this.headerAiButton, 'header AI toggle should be absent on OSS').toHaveCount(0);
    await expect(this.homeAiTab, 'Home AI tab should be absent on OSS').toHaveCount(0);
    await expect(this.chatExpandBtn, 'AI chat sidebar shell should not mount on OSS').toHaveCount(0);
  }

  /** Asserts the header AI toggle and the Home AI tab are visible — the enterprise gate. */
  async expectEntryPointsVisible() {
    await expect(this.headerAiButton, 'header AI toggle should be visible on Enterprise').toBeVisible({
      timeout: 15000,
    });
    await expect(this.homeAiTab, 'Home AI tab should be visible on Enterprise').toBeVisible({
      timeout: 15000,
    });
  }
}
