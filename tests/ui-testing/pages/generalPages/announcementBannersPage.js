// announcementBannersPage.js - Page Object for the Announcement Banners feature
// Covers the Settings > General "Configure" entry point (Settings > Announcement Banners),
// the ODrawer editor (AnnouncementBanners.vue), the add/edit ODialog
// (AnnouncementBannerDialog.vue), the banner cards, and the live header strip
// (AnnouncementBanner.vue mounted in MainLayout.vue).
//
// Selector source of truth: the component data-test attributes (verified below).
//   - OInput  data-test="X"  -> native input/textarea is [data-test="X-field"], error span [data-test="X-error"]
//   - OSelect data-test="X"  -> trigger [data-test="X-trigger"], popover [data-test="X-popover"], option [data-test="X-option"]
//   - OSwitch data-test="X"  -> toggle button [data-test="X-btn"]
//   - ODrawer/ODialog        -> footer buttons [data-test="<parent>"] [data-test="o-drawer-primary-btn"] / "o-dialog-primary-btn"
import { expect } from '@playwright/test';
const testLogger = require('../../playwright-tests/utils/test-logger.js');

const VARIANT_SELECTORS = [
  '[data-test="announcement-banner-critical"]',
  '[data-test="announcement-banner-warning"]',
  '[data-test="announcement-banner-info"]',
  '[data-test="announcement-banner-promo"]',
];

export class AnnouncementBannersPage {
  constructor(page) {
    this.page = page;

    // ── Settings entry point + editor drawer ────────────────────────────────
    this.settingsBtn = '[data-test="settings_ent_announcement_banners_btn"]';
    this.drawer = '[data-test="announcement-banners-settings"]';
    this.addBtn = '[data-test="announcement-banners-add-btn"]';
    this.preview = '[data-test="announcement-banners-preview"]';
    this.drawerPrimary = '[data-test="announcement-banners-settings"] [data-test="o-drawer-primary-btn"]';

    // ── Add / edit dialog ───────────────────────────────────────────────────
    this.dialog = '[data-test="announcements-banner-dialog"]';
    this.dialogPrimary = '[data-test="announcements-banner-dialog"] [data-test="o-dialog-primary-btn"]';
    this.messageField = '[data-test="announcements-banner-dialog-message-field"]';
    this.messageError = '[data-test="announcements-banner-dialog-message-error"]';
    this.variantTrigger = '[data-test="announcements-banner-dialog-variant-trigger"]';
    this.variantPopover = '[data-test="announcements-banner-dialog-variant-popover"]';
    this.hasCtaBtn = '[data-test="announcements-banner-dialog-has-cta-btn"]';
    this.ctaTextField = '[data-test="announcements-banner-dialog-cta-text-field"]';
    this.ctaUrlField = '[data-test="announcements-banner-dialog-cta-url-field"]';
    this.dismissibleBtn = '[data-test="announcements-banner-dialog-dismissible-btn"]';

    // ── Toast ───────────────────────────────────────────────────────────────
    this.toastMessage = '[data-test="o-toast-message"]';
  }

  // Factories: variant-keyed live-bar and index-keyed card locators.
  bannerBar(variant) {
    return this.page.locator(`[data-test="announcement-banner-${variant}"]`);
  }

  card(index) {
    return this.page.locator(`[data-test="announcements-banner-card-${index}"]`);
  }

  cardEdit(index) {
    return this.page.locator(`[data-test="announcements-banner-card-edit-${index}"]`);
  }

  cardRemove(index) {
    return this.page.locator(`[data-test="announcements-banner-card-remove-${index}"]`);
  }

  // ── Editor drawer ─────────────────────────────────────────────────────────

  async openEditor() {
    testLogger.info('Opening announcement banners editor');
    await this.page.locator(this.settingsBtn).waitFor({ state: 'visible', timeout: 30000 });
    await this.page.locator(this.settingsBtn).click();
    await this.page.locator(this.drawer).waitFor({ state: 'visible', timeout: 10000 });
  }

  // ── Add / edit dialog ─────────────────────────────────────────────────────

  async clickAddBanner() {
    testLogger.info('Opening add-banner dialog');
    await this.page.locator(this.addBtn).click();
    await this.page.locator(this.dialog).waitFor({ state: 'visible', timeout: 10000 });
  }

  async editBanner(index) {
    testLogger.info(`Editing banner at index ${index}`);
    await this.cardEdit(index).click();
    await this.page.locator(this.dialog).waitFor({ state: 'visible', timeout: 10000 });
  }

  async removeBanner(index) {
    testLogger.info(`Removing banner at index ${index}`);
    await this.cardRemove(index).click();
  }

  async fillMessage(message) {
    await this.page.locator(this.messageField).fill(message);
  }

  async selectVariant(label) {
    testLogger.info(`Selecting severity variant: ${label}`);
    await this.page.locator(this.variantTrigger).click();
    await this.page.locator(this.variantPopover).waitFor({ state: 'visible', timeout: 5000 });
    await this.page.getByRole('option', { name: label, exact: true }).click();
  }

  async toggleHasCta() {
    await this.page.locator(this.hasCtaBtn).click();
  }

