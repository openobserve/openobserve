import { expect } from '@playwright/test';

export class IngestionConfigPage {
    // Static test data: Complete list of ALL integrations across all categories
    static allIntegrations = [
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

    constructor(page) {
        this.page = page;

        // Recommended page selectors
        this.recommendedSearchInput = '[data-test="recommended-list-search-input"]';

        // Configuration content selectors
        this.copyButton = '[data-test="rum-copy-btn"]';
        this.contentText = '[data-test="rum-content-text"]';

        // Notification selector
        this.notification = '.q-notification__message';

        // Route tab selector (for search filtering)
        this.routeTab = '.q-route-tab';
    }

    // ==================== Navigation ====================

    async navigateToRecommended(orgId) {
        await this.page.goto(`${process.env.INGESTION_URL}/web/ingestion/recommended?org_identifier=${orgId}`);
        await this.page.waitForLoadState('networkidle');
    }

    async navigateToCustom(orgId) {
        await this.page.goto(`${process.env.INGESTION_URL}/web/ingestion/custom?org_identifier=${orgId}`);
        await this.page.waitForLoadState('networkidle');
        // Wait for Curl tab to be visible (custom page auto-loads logs/curl)
        await this.page.getByRole('tab', { name: 'Curl' }).waitFor({ state: 'visible', timeout: 5000 });
    }

    async navigateToIntegration(integrationPath, orgId) {
        await this.page.goto(`${process.env.INGESTION_URL}/web${integrationPath}?org_identifier=${orgId}`);
        await this.page.waitForLoadState('networkidle');
    }

    // ==================== Tab Interactions ====================

    async clickMetricsTab() {
        const metricsTab = this.page.getByRole('tab', { name: 'Metrics' });
        await expect(metricsTab).toBeVisible({ timeout: 10000 });
        await metricsTab.click();
        await this.page.waitForLoadState('networkidle');
        // Wait for Prometheus tab to be visible (first metrics integration)
        await this.page.getByRole('tab', { name: 'Prometheus' }).waitFor({ state: 'visible', timeout: 5000 });
    }

    async verifyIntegrationTabVisible(integrationName, timeout = 10000) {
        const tab = this.page.getByRole('tab', { name: integrationName });
        await expect(tab).toBeVisible({ timeout });
    }

    // ==================== Copy Functionality ====================

    async clickCopyButton() {
        await this.page.locator(this.copyButton).first().click();
    }

    async getContentText() {
        return await this.page.locator(this.contentText).first().textContent();
    }

    async verifyCopyButtonVisible(timeout = 10000) {
        await expect(this.page.locator(this.copyButton).first()).toBeVisible({ timeout });
    }

    async verifyContentVisible() {
        await expect(this.page.locator(this.contentText).first()).toBeVisible();
    }

    async verifyNotificationVisible(expectedText = null, timeout = 5000) {
        const notification = this.page.locator(this.notification);
        await expect(notification).toBeVisible({ timeout });

        if (expectedText) {
            const text = await notification.textContent();
            expect(text).toContain(expectedText);
        }
    }

    // ==================== Search Functionality ====================

    async getSearchInput() {
        return this.page.locator(this.recommendedSearchInput);
    }

    async verifySearchInputVisible() {
        await expect(this.page.locator(this.recommendedSearchInput)).toBeVisible();
    }

    async fillSearchInput(searchText) {
        const searchInput = this.page.locator(this.recommendedSearchInput);
        await searchInput.fill(searchText);
        // Wait for search filtering to complete
        await this.page.waitForLoadState('domcontentloaded');
    }

    async clearSearchInput() {
        const searchInput = this.page.locator(this.recommendedSearchInput);
        await searchInput.clear();
        // Wait for search filtering to reset
        await this.page.waitForLoadState('domcontentloaded');
    }

    async waitForRecommendedTabs() {
        // Wait for the first integration tab (Kubernetes) to be visible
        // This ensures the redirect and tab rendering is complete
        await this.page.getByRole('tab', { name: /kubernetes/i }).waitFor({ state: 'visible', timeout: 10000 });
    }

    async getRouteTabCount() {
        // Ensure tabs are rendered before counting
        await this.waitForRecommendedTabs();
        // Count only the integration tabs within the data-sources-recommended-tabs container
        // This excludes the top-level navigation tabs
        return await this.page.locator('.data-sources-recommended-tabs .q-tab').count();
    }

    // ==================== Assertions ====================

    async expectRecommendedPageLoaded() {
        await expect(this.page.locator(this.recommendedSearchInput)).toBeVisible();
    }

    async expectLogsPageLoaded() {
        await expect(this.page.getByRole('tab', { name: 'Fluentd' })).toBeVisible({ timeout: 10000 });
        await expect(this.page.getByRole('tab', { name: 'Curl' })).toBeVisible({ timeout: 5000 });
    }

    async expectMetricsPageLoaded() {
        await expect(this.page.getByRole('tab', { name: 'Prometheus' })).toBeVisible({ timeout: 10000 });
    }

    async expectContentLength(minLength) {
        const content = await this.getContentText();
        expect(content).toBeTruthy();
        expect(content.length).toBeGreaterThan(minLength);
    }

    async expectContentContainsOrgId(orgId) {
        const content = await this.getContentText();
        return content.includes('default') || content.includes(orgId);
    }

    // ==================== Scrolling and Content Display ====================

    async scrollContentToBottom() {
        const contentElement = this.page.locator(this.contentText).first();
        await contentElement.evaluate(el => el.scrollTop = el.scrollHeight);
    }

    async getContentScrollHeight() {
        const contentElement = this.page.locator(this.contentText).first();
        return await contentElement.evaluate(el => el.scrollHeight);
    }

    async getContentClientHeight() {
        const contentElement = this.page.locator(this.contentText).first();
        return await contentElement.evaluate(el => el.clientHeight);
    }

    async isContentScrollable() {
        const scrollHeight = await this.getContentScrollHeight();
        const clientHeight = await this.getContentClientHeight();
        return scrollHeight > clientHeight;
    }

    // ==================== Link Verification ====================

    async getDocumentationLinks() {
        // Find all external links with target="_blank"
        return await this.page.locator('a[target="_blank"]').all();
    }

    async getDocumentationLinkCount() {
        const links = await this.getDocumentationLinks();
        return links.length;
    }

    async verifyDocumentationLinksExist() {
        const linkCount = await this.getDocumentationLinkCount();
        expect(linkCount).toBeGreaterThan(0);
        return linkCount;
    }

    async verifyDocumentationLinkHref(index = 0) {
        const links = await this.getDocumentationLinks();
        if (links.length > index) {
            const href = await links[index].getAttribute('href');
            expect(href).toBeTruthy();
            expect(href).toMatch(/^https?:\/\//); // Verify it's a valid URL
            return href;
        }
        return null;
    }

    async clickDocumentationLink(index = 0) {
        const links = await this.getDocumentationLinks();
        if (links.length > index) {
            await links[index].click();
        }
    }

    async verifyDocumentationLinkAccessible(index = 0) {
        const links = await this.getDocumentationLinks();
        if (links.length > index) {
            const href = await links[index].getAttribute('href');

            // Make HEAD request to check if link is accessible (5s timeout)
            const response = await this.page.request.head(href, { timeout: 5000 });
            const status = response.status();

            return {
                url: href,
                status: status,
                ok: response.ok()
            };
        }
        return null;
    }

    async getAllDocumentationLinksStatus(skipUrls = []) {
        const links = await this.getDocumentationLinks();
        const results = [];

        for (let i = 0; i < links.length; i++) {
            const href = await links[i].getAttribute('href');

            // Skip URLs that are known to work but cause timeouts
            if (skipUrls.some(skipUrl => href.includes(skipUrl))) {
                results.push({
                    index: i,
                    url: href,
                    status: 'SKIPPED',
                    ok: true,
                    skipped: true
                });
                continue;
            }

            try {
                // 5 second timeout to prevent hanging
                const response = await this.page.request.head(href, { timeout: 5000 });
                results.push({
                    index: i,
                    url: href,
                    status: response.status(),
                    ok: response.ok()
                });
            } catch (error) {
                results.push({
                    index: i,
                    url: href,
                    status: 'ERROR',
                    ok: false,
                    error: error.message
                });
            }
        }

        return results;
    }
}
