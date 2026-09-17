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

function dataTestName(selector) {
    const m = selector.match(/\[data-test="([^"]+)"\]/);
    if (!m) throw new Error(`Not a data-test selector: ${selector}`);
    return m[1];
}

// Picks `value` in the OSelect at `rootSelector` (optionally under `scope`) and confirms the trigger committed it.
export async function selectOSelectOption(page, rootSelector, value, { retries = 4, scope = null } = {}) {
    const name = dataTestName(rootSelector);
    const root = (scope ?? page).locator(rootSelector);
    const trigger = root.locator(`[data-test="${name}-trigger"]`).first();
    const option = page.locator(`[data-test="${name}-option"][data-test-value="${value}"]`).first();

    const committed = async () => {
        const attr = await trigger.getAttribute('data-test-selected-value').catch(() => null);
        if (attr !== null) return attr === String(value);
        const label = await option.getAttribute('data-test-label').catch(() => null);
        const text = ((await trigger.textContent().catch(() => '')) ?? '').trim();
        return !!label && text.includes(label.trim());
    };

    for (let i = 0; i < retries; i++) {
        await openOSelectDropdown(page, root);
        try {
            await option.waitFor({ state: 'visible', timeout: 5000 });
            await option.click();
        } catch {
            continue;
        }
        if (await committed()) return;
    }
    const offered = await page
        .locator(`[data-test="${name}-option"]`)
        .evaluateAll((nodes) => nodes.map((n) => n.getAttribute('data-test-value')))
        .catch(() => []);
    throw new Error(`OSelect "${name}" never committed "${value}"; offered: ${JSON.stringify(offered)}`);
}
