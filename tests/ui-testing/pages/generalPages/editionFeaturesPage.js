// editionFeaturesPage.js - Page Object for the Enterprise Upgrade / Edition dialog
// Covers the header edition button (data-test="upgrade-to-enterprise-btn") and the
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
  { name: 'Single Sign On', slug: 'sso', beta: false, ha: true, expectedPath: '/docs/user-guide/account-administration/identity-and-access-management/sso/' },
  { name: 'Role Based Access Control', slug: 'rbac', beta: false, ha: true, expectedPath: '/docs/user-guide/account-administration/identity-and-access-management/role-based-access-control/' },
  { name: 'Federated Search / Supercluster', slug: 'fed_search', beta: false, ha: true, expectedPath: '/docs/user-guide/data-exploration/federated-search/' },
  { name: 'Query Management', slug: 'query_mgmt', beta: false, ha: false, expectedPath: '/docs/user-guide/account-administration/management/query-management/' },
  { name: 'Workload Management', slug: 'workload_mgmt', beta: false, ha: false, expectedPath: '/docs/' },
  { name: 'Audit Trail', slug: 'audit_trail', beta: false, ha: false, expectedPath: '/docs/user-guide/account-administration/management/audit-trail/' },
  { name: 'Sensitive Data Redaction', slug: 'data_redact', beta: false, ha: false, expectedPath: '/docs/user-guide/account-administration/management/sensitive-data-redaction/' },
  { name: 'Pipeline Remote Destinations', slug: 'pipeline_remote', beta: false, ha: false, expectedPath: '/docs/user-guide/data-processing/pipelines/remote-destination/' },
  { name: 'Query Optimizer / Aggregation Cache', slug: 'query_opt', beta: false, ha: false, expectedPath: '/docs/' },
  { name: 'Incident Management', slug: 'incident_mgmt', beta: true, ha: true, expectedPath: '/docs/user-guide/analytics/incidents/' },
  // sre_agent: o2.ws redirect resolves to /docs/administration/deployment/sre-agent-setup-guide/
  // but that page issues a client-side redirect to /docs/enterprise-setup/sre-agent/ — assert
  // the final user-visible URL.
  { name: 'SRE Agent', slug: 'sre_agent', beta: true, ha: true, expectedPath: '/docs/enterprise-setup/sre-agent/' },
  { name: 'O2 Assistant', slug: 'ai_assistant', beta: true, ha: true, expectedPath: '/docs/' },
  { name: 'Anomaly Detection', slug: 'anomaly_detect', beta: true, ha: false, expectedPath: '/docs/user-guide/analytics/alerts/anomaly-detection/' },
  { name: 'Metrics Auto Downsampling', slug: 'metrics_downsample', beta: false, ha: false, expectedPath: '/docs/user-guide/data-exploration/metrics/downsampling-metrics/' },
  { name: 'Log Patterns', slug: 'log_patterns', beta: false, ha: false, expectedPath: '/blog/log-patterns-automatic-pattern-extraction-faster-analysis/' },
  { name: 'MCP Server', slug: 'mcp_server', beta: false, ha: true, expectedPath: '/docs/integration/ai/mcp/' },
  { name: 'Rate Limiting', slug: 'rate_limit', beta: false, ha: false, expectedPath: '/docs/user-guide/account-administration/identity-and-access-management/quotas/how-quotas-work/' },
  { name: 'Broadcast Join', slug: 'broadcast_join', beta: false, ha: true, expectedPath: '/docs/user-guide/advanced/query-tuning/broadcast-join/' },
  { name: 'Logs, Metrics & Traces Correlation', slug: 'telemetry_corr', beta: false, ha: false, expectedPath: '/docs/' },
  { name: 'Service Graph', slug: 'service_maps', beta: false, ha: false, expectedPath: '/docs/user-guide/data-exploration/traces/service-graph/' },
];

