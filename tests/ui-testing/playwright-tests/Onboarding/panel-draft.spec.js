const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
import PageManager from '../../pages/page-manager.js';
import { setupTestDashboard, deleteDashboard, waitForDashboardPage } from '../Dashboards/utils/dashCreation.js';

const leaveDialog = (page) => page.locator('[data-test="confirm-dialog"]');
const draftOffer = (page) => page.locator('[data-test="dashboard-panel-draft-offer"]');
const panelName = (page) => page.locator('[data-test="dashboard-panel-name"]');
const discardedToast = (page) => page.locator('[data-test^="o-toast-"][data-test-message="Panel discarded"]');

async function openNewPanel(page, pm) {
    await pm.dashboardCreate.addPanel();
    await page.waitForURL((url) => url.pathname.includes('add_panel'), { timeout: 30000 });
    await pm.dashboardPanelActions.getPanelSaveBtn().waitFor({ state: 'visible', timeout: 30000 });
}

// A typed title is a user edit, so it arms the unsaved baseline and the 1 s autosave.
async function editTitle(page, pm, title) {
    await pm.dashboardPanelActions.addPanelName(title);
    await expect.poll(() => page.evaluate(() =>
        Object.keys(localStorage).filter((k) => k.startsWith('o2.dashboards.panelDraft.') && !k.endsWith('.probe')).length,
    ), { timeout: 5000 }).toBe(1);
}

test.describe('Add panel drafts', () => {
    test.describe.configure({ mode: 'serial' });
    let pm;
    let dashboardName;

    test.beforeEach(async ({ page }, testInfo) => {
        testLogger.testStart(testInfo.title, testInfo.file);
        await navigateToBase(page);
        pm = new PageManager(page);
        dashboardName = `Dashboard_Draft_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
        await setupTestDashboard(page, pm, dashboardName);
    });

    test.afterEach(async ({ page }) => {
        await page.goto(`${process.env.ZO_BASE_URL}/web/dashboards?org_identifier=${process.env.ORGNAME}`).catch(() => {});
        await waitForDashboardPage(page).catch(() => {});
        await deleteDashboard(page, dashboardName).catch(() => {});
    });

    test('Back with changes asks Leave without saving and Leave keeps a draft that is offered on return', {
        tag: ['@onboarding', '@dashboards', '@panelDraft', '@P1'],
    }, async ({ page }) => {
        let nativeDialogs = 0;
        page.on('dialog', (dialog) => { nativeDialogs += 1; dialog.dismiss().catch(() => {}); });
        await openNewPanel(page, pm);
        await editTitle(page, pm, 'Errors by level');

        await page.locator('[data-test="dashboard-back-btn"]').click();
        await expect(leaveDialog(page)).toContainText('Leave without saving?');
        await expect(leaveDialog(page)).toContainText('Your draft is kept on this browser for 7 days.');
        await leaveDialog(page).locator('[data-test="o-dialog-secondary-btn"]').click();
        await expect(page).toHaveURL(/add_panel/);

        await page.locator('[data-test="dashboard-back-btn"]').click();
        await leaveDialog(page).locator('[data-test="o-dialog-primary-btn"]').click();
        await page.waitForURL((url) => !url.pathname.includes('add_panel'), { timeout: 30000 });
        expect(nativeDialogs).toBe(0);

        await openNewPanel(page, pm);
        await expect(draftOffer(page)).toContainText('Errors by level');
        await expect(draftOffer(page)).toHaveAttribute('data-conflict', 'false');
        await expect(panelName(page)).not.toContainText('Errors by level');

        await page.locator('[data-test="dashboard-panel-draft-resume-btn"]').click();
        await expect(draftOffer(page)).toHaveCount(0);
        await expect(panelName(page)).toContainText('Errors by level');
    });

    test('Back with no changes leaves at once', {
        tag: ['@onboarding', '@dashboards', '@panelDraft', '@P1'],
    }, async ({ page }) => {
        await openNewPanel(page, pm);
        await page.locator('[data-test="dashboard-back-btn"]').click();
        await page.waitForURL((url) => !url.pathname.includes('add_panel'), { timeout: 30000 });
        await expect(leaveDialog(page)).toHaveCount(0);
    });

    test('Discard leaves without a dialog and Undo within 5 s restores the panel', {
        tag: ['@onboarding', '@dashboards', '@panelDraft', '@P1'],
    }, async ({ page }) => {
        await openNewPanel(page, pm);
        await editTitle(page, pm, 'Latency p95');

        await pm.dashboardPanelActions.getPanelDiscardBtn().click();
        await page.waitForURL((url) => !url.pathname.includes('add_panel'), { timeout: 30000 });
        await expect(leaveDialog(page)).toHaveCount(0);
        const toast = discardedToast(page);
        await expect(toast).toBeVisible();

        await toast.locator('[data-test="o-toast-action-btn"]').click();
        await page.waitForURL((url) => url.pathname.includes('add_panel'), { timeout: 30000 });
        await expect(panelName(page)).toContainText('Latency p95');
        await expect(draftOffer(page)).toHaveCount(0);
    });

    test('after 5 s the discarded draft is gone', {
        tag: ['@onboarding', '@dashboards', '@panelDraft', '@P2'],
    }, async ({ page }) => {
        await openNewPanel(page, pm);
        await editTitle(page, pm, 'Gone after five');

        await pm.dashboardPanelActions.getPanelDiscardBtn().click();
        await page.waitForURL((url) => !url.pathname.includes('add_panel'), { timeout: 30000 });
        await expect(discardedToast(page)).toBeHidden({ timeout: 8000 });

        await openNewPanel(page, pm);
        await expect(draftOffer(page)).toHaveCount(0);
    });
});
