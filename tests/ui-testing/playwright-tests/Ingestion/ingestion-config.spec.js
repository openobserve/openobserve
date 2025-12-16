const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const PageManager = require('../../pages/page-manager.js');

test.describe("Ingestion Configuration Tests", () => {
  test.describe.configure({ mode: 'parallel' });
  let pm;

  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);

    await navigateToBase(page);
    pm = new PageManager(page);

    await page.waitForLoadState('domcontentloaded');
    testLogger.info('Ingestion configuration test setup completed');
  });

  test.describe("Ingestion Navigation", () => {
    test("should navigate to Recommended ingestion page", {
      tag: ['@ingestion', '@navigation', '@P0']
    }, async () => {
      testLogger.info('Testing navigation to Recommended ingestion page');

      const orgId = process.env["ORGNAME"];
      await pm.ingestionConfigPage.navigateToRecommended(orgId);
      await pm.ingestionConfigPage.expectRecommendedPageLoaded();

      testLogger.info('Recommended ingestion page loaded successfully');
    });

    test("should navigate to Custom/Logs ingestion parent page", {
      tag: ['@ingestion', '@logs', '@P0']
    }, async () => {
      testLogger.info('Testing navigation to Custom/Logs ingestion page');

      const orgId = process.env["ORGNAME"];
      await pm.ingestionConfigPage.navigateToCustom(orgId);
      await pm.ingestionConfigPage.expectLogsPageLoaded();

      testLogger.info('Logs ingestion page loaded with integration options');
    });

    test("should navigate to Custom/Metrics ingestion parent page", {
      tag: ['@ingestion', '@metrics', '@P0']
    }, async () => {
      testLogger.info('Testing navigation to Custom/Metrics ingestion page');

      const orgId = process.env["ORGNAME"];
      await pm.ingestionConfigPage.navigateToCustom(orgId);
      await pm.ingestionConfigPage.clickMetricsTab();
      await pm.ingestionConfigPage.expectMetricsPageLoaded();

      testLogger.info('Metrics ingestion page loaded with integration options');
    });
  });

  test.describe("Copy Functionality", () => {
    test("should copy Fluentd configuration to clipboard", {
      tag: ['@ingestion', '@copy', '@P1']
    }, async () => {
      testLogger.info('Testing copy functionality for Fluentd configuration');

      const orgId = process.env["ORGNAME"];
      await pm.ingestionConfigPage.navigateToIntegration('/ingestion/custom/logs/fluentd', orgId);

      const contentText = await pm.ingestionConfigPage.getContentText();
      await pm.ingestionConfigPage.expectContentLength(0);
      testLogger.info(`Configuration content displayed (${contentText.length} chars)`);

      await pm.ingestionConfigPage.clickCopyButton();
      await pm.ingestionConfigPage.verifyNotificationVisible('Copied Successfully');

      testLogger.info('Copy button clicked, notification displayed');
    });

    test("should copy Prometheus configuration to clipboard", {
      tag: ['@ingestion', '@copy', '@P1']
    }, async () => {
      testLogger.info('Testing copy functionality for Prometheus configuration');

      const orgId = process.env["ORGNAME"];
      await pm.ingestionConfigPage.navigateToIntegration('/ingestion/custom/metrics/prometheus', orgId);

      const contentText = await pm.ingestionConfigPage.getContentText();
      expect(contentText).toBeTruthy();

      await pm.ingestionConfigPage.clickCopyButton();
      await pm.ingestionConfigPage.verifyNotificationVisible();

      testLogger.info('Prometheus configuration copied successfully');
    });
  });

  test.describe("Configuration Content", () => {
    const integrationSamples = [
      { category: 'logs', name: 'fluentd', path: '/ingestion/custom/logs/fluentd', label: 'Fluentd' },
      { category: 'logs', name: 'curl', path: '/ingestion/custom/logs/curl', label: 'Curl' },
      { category: 'metrics', name: 'prometheus', path: '/ingestion/custom/metrics/prometheus', label: 'Prometheus' },
      { category: 'metrics', name: 'otelCollector', path: '/ingestion/custom/metrics/otelCollector', label: 'OTEL Collector' },
      { category: 'recommended', name: 'kubernetes', path: '/ingestion/recommended/kubernetes', label: 'Kubernetes' },
      { category: 'databases', name: 'postgres', path: '/ingestion/databases/postgres', label: 'PostgreSQL' },
    ];

    for (const integration of integrationSamples) {
      test(`should display ${integration.label} configuration with org identifier`, {
        tag: ['@ingestion', `@${integration.category}`, '@content', '@P1']
      }, async () => {
        testLogger.info(`Testing configuration display for ${integration.label}`);

        const orgId = process.env["ORGNAME"];
        await pm.ingestionConfigPage.navigateToIntegration(integration.path, orgId);

        await pm.ingestionConfigPage.verifyCopyButtonVisible();
        await pm.ingestionConfigPage.verifyContentVisible();
        await pm.ingestionConfigPage.expectContentLength(10);

        const containsOrgId = await pm.ingestionConfigPage.expectContentContainsOrgId(orgId);
        if (containsOrgId) {
          testLogger.info(`✓ Configuration contains org identifier for ${integration.label}`);
        }

        testLogger.info(`${integration.label} configuration displayed successfully`);
      });
    }
  });

  test.describe("Recommended Page Features", () => {
    test("should search and filter recommended integrations", {
      tag: ['@ingestion', '@search', '@P2']
    }, async () => {
      testLogger.info('Testing search functionality in Recommended page');

      const orgId = process.env["ORGNAME"];
      await pm.ingestionConfigPage.navigateToRecommended(orgId);
      await pm.ingestionConfigPage.verifySearchInputVisible();

      const initialCount = await pm.ingestionConfigPage.getRouteTabCount();
      testLogger.info(`Initial recommended integrations count: ${initialCount}`);

      await pm.ingestionConfigPage.fillSearchInput('kubernetes');

      const filteredCount = await pm.ingestionConfigPage.getRouteTabCount();
      expect(filteredCount).toBeLessThanOrEqual(initialCount);
      testLogger.info(`Filtered results count: ${filteredCount}`);

      await pm.ingestionConfigPage.clearSearchInput();

      const finalCount = await pm.ingestionConfigPage.getRouteTabCount();
      expect(finalCount).toBe(initialCount);

      testLogger.info('Search and filter functionality working correctly');
    });
  });

  test.describe("Content Scrolling and Display", () => {
    test("should scroll through Kubernetes configuration content", {
      tag: ['@ingestion', '@scroll', '@P2']
    }, async ({ page }) => {
      testLogger.info('Testing scroll behavior for Kubernetes configuration');

      const orgId = process.env["ORGNAME"];
      await pm.ingestionConfigPage.navigateToIntegration('/ingestion/recommended/kubernetes', orgId);

      await pm.ingestionConfigPage.verifyContentVisible();

      // Get initial scroll dimensions
      const scrollHeight = await pm.ingestionConfigPage.getContentScrollHeight();
      const clientHeight = await pm.ingestionConfigPage.getContentClientHeight();
      testLogger.info(`Content dimensions - scrollHeight: ${scrollHeight}, clientHeight: ${clientHeight}`);

      // Check if content is scrollable (for long configurations)
      const isScrollable = await pm.ingestionConfigPage.isContentScrollable();
      if (isScrollable) {
        testLogger.info('✓ Configuration content is scrollable');

        // Scroll to bottom
        await pm.ingestionConfigPage.scrollContentToBottom();
        await page.waitForTimeout(500);

        testLogger.info('✓ Successfully scrolled to bottom of configuration');
      } else {
        testLogger.info('✓ Configuration content fits without scrolling');
      }

      testLogger.info('Scroll test completed successfully');
    });
  });

  test.describe("Documentation Links", () => {
    const integrationsWithLinks = [
      { path: '/ingestion/custom/logs/fluentbit', label: 'FluentBit', category: 'logs' },
      { path: '/ingestion/custom/logs/fluentd', label: 'Fluentd', category: 'logs' },
      { path: '/ingestion/custom/metrics/prometheus', label: 'Prometheus', category: 'metrics' },
      { path: '/ingestion/databases/postgres', label: 'PostgreSQL', category: 'databases' },
      { path: '/ingestion/databases/mysql', label: 'MySQL', category: 'databases' },
      { path: '/ingestion/servers/nginx', label: 'Nginx', category: 'servers' },
      { path: '/ingestion/servers/apache', label: 'Apache', category: 'servers' },
      { path: '/ingestion/recommended/gcp', label: 'GCP', category: 'recommended' },
      { path: '/ingestion/recommended/azure', label: 'Azure', category: 'recommended' },
    ];

    for (const integration of integrationsWithLinks) {
      test(`should verify ${integration.label} documentation links are accessible`, {
        tag: ['@ingestion', '@links', `@${integration.category}`, '@P1']
      }, async () => {
        testLogger.info(`Testing documentation links for ${integration.label}`);

        const orgId = process.env["ORGNAME"];
        await pm.ingestionConfigPage.navigateToIntegration(integration.path, orgId);

        // Get all documentation links on this page
        const linkCount = await pm.ingestionConfigPage.getDocumentationLinkCount();
        testLogger.info(`Found ${linkCount} documentation link(s) on ${integration.label} page`);

        if (linkCount === 0) {
          testLogger.info(`ℹ No documentation links found for ${integration.label}`);
          return;
        }

        // Check HTTP status for all links
        const linkResults = await pm.ingestionConfigPage.getAllDocumentationLinksStatus();

        let brokenLinks = 0;
        for (const result of linkResults) {
          if (result.ok) {
            testLogger.info(`✓ Link ${result.index + 1}: ${result.url} - Status: ${result.status}`);
          } else {
            testLogger.info(`✗ Link ${result.index + 1}: ${result.url} - Status: ${result.status || result.error}`);
            brokenLinks++;
          }
        }

        // Assert all links are working
        expect(brokenLinks).toBe(0);

        testLogger.info(`${integration.label} documentation links validation completed - ${linkResults.length} links checked`);
      });
    }

    test("should report all broken documentation links across integrations", {
      tag: ['@ingestion', '@links', '@comprehensive', '@P1']
    }, async () => {
      testLogger.info('Comprehensive documentation link validation across all tested integrations');

      const orgId = process.env["ORGNAME"];
      const allBrokenLinks = [];

      for (const integration of integrationsWithLinks) {
        await pm.ingestionConfigPage.navigateToIntegration(integration.path, orgId);

        const linkCount = await pm.ingestionConfigPage.getDocumentationLinkCount();

        if (linkCount > 0) {
          const linkResults = await pm.ingestionConfigPage.getAllDocumentationLinksStatus();

          const broken = linkResults.filter(r => !r.ok);
          if (broken.length > 0) {
            allBrokenLinks.push({
              integration: integration.label,
              path: integration.path,
              brokenLinks: broken
            });
          }
        }
      }

      // Log all broken links
      if (allBrokenLinks.length > 0) {
        testLogger.info('=== BROKEN LINKS FOUND ===');
        for (const item of allBrokenLinks) {
          testLogger.info(`\n${item.integration} (${item.path}):`);
          for (const link of item.brokenLinks) {
            testLogger.info(`  ✗ ${link.url} - Status: ${link.status || link.error}`);
          }
        }
        testLogger.info('\n=========================');
      } else {
        testLogger.info('✓ All documentation links are working correctly!');
      }

      // Fail test if any broken links found
      expect(allBrokenLinks.length).toBe(0);

      testLogger.info('Comprehensive link validation completed');
    });
  });

  test.afterEach(async () => {
    testLogger.info('Ingestion configuration test completed');
  });
});
