/**
 * Test data generator for metrics tests
 * Provides realistic metrics data with multiple streams and various metric types
 */

const testLogger = require('./test-logger');

class MetricsTestData {
    constructor() {
        this.streams = {
            'application_metrics': {
                description: 'Application performance metrics',
                metrics: ['http_requests_total', 'http_request_duration_seconds', 'error_rate', 'active_connections']
            },
            'system_metrics': {
                description: 'System resource metrics',
                metrics: ['cpu_usage_percent', 'memory_usage_bytes', 'disk_io_bytes_per_sec', 'network_throughput_mbps']
            },
            'business_metrics': {
                description: 'Business KPI metrics',
                metrics: ['revenue_total', 'orders_per_minute', 'conversion_rate', 'cart_abandonment_rate']
            },
            'infrastructure_metrics': {
                description: 'Infrastructure monitoring metrics',
                metrics: ['node_cpu_seconds_total', 'node_memory_MemTotal_bytes', 'node_disk_read_bytes_total', 'up']
            }
        };

        // Predefined time ranges for testing
        this.timeRanges = {
            'last_5_minutes': { from: 'now-5m', to: 'now' },
            'last_15_minutes': { from: 'now-15m', to: 'now' },
            'last_1_hour': { from: 'now-1h', to: 'now' },
            'last_6_hours': { from: 'now-6h', to: 'now' },
            'last_24_hours': { from: 'now-24h', to: 'now' },
            'last_7_days': { from: 'now-7d', to: 'now' },
            'custom_range': { from: '2024-01-01T00:00:00Z', to: '2024-01-07T23:59:59Z' }
        };

        // Sample PromQL queries for different scenarios
        this.sampleQueries = {
            basic: {
                'simple_metric': 'up',
                'with_label': 'http_requests_total{method="GET"}',
                'all_metrics': '{__name__=~".+"}',
            },
            aggregations: {
                'sum_by_status': 'sum by (status) (rate(http_requests_total[5m]))',
                'avg_cpu': 'avg(cpu_usage_percent)',
                'max_memory': 'max(memory_usage_bytes)',
                'min_response_time': 'min(http_request_duration_seconds)',
                'count_errors': 'count(error_rate > 0.01)',
            },
            functions: {
                'rate_5m': 'rate(http_requests_total[5m])',
                'increase_1h': 'increase(orders_total[1h])',
                'delta_10m': 'delta(revenue_total[10m])',
                'deriv_5m': 'deriv(active_connections[5m])',
                'predict_linear': 'predict_linear(disk_usage_bytes[1h], 3600)',
            },
            histograms: {
                'p95_latency': 'histogram_quantile(0.95, rate(http_request_duration_seconds_bucket[5m]))',
                'p99_latency': 'histogram_quantile(0.99, rate(http_request_duration_seconds_bucket[5m]))',
                'p50_latency': 'histogram_quantile(0.50, rate(http_request_duration_seconds_bucket[5m]))',
            },
            complex: {
                'error_rate_calculation': '100 * sum(rate(http_requests_total{status=~"5.."}[5m])) / sum(rate(http_requests_total[5m]))',
                'cpu_utilization': '100 - (avg by (instance) (rate(node_cpu_seconds_total{mode="idle"}[5m])) * 100)',
                'memory_percentage': '(1 - (node_memory_MemFree_bytes / node_memory_MemTotal_bytes)) * 100',
                'request_rate_comparison': 'rate(http_requests_total[5m]) / rate(http_requests_total[5m] offset 1h)',
            },
            alerts: {
                'high_error_rate': 'rate(http_requests_total{status=~"5.."}[5m]) > 0.05',
                'low_disk_space': 'disk_free_bytes < 10737418240',  // < 10GB
                'high_cpu': 'cpu_usage_percent > 80',
                'memory_pressure': 'memory_usage_bytes / memory_total_bytes > 0.9',
            }
        };

        // SQL queries for metrics (when SQL mode is available)
        this.sqlQueries = {
            basic: {
                'select_all': 'SELECT * FROM metrics LIMIT 100',
                'select_specific': 'SELECT time, value, name FROM metrics WHERE name = "cpu_usage_percent"',
                'with_time_filter': 'SELECT * FROM metrics WHERE time >= now() - interval \'1 hour\'',
            },
            aggregations: {
                'avg_by_name': 'SELECT name, AVG(value) as avg_value FROM metrics GROUP BY name',
                'sum_per_hour': 'SELECT date_trunc(\'hour\', time) as hour, SUM(value) FROM metrics GROUP BY hour',
                'count_by_label': 'SELECT labels, COUNT(*) as count FROM metrics GROUP BY labels',
            },
            complex: {
                'percentiles': 'SELECT percentile_cont(0.95) WITHIN GROUP (ORDER BY value) as p95 FROM metrics',
                'moving_average': 'SELECT time, AVG(value) OVER (ORDER BY time ROWS BETWEEN 4 PRECEDING AND CURRENT ROW) as moving_avg FROM metrics',
                'time_bucket': 'SELECT time_bucket(\'5 minutes\', time) as bucket, AVG(value) FROM metrics GROUP BY bucket',
            }
        };
    }

