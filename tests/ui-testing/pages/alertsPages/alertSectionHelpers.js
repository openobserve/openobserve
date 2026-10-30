// Copyright 2026 OpenObserve Inc.

const testLogger = require('../../playwright-tests/utils/test-logger.js');

/** Sections of the alert editor's snapping column, in order; rare settings hide behind a per-section "N more" link. */
export const ALERT_SECTIONS = ['watch', 'condition', 'notify', 'schedule', 'details'];

// Old tab names map onto the section that now holds the tab's first controls.
const SECTION_FOR_TAB = {
    'alert rules': 'watch',
    condition: 'watch',
    advanced: 'notify',
    'anomaly-config': 'watch',
    'detection config': 'watch',
    config: 'watch',
    'anomaly-alerting': 'notify',
    alerting: 'notify',
};

/** Section id for an old tab name ("Alert Rules", "Advanced", ...) or a section id. */
export function alertSectionForTab(tabName) {
    const key = String(tabName).toLowerCase();
    if (ALERT_SECTIONS.includes(key)) return key;
    return SECTION_FOR_TAB[key] ?? 'watch';
}

/** Scrolls the editor to a section through the section list, or straight to the section when the list is hidden. */
export async function goToAlertSection(page, sectionId) {
    const section = page.locator(`[data-test="add-alert-section-${sectionId}"]`).first();
    await section.waitFor({ state: 'attached', timeout: 15000 });
    const navItem = page.locator(`[data-test="o-section-nav-item-${sectionId}"]`).first();
    if (await navItem.isVisible().catch(() => false)) {
        await navItem.click();
    } else {
        await section.scrollIntoViewIfNeeded();
    }
    // Smooth scroll plus snap settle.
    await page.waitForTimeout(600);
    testLogger.info('Scrolled to alert section', { sectionId });
}

/** Opens every section's "N more" group so tucked settings render. Opening only reveals; it sets no value. */
export async function expandAlertSettingGroups(page, sections = ['condition', 'notify', 'details']) {
    for (const s of sections) {
        const more = page.locator(`[data-test="add-alert-section-${s}-more"]`).first();
        if (!(await more.isVisible().catch(() => false))) continue;
        if ((await more.getAttribute('aria-expanded').catch(() => null)) === 'true') continue;
        await more.click();
        await page.waitForTimeout(200);
        testLogger.info('Expanded tucked settings', { section: s });
    }
}

/** Clicks a setting's "+ add" link when it shows. Only "template" is a pure reveal; "variables" and "createsIncident" also set a value. */
export async function revealAlertSetting(page, settingId) {
    const add = page.locator(`[data-test="add-alert-add-${settingId}"]`).first();
    if (!(await add.isVisible().catch(() => false))) return false;
    await add.click();
    await page.waitForTimeout(200);
    testLogger.info('Revealed alert setting', { settingId });
    return true;
}

/** Shows every setting the old Advanced tab held without setting any value: all tucked groups plus the template override. */
export async function showAllAlertSettings(page) {
    await expandAlertSettingGroups(page);
    await revealAlertSetting(page, 'template');
}

/** Closes a query-editor drawer left open; while open it takes every pointer event on the page. */
export async function closeQueryEditorDrawer(page) {
    const open = page.locator('[data-test="query-editor-dialog"][data-state="open"]');
    for (let i = 0; i < 5 && (await open.count()) > 0; i++) {
        await page.keyboard.press('Escape').catch(() => {});
        await page.waitForTimeout(400);
    }
}

/** Replaces the old tab switch: scrolls to the tab's section and shows the settings that tab used to hold. */
export async function openAlertSectionForTab(page, tabName) {
    const sectionId = alertSectionForTab(tabName);
    await closeQueryEditorDrawer(page);
    await showAllAlertSettings(page);
    await goToAlertSection(page, sectionId);
    return sectionId;
}

/** Scrolls a control into view and waits out the scroll event; an OSelect opened in the same frame as a scroll closes again. */
export async function settleIntoView(page, locator) {
    await locator.first().scrollIntoViewIfNeeded();
    await page.waitForTimeout(400);
}
