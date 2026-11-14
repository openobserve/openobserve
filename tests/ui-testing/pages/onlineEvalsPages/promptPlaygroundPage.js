// AI Playground and its Save as Prompt dialog (new prompt or a new version of an existing one).
import { expect } from '@playwright/test';

export class PromptPlaygroundPage {
    constructor(page) {
        this.page = page;
        this.systemMessageInput = page.locator('[data-test="ai-playground-message-input-msg-2-field"]');
        this.userMessageInput = page.locator('[data-test="ai-playground-message-input-msg-3-field"]');
        this.saveDialog = page.getByRole('dialog');
        this.saveDialogSaveBtn = this.saveDialog.locator('[data-test="o-dialog-primary-btn"]');
        this.promptNameInput = this.saveDialog.locator('[data-test="save-as-prompt-name"]').locator('input');
        this.commitMessageInput = this.saveDialog.locator('[data-test="save-as-prompt-commit"]').locator('textarea');
        this.modeTrigger = this.saveDialog.locator('[data-test="save-as-prompt-mode-trigger"]').first();
        this.targetTrigger = this.saveDialog.locator('[data-test="save-as-prompt-target-trigger"]').first();
        this.targetSearch = page.locator('[data-test="save-as-prompt-target-search"]');
    }

    async goto(org) {
        await this.page.goto(`${process.env.ZO_BASE_URL.replace(/\/$/, '')}/web/ai/playground?org_identifier=${org}`);
    }

    async openSaveAsPrompt(variant = 'A') {
        await this.page.locator(`[data-test="ai-playground-variant-save-prompt-${variant}"]`).click();
    }

    async fillNewPrompt(name, commitMessage) {
        await expect(this.promptNameInput).toBeVisible({ timeout: 15000 });
        await this.promptNameInput.fill(name);
        await this.commitMessageInput.fill(commitMessage);
    }

    // the target list is virtualised and grows with the org, so narrow it to the prompt first
    async chooseAppendTo(name, commitMessage) {
        await this.modeTrigger.click();
        await this.page.locator('[data-test="save-as-prompt-mode-option"][data-test-value="append"]').click();
        await this.targetTrigger.click();
        await this.targetSearch.fill(name);
        await this.page.locator('[data-test="save-as-prompt-target-option"]', { hasText: name }).first().click();
        await this.commitMessageInput.fill(commitMessage);
    }

    async clickSave() {
        await this.saveDialogSaveBtn.click();
    }
}

export default PromptPlaygroundPage;