    /**
     * Generate OTLP metrics for a specific stream
     */
    generateStreamMetrics(streamName, metricCount = 100) {
        const streamConfig = this.streams[streamName];
        if (!streamConfig) {
            throw new Error(`Unknown stream: ${streamName}`);
        }

        const currentTime = Date.now() * 1000000; // nanoseconds
        const metrics = [];

        for (const metricName of streamConfig.metrics) {
            metrics.push(this.generateMetric(metricName, currentTime, metricCount));
        }

        return {
            resourceMetrics: [{
                resource: {
                    attributes: [
                        { key: "service.name", value: { stringValue: streamName } },
                        { key: "service.version", value: { stringValue: "1.0.0" } },
                        { key: "environment", value: { stringValue: "test" } }
                    ]
                },
                scopeMetrics: [{
                    scope: {
                        name: "test-metrics-generator",
                        version: "1.0.0"
                    },
                    metrics: metrics
                }]
            }]
        };
    }

    /**
     * Generate a specific metric based on its name and type
     */
    generateMetric(metricName, timestamp, dataPointCount = 100) {
        // Determine metric type based on name patterns
        if (metricName.endsWith('_total') || metricName.endsWith('_count')) {
            return this.generateCounterMetric(metricName, timestamp, dataPointCount);
        } else if (metricName.endsWith('_seconds') || metricName.endsWith('_duration')) {
            return this.generateHistogramMetric(metricName, timestamp, dataPointCount);
        } else if (metricName.includes('rate') || metricName.includes('percent')) {
            return this.generateGaugeMetric(metricName, timestamp, dataPointCount, 0, 100);
        } else {
            return this.generateGaugeMetric(metricName, timestamp, dataPointCount);
        }
    }

    /**
     * Generate counter metric (monotonically increasing)
     */
    generateCounterMetric(name, timestamp, dataPointCount) {
        const dataPoints = [];
        let value = Math.floor(Math.random() * 1000);

        for (let i = 0; i < dataPointCount; i++) {
            value += Math.floor(Math.random() * 100);
            dataPoints.push({
                timeUnixNano: (timestamp - (dataPointCount - i) * 60000000000).toString(),
                asInt: value.toString(),
                attributes: this.generateAttributes(name)
            });
        }

        return {
            name: name,
            unit: "1",
            sum: {
                aggregationTemporality: 2, // CUMULATIVE
                isMonotonic: true,
                dataPoints: dataPoints
            }
        };
    }

    /**
     * Generate gauge metric
     */
    generateGaugeMetric(name, timestamp, dataPointCount, min = 0, max = 10000) {
        const dataPoints = [];

        for (let i = 0; i < dataPointCount; i++) {
            const value = min + Math.random() * (max - min);
            dataPoints.push({
                timeUnixNano: (timestamp - (dataPointCount - i) * 60000000000).toString(),
                asDouble: value,
                attributes: this.generateAttributes(name)
            });
        }

        return {
            name: name,
            unit: name.includes('bytes') ? 'bytes' : '1',
            gauge: {
                dataPoints: dataPoints
            }
        };
    }

    /**
     * Generate histogram metric
     */
    generateHistogramMetric(name, timestamp, dataPointCount) {
        const dataPoints = [];
        const buckets = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10];

