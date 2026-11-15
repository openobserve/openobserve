// editionFeaturesPage.js - Page Object for the Enterprise Upgrade / Edition dialog
// Covers the edition entry (data-test="upgrade-to-enterprise-btn", a top-bar link on OSS and a
// Help menu item on Enterprise and Cloud) and the
// EnterpriseUpgradeDialog feature list with o2.ws documentation short links.
import { expect } from '@playwright/test';
const testLogger = require('../../playwright-tests/utils/test-logger.js');

// Enterprise features rendered in the dialog for OSS and ENT builds (non-cloud layout).
// Source of truth: web/src/components/EnterpriseUpgradeDialog.vue (FEATURE_LINKS + enterpriseFeatures).
// expectedPath = fragment that must appear in the final openobserve.ai URL after the
// o2.ws redirect (resolved live on 2026-06-10).
// NOTE: workload_mgmt, query_opt, ai_assistant and telemetry_corr currently fall back
// to the /docs/ homepage — no dedicated short link is configured for them yet.
export const ENTERPRISE_FEATURES = [
  { name: 'Single sign on', slug: 'sso', beta: false, ha: true, expectedPath: '/docs/user-guide/account-administration/identity-and-access-management/sso/' },
  { name: 'Role based access control', slug: 'rbac', beta: false, ha: true, expectedPath: '/docs/user-guide/account-administration/identity-and-access-management/role-based-access-control/' },
  { name: 'Federated search / supercluster', slug: 'fed_search', beta: false, ha: true, expectedPath: '/docs/user-guide/data-exploration/federated-search/' },
  { name: 'Query management', slug: 'query_mgmt', beta: false, ha: false, expectedPath: '/docs/user-guide/account-administration/management/query-management/' },
  { name: 'Audit trail', slug: 'audit_trail', beta: false, ha: false, expectedPath: '/docs/user-guide/account-administration/management/audit-trail/' },
  { name: 'Sensitive data redaction', slug: 'data_redact', beta: false, ha: false, expectedPath: '/docs/user-guide/account-administration/management/sensitive-data-redaction/' },
  { name: 'Pipeline remote destinations', slug: 'pipeline_remote', beta: false, ha: false, expectedPath: '/docs/user-guide/data-processing/pipelines/remote-destination/' },
  { name: 'Incident management', slug: 'incident_mgmt', beta: true, ha: true, expectedPath: '/docs/user-guide/analytics/incidents/' },
  // sre_agent: o2.ws redirect resolves to /docs/administration/deployment/sre-agent-setup-guide/
  // but that page issues a client-side redirect to /docs/enterprise-setup/sre-agent/ — assert
  // the final user-visible URL.
  { name: 'SRE agent', slug: 'sre_agent', beta: true, ha: true, expectedPath: '/docs/enterprise-setup/sre-agent/' },
  { name: 'O2 Assistant', slug: 'ai_assistant', beta: true, ha: true, expectedPath: '/docs/' },
  { name: 'Anomaly detection', slug: 'anomaly_detect', beta: true, ha: false, expectedPath: '/docs/user-guide/analytics/alerts/anomaly-detection/' },
  { name: 'Metrics auto downsampling', slug: 'metrics_downsample', beta: false, ha: false, expectedPath: '/docs/user-guide/data-exploration/metrics/downsampling-metrics/' },
  { name: 'Log patterns', slug: 'log_patterns', beta: false, ha: false, expectedPath: '/blog/log-patterns-automatic-pattern-extraction-faster-analysis/' },
  { name: 'Rate limiting', slug: 'rate_limit', beta: false, ha: false, expectedPath: '/docs/user-guide/account-administration/identity-and-access-management/quotas/how-quotas-work/' },
  { name: 'Logs, metrics & traces correlation', slug: 'telemetry_corr', beta: false, ha: false, expectedPath: '/docs/' },
  { name: 'Service graph', slug: 'service_maps', beta: false, ha: false, expectedPath: '/docs/user-guide/data-exploration/traces/service-graph/' },
];

// Cloud-only feature: EnterpriseOfferFeatureGrid leaves it out of the grid on OSS/ENT.
export const CLOUD_ONLY_FEATURE_NAME = 'Bring your own bucket';

