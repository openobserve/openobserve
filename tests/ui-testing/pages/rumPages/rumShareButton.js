// rumShareButton.js — shared RUM share-button helper (shorten + copy + toast)
//
// The five RUM share buttons (Errors list, Sessions list, Performance summary,
// Session Viewer, Error detail) all render the same common ShareButton and drive
// the same flow: POST the full current URL to /api/{org}/short, copy the returned
// /web/short/<16-char-id> link to the clipboard, and show a success toast. This
// helper wraps that flow once so every surface reuses it.
import { expect } from '@playwright/test';

export class RumShareButton {
    // Backend short id is a 16-char md5 hash (src/core/src/short_url.rs).
    static SHORT_URL_REGEX = /\/web\/short\/[a-f0-9]{16}\?org_identifier=/;

    constructor(page, buttonLocator) {
        this.page = page;
        this.button = buttonLocator;
        // Attribute match (not getByText): strict-mode + stacked-toast safe.
        this.successToast = page
            .locator(
                '[data-test-variant="success"][data-test-message*="Link Copied Successfully!"]',
            )
            .first();
    }

    async expectVisible(timeoutMs = 15000) {
        await expect(this.button).toBeVisible({ timeout: timeoutMs });
    }

    // The button is :disabled until ZO_WEB_URL is configured AND the route syncs
    // the share URL. Probe with auto-retry so a momentarily-empty URL (page still
    // syncing) is not mistaken for "web_url unset"; returns false only when the
    // button stays disabled (web_url missing) — the caller then skips, per plan.
    async waitForEnabled(timeoutMs = 10000) {
        try {
            await expect(this.button).toBeEnabled({ timeout: timeoutMs });
            return true;
        } catch {
            return false;
        }
    }

    async click() {
        await this.button.click();
    }

    async readClipboardUrl() {
        return await this.page.evaluate(() => navigator.clipboard.readText());
    }

    async expectSuccessToast(timeoutMs = 15000) {
        await expect(this.successToast).toBeVisible({ timeout: timeoutMs });
    }

    async expectShortUrlCopied() {
        // The success toast is the copy-completion signal, so once it is visible
        // the clipboard write has already committed; still poll the clipboard so a
        // slow commit never produces a one-shot flake.
        await this.expectSuccessToast();
        await expect
            .poll(
                async () => RumShareButton.SHORT_URL_REGEX.test(await this.readClipboardUrl()),
                { timeout: 15000, intervals: [500, 1000] },
            )
            .toBe(true);
    }

    // Fire the global copy-URL shortcut (registered via useShortcuts in the Errors
    // and Sessions lists). Blur the editor first so Monaco does not swallow the
    // keystroke; the shortcut has no isInputFocused() guard itself.
    async pressCopyShortcut() {
        await this.page.evaluate(() => {
            const el = document.activeElement;
            if (el && typeof el.blur === 'function') el.blur();
        });
        const isMac = process.platform === 'darwin';
        await this.page.keyboard.press(isMac ? 'Meta+Shift+C' : 'Control+Shift+C');
    }
}