        for (let i = 0; i < dataPointCount; i++) {
            const count = Math.floor(Math.random() * 1000);
            const sum = Math.random() * 1000;
            const bucketCounts = this.generateBucketCounts(count, buckets.length + 1);

            dataPoints.push({
                timeUnixNano: (timestamp - (dataPointCount - i) * 60000000000).toString(),
                count: count.toString(),
                sum: sum,
                bucketCounts: bucketCounts,
                explicitBounds: buckets,
                attributes: this.generateAttributes(name)
            });
        }

        return {
            name: name,
            unit: "s",
            histogram: {
                aggregationTemporality: 2,
                dataPoints: dataPoints
            }
        };
    }

    /**
     * Generate realistic attributes for metrics
     */
    generateAttributes(metricName) {
        const attributes = [];

        // Common attributes
        if (metricName.includes('http')) {
            attributes.push(
                { key: "method", value: { stringValue: ["GET", "POST", "PUT", "DELETE"][Math.floor(Math.random() * 4)] } },
                { key: "status", value: { stringValue: ["200", "201", "400", "404", "500"][Math.floor(Math.random() * 5)] } },
                { key: "endpoint", value: { stringValue: ["/api/users", "/api/products", "/api/orders"][Math.floor(Math.random() * 3)] } }
            );
        }

        // Determine instance format based on metric type
        let instanceValue;
        if (metricName.includes('cpu') || metricName.includes('memory') || metricName.includes('disk')) {
            // Infrastructure metrics use node naming
            instanceValue = `node-${Math.floor(Math.random() * 5)}`;
            attributes.push(
                { key: "region", value: { stringValue: ["us-east-1", "us-west-2", "eu-central-1"][Math.floor(Math.random() * 3)] } },
                { key: "datacenter", value: { stringValue: ["dc1", "dc2", "dc3"][Math.floor(Math.random() * 3)] } }
            );
        } else {
            // Other metrics use localhost:port format for Prometheus compatibility
            instanceValue = `localhost:${8000 + Math.floor(Math.random() * 100)}`;
        }

        if (metricName.includes('business') || metricName.includes('revenue') || metricName.includes('orders')) {
            attributes.push(
                { key: "product_category", value: { stringValue: ["electronics", "clothing", "books", "food"][Math.floor(Math.random() * 4)] } },
                { key: "customer_segment", value: { stringValue: ["premium", "standard", "basic"][Math.floor(Math.random() * 3)] } },
                { key: "channel", value: { stringValue: ["web", "mobile", "api"][Math.floor(Math.random() * 3)] } }
            );
        }

        // Add job and instance for Prometheus compatibility (instance set once based on metric type)
        attributes.push(
            { key: "job", value: { stringValue: "metrics_test" } },
            { key: "instance", value: { stringValue: instanceValue } }
        );

        return attributes;
    }

    /**
     * Generate bucket counts for histogram
     */
    generateBucketCounts(total, bucketCount) {
        const counts = [];
        let remaining = total;

        for (let i = 0; i < bucketCount; i++) {
            const count = i === bucketCount - 1 ? remaining : Math.floor(Math.random() * remaining * 0.3);
            counts.push(count.toString());
            remaining -= count;
        }

        return counts;
    }

    /**
     * Get a random query from a category
     */
    getRandomQuery(category, subcategory) {
        const queries = category === 'sql' ? this.sqlQueries : this.sampleQueries;
        if (!queries[subcategory]) {
            return null;
        }

        const queryKeys = Object.keys(queries[subcategory]);
        const randomKey = queryKeys[Math.floor(Math.random() * queryKeys.length)];
        return {
            name: randomKey,
            query: queries[subcategory][randomKey]
        };
    }

    /**
     * Get queries for testing
     */
    getTestQueries(category) {
        const queries = category === 'sql' ? this.sqlQueries : this.sampleQueries;
        const result = [];

        for (const [subcategory, querySet] of Object.entries(queries)) {
            for (const [name, query] of Object.entries(querySet)) {
                result.push({
                    category: subcategory,
                    name: name,
                    query: query
                });
            }
        }

        return result;
    }
}

module.exports = new MetricsTestData();