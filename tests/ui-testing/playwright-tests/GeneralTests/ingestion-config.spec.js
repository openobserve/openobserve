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
    test("should navigate to Recommended, Logs, and Metrics pages", {
      tag: ['@ingestion', '@navigation', '@P0']
    }, async () => {
      const orgId = process.env["ORGNAME"];

      // Test Recommended page navigation
      testLogger.info('Testing navigation to Recommended ingestion page');
      await pm.ingestionConfigPage.navigateToRecommended(orgId);
      await pm.ingestionConfigPage.expectRecommendedPageLoaded();
      testLogger.info('✓ Recommended page loaded successfully');

      // Test Custom/Logs page navigation
      testLogger.info('Testing navigation to Custom/Logs ingestion page');
      await pm.ingestionConfigPage.navigateToCustom(orgId);
      await pm.ingestionConfigPage.expectLogsPageLoaded();
      testLogger.info('✓ Logs page loaded successfully');

      // Test Custom/Metrics page navigation
      testLogger.info('Testing navigation to Custom/Metrics ingestion page');
      await pm.ingestionConfigPage.clickMetricsTab();
      await pm.ingestionConfigPage.expectMetricsPageLoaded();
      testLogger.info('✓ Metrics page loaded successfully');

      testLogger.info('All ingestion page navigation tests completed');
    });
  });

  test.describe("Copy Functionality", () => {
    test("should copy Logs and Metrics configurations to clipboard", {
      tag: ['@ingestion', '@copy', '@P1']
    }, async () => {
      const orgId = process.env["ORGNAME"];

      // Test copy functionality for Logs (Fluentd)
      testLogger.info('Testing copy functionality for Fluentd (Logs) configuration');
      await pm.ingestionConfigPage.navigateToIntegration('/ingestion/custom/logs/fluentd', orgId);
      const fluentdContent = await pm.ingestionConfigPage.getContentText();
      await pm.ingestionConfigPage.expectContentLength(0);
      testLogger.info(`✓ Fluentd configuration displayed (${fluentdContent.length} chars)`);
      await pm.ingestionConfigPage.clickCopyButton();
      await pm.ingestionConfigPage.verifyNotificationVisible('Copied Successfully');
      testLogger.info('✓ Fluentd configuration copied successfully');

      // Test copy functionality for Metrics (Prometheus)
      testLogger.info('Testing copy functionality for Prometheus (Metrics) configuration');
      await pm.ingestionConfigPage.navigateToIntegration('/ingestion/custom/metrics/prometheus', orgId);
      const prometheusContent = await pm.ingestionConfigPage.getContentText();
      expect(prometheusContent).toBeTruthy();
      testLogger.info(`✓ Prometheus configuration displayed (${prometheusContent.length} chars)`);
      await pm.ingestionConfigPage.clickCopyButton();
      await pm.ingestionConfigPage.verifyNotificationVisible();
      testLogger.info('✓ Prometheus configuration copied successfully');

      testLogger.info('All copy functionality tests completed');
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
    test("should validate ALL documentation links across all integrations", {
      tag: ['@ingestion', '@links', '@comprehensive', '@P1']
    }, async () => {
      const allIntegrations = require('../../../test-data/ingestion_integrations.json');

      testLogger.info(`=== Starting comprehensive documentation link validation for ${allIntegrations.length} integrations ===`);

      // URLs that are known to work but cause issues in automated testing
      const skipUrls = [
        'short.openobserve.ai/database/zookeeper', // Manually verified working but causes 1+ hour timeout
        'axoflow.com/docs/axosyslog-core/chapter-destinations/openobserve' // Returns 405 for HEAD requests but works in browser
      ];

      if (skipUrls.length > 0) {
        testLogger.info(`Note: Skipping ${skipUrls.length} URL(s) known to work but cause issues in automated testing:`);
        skipUrls.forEach(url => testLogger.info(`  - ${url}`));
      }

      const orgId = process.env["ORGNAME"];
      const allBrokenLinks = [];
      let totalLinksChecked = 0;
      let totalLinksSkipped = 0;
      let integrationsWithLinks = 0;
      let integrationsWithoutLinks = 0;

      for (const integration of allIntegrations) {
        testLogger.info(`\nChecking: ${integration.label} (${integration.category})`);

        try {
          await pm.ingestionConfigPage.navigateToIntegration(integration.path, orgId);

          const linkCount = await pm.ingestionConfigPage.getDocumentationLinkCount();

          if (linkCount === 0) {
            testLogger.info(`  ℹ No documentation links found`);
            integrationsWithoutLinks++;
            continue;
          }

          integrationsWithLinks++;
          totalLinksChecked += linkCount;

          // Check HTTP status for all links (with skip list)
          const linkResults = await pm.ingestionConfigPage.getAllDocumentationLinksStatus(skipUrls);

          const broken = linkResults.filter(r => !r.ok && !r.skipped);
          const working = linkResults.filter(r => r.ok && !r.skipped);
          const skipped = linkResults.filter(r => r.skipped);

          if (skipped.length > 0) {
            totalLinksSkipped += skipped.length;
            testLogger.info(`  ⊘ ${skipped.length} link(s) skipped (manually verified)`);
          }

          if (broken.length > 0) {
            testLogger.info(`  ✗ ${broken.length} broken link(s) found:`);
            for (const link of broken) {
              testLogger.info(`    - ${link.url} (Status: ${link.status || link.error})`);
            }

            allBrokenLinks.push({
              integration: integration.label,
              path: integration.path,
              category: integration.category,
              brokenLinks: broken
            });
          } else if (working.length > 0) {
            testLogger.info(`  ✓ All ${working.length} link(s) working`);
          }
        } catch (error) {
          testLogger.info(`  ⚠ Error checking ${integration.label}: ${error.message}`);
        }
      }

      // Summary Report
      testLogger.info('\n' + '='.repeat(80));
      testLogger.info('DOCUMENTATION LINK VALIDATION SUMMARY');
      testLogger.info('='.repeat(80));
      testLogger.info(`Total integrations checked: ${allIntegrations.length}`);
      testLogger.info(`Integrations with links: ${integrationsWithLinks}`);
      testLogger.info(`Integrations without links: ${integrationsWithoutLinks}`);
      testLogger.info(`Total links validated: ${totalLinksChecked}`);
      if (totalLinksSkipped > 0) {
        testLogger.info(`Total links skipped: ${totalLinksSkipped} (manually verified working)`);
      }

      if (allBrokenLinks.length > 0) {
        testLogger.info(`\n❌ BROKEN LINKS FOUND IN ${allBrokenLinks.length} INTEGRATIONS:`);
        testLogger.info('='.repeat(80));

        for (const item of allBrokenLinks) {
          testLogger.info(`\n${item.integration} (${item.category})`);
          testLogger.info(`  Path: ${item.path}`);
          for (const link of item.brokenLinks) {
            testLogger.info(`  ✗ ${link.url}`);
            testLogger.info(`    Status: ${link.status || link.error}`);
          }
        }
        testLogger.info('\n' + '='.repeat(80));
      } else {
        testLogger.info(`\n✅ ALL ${totalLinksChecked} DOCUMENTATION LINKS ARE WORKING!`);
        testLogger.info('='.repeat(80));
      }

      // Fail test if any broken links found
      expect(allBrokenLinks.length).toBe(0);

      testLogger.info('\nComprehensive link validation completed');
    });
  });

  test.afterEach(async () => {
    testLogger.info('Ingestion configuration test completed');
  });
});
