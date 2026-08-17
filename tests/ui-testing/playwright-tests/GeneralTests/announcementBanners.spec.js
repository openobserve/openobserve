// Copyright 2026 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const PageManager = require('../../pages/page-manager.js');

/**
 * Announcement Banners E2E Tests.
 *
 * Operator-authored banners are written on the `_meta` org (Settings > General)
 * and rendered above the toolbar for every org on an enterprise build.
 *
 * Tests are fully independent: each authoring test creates its own uniquely-named
 * banner(s) via the feature's own UI and asserts on that exact message (message-
 * scoped live-strip assertions), so no test depends on another's published state.
 */

function uniqueMessage(prefix) {
    return `${prefix} ${Date.now()} ${Math.random().toString(36).slice(2, 8)}`;
}

test.describe("Announcement Banners testcases", () => {
    test.describe.configure({ mode: 'parallel' });
    let pm;

    test.beforeEach(async ({ page }, testInfo) => {
        testLogger.testStart(testInfo.title, testInfo.file);
        await navigateToBase(page);
        pm = new PageManager(page);
        testLogger.info('Announcement Banners test setup completed');
    });

    test("should publish a critical banner and render it for a non-meta org", {
        tag: ['@announcementBanners', '@all', '@enterprise', '@P0'],
    }, async () => {
        const viewerOrg = process.env["ORGNAME"];
        const message = uniqueMessage('Planned maintenance');
        testLogger.info(`Authoring critical banner with message: ${message}`);

        await pm.announcementBannersPage.navigateToMetaGeneralSettings();
        await pm.announcementBannersPage.openSettingsDrawer();
        await pm.announcementBannersPage.expectSettingsDrawerVisible();

        await pm.announcementBannersPage.clickAddBanner();
        await pm.announcementBannersPage.expectDialogVisible();
        await pm.announcementBannersPage.fillMessage(message);
        await pm.announcementBannersPage.selectVariant('critical');
        await pm.announcementBannersPage.clickApply();
        await pm.announcementBannersPage.expectDialogHidden();
        await pm.announcementBannersPage.expectBannerCardWithMessage(message);
        await pm.announcementBannersPage.expectPreviewShowsMessage(message, 'critical');

        await pm.announcementBannersPage.clickPublish();
        await pm.announcementBannersPage.expectSuccessNotification();

        testLogger.info(`Verifying banner renders for viewer org: ${viewerOrg}`);
        await pm.announcementBannersPage.navigateToOrgHome(viewerOrg);
        await pm.announcementBannersPage.expectLiveBannerMessage('critical', message);
        testLogger.info('Test completed');
    });

    test("should keep a dismissed banner hidden across reload", {
        tag: ['@announcementBanners', '@all', '@enterprise', '@P1'],
    }, async () => {
        const viewerOrg = process.env["ORGNAME"];
        const message = uniqueMessage('Dismissible info notice');

        await pm.announcementBannersPage.navigateToMetaGeneralSettings();
        await pm.announcementBannersPage.openSettingsDrawer();
        await pm.announcementBannersPage.clickAddBanner();
        await pm.announcementBannersPage.fillMessage(message);
        await pm.announcementBannersPage.clickApply();
        await pm.announcementBannersPage.expectDialogHidden();
        await pm.announcementBannersPage.clickPublish();
        await pm.announcementBannersPage.expectSuccessNotification();

        await pm.announcementBannersPage.navigateToOrgHome(viewerOrg);
        await pm.announcementBannersPage.expectLiveBannerMessage('info', message);

        testLogger.info('Dismissing the info banner');
        await pm.announcementBannersPage.dismissLiveBanner('info', message);
        await pm.announcementBannersPage.expectLiveBannerAbsentByMessage('info', message);

        testLogger.info('Reloading and verifying the banner stays hidden');
        await pm.announcementBannersPage.reloadViewer();
        await pm.announcementBannersPage.expectLiveBannerAbsentByMessage('info', message);
        testLogger.info('Test completed');
    });

    test("should reject an empty message with a client-side validation error", {
        tag: ['@announcementBanners', '@all', '@enterprise', '@P1'],
    }, async () => {
        await pm.announcementBannersPage.navigateToMetaGeneralSettings();
        await pm.announcementBannersPage.openSettingsDrawer();

        await pm.announcementBannersPage.clickAddBanner();
        await pm.announcementBannersPage.expectDialogVisible();

        testLogger.info('Applying with an empty message');
        await pm.announcementBannersPage.clickApply();

        await pm.announcementBannersPage.expectMessageValidationError();
        await pm.announcementBannersPage.expectDialogVisible();
        testLogger.info('Test completed');
    });

    test("should reject a non-http(s) CTA link with a client-side validation error", {
        tag: ['@announcementBanners', '@all', '@enterprise', '@P1'],
    }, async () => {
        await pm.announcementBannersPage.navigateToMetaGeneralSettings();
        await pm.announcementBannersPage.openSettingsDrawer();
        await pm.announcementBannersPage.clickAddBanner();
        await pm.announcementBannersPage.expectDialogVisible();

        await pm.announcementBannersPage.fillMessage(uniqueMessage('CTA banner'));
        await pm.announcementBannersPage.toggleCta();
        await pm.announcementBannersPage.fillCtaText('Status page');
        await pm.announcementBannersPage.fillCtaUrl('javascript:alert(1)');

        testLogger.info('Applying with a javascript: CTA URL');
        await pm.announcementBannersPage.clickApply();

        await pm.announcementBannersPage.expectCtaUrlValidationError();
        await pm.announcementBannersPage.expectDialogVisible();
        testLogger.info('Test completed');
    });

    test("should order banners by severity and suppress promo while critical is active", {
        tag: ['@announcementBanners', '@all', '@enterprise', '@P2'],
    }, async () => {
        const viewerOrg = process.env["ORGNAME"];
        const infoMsg = uniqueMessage('Info banner');
        const warningMsg = uniqueMessage('Warning banner');
        const criticalMsg = uniqueMessage('Critical banner');
        const promoMsg = uniqueMessage('Promo banner');

        // Author + publish info, warning, critical.
        await pm.announcementBannersPage.navigateToMetaGeneralSettings();
        await pm.announcementBannersPage.openSettingsDrawer();

        await pm.announcementBannersPage.clickAddBanner();
        await pm.announcementBannersPage.fillMessage(infoMsg);
        await pm.announcementBannersPage.clickApply();
        await pm.announcementBannersPage.expectDialogHidden();

        await pm.announcementBannersPage.clickAddBanner();
        await pm.announcementBannersPage.fillMessage(warningMsg);
        await pm.announcementBannersPage.selectVariant('warning');
        await pm.announcementBannersPage.clickApply();
        await pm.announcementBannersPage.expectDialogHidden();

        await pm.announcementBannersPage.clickAddBanner();
        await pm.announcementBannersPage.fillMessage(criticalMsg);
        await pm.announcementBannersPage.selectVariant('critical');
        await pm.announcementBannersPage.clickApply();
        await pm.announcementBannersPage.expectDialogHidden();

        await pm.announcementBannersPage.clickPublish();
        await pm.announcementBannersPage.expectSuccessNotification();

        // Severity order on the live strip: critical -> warning -> info.
        await pm.announcementBannersPage.navigateToOrgHome(viewerOrg);
        await pm.announcementBannersPage.expectLiveBannerMessage('critical', criticalMsg);
        const order = await pm.announcementBannersPage.getLiveBannerTextsInOrder();
        expect(order.indexOf(criticalMsg)).toBeGreaterThan(-1);
        expect(order.indexOf(warningMsg)).toBeGreaterThan(-1);
        expect(order.indexOf(infoMsg)).toBeGreaterThan(-1);
        expect(order.indexOf(criticalMsg)).toBeLessThan(order.indexOf(warningMsg));
        expect(order.indexOf(warningMsg)).toBeLessThan(order.indexOf(infoMsg));
        testLogger.info(`Live order: ${JSON.stringify(order)}`);

        // Add a promo banner while a critical banner is still active.
        await pm.announcementBannersPage.navigateToMetaGeneralSettings();
        await pm.announcementBannersPage.openSettingsDrawer();
        await pm.announcementBannersPage.clickAddBanner();
        await pm.announcementBannersPage.fillMessage(promoMsg);
        await pm.announcementBannersPage.selectVariant('promo');
        await pm.announcementBannersPage.clickApply();
        await pm.announcementBannersPage.expectDialogHidden();
        await pm.announcementBannersPage.clickPublish();
        await pm.announcementBannersPage.expectSuccessNotification();

        // Promo is suppressed while a critical banner is up.
        await pm.announcementBannersPage.navigateToOrgHome(viewerOrg);
        await pm.announcementBannersPage.expectLiveBannerMessage('critical', criticalMsg);
        await pm.announcementBannersPage.expectLiveBannerAbsentByMessage('promo', promoMsg);

        // Remove the critical banner; the promo banner now renders.
        await pm.announcementBannersPage.navigateToMetaGeneralSettings();
        await pm.announcementBannersPage.openSettingsDrawer();
        await pm.announcementBannersPage.removeBannerByMessage(criticalMsg);
        await pm.announcementBannersPage.clickPublish();
        await pm.announcementBannersPage.expectSuccessNotification();

        await pm.announcementBannersPage.navigateToOrgHome(viewerOrg);
        await pm.announcementBannersPage.expectLiveBannerMessage('promo', promoMsg);
        await pm.announcementBannersPage.expectLiveBannerAbsentByMessage('critical', criticalMsg);
        const finalOrder = await pm.announcementBannersPage.getLiveBannerTextsInOrder();
        expect(finalOrder.indexOf(warningMsg)).toBeGreaterThan(-1);
        expect(finalOrder.indexOf(infoMsg)).toBeGreaterThan(-1);
        expect(finalOrder.indexOf(promoMsg)).toBeGreaterThan(-1);
        expect(finalOrder.indexOf(warningMsg)).toBeLessThan(finalOrder.indexOf(infoMsg));
        expect(finalOrder.indexOf(infoMsg)).toBeLessThan(finalOrder.indexOf(promoMsg));
        testLogger.info('Test completed');
    });

    test("should return 403 for non-meta org config access and 200 for the live read", {
        tag: ['@announcementBanners', '@all', '@enterprise', '@P2', '@api'],
    }, async () => {
        const viewerOrg = process.env["ORGNAME"];

        testLogger.info(`Asserting config endpoint is forbidden for non-meta org: ${viewerOrg}`);
        const configStatus = await pm.announcementBannersPage.apiGetConfigStatus(viewerOrg);
        expect(configStatus).toBe(403);

        testLogger.info('Asserting the live read remains open to any org');
        const active = await pm.announcementBannersPage.apiGetActive(viewerOrg);
        expect(active.status).toBe(200);
        expect(Array.isArray(active.banners)).toBe(true);
        testLogger.info('Test completed');
    });
});
