// aiChatPage.js — Page object for the O2 AI Chat assistant panel (O2AIChat.vue).
//
// The panel is reachable two ways, both gated on enterprise/cloud + `ai.enabled`:
//   1. HomeView AI tab   ([data-test="home-tab-ai"]) — mounts O2AIChat with is-open="true".
//   2. Header AI toggle  ([data-test="menu-link-ai-item"]) — MainLayout side panel, or on the
//      home route it dispatches `o2:home-switch-tab` which switches to the home AI tab.
//
// The AI panel is driven by real HTTP in production, but the session-restore feature under test
// is only organically triggered by a multi-replica outage. These E2E tests intercept
// `**/ai/chat_stream` and `**/ai/confirm/**` via `page.route` in the spec and assert the rendered
// outcomes. This page object owns every selector + assertion; the spec never touches the DOM.

import { expect } from '@playwright/test';

export class AiChatPage {
    constructor(page) {
        this.page = page;

        // ===== ENTRY POINTS =====
        this.homeAiTab = page.locator('[data-test="home-tab-ai"]');
        this.aiChatNavButton = page.locator('[data-test="menu-link-ai-item"]');

        // ===== PANEL ROOT & CONTROLS (VERIFIED from web/src/components/O2AIChat.vue) =====
        this.panelRoot = page.locator('.chat-container.chat-open');
        // RichTextInput is a contenteditable div inside the stable .unified-input-box wrapper.
        this.chatInput = page.locator('.unified-input-box [contenteditable="true"]');
        this.sendButton = page.locator('.send-button');

        // ===== ERROR / RECOVERY SURFACES (O2AIChat.vue appendErrorBlock) =====
        // block.type === 'error' renders .stream-error-block; block.recoverable === true
        // adds a .stream-error-recoverable child (the RESTORED_NOTICE marker).
        this.errorBlocks = page.locator('.stream-error-block');
        this.recoverableNotices = page.locator('.stream-error-recoverable');

        // ===== TOOL CONFIRMATION DIALOG (O2AIConfirmDialog.vue) =====
        // A non-navigation confirmation_required renders "Yes" / "No" (common.yes / common.no);
        // "Yes" = approve (handleConfirm). Scope to the dialog to avoid unrelated buttons.
        this.confirmDialog = page.locator('.confirmation-dialog');
        this.confirmApproveButton = this.confirmDialog.getByRole('button', { name: 'Yes', exact: true });
    }

    /**
     * Open the AI panel and probe that it is functional. Returns `true` only when the panel is
     * open AND the chat input is present (an unconfigured AI renders a "not configured" state
     * without the input). Callers skip the test when this returns `false`.
     *
     * Entry preference: Home AI tab (deterministic) -> header AI toggle (fallback).
     */
    async openAiPanel() {
        let opened = false;

        // The AI tab only appears after `zoConfig.ai_enabled` resolves asynchronously, so give
        // it a generous window before falling back to the header toggle.
        try {
            await this.homeAiTab.waitFor({ state: 'visible', timeout: 15000 });
            await this.homeAiTab.click();
            opened = true;
        } catch (_) {
            try {
                await this.aiChatNavButton.waitFor({ state: 'visible', timeout: 5000 });
                await this.aiChatNavButton.click();
                opened = true;
            } catch (_) {
                opened = false;
            }
        }

        if (!opened) return false;

        // Panel mounted — but AI may be unconfigured (no input). The mocked chat_stream flows
        // only fire when the send input exists, so treat a missing input as "unavailable".
        try {
            await this.chatInput.waitFor({ state: 'visible', timeout: 15000 });
            return true;
        } catch (_) {
            return false;
        }
    }

    /** Type a user message into the contenteditable input. */
    async typeMessage(text) {
        await this.chatInput.click();
        await this.chatInput.pressSequentially(text);
    }

    /** Send the typed message via the send button (guards that it became enabled first). */
    async sendMessage() {
        await expect(this.sendButton).toBeEnabled({ timeout: 10000 });
        await this.sendButton.click();
    }

    /** Wait for the RESTORED_NOTICE: a recoverable error block announcing the restore. */
    async expectRestoredNoticeVisible() {
        const notice = this.errorBlocks.filter({ hasText: /has been restored/ });
        await expect(notice).toBeVisible({ timeout: 15000 });
        await expect(notice.locator('.stream-error-recoverable')).toBeVisible({ timeout: 15000 });
    }

    /** Assert the "could not be restored" dead-end error block is shown (retry failed). */
    async expectCouldNotBeRestoredErrorVisible() {
        const err = this.errorBlocks.filter({ hasText: /could not be restored/ });
        await expect(err).toBeVisible({ timeout: 15000 });
    }

    /** Assert the confirmation-delivery failure error block is shown. */
    async expectConfirmationDeliveryErrorVisible() {
        const err = this.errorBlocks.filter({ hasText: /could not be delivered/ });
        await expect(err).toBeVisible({ timeout: 15000 });
    }

    /** Assert a given text appears somewhere in the transcript. */
    async expectTranscriptText(text) {
        await expect(this.panelRoot).toContainText(text, { timeout: 15000 });
    }

    /** Assert NO recoverable notice (RESTORED_NOTICE) is present — negative assertion. */
    async expectNoRecoverableNotice() {
        await expect(this.recoverableNotices).toHaveCount(0, { timeout: 5000 });
    }

    /** Wait for the tool-confirmation dialog to appear. */
    async expectConfirmDialogVisible() {
        await expect(this.confirmDialog).toBeVisible({ timeout: 15000 });
    }

    /** Click the approve ("Yes") button in the tool-confirmation dialog. */
    async clickConfirmApprove() {
        await expect(this.confirmApproveButton).toBeVisible({ timeout: 15000 });
        await this.confirmApproveButton.click();
    }
}
