// aiChatShortcutPage.js - Page Object for the global AI-chat keyboard shortcut gate.
// The Ctrl+B (Meta+B on macOS) "Toggle AI chat" binding is registered only on
// enterprise builds (MainLayout.vue), and the header AI button is rendered only
// when config.isEnterprise == 'true' && store.state.zoConfig.ai_enabled (Header.vue).
// On OSS neither exists, so this page object asserts the gate is closed.
//
// Selector policy: data-test where available; the AI sidebar <aside> has no
// data-test hook, so it is located via its stable .o2-sidebar-right class.
import { expect } from '@playwright/test';

export class AiChatShortcutPage {
  constructor(page) {
    this.page = page;

    // Header AI toggle button (v-if removed on OSS; Header.vue)
    this.aiButton = page.locator('[data-test="menu-link-ai-item"]');
    // AI chat panel (v-show hidden when closed, so always in the DOM; MainLayout.vue)
    this.chatPanel = page.locator('.o2-sidebar-right');
    // Open-chat content (v-if="isOpen", absent from the DOM when closed; O2AIChat.vue)
    this.chatContentWrapper = page.locator('.chat-content-wrapper');
    // Main content panel (width shrinks to 75%/50% only when chat is open)
    this.mainContent = page.locator('[data-test="main-content"]');
  }

  // Platform-correct combo for the global toggle: Meta+B on macOS, Ctrl+B elsewhere.
  async pressAiChatToggle() {
    await this.page.keyboard.press(process.platform === 'darwin' ? 'Meta+b' : 'Control+b');
    // Deliberate settle: on a regression where the binding was wrongly registered,
    // the handler fires async after the keypress — give it a beat to (fail to) fire.
    await this.page.waitForTimeout(300);
  }

  async expectAiButtonHidden() {
    await expect(this.aiButton).toHaveCount(0);
  }

  async expectAiButtonVisible() {
    await expect(this.aiButton).toBeVisible();
  }

  // Closed panel: the content wrapper is v-if removed, the <aside> is v-show hidden.
  async expectChatPanelClosed() {
    await expect(this.chatContentWrapper).toHaveCount(0);
    await expect(this.chatPanel).toBeHidden();
  }

  async expectChatPanelOpen() {
    await expect(this.chatPanel).toBeVisible();
    await expect(this.chatContentWrapper).toBeVisible();
  }

  // The main content <main> keeps its inline width at 100% while the chat is closed.
  async expectMainContentFullWidth() {
    await expect(this.mainContent).toHaveAttribute('style', /width:\s*100%/);
  }

  // Asserts the inline width binding dropped to the given percentage (75% inline,
  // 50% expanded) — only reachable while chat is open on an enterprise build.
  async expectMainContentWidth(percentage) {
    await expect(this.mainContent).toHaveAttribute('style', new RegExp(`width:\\s*${percentage}%`));
  }
}