  async toggleDismissible() {
    await this.page.locator(this.dismissibleBtn).click();
  }

  async fillCtaText(text) {
    await this.page.locator(this.ctaTextField).fill(text);
  }

  async fillCtaUrl(url) {
    await this.page.locator(this.ctaUrlField).fill(url);
  }

  async clickApply() {
    testLogger.info('Applying banner form');
    await this.page.locator(this.dialogPrimary).click();
  }

  // ── Drawer footer ─────────────────────────────────────────────────────────

  async publish() {
    testLogger.info('Publishing announcement banners');
    await this.page.locator(this.drawerPrimary).click();
    await expect(
      this.page.locator(this.toastMessage).filter({ hasText: 'Announcement banners updated' }).first(),
    ).toBeVisible({ timeout: 30000 });
  }

  // ── Dialog assertions ─────────────────────────────────────────────────────

  async expectDialogVisible() {
    await expect(this.page.locator(this.dialog)).toBeVisible({ timeout: 10000 });
  }

  async expectDialogClosed() {
    await expect(this.page.locator(this.dialog)).toBeHidden({ timeout: 10000 });
  }

  async expectMessageError(text) {
    await expect(this.page.locator(this.messageError)).toBeVisible({ timeout: 10000 });
    await expect(this.page.locator(this.messageError)).toContainText(text);
  }

  // ── Card / preview assertions ─────────────────────────────────────────────

  async expectBannerCard(index, message) {
    await expect(this.card(index)).toBeVisible({ timeout: 10000 });
    await expect(this.card(index)).toContainText(message);
  }

  async expectCardAbsent(index) {
    await expect(this.card(index)).toHaveCount(0);
  }

  async expectPreviewContains(message) {
    await expect(this.page.locator(this.preview)).toContainText(message, { timeout: 10000 });
  }

  // The preview is driven by the same resolver as the live bar, so the order of
  // its message text is the order users get. Assert each message appears after
  // the previous one (not just that all are present).
  async expectPreviewOrder(messages) {
    const text = await this.page.locator(this.preview).innerText();
    for (let i = 1; i < messages.length; i++) {
      const prev = text.indexOf(messages[i - 1]);
      const curr = text.indexOf(messages[i]);
      expect(prev, `"${messages[i - 1]}" should be present in the preview`).toBeGreaterThanOrEqual(0);
      expect(curr, `"${messages[i]}" should appear after "${messages[i - 1]}"`).toBeGreaterThan(prev);
    }
  }

  // ── Live bar assertions ───────────────────────────────────────────────────

  async expectBannerBar(variant, message) {
    const bar = this.bannerBar(variant).filter({ hasText: message }).first();
    await expect(bar).toBeVisible({ timeout: 30000 });
    await expect(bar).toContainText(message);
  }

  async expectBannerBarAbsent(variant, message) {
    await expect(this.bannerBar(variant).filter({ hasText: message })).toHaveCount(0);
  }

  async dismissBanner(variant, message) {
    const bar = this.bannerBar(variant).filter({ hasText: message }).first();
    await expect(bar).toBeVisible({ timeout: 30000 });
    await bar.getByRole('button', { name: 'Dismiss announcement' }).click();
    await expect(bar).toBeHidden({ timeout: 10000 });
  }

  // The dismissal must persist in localStorage (o2_dismissed_announcements) or
  // the banner reappears on the next load. Verify the write actually happened.
  async expectDismissalPersisted() {
    const stored = await this.page.evaluate(() => {
      try {
        return JSON.parse(window.localStorage.getItem('o2_dismissed_announcements') || '[]');
      } catch {
        return [];
      }
    });
    expect(Array.isArray(stored) && stored.length > 0).toBe(true);
  }

  async expectNoDismissControl(variant, message) {
    const bar = this.bannerBar(variant).filter({ hasText: message }).first();
    await expect(bar).toBeVisible({ timeout: 30000 });
    await expect(bar.getByRole('button', { name: 'Dismiss announcement' })).toHaveCount(0);
  }

  async expectCtaLink(text, url) {
    const link = this.page.getByRole('link', { name: text });
    await expect(link).toBeVisible({ timeout: 30000 });
    await expect(link).toHaveAttribute('href', url);
  }

  // DOM order of the live banner bars (top-to-bottom). Asserts each message is
  // present and appears after the previous one — message-scoped so a concurrent
  // worker's banner (a different message) can never break the relative-order
  // check. Excludes the dismiss/CTA controls: those embed the auto-derived
  // banner id, never one of the four variant keys.
  async expectLiveBarOrder(messages) {
    const bars = this.page.locator(VARIANT_SELECTORS.join(', '));
    const texts = await bars.evaluateAll((els) => els.map((el) => (el.textContent || '').trim()));
    for (let i = 1; i < messages.length; i++) {
      const prevIdx = texts.findIndex((t) => t.includes(messages[i - 1]));
      const currIdx = texts.findIndex((t) => t.includes(messages[i]));
      expect(prevIdx, `"${messages[i - 1]}" should be present in the live bar`).toBeGreaterThanOrEqual(0);
      expect(currIdx, `"${messages[i]}" should appear after "${messages[i - 1]}"`).toBeGreaterThan(prevIdx);
    }
  }
}
