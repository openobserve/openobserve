const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const PageManager = require('../../pages/page-manager.js');

test.describe("Query Editor AI Bar Visibility testcases", () => {
  test.describe.configure({ mode: 'parallel' });
  let pm;

  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    await navigateToBase(page);
    pm = new PageManager(page);
    testLogger.info('Test setup completed');
  });

  // P0 — floating AI toggle icon gated off on OSS (aiFeatureEnabled false).
  test("OSS Logs: floating AI toggle icon must not render", {
    tag: ['@query-editor-ai-bar', '@all', '@logs', '@P0'],
  }, async ({ page }) => {
    testLogger.info('Verifying the floating AI toggle icon is absent from the Logs main query editor on OSS');

    await pm.logsPage.navigateToLogs();
    await pm.logsPage.expectQueryEditorVisible();
    await pm.logsPage.expectAiToggleAbsent();

    testLogger.info('Floating AI toggle icon absence verified');
  });

  // P0 — AI input bar (and its input field) gated off on OSS.
  test("OSS Logs: AI input bar must not render", {
    tag: ['@query-editor-ai-bar', '@all', '@logs', '@P0'],
  }, async ({ page }) => {
    testLogger.info('Verifying the AI input bar is absent from the Logs main query editor on OSS');

    await pm.logsPage.navigateToLogs();
    await pm.logsPage.expectQueryEditorVisible();
    await pm.logsPage.expectAiInputBarAbsent();
    await pm.logsPage.expectAiInputFieldAbsent();

    testLogger.info('AI input bar absence verified');
  });

  // P1 — the second QueryEditor instance (VRL function editor, default query-editor prefix).
  test("OSS Logs: VRL editor AI toggle + bar must not render", {
    tag: ['@query-editor-ai-bar', '@all', '@logs', '@P1'],
  }, async ({ page }) => {
    testLogger.info('Verifying the VRL editor AI toggle and input bar are absent on OSS');

    await pm.logsPage.navigateToLogs();
    await pm.logsPage.expectFnEditorVisible();
    await pm.logsPage.expectVrlAiToggleAbsent();
    await pm.logsPage.expectVrlAiInputBarAbsent();

    testLogger.info('VRL editor AI UI absence verified');
  });

  // P2 — positive gate (enterprise + ai_enabled) is out of scope for this OSS run.
  test.fixme("Enterprise + ai_enabled: AI bar IS shown (positive gate) — not runnable in OSS checkout", {
    tag: ['@query-editor-ai-bar', '@all', '@logs', '@P2'],
  }, async ({ page }) => {
    testLogger.info('Positive gate requires config.isEnterprise=="true" && zoConfig.ai_enabled — unavailable in OSS build');
    // Enterprise + ai_enabled: the floating toggle renders and clicking it opens the AI bar.
    // Not runnable in this OSS checkout — config.isEnterprise defaults to "false"
    // (aws-exports.ts:33-35), so aiFeatureEnabled (QueryEditor.vue:269-271) is always false.
  });
});
