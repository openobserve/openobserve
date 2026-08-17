// Copyright 2026 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

const { expect } = require('@playwright/test');
const { getAuthHeaders } = require('../../playwright-tests/utils/cloud-auth.js');

/**
 * Page object for Announcement Banners.
 *
 * Two surfaces, both covered here:
 *  - the authoring drawer (Settings > General on the `_meta` org), driven by the
 *    `AnnouncementBanners` / `AnnouncementBannerDialog` components, and
 *  - the live strip (`AnnouncementBanner`) rendered above the toolbar for every org
 *    when the enterprise build is active.
 *
 * Every selector lives here; the spec only calls these methods.
 *
 * Live-strip assertions are message-scoped (`.filter({ hasText })`) rather than
 * variant-only, so a test stays correct even when a sibling test publishes another
 * banner of the same variant while tests run in parallel against the shared config.
 */
class AnnouncementBannersPage {
    constructor(page) {
        this.page = page;

        // ── Authoring entry + drawer ───────────────────────────────────────
        this.announcementBannersBtn = '[data-test="settings_ent_announcement_banners_btn"]';
        this.settingsDrawer = '[data-test="announcement-banners-settings"]';
        this.preview = '[data-test="announcement-banners-preview"]';
        this.addBannerBtn = '[data-test="announcement-banners-add-btn"]';
        this.publishBtn = '[data-test="announcement-banners-publish-btn"]';
        this.bannerCard = '[data-test^="announcements-banner-card-"]';

        // ── Banner dialog ──────────────────────────────────────────────────
        this.dialog = '[data-test="announcements-banner-dialog"]';
        this.messageTextarea = '[data-test="announcements-banner-dialog-message"] textarea';
        this.variantSelect = '[data-test="announcements-banner-dialog-variant"]';
        this.hasCtaToggle = '[data-test="announcements-banner-dialog-has-cta"]';
        this.ctaTextInput = '[data-test="announcements-banner-dialog-cta-text"] input';
        this.ctaUrlInput = '[data-test="announcements-banner-dialog-cta-url"] input';
        this.applyBtn = '[data-test="announcements-banner-dialog-apply"]';

        // ── Live strip ─────────────────────────────────────────────────────
        this.variantLabels = {
            info: 'Info',
            warning: 'Warning',
            critical: 'Critical',
            promo: 'Promotion',
        };
    }

    liveBanner(variant) {
        return `[data-test="announcement-banner-${variant}"]`;
    }

    // ── Authoring: navigation ─────────────────────────────────────────────

    async navigateToMetaGeneralSettings() {
        await this.page.goto(
            `${process.env["ZO_BASE_URL"]}/web/settings/general?org_identifier=_meta`,
        );
        await this.page.waitForLoadState('domcontentloaded');
        await this.page.locator(this.announcementBannersBtn).waitFor({ state: 'visible' });
    }

    async openSettingsDrawer() {
        await this.page.locator(this.announcementBannersBtn).click();
        await this.page.locator(this.settingsDrawer).waitFor({ state: 'visible' });
    }

    async expectSettingsDrawerVisible() {
        await expect(this.page.locator(this.settingsDrawer)).toBeVisible();
    }

    // ── Authoring: banner dialog ──────────────────────────────────────────

    async clickAddBanner() {
        await this.page.locator(this.addBannerBtn).click();
    }

    async expectDialogVisible() {
        await expect(this.page.locator(this.dialog)).toBeVisible();
    }

    async expectDialogHidden() {
        await expect(this.page.locator(this.dialog)).toBeHidden();
    }

    async fillMessage(text) {
        await this.page.locator(this.messageTextarea).fill(text);
    }

    async selectVariant(variant) {
        const label = this.variantLabels[variant];
        await this.page.locator(this.variantSelect).click();
        const option = this.page.getByRole('option', { name: label });
        await option.waitFor({ state: 'visible' });
        await option.click();
    }

    async toggleCta() {
        await this.page.locator(this.hasCtaToggle).click();
    }

    async fillCtaText(text) {
        await this.page.locator(this.ctaTextInput).fill(text);
    }

    async fillCtaUrl(url) {
        await this.page.locator(this.ctaUrlInput).fill(url);
    }

    async clickApply() {
        await this.page.locator(this.applyBtn).click();
    }

    async expectMessageValidationError() {
        await expect(this.page.getByText('Enter the message people will see.')).toBeVisible();
    }

    async expectCtaUrlValidationError() {
        await expect(
            this.page.getByText('The link must start with http:// or https://'),
        ).toBeVisible();
    }

    async expectBannerCardWithMessage(message) {
        await expect(
            this.page.locator(this.bannerCard).filter({ hasText: message }).first(),
        ).toBeVisible();
    }

    async expectPreviewShowsMessage(message, variant) {
        const barClass = variant
            ? `.announcement-preview-bar--${variant}`
            : '.announcement-preview-bar';
        await expect(
            this.page.locator(`${this.preview} ${barClass}`).filter({ hasText: message }),
        ).toBeVisible();
    }

    async removeBannerByMessage(message) {
        const card = this.page.locator(this.bannerCard).filter({ hasText: message }).first();
        await card.getByRole('button', { name: 'Remove banner' }).click();
    }

    // ── Authoring: publish ────────────────────────────────────────────────

    async clickPublish() {
        await this.page.locator(this.publishBtn).click();
    }

    async expectSuccessNotification() {
        await expect(this.page.getByText('Announcement banners updated')).toBeVisible();
    }

    // ── Live strip (viewer org) ───────────────────────────────────────────

    async navigateToOrgHome(org) {
        await this.page.goto(`${process.env["ZO_BASE_URL"]}?org_identifier=${org}`);
        await this.page.waitForLoadState('domcontentloaded');
    }

    async reloadViewer() {
        await this.page.reload();
        await this.page.waitForLoadState('domcontentloaded');
    }

    async expectLiveBannerMessage(variant, message) {
        await expect(
            this.page.locator(this.liveBanner(variant)).filter({ hasText: message }),
        ).toBeVisible();
    }

    async expectLiveBannerAbsentByMessage(variant, message) {
        await expect(
            this.page.locator(this.liveBanner(variant)).filter({ hasText: message }),
        ).toHaveCount(0);
    }

    async dismissLiveBanner(variant, message) {
        await this.page
            .locator(this.liveBanner(variant))
            .filter({ hasText: message })
            .getByRole('button', { name: 'Dismiss announcement' })
            .click();
    }

    async getLiveBannerTextsInOrder() {
        return await this.page.locator('.announcement-bar-text').allTextContents();
    }

    // ── API (authoring access control) ────────────────────────────────────

    async apiGetConfigStatus(org) {
        const baseUrl = (process.env.ZO_BASE_URL || '').replace(/\/+$/, '');
        const response = await this.page.request.get(
            `${baseUrl}/api/${org}/announcements/config`,
            { headers: getAuthHeaders() },
        );
        return response.status();
    }

    async apiGetActive(org) {
        const baseUrl = (process.env.ZO_BASE_URL || '').replace(/\/+$/, '');
        const response = await this.page.request.get(
            `${baseUrl}/api/${org}/announcements`,
            { headers: getAuthHeaders() },
        );
        let banners = [];
        try {
            const data = await response.json();
            banners = Array.isArray(data && data.banners) ? data.banners : [];
        } catch (error) {
            // Non-JSON body is not a failure of the read contract; leave banners empty.
        }
        return { status: response.status(), banners };
    }
}

module.exports = { AnnouncementBannersPage };
