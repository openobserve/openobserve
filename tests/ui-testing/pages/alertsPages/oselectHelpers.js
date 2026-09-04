/**
 * Helpers for interacting with the OSelect (reka-ui popover) component used
 * across the alert forms.
 */

/**
 * Reliably open an OSelect dropdown given its root locator.
 *
 * OSelect forwards the consumer's `data-test` onto an inner `<button>`-trigger;
 * clicking the root wrapper does NOT toggle the reka-ui popover. The trigger can
 * also open-then-close on a single Playwright click, so we click until the
 * popover reports open (`aria-expanded="true"`).
 *
 * @param {import('@playwright/test').Page} page
 * @param {import('@playwright/test').Locator} rootLocator OSelect root, e.g. [data-test="...-select"]
 * @param {{ retries?: number, settleMs?: number }} [options]
 */
export async function openOSelectDropdown(page, rootLocator, { retries = 5, settleMs = 400 } = {}) {
    const trigger = rootLocator.locator('[data-test$="-trigger"]').first();
    await trigger.waitFor({ state: 'visible', timeout: 5000 });
    for (let i = 0; i < retries; i++) {
        if ((await trigger.getAttribute('aria-expanded')) === 'true') return;
        await trigger.click();
        await page.waitForTimeout(settleMs);
    }
}
