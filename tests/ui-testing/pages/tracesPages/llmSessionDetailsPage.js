import { expect } from '@playwright/test';

export class LlmSessionDetailsPage {
  constructor(page) {
    this.page = page;
    this.conversationPanel = '[data-test="session-conversation-panel"]';
    this.turnHeader = (traceId) => `[data-test="session-turn-header-${traceId}"]`;
    this.turnBody = (traceId) => `[data-test="session-turn-body-${traceId}"]`;
  }

  async open({ stream, sessionId, fromUs, toUs, org = process.env['ORGNAME'] || 'default' }) {
    const baseUrl = (process.env['ZO_BASE_URL'] || '').replace(/\/+$/, '');
    const query = new URLSearchParams({
      stream,
      session_id: sessionId,
      from: String(fromUs),
      to: String(toUs),
      org_identifier: org,
    });
    await this.page.goto(`${baseUrl}/web/traces/session-details?${query}`);
    await expect(this.page.locator(this.conversationPanel)).toBeVisible({ timeout: 30000 });
  }

  async expandTurn(traceId) {
    await this.page.locator(this.turnHeader(traceId)).click();
    await expect(this.page.locator(this.turnBody(traceId))).toBeVisible({ timeout: 15000 });
  }

  async expectTurnReply(traceId, reply) {
    await expect(this.page.locator(this.turnBody(traceId))).toContainText(reply, { timeout: 30000 });
  }
}