// Hero panel link buttons (EnterpriseUpgradeDialog.vue openDownloadPage/openDocsLink).
export const HERO_LINKS = {
  download_resources: { slug: 'download_resources', expectedPath: '/downloads/' },
  // ent_install_guide: o2.ws redirect resolves to /docs/administration/deployment/openobserve-enterprise-edition-installation-guide/
  // but that page issues a client-side redirect to /docs/enterprise-setup/ — assert the final user-visible URL.
  ent_install_guide: { slug: 'ent_install_guide', expectedPath: '/docs/enterprise-setup/' },
  // "lincense" typo is the real live URL on openobserve.ai
  license_guide: { slug: 'license_guide', expectedPath: '/docs/user-guide/account-administration/management/lincense/' },
};

export class EditionFeaturesPage {
  constructor(page) {
    this.page = page;

    // Edition entry (same data-test in OSS and ENT, label differs). OSS keeps it in the
    // top bar; Enterprise and Cloud list it in the Help menu, so it exists only while that menu is open.
    this.editionButton = page.locator('[data-test="upgrade-to-enterprise-btn"]');
    this.helpMenuButton = page.locator('[data-test="menu-link-help-item"]');

    // Dialog
    this.dialog = page.locator('[data-test="enterprise-upgrade-dialog"]');
    this.heroTitle = this.dialog.locator('[data-test="enterprise-upgrade-hero-title"]');
    this.offerBadge = this.dialog.locator('[data-test="enterprise-upgrade-offer-badge"]');
    this.primaryButton = this.dialog.locator('[data-test="enterprise-upgrade-download-btn"]');
    this.learnMoreButton = this.dialog.locator('[data-test="enterprise-upgrade-learn-more-btn"]');
    // The dialog has no features heading any more: the header carries the title, the grid follows.
    this.featuresGrid = this.dialog.locator('[data-test="enterprise-upgrade-features-list-standard"]');
    this.featureItems = this.dialog.locator('[data-test="enterprise-upgrade-feature-item"]');
  }

  getFeatureItem(name) {
    return this.featureItems.filter({
      has: this.page.locator('[data-test="enterprise-upgrade-feature-name"]', { hasText: name }),
    });
  }

  // Makes the edition entry visible: on Enterprise and Cloud it lives in the Help menu.
  // Returns true when this call opened the Help menu, so the caller can close it again.
  async revealEditionButton() {
    await expect(this.helpMenuButton).toBeVisible({ timeout: 15000 });
    if (await this.editionButton.isVisible()) return false;
    await this.helpMenuButton.click();
    await expect(this.editionButton).toBeVisible({ timeout: 10000 });
    return true;
  }

  async expectEditionButtonLabel(expectedLabel) {
    await this.revealEditionButton();
    await expect(this.editionButton).toContainText(expectedLabel);
  }

  // Detects the active edition from the rendered edition entry's label. The dialog
  // variant is driven by frontend build-time flags (VITE_OPENOBSERVE_ENTERPRISE /
  // VITE_OPENOBSERVE_CLOUD via @/aws-exports), which can diverge from the backend
  // binary's build_type (e.g. an OSS frontend bundle served by an enterprise
  // backend). The label is the most direct signal of what the user sees.
  async detectEdition() {
    const openedMenu = await this.revealEditionButton();
    const label = await this.editionButton.innerText({ timeout: 15000 });
    // Close the Help menu again so the caller's next click is not swallowed by it.
    if (openedMenu) {
      await this.page.keyboard.press('Escape');
      await expect(this.editionButton).toBeHidden({ timeout: 5000 });
    }
    const trimmed = label.trim();
    if (trimmed.includes('Edition: Enterprise')) return 'enterprise';
    if (trimmed.includes('Get OpenObserve Enterprise')) return 'opensource';
    if (trimmed.includes('OpenObserve Features')) return 'cloud';
    throw new Error(`Unrecognized edition button label: "${trimmed}" (raw: ${JSON.stringify(label)})`);
  }

  async openDialog() {
    await this.revealEditionButton();
    await this.editionButton.click();
    await expect(this.dialog).toBeVisible({ timeout: 10000 });
  }

