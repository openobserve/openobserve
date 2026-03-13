const testLogger = require('./test-logger');

/**
 * OTLP Metrics Ingestion Module for OpenObserve E2E Tests
 * Based on OpenTelemetry metrics format
 */

class MetricsIngestion {
    constructor() {
        // Configuration for local OpenObserve instance
        // Normalize base URL to avoid double slashes
        const baseUrl = (process.env.ZO_BASE_URL || 'http://localhost:5080').replace(/\/$/, ''); // Remove trailing slash if present
        const orgName = process.env.ORGNAME || 'default';

        // If METRICS_ENDPOINT is provided, normalize it too
        let endpoint = process.env.METRICS_ENDPOINT;
        if (endpoint) {
            // Normalize the endpoint to avoid double slashes
            endpoint = endpoint.replace(/\/+/g, '/').replace('http:/', 'http://').replace('https:/', 'https://');
        } else {
            endpoint = `${baseUrl}/api/${orgName}/v1/metrics`;
        }

        // Require environment variables - no fallback credentials
        if (!process.env.ZO_ROOT_USER_EMAIL || !process.env.ZO_ROOT_USER_PASSWORD) {
            throw new Error('ZO_ROOT_USER_EMAIL and ZO_ROOT_USER_PASSWORD environment variables must be set');
        }

        this.config = {
            endpoint: endpoint,
            username: process.env.ZO_ROOT_USER_EMAIL,
            password: process.env.ZO_ROOT_USER_PASSWORD,
            orgId: orgName,
            streamName: 'default'
        };

        // External configuration (if needed) - requires env vars
        this.externalConfig = {
            endpoint: process.env.METRICS_EXTERNAL_ENDPOINT || '',
            username: process.env.METRICS_EXTERNAL_USERNAME || '',
            password: process.env.METRICS_EXTERNAL_PASSWORD || '',
            orgId: process.env.METRICS_EXTERNAL_ORG_ID || '',
            streamName: process.env.METRICS_EXTERNAL_STREAM || 'default'
        };
    }

    /**
     * Generate random attributes for testing
     */
    generateRandomAttributes(count) {
        const attributes = [];
        for (let i = 0; i < count; i++) {
            const fieldName = `field_${i}`;
            const randomType = Math.floor(Math.random() * 3);

            const attribute = {
                key: fieldName,
                value: {}
            };

            if (randomType === 0) {
                // String value
                attribute.value.stringValue = `value_${Math.random().toString(36).substring(7)}`;
            } else if (randomType === 1) {
                // Integer value
                attribute.value.intValue = Math.floor(Math.random() * 10000);
            } else {
                // Boolean value
                attribute.value.boolValue = Math.random() < 0.5;
            }

            attributes.push(attribute);
        }
        return attributes;
    }

