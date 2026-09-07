/**
 * AI Chat Keyboard Shortcut Gate
 *
 * The global Ctrl+B (Meta+B on macOS) "Toggle AI chat" shortcut is registered
 * only on enterprise builds (MainLayout.vue `if (config.isEnterprise == "true")`),
 * and the header AI button is rendered only when the same flag is set AND
 * `store.state.zoConfig.ai_enabled` is truthy (Header.vue). On an OSS build both
 * entry points are closed: the button is v-if removed, the binding never exists,
 * and `toggleAIChat()` early-returns because the OSS /config response carries no
 * `ai_enabled`. Exactly one of the two tests runs per environment, detected via
 * EditionFeaturesPage.detectEdition (the frontend build-time flag the gate reads).
 *
 * Deliberately NOT asserted here (false signals on OSS):
 * - the shortcut cheatsheet still lists "Ctrl+B" (static SHORTCUT_REGISTRY, not
 *   the actual registration), and
 * - the AI panel <aside> is v-show hidden rather than removed from the DOM, so
 *   "closed" is asserted via the v-if-removed .chat-content-wrapper + toBeHidden.
 */

const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const PageManager = require('../../pages/page-manager.js');
const testLogger = require('../utils/test-logger.js');

test.describe('AI Chat Keyboard Shortcut Gate testcases', () => {
  test.describe.configure({ mode: 'parallel' });
  let pm;

  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    await navigateToBase(page);
    pm = new PageManager(page);
    testLogger.info('Test setup completed');
  });

  test('OSS - Ctrl+B does not open the AI chat panel and the header AI button is hidden', {
    tag: ['@aiChatShortcut', '@all', '@oss'],
  }, async ({ page }) => {
    const edition = await pm.editionFeaturesPage.detectEdition();
    test.skip(edition !== 'opensource', `Runs only on OSS build (detected: ${edition})`);

    testLogger.step('Verifying the header AI button is not rendered');
    await pm.aiChatShortcutPage.expectAiButtonHidden();

    testLogger.step('Pressing the platform AI-chat toggle combo');
    await pm.aiChatShortcutPage.pressAiChatToggle();

    testLogger.step('Verifying the AI chat panel stays closed and layout is unchanged');
    await pm.aiChatShortcutPage.expectChatPanelClosed();
    await pm.aiChatShortcutPage.expectMainContentFullWidth();

    testLogger.info('OSS AI chat shortcut gate validation completed');
  });

  test('ENT - Ctrl+B toggles the AI chat sidebar', {
    tag: ['@aiChatShortcut', '@all', '@enterprise'],
  }, async ({ page }) => {
    const edition = await pm.editionFeaturesPage.detectEdition();
    test.skip(edition !== 'enterprise', `Runs only on Enterprise build (detected: ${edition})`);

    testLogger.step('Verifying the header AI button is rendered');
    await pm.aiChatShortcutPage.expectAiButtonVisible();

    testLogger.step('Pressing the toggle opens the inline sidebar');
    await pm.aiChatShortcutPage.pressAiChatToggle();
    await pm.aiChatShortcutPage.expectChatPanelOpen();
    await pm.aiChatShortcutPage.expectMainContentWidth('75');

    testLogger.step('Pressing the toggle again closes the sidebar');
    await pm.aiChatShortcutPage.pressAiChatToggle();
    await pm.aiChatShortcutPage.expectChatPanelClosed();
    await pm.aiChatShortcutPage.expectMainContentFullWidth();

    testLogger.info('Enterprise AI chat shortcut toggle validation completed');
  });
});