  async expectHero({ heroTitle, badgePattern, primaryButtonText, hasLearnMore }) {
    await expect(this.heroTitle).toHaveText(heroTitle);
    await expect(this.offerBadge).toContainText(badgePattern);
    await expect(this.primaryButton).toContainText(primaryButtonText);
    await expect(this.featuresGrid).toBeVisible();
    if (hasLearnMore) {
      await expect(this.learnMoreButton).toContainText('Learn more');
    }
  }

  async expectFeatureCard({ name, beta, ha }) {
    const item = this.getFeatureItem(name);
    await expect(item, `Feature card "${name}" should be visible`).toBeVisible();
    await expect(item.locator('[data-test="enterprise-upgrade-feature-external-link"]'), `"${name}" should show external link icon`).toBeVisible();
    if (beta) {
      await expect(item.locator('[data-test="enterprise-upgrade-feature-beta-badge"]'), `"${name}" should show BETA badge`).toBeVisible();
    }
    if (ha) {
      await expect(item.locator('[data-test="enterprise-upgrade-feature-ha-badge"]'), `"${name}" should show HA badge`).toBeVisible();
    }
  }

  async expectCloudOnlyFeatureHidden() {
    // byob is filtered out of the OSS/ENT grid, so it is not rendered at all
    const item = this.getFeatureItem(CLOUD_ONLY_FEATURE_NAME);
    await expect(item, `"${CLOUD_ONLY_FEATURE_NAME}" must stay hidden outside Cloud`).toBeHidden();
  }

  // Opens the popup for a link locator and returns the new page.
  //
  // The click and the popup wait are deliberately NOT raced inside one Promise.all
  // any more. They used to be, and the popup wait (15s) is shorter than the click's
  // own action timeout (45s in CI) — so a click that was merely slow to become
  // actionable lost the race and surfaced as a misleading
  // "waitForEvent: Timeout 15000ms exceeded while waiting for event 'page'", hiding
  // the real reason and offering no second chance. Settle the target first, then
  // click, then wait for the popup; a click that opens nothing is retried once and,
  // failing that, reported as exactly what it is.
  async openPopup(locator, attempts = 2) {
    await locator.scrollIntoViewIfNeeded();
    await expect(locator, 'link element should be visible before clicking').toBeVisible();

    for (let attempt = 1; attempt <= attempts; attempt++) {
      // Arm the listener before clicking — window.open fires during the click.
      const popupPromise = this.page
        .context()
        .waitForEvent('page', { timeout: 15000 })
        .catch(() => null);
      await locator.click();
      const popup = await popupPromise;
      if (popup) return popup;
      testLogger.warn('Click did not open a popup window', { attempt, attempts });
    }

    throw new Error(
      `Clicking the link opened no popup window after ${attempts} attempts — window.open never fired`,
    );
  }

  // Clicks a locator that triggers window.open and returns the popup's final URL
  // after the o2.ws short link redirects to openobserve.ai.
  async clickAndCapturePopupUrl(locator) {
    const popup = await this.openPopup(locator);
    try {
      // Resolve as soon as the o2.ws short link commits to an openobserve.ai URL.
      // Use waitUntil:'commit' (not the default 'load') — the marketing/docs pages
      // are heavy and frequently never fire the 'load' event within the timeout in
      // CI, which previously burned the full 30s on every link and blew past the
      // test timeout (24 links × ~45s).
      await popup.waitForURL(/openobserve\.ai/, { timeout: 20000, waitUntil: 'commit' });
      // A couple of pages (sre_agent, ent_install_guide) issue an in-page JS
      // redirect. Let the URL settle so we sample the final destination, but cap it
      // tightly — do NOT wait for networkidle (a live marketing site with chat /
      // analytics widgets never goes idle, so that always burned its full timeout).
      let lastUrl = popup.url();
      for (let i = 0; i < 6; i++) {
        await popup.waitForTimeout(500);
        const currentUrl = popup.url();
        if (currentUrl === lastUrl) break;
        lastUrl = currentUrl;
      }
      return popup.url();
    } catch (e) {
      testLogger.error('Popup never reached openobserve.ai — returning current URL', {
        currentUrl: popup.url(),
        error: e.message,
      });
      return popup.url();
    } finally {
      await popup.close().catch(() => {});
    }
  }

  async captureFeatureLinkUrl(name) {
    return this.clickAndCapturePopupUrl(this.getFeatureItem(name));
  }
}