    /**
     * Generate OTLP metrics payload
     */
    generateOTLPMetrics() {
        const currentTime = Date.now() * 1000000; // Convert to nanoseconds

        // Dynamic service names and regions for variety
        const serviceNames = [
            'api-gateway',
            'auth-service',
            'payment-processor',
            'user-service',
            'notification-service',
            'analytics-engine',
            'inventory-service',
            'order-service',
            'search-service'
        ];

        const regions = [
            'us-east-1',
            'us-west-2',
            'eu-central-1',
            'ap-southeast-1',
            'ap-northeast-1',
            'eu-west-1',
            'us-central-1',
            'ap-south-1'
        ];

        const environments = ['production', 'staging', 'development', 'qa'];
        const hostNames = ['server-01', 'server-02', 'server-03', 'node-01', 'node-02', 'instance-01', 'instance-02'];
        const jobs = ['api-server', 'web-server', 'background-worker', 'scheduler', 'monitor', 'metrics-collector'];

        // Randomly select values for this batch
        const serviceName = serviceNames[Math.floor(Math.random() * serviceNames.length)];
        const region = regions[Math.floor(Math.random() * regions.length)];
        const environment = environments[Math.floor(Math.random() * environments.length)];
        const hostName = hostNames[Math.floor(Math.random() * hostNames.length)];
        const job = jobs[Math.floor(Math.random() * jobs.length)];

        // Generate multiple metrics with realistic values
        const cpuValue = Math.floor(25 + Math.random() * 50); // CPU between 25-75% (integer)
        const memoryValue = Math.floor(4096 + Math.random() * 4096); // Memory between 4-8 GB (integer)
        const requestCount = Math.floor(100 + Math.random() * 900); // 100-1000 requests
        const requestDuration = Math.floor(50 + Math.random() * 450); // 50-500ms (integer)

        // Dynamic up metric value - 90% chance of being up (1), 10% chance of being down (0)
        const upValue = Math.random() > 0.1 ? 1 : 0;

        return {
            resourceMetrics: [
                {
                    resource: {
                        attributes: [
                            {
                                key: "service.name",
                                value: { stringValue: serviceName }
                            },
                            {
                                key: "service.version",
                                value: { stringValue: "1.0.0" }
                            },
                            {
                                key: "environment",
                                value: { stringValue: environment }
                            },
                            {
                                key: "host.name",
                                value: { stringValue: hostName }
                            },
                            {
                                key: "region",
                                value: { stringValue: region }
                            }
                        ],
                        droppedAttributesCount: 0
                    },
                    schemaUrl: "https://opentelemetry.io/schemas/1.21.0",
                    scopeMetrics: [
                        {
                            scope: {
                                name: "opentelemetry-instrumentation",
                                version: "1.0.0",
                                attributes: [],
                                droppedAttributesCount: 0
                            },
                            schemaUrl: "https://opentelemetry.io/schemas/1.21.0",
                            metrics: [
                                // 1. UP metric - standard Prometheus metric with dynamic value
                                {
                                    name: "up",
                                    unit: "1",
                                    gauge: {
                                        dataPoints: [
                                            {
                                                timeUnixNano: currentTime.toString(),
                                                asDouble: upValue,  // Dynamic value: 0 or 1
                                                attributes: [
                                                    {
                                                        key: "job",
                                                        value: { stringValue: job }
                                                    },
                                                    {
                                                        key: "instance",
                                                        value: { stringValue: `${hostName}:8080` }
                                                    }
                                                ]
                                            }
                                        ]
                                    }
                                },
                                // 2. CPU usage metric - with dynamic attributes
                                {
                                    name: "cpu_usage",
                                    unit: "percent",
                                    gauge: {
                                        dataPoints: [
                                            {
                                                timeUnixNano: currentTime.toString(),
                                                asDouble: cpuValue,
                                                attributes: [
                                                    {
                                                        key: "node",
                                                        value: { stringValue: hostName }
                                                    },
                                                    {
                                                        key: "instance",
                                                        value: { stringValue: `${hostName}:8080` }
                                                    },
                                                    {
                                                        key: "region",
                                                        value: { stringValue: region }
                                                    }
                                                ]
                                            }
                                        ]
                                    }
                                },
                                // 3. Memory usage metric - with dynamic attributes
                                {
                                    name: "memory_usage",
                                    unit: "MB",
                                    gauge: {
                                        dataPoints: [
                                            {
                                                timeUnixNano: currentTime.toString(),
                                                asDouble: memoryValue,
                                                attributes: [
                                                    {
                                                        key: "node",
                                                        value: { stringValue: hostName }
                                                    },
                                                    {
                                                        key: "instance",
                                                        value: { stringValue: `${hostName}:8080` }
                                                    },
                                                    {
                                                        key: "region",
                                                        value: { stringValue: region }
                                                    }
                                                ]
                                            }
                                        ]
                                    }
                                },
                                // 4. Request count - with dynamic attributes
                                {
                                    name: "request_count",
                                    unit: "count",
                                    gauge: {
                                        dataPoints: [
                                            {
                                                timeUnixNano: currentTime.toString(),
                                                asDouble: requestCount,
                                                attributes: [
                                                    {
                                                        key: "node",
                                                        value: { stringValue: hostName }
                                                    },
                                                    {
                                                        key: "service",
                                                        value: { stringValue: serviceName }
                                                    },
                                                    {
                                                        key: "region",
                                                        value: { stringValue: region }
                                                    }
                                                ]
                                            }
                                        ]
                                    }
                                },
                                // 5. Request duration - with dynamic attributes
                                {
                                    name: "request_duration",
                                    unit: "ms",
                                    gauge: {
                                        dataPoints: [
                                            {
                                                timeUnixNano: currentTime.toString(),
                                                asDouble: requestDuration,
                                                attributes: [
                                                    {
                                                        key: "node",
                                                        value: { stringValue: hostName }
                                                    },
                                                    {
                                                        key: "instance",
                                                        value: { stringValue: `${hostName}:8080` }
                                                    },
                                                    {
                                                        key: "service",
                                                        value: { stringValue: serviceName }
                                                    },
                                                    {
                                                        key: "region",
                                                        value: { stringValue: region }
                                                    }
                                                ]
                                            }
                                        ]
                                    }
                                }
                            ]
                        }
                    ]
                }
            ]
        };
    }

