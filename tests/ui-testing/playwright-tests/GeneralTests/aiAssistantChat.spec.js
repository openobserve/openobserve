/**
 * AI Assistant Chat — Enterprise Gating
 *
 * The AI Assistant (O2AIChat) is reached through two entry points that are both
 * enterprise-gated: the header toggle (Header.vue, data-test="menu-link-ai-item")
 * and the Home "AI Assistant" tab (HomeView.vue, data-test="home-tab-ai"). The
 * gate reads config.isEnterprise == 'true' && store.state.zoConfig.ai_enabled,
 * and the backend reports ai_enabled: false in OSS (enterprise_value!(false,
 * o2cfg.ai.enabled) in src/api/management/src/request/status/mod.rs:469) — so on
 * an OSS build neither entry point ever renders.
 *
 * Exactly one of the two tests runs per environment: the active build + AI gate
 * are detected from the live /api/{org}/config response (build_type + ai_enabled)
 * — the exact values the gate itself reads (see AiAssistantChatPage). The OSS
 * test asserts the entry points are absent; the enterprise test asserts they are
 * present. The deeper functional flows (send message / stream, feedback, chat
 * history) are enterprise-gated AND depend on chat input/send controls that have
 * no stable data-test yet, so they are out of scope for this OSS run.
 */

const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const PageManager = require('../../pages/page-manager.js');

test.describe('AI Assistant Chat testcases', () => {
  test.describe.configure({ mode: 'parallel' });
  let pm;
  let orgId;

  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    orgId = process.env['ORGNAME'] || 'default';
    await navigateToBase(page);
    pm = new PageManager(page);
    testLogger.info('AI Assistant Chat test setup completed');
  });

  test('OSS - AI chat entry points are hidden', {
    tag: ['@ai-assistant-chat', '@all', '@oss'],
  }, async ({ page }) => {
    const { buildType, aiEnabled } = await pm.aiAssistantChatPage.detectAiChatAvailability(orgId);
    test.skip(buildType !== 'opensource', `Runs only on OSS build (detected: ${buildType})`);

    // navigateToBase lands on Home, which renders both the header and the Home
    // tab bar, so both entry points are assertable in a single pass.
    testLogger.step('Verifying AI chat entry points are hidden on OSS');
    await pm.aiAssistantChatPage.expectEntryPointsHidden();

    testLogger.info('OSS AI chat gating validation completed', { buildType, aiEnabled });
  });

  test('ENT - AI chat entry points are visible', {
    tag: ['@ai-assistant-chat', '@all', '@enterprise'],
  }, async ({ page }) => {
    const { buildType, aiEnabled } = await pm.aiAssistantChatPage.detectAiChatAvailability(orgId);
    test.skip(
      buildType !== 'enterprise' || !aiEnabled,
      `Runs only on Enterprise build with AI enabled (detected: ${buildType}, aiEnabled: ${aiEnabled})`,
    );

    testLogger.step('Verifying AI chat entry points are visible on Enterprise');
    await pm.aiAssistantChatPage.expectEntryPointsVisible();

    testLogger.info('Enterprise AI chat gating validation completed', { buildType, aiEnabled });
  });
});
