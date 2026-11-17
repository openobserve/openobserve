// Copyright 2026 OpenObserve Inc.

import { expect } from '@playwright/test';
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

/** Unfolds the condition filter builder, which stays behind its sentence until "+ Add filters" or Change. */
export async function openAlertFilterBuilder(page) {
    await goToAlertSection(page, 'condition');
    for (const id of ['add-alert-add-filters', 'add-alert-filter-sentence-change']) {
        const link = page.locator(`[data-test="${id}"]`).first();
        if (!(await link.isVisible().catch(() => false))) continue;
        await link.click();
        await page.waitForTimeout(300);
        testLogger.info('Opened the filter builder', { via: id });
        return true;
    }
    return false;
}

/** Scrolls a control into view and waits out the scroll event; an OSelect opened in the same frame as a scroll closes again. */
export async function settleIntoView(page, locator) {
    await locator.first().scrollIntoViewIfNeeded();
    await page.waitForTimeout(400);
}

const STREAM_TYPE_TRIGGER = '[data-test="add-alert-stream-type-select-dropdown-trigger"]';
const STREAM_TYPE_OPTION = '[data-test="add-alert-stream-type-select-dropdown-option"]';
export const ALERT_NAME_FIELD = '[data-test="add-alert-details-name-input-field"]';

/** Picks logs, metrics or traces in the Watch section's stream-type dropdown. */
export async function selectAlertStreamType(page, streamType) {
    const trigger = page.locator(STREAM_TYPE_TRIGGER).first();
    await trigger.waitFor({ state: 'visible', timeout: 15000 });
    await settleIntoView(page, trigger);
    if ((await trigger.getAttribute('data-test-selected-value')) === streamType) return;
    await trigger.click();
    const option = page.locator(`${STREAM_TYPE_OPTION}[data-test-value="${streamType}"]`).first();
    await option.waitFor({ state: 'visible', timeout: 10000 });
    await option.click();
    testLogger.info('Selected stream type', { streamType });
}

/** Types the alert name into section 5; the header only shows it. */
export async function fillAlertName(page, name) {
    await goToAlertSection(page, 'details');
    const field = page.locator(ALERT_NAME_FIELD).first();
    await field.waitFor({ state: 'visible', timeout: 15000 });
    await settleIntoView(page, field);
    await field.fill(name);
    testLogger.info('Filled alert name', { name });
}

const DESTINATION_LIST = '[data-test="alert-destinations-list"]';
const DESTINATION_LIST_OPTION = '[data-test="alert-destinations-list-option"]';
const DESTINATION_TRIGGER = '[data-test="alert-destinations-select-trigger"]';

/** Up to eight destinations render as checkboxes, more as a multi-select; true when the checkbox list is showing. */
export async function destinationsShowAsList(page) {
    const list = page.locator(`${DESTINATION_LIST}, ${DESTINATION_TRIGGER}`).first();
    await list.waitFor({ state: 'attached', timeout: 15000 });
    await settleIntoView(page, list);
    return page.locator(DESTINATION_LIST).first().isVisible();
}

/** Picks one destination by name in either form of the destinations field. */
export async function pickAlertDestination(page, destinationName) {
    if (await destinationsShowAsList(page)) {
        const option = page
            .locator(DESTINATION_LIST_OPTION)
            .filter({ has: page.getByText(destinationName, { exact: true }) })
            .first();
        if ((await option.locator('[aria-checked]').first().getAttribute('aria-checked')) !== 'true') {
            await option.click();
        }
        await expect(option.locator('[aria-checked="true"]')).toHaveCount(1);
        return;
    }
    await page.locator(DESTINATION_TRIGGER).first().click();
    const choice = page.getByRole('option', { name: destinationName, exact: true });
    await choice.waitFor({ state: 'visible', timeout: 15000 });
    await choice.click();
    await page.keyboard.press('Escape');
}

/** Unpicks every selected destination in either form of the destinations field. */
export async function clearAlertDestinations(page) {
    if (await destinationsShowAsList(page)) {
        const checked = page.locator(`${DESTINATION_LIST_OPTION} [aria-checked="true"]`);
        while (await checked.count()) {
            await checked.first().click();
        }
        return;
    }
    await page.locator(DESTINATION_TRIGGER).first().click();
    const selected = page.locator('[role="option"][aria-selected="true"]');
    await selected.first().waitFor({ state: 'visible', timeout: 15000 });
    while (await selected.count()) {
        await selected.first().click();
    }
    await page.keyboard.press('Escape');
}