    /**
     * Generate bucket counts for histogram
     */
    generateBucketCounts(totalCount) {
        const buckets = [];
        let remaining = totalCount;
        const numBuckets = 12; // 11 explicit bounds + 1 for +Inf

        for (let i = 0; i < numBuckets; i++) {
            const count = i === numBuckets - 1 ? remaining : Math.floor(Math.random() * remaining * 0.3);
            buckets.push(count.toString());
            remaining -= count;
        }

        return buckets;
    }

    /**
     * Check if the metrics endpoint is healthy
     */
    async checkEndpointHealth(config) {
        try {
            const auth = Buffer.from(`${config.username}:${config.password}`).toString('base64');

            // Try a simple GET to the base API endpoint
            const baseUrl = config.endpoint.replace('/v1/metrics', '');
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 5000);

            const response = await fetch(baseUrl, {
                method: 'GET',
                headers: {
                    'Authorization': `Basic ${auth}`
                },
                signal: controller.signal
            });

            clearTimeout(timeoutId);

            // Any response (even 404) means the server is responding
            return true;
        } catch (error) {
            if (error.name === 'AbortError') {
                testLogger.debug('Endpoint health check timed out');
            } else {
                testLogger.debug('Endpoint health check failed', { error: error.message });
            }
            return false;
        }
    }

    /**
     * Wait for endpoint to be ready with exponential backoff
     */
    async waitForEndpoint(config, maxRetries = 10, initialDelay = 1000) {
        let delay = initialDelay;

        for (let i = 0; i < maxRetries; i++) {
            testLogger.debug(`Checking endpoint health (attempt ${i + 1}/${maxRetries})`);

            const isHealthy = await this.checkEndpointHealth(config);
            if (isHealthy) {
                testLogger.info('Metrics endpoint is ready');
                return true;
            }

            if (i < maxRetries - 1) {
                testLogger.debug(`Endpoint not ready, waiting ${delay}ms before retry`);
                await new Promise(resolve => setTimeout(resolve, delay));
                delay = Math.min(delay * 1.5, 10000); // Exponential backoff, max 10 seconds
            }
        }

        testLogger.error('Metrics endpoint did not become ready after all retries');
        return false;
    }

    /**
     * Send metrics to OpenObserve using OTLP format with retry logic
     */
    async sendMetrics(metricsData, useExternal = false, maxRetries = 3) {
        const config = useExternal ? this.externalConfig : this.config;
        const auth = Buffer.from(`${config.username}:${config.password}`).toString('base64');

        let lastError = null;
        let retryDelay = 500;

        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            try {
                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), 10000); // 10 second timeout

                const response = await fetch(config.endpoint, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Basic ${auth}`,
                        'organization': config.orgId,
                        'stream-name': config.streamName
                    },
                    body: JSON.stringify(metricsData),
                    signal: controller.signal
                });

                clearTimeout(timeoutId);

                const responseText = await response.text();
                let responseData = null;
                try {
                    responseData = responseText ? JSON.parse(responseText) : null;
                } catch (e) {
                    responseData = responseText;
                }

                if (!response.ok) {
                    lastError = new Error(`HTTP ${response.status}: ${responseText}`);

                    // Don't retry on client errors (4xx) except 429 (rate limit)
                    if (response.status >= 400 && response.status < 500 && response.status !== 429) {
                        testLogger.debug(`Client error, not retrying`, {
                            status: response.status,
                            attempt: attempt
                        });
                        break;
                    }

                    // Retry on server errors or rate limits
                    if (attempt < maxRetries) {
                        testLogger.debug(`Request failed, retrying (${attempt}/${maxRetries})`, {
                            status: response.status,
                            delay: retryDelay
                        });
                        await new Promise(resolve => setTimeout(resolve, retryDelay));
                        retryDelay = Math.min(retryDelay * 2, 5000); // Exponential backoff
                        continue;
                    }
                } else {
                    // Success!
                    return {
                        success: true,
                        status: response.status,
                        data: responseData
                    };
                }
            } catch (error) {
                lastError = error;

                if (error.name === 'AbortError') {
                    lastError = new Error('Request timeout after 10 seconds');
                }

                if (attempt < maxRetries) {
                    testLogger.debug(`Request error, retrying (${attempt}/${maxRetries})`, {
                        error: error.message,
                        delay: retryDelay
                    });
                    await new Promise(resolve => setTimeout(resolve, retryDelay));
                    retryDelay = Math.min(retryDelay * 2, 5000);
                    continue;
                }
            }
        }

        // All retries failed
        testLogger.error('Failed to send metrics after all retries', {
            error: lastError?.message || 'Unknown error',
            endpoint: config.endpoint
        });
        return {
            success: false,
            error: lastError?.message || 'Unknown error'
        };
    }

    /**
     * Ingest test metrics - main entry point
     */
    async ingestTestMetrics(options = {}) {
        const {
            iterations = 5,
            delay = 1000,
            useExternal = false
        } = options;

        testLogger.info('Starting OTLP metrics ingestion', {
            iterations,
            delay,
            destination: useExternal ? 'external' : 'local'
        });

        const results = [];

        for (let i = 0; i < iterations; i++) {
            testLogger.info(`Generating metrics batch ${i + 1}/${iterations}`);

            // Generate OTLP metrics
            const metricsData = this.generateOTLPMetrics();

            // Send metrics
            const result = await this.sendMetrics(metricsData, useExternal);
            results.push(result);

            if (result.success) {
                testLogger.info(`Successfully sent metrics batch ${i + 1}`, {
                    status: result.status
                });
            } else {
                testLogger.error(`Failed to send metrics batch ${i + 1}`, {
                    error: result.error
                });
            }

            // Wait before next batch
            if (i < iterations - 1) {
                await new Promise(resolve => setTimeout(resolve, delay));
            }
        }

        const successCount = results.filter(r => r.success).length;
        testLogger.info('Metrics ingestion completed', {
            total: iterations,
            successful: successCount,
            failed: iterations - successCount
        });

        return {
            success: successCount > 0,
            totalBatches: iterations,
            successfulBatches: successCount,
            results
        };
    }

    /**
     * Continuous metrics ingestion
     * Uses while loop with await to prevent overlapping executions
     */
    async ingestContinuously(durationMs = 60000, intervalMs = 5000) {
        testLogger.info('Starting continuous OTLP metrics ingestion', {
            duration: `${durationMs}ms`,
            interval: `${intervalMs}ms`
        });

        const startTime = Date.now();
        let batchCount = 0;
        let successCount = 0;

        while (Date.now() - startTime < durationMs) {
            batchCount++;
            const metricsData = this.generateOTLPMetrics();
            const result = await this.sendMetrics(metricsData);

            if (result.success) {
                successCount++;
                testLogger.debug(`Continuous batch ${batchCount} sent successfully`);
            } else {
                testLogger.error(`Continuous batch ${batchCount} failed`);
            }

            // Wait for interval before next iteration (only if we're not done)
            if (Date.now() - startTime < durationMs) {
                await new Promise(resolve => setTimeout(resolve, intervalMs));
            }
        }

        testLogger.info('Continuous metrics ingestion completed', {
            batches: batchCount,
            successful: successCount
        });

        return {
            success: successCount > 0,
            totalBatches: batchCount,
            successfulBatches: successCount
        };
    }

    /**
     * Run as CLI tool when invoked directly
     */
    async runCLI() {
        // Parse command line arguments
        const args = process.argv.slice(2);
        const continuous = args.includes('--continuous');
        const useExternal = args.includes('--external');
        const iterations = parseInt(args.find(arg => arg.startsWith('--iterations='))?.split('=')[1] || '5');
        const duration = parseInt(args.find(arg => arg.startsWith('--duration='))?.split('=')[1] || '60000');

        testLogger.info('============================================');
        testLogger.info('OpenObserve OTLP Metrics Ingestion Tool');
        testLogger.info('============================================');
        testLogger.info(`Mode: ${continuous ? 'Continuous' : 'Batch'}`);
        testLogger.info(`Target: ${useExternal ? 'External' : 'Local'} OpenObserve instance`);

        // Display metrics that will be sent
        testLogger.info('Metrics to be ingested:', {
            metrics: [
                'up (gauge) - PromQL compatible with dynamic values',
                'cpu_usage (gauge) - CPU usage percentage',
                'memory_usage (gauge) - Memory usage in MB',
                'request_count (gauge) - Request counter',
                'request_duration (gauge) - Request duration in ms'
            ]
        });

        if (continuous) {
            testLogger.info('Continuous ingestion settings:', {
                duration: `${duration}ms`,
                interval: '5000ms'
            });
            testLogger.info('Starting continuous metrics ingestion...');

            try {
                const result = await this.ingestContinuously(duration, 5000);
                testLogger.info('============================================');
                testLogger.info('Continuous ingestion completed', {
                    totalBatches: result.totalBatches,
                    successfulBatches: result.successfulBatches,
                    successRate: `${(result.successfulBatches / result.totalBatches * 100).toFixed(1)}%`
                });
                testLogger.info('============================================');
                process.exit(0);
            } catch (error) {
                testLogger.error('Continuous ingestion failed', { error: error.message });
                process.exit(1);
            }
        } else {
            testLogger.info('Batch ingestion settings:', {
                iterations: iterations,
                delay: '100ms between batches'
            });

            // Function to show progress
            let sentCount = 0;

            // Run batch ingestion with progress
            try {
                const results = [];
                const startTime = Date.now();

                for (let i = 0; i < iterations; i++) {
                    sentCount++;

                    // Show progress every 10 iterations or on first/last
                    if (i === 0 || i === iterations - 1 || (i + 1) % 10 === 0) {
                        testLogger.info(`Sending metrics batch ${i + 1} of ${iterations}`);
                    }

                    // Generate and send metrics
                    const metricsData = this.generateOTLPMetrics();
                    const result = await this.sendMetrics(metricsData, useExternal);
                    results.push(result);

                    if (!result.success && i < 5) {
                        // Show first few errors for debugging
                        testLogger.warn(`Batch ${i + 1} failed`, { error: result.error });
                    }

                    // Small delay between batches (100ms like the shell script)
                    await new Promise(resolve => setTimeout(resolve, 100));
                }

                const successCount = results.filter(r => r.success).length;
                const elapsedTime = ((Date.now() - startTime) / 1000).toFixed(1);

                testLogger.info('============================================');
                if (successCount === iterations) {
                    testLogger.info(`All ${iterations} metrics sent successfully!`);
                } else {
                    testLogger.info('Batch ingestion completed', {
                        totalBatches: iterations,
                        successful: successCount,
                        failed: iterations - successCount,
                        successRate: `${(successCount / iterations * 100).toFixed(1)}%`
                    });
                }
                testLogger.info(`Total time: ${elapsedTime}s`);
                testLogger.info('============================================');

                if (successCount > 0) {
                    testLogger.info('View metrics in OpenObserve:', {
                        instructions: [
                            '1. Navigate to Metrics page',
                            '2. Try these queries:',
                            '   - up',
                            '   - cpu_usage',
                            '   - memory_usage',
                            '   - request_count',
                            '   - request_duration'
                        ]
                    });
                }

                process.exit(successCount > 0 ? 0 : 1);
            } catch (error) {
                testLogger.error('Batch ingestion failed', { error: error.message });
                process.exit(1);
            }
        }
    }
}

// Create singleton instance
const metricsIngestion = new MetricsIngestion();

// Handle graceful shutdown when running as CLI
if (require.main === module) {
    process.on('SIGINT', () => {
        testLogger.info('Ingestion interrupted by user');
        process.exit(0);
    });

    process.on('SIGTERM', () => {
        testLogger.info('Ingestion terminated');
        process.exit(0);
    });

    // Run CLI
    metricsIngestion.runCLI();
}

module.exports = metricsIngestion;