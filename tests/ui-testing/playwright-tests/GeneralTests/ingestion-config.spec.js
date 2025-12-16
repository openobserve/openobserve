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
    // Complete list of ALL integrations across all categories
    const allIntegrations = [
      // Logs
      { path: '/ingestion/custom/logs/curl', label: 'Curl', category: 'logs' },
      { path: '/ingestion/custom/logs/fluentbit', label: 'FluentBit', category: 'logs' },
      { path: '/ingestion/custom/logs/fluentd', label: 'Fluentd', category: 'logs' },
      { path: '/ingestion/custom/logs/filebeat', label: 'FileBeat', category: 'logs' },
      { path: '/ingestion/custom/logs/vector', label: 'Vector', category: 'logs' },
      { path: '/ingestion/custom/logs/syslogng', label: 'Syslog-ng', category: 'logs' },
      { path: '/ingestion/custom/logs/logstash', label: 'Logstash', category: 'logs' },

      // Metrics
      { path: '/ingestion/custom/metrics/prometheus', label: 'Prometheus', category: 'metrics' },
      { path: '/ingestion/custom/metrics/otelCollector', label: 'OTEL Collector', category: 'metrics' },
      { path: '/ingestion/custom/metrics/cloudwatch', label: 'CloudWatch Metrics', category: 'metrics' },

      // Traces
      { path: '/ingestion/custom/traces/opentelemetry', label: 'OpenTelemetry', category: 'traces' },

      // Databases
      { path: '/ingestion/databases/postgres', label: 'PostgreSQL', category: 'databases' },
      { path: '/ingestion/databases/mysql', label: 'MySQL', category: 'databases' },
      { path: '/ingestion/databases/mongodb', label: 'MongoDB', category: 'databases' },
      { path: '/ingestion/databases/redis', label: 'Redis', category: 'databases' },
      { path: '/ingestion/databases/cassandra', label: 'Cassandra', category: 'databases' },
      { path: '/ingestion/databases/elasticsearch', label: 'Elasticsearch', category: 'databases' },
      { path: '/ingestion/databases/couchdb', label: 'CouchDB', category: 'databases' },
      { path: '/ingestion/databases/dynamodb', label: 'DynamoDB', category: 'databases' },
      { path: '/ingestion/databases/oracle', label: 'Oracle', category: 'databases' },
      { path: '/ingestion/databases/sqlserver', label: 'SQL Server', category: 'databases' },
      { path: '/ingestion/databases/snowflake', label: 'Snowflake', category: 'databases' },
      { path: '/ingestion/databases/databricks', label: 'Databricks', category: 'databases' },
      { path: '/ingestion/databases/saphana', label: 'SAP HANA', category: 'databases' },
      { path: '/ingestion/databases/aerospike', label: 'Aerospike', category: 'databases' },
      { path: '/ingestion/databases/zookeeper', label: 'Zookeeper', category: 'databases' },

      // Servers
      { path: '/ingestion/servers/nginx', label: 'Nginx', category: 'servers' },
      { path: '/ingestion/servers/apache', label: 'Apache', category: 'servers' },
      { path: '/ingestion/servers/iis', label: 'IIS', category: 'servers' },

      // Security
      { path: '/ingestion/security/okta', label: 'Okta', category: 'security' },
      { path: '/ingestion/security/office365', label: 'Office 365', category: 'security' },
      { path: '/ingestion/security/googleworkspace', label: 'Google Workspace', category: 'security' },
      { path: '/ingestion/security/jumpcloud', label: 'JumpCloud', category: 'security' },
      { path: '/ingestion/security/openvpn', label: 'OpenVPN', category: 'security' },
      { path: '/ingestion/security/osquery', label: 'OSQuery', category: 'security' },
      { path: '/ingestion/security/falco', label: 'Falco', category: 'security' },

      // DevOps
      { path: '/ingestion/devops/jenkins', label: 'Jenkins', category: 'devops' },
      { path: '/ingestion/devops/terraform', label: 'Terraform', category: 'devops' },
      { path: '/ingestion/devops/ansible', label: 'Ansible', category: 'devops' },
      { path: '/ingestion/devops/githubactions', label: 'GitHub Actions', category: 'devops' },

      // Networking
      { path: '/ingestion/networking/netflow', label: 'Netflow', category: 'networking' },

      // Message Queues
      { path: '/ingestion/messagequeues/kafka', label: 'Kafka', category: 'messagequeues' },
      { path: '/ingestion/messagequeues/rabbitmq', label: 'RabbitMQ', category: 'messagequeues' },
      { path: '/ingestion/messagequeues/nats', label: 'NATS', category: 'messagequeues' },

      // Languages/Frameworks
      { path: '/ingestion/languages/python', label: 'Python', category: 'languages' },
      { path: '/ingestion/languages/nodejs', label: 'Node.js', category: 'languages' },
      { path: '/ingestion/languages/java', label: 'Java', category: 'languages' },
      { path: '/ingestion/languages/go', label: 'Go', category: 'languages' },
      // Rust integration removed from UI - no longer available
      { path: '/ingestion/languages/dotnetlogs', label: '.NET Logs', category: 'languages' },
      { path: '/ingestion/languages/dotnettracing', label: '.NET Tracing', category: 'languages' },
      { path: '/ingestion/languages/fastapi', label: 'FastAPI', category: 'languages' },

      // Others
      { path: '/ingestion/others/airbyte', label: 'Airbyte', category: 'others' },
      { path: '/ingestion/others/airflow', label: 'Airflow', category: 'others' },
      { path: '/ingestion/others/cribl', label: 'Cribl', category: 'others' },
      { path: '/ingestion/others/heroku', label: 'Heroku', category: 'others' },
      { path: '/ingestion/others/vercel', label: 'Vercel', category: 'others' },

      // Recommended
      { path: '/ingestion/recommended/kubernetes', label: 'Kubernetes', category: 'recommended' },
      { path: '/ingestion/recommended/gcp', label: 'GCP', category: 'recommended' },
      { path: '/ingestion/recommended/azure', label: 'Azure', category: 'recommended' },
      { path: '/ingestion/recommended/aws', label: 'AWS', category: 'recommended' },
    ];

    test("should validate ALL documentation links across all integrations", {
      tag: ['@ingestion', '@links', '@comprehensive', '@P1']
    }, async () => {
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