// Cloud-only feature: rendered with v-show, so present in DOM but hidden on OSS/ENT.
export const CLOUD_ONLY_FEATURE_NAME = 'Bring Your Own Bucket';

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

    // Header trigger button (same data-test in OSS and ENT, label differs)
    this.editionButton = page.locator('[data-test="upgrade-to-enterprise-btn"]');

    // Dialog
    this.dialog = page.locator('[data-test="enterprise-upgrade-dialog"]');
    this.heroTitle = this.dialog.locator('.hero-title');
    this.offerBadge = this.dialog.locator('.offer-badge');
    this.primaryButton = this.dialog.locator('.download-btn');
    this.learnMoreButton = this.dialog.locator('.learn-more-btn');
    this.featuresTitle = this.dialog.locator('.features-header h4');
    this.featureItems = this.dialog.locator('.feature-list-item');
  }

  getFeatureItem(name) {
    return this.featureItems.filter({
      has: this.page.locator('.feature-name', { hasText: name }),
    });
  }

  async expectEditionButtonLabel(expectedLabel) {
    await expect(this.editionButton).toBeVisible({ timeout: 15000 });
    await expect(this.editionButton).toContainText(expectedLabel);
  }

  // Detects the active edition from the rendered header button label. The dialog
  // variant is driven by frontend build-time flags (VITE_OPENOBSERVE_ENTERPRISE /
  // VITE_OPENOBSERVE_CLOUD via @/aws-exports), which can diverge from the backend
  // binary's build_type (e.g. an OSS frontend bundle served by an enterprise
  // backend). The button label is the most direct signal of what the user sees.
  async detectEdition() {
    const label = await this.editionButton.innerText({ timeout: 15000 });
    const trimmed = label.trim();
    if (trimmed.includes('Edition: Enterprise')) return 'enterprise';
    if (trimmed.includes('Get OpenObserve Enterprise')) return 'opensource';
    if (trimmed.includes('OpenObserve Features')) return 'cloud';
    throw new Error(`Unrecognized edition button label: "${trimmed}" (raw: ${JSON.stringify(label)})`);
  }

  async openDialog() {
    await this.editionButton.click();
    await expect(this.dialog).toBeVisible({ timeout: 10000 });
  }

  async expectHero({ heroTitle, badgePattern, primaryButtonText, featuresTitle, hasLearnMore }) {
    await expect(this.heroTitle).toHaveText(heroTitle);
    await expect(this.offerBadge).toContainText(badgePattern);
    await expect(this.primaryButton).toContainText(primaryButtonText);
    await expect(this.featuresTitle).toHaveText(featuresTitle);
    if (hasLearnMore) {
      await expect(this.learnMoreButton).toContainText('Learn More');
    }
  }

  async expectFeatureCard({ name, beta, ha }) {
    const item = this.getFeatureItem(name);
    await expect(item, `Feature card "${name}" should be visible`).toBeVisible();
    await expect(item.locator('.external-link-icon'), `"${name}" should show external link icon`).toBeVisible();
    if (beta) {
      await expect(item.locator('.beta-badge'), `"${name}" should show BETA badge`).toBeVisible();
    }
    if (ha) {
      await expect(item.locator('.ha-badge'), `"${name}" should show HA badge`).toBeVisible();
    }
  }

  async expectCloudOnlyFeatureHidden() {
    // byob is v-show gated: attached to the DOM but display:none on OSS/ENT
    const item = this.getFeatureItem(CLOUD_ONLY_FEATURE_NAME);
    await expect(item, `"${CLOUD_ONLY_FEATURE_NAME}" must stay hidden outside Cloud`).toBeHidden();
  }

  // Clicks a locator that triggers window.open and returns the popup's final URL
  // after the o2.ws short link redirects to openobserve.ai.
  //
  // Passing expectedPath keeps this fast: openobserve.ai loads GTM/PostHog/Segment,
  // which beacon continuously, so waitForLoadState('networkidle') rarely settles and
  // burns most of its timeout on every popup. Across 22 links that alone can exceed
  // the test budget. Only a couple of links (sre_agent, ent_install_guide) actually
  // perform a client-side redirect, so instead of paying a blanket idle wait we wait
  // for the URL we expect — it resolves immediately when the link already landed
  // correctly, and only waits for the ones that really do redirect.
  async clickAndCapturePopupUrl(locator, expectedPath) {
    const [popup] = await Promise.all([
      this.page.context().waitForEvent('page', { timeout: 15000 }),
      locator.click(),
    ]);
    try {
      await popup.waitForURL(/openobserve\.ai/, { timeout: 30000 });

      if (expectedPath) {
        await popup
          .waitForURL((url) => url.href.includes(expectedPath), { timeout: 10000 })
          .catch(() => {});
      }

      // Safety net for a genuinely broken link: expectedPath never matched, so settle
      // on a stable URL rather than sampling mid-redirect and reporting a misleading
      // failure. Bounded to ~2s and skipped entirely on the happy path.
      if (!expectedPath || !popup.url().includes(expectedPath)) {
        let previous = popup.url();
        for (let i = 0; i < 4; i++) {
          await popup.waitForTimeout(500);
          const current = popup.url();
          if (current === previous) break;
          previous = current;
        }
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

  async captureFeatureLinkUrl(name, expectedPath) {
    return this.clickAndCapturePopupUrl(this.getFeatureItem(name), expectedPath);
  }
}
