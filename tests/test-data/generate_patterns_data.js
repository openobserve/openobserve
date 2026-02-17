// Script to generate pattern-rich test data for Search Patterns E2E tests
// Run with: node generate_patterns_data.js
//
// This script generates logs similar to production K8s/application logs
// with patterns that will be detected by the pattern extraction system

const fs = require('fs');
const path = require('path');

const baseTimestamp = Date.now() * 1000; // microseconds
const logs = [];

// Helper to generate ISO timestamp
function isoTimestamp(offset = 0) {
    return new Date(Date.now() + offset).toISOString().replace('T', 'T').replace(/\.\d{3}Z$/, 'Z');
}

// Kubernetes metadata templates
const k8sMetadata = {
    namespace: ['ziox', 'monitoring', 'default', 'kube-system', 'ingress-nginx'],
    podPrefix: ['ziox-querier', 'ziox-ingester', 'prometheus-k8s', 'nginx-ingress', 'coredns'],
    container: ['ziox', 'prometheus', 'nginx', 'coredns', 'sidecar'],
    host: ['ip-10-2-15-197.us-east-2.compute.internal', 'ip-10-2-50-35.us-east-2.compute.internal', 'ip-10-2-56-159.us-east-2.compute.internal'],
    role: ['querier', 'ingester', 'router', 'compactor', 'alertmanager']
};

// Log levels
const levels = ['INFO', 'DEBUG', 'WARN', 'ERROR', 'TRACE'];

// Pattern 1: AWS credentials provider (2000 logs)
const awsModules = ['aws_config::default_provider::credentials', 'aws_config::meta::credentials', 'aws_sdk_s3::client'];
for (let i = 0; i < 2000; i++) {
    const module = awsModules[i % awsModules.length];
    logs.push({
        _timestamp: baseTimestamp + (i * 1000),
        log: `[${isoTimestamp(i * 1000)} INFO  ${module}] provide_credentials; provider=default_chain`,
        stream: 'stderr',
        kubernetes_namespace_name: k8sMetadata.namespace[i % k8sMetadata.namespace.length],
        kubernetes_pod_name: `${k8sMetadata.podPrefix[i % k8sMetadata.podPrefix.length]}-${Math.random().toString(36).substring(2, 12)}`,
        kubernetes_container_name: k8sMetadata.container[i % k8sMetadata.container.length],
        kubernetes_host: k8sMetadata.host[i % k8sMetadata.host.length]
    });
}

// Pattern 2: Search/query operations (2000 logs)
const searchFiles = ['default', 'metrics', 'traces', 'logs', 'events'];
const orgs = ['Bhargav_organization_29', 'default_org', 'production', 'staging', 'test_org'];
for (let i = 0; i < 2000; i++) {
    const file = searchFiles[i % searchFiles.length];
    const org = orgs[i % orgs.length];
    const fileId = Math.floor(Math.random() * 9999999999999999999);
    logs.push({
        _timestamp: baseTimestamp + (2000000 + i * 1000),
        log: `[${isoTimestamp(2000000 + i * 1000)} INFO  zinc_enl::service::search::datafusion] search file: ${org}/logs/${file}/2022/12/26/20/${fileId}.parquet, need add columns: ["from"]`,
        stream: 'stderr',
        kubernetes_namespace_name: k8sMetadata.namespace[i % k8sMetadata.namespace.length],
        kubernetes_pod_name: `${k8sMetadata.podPrefix[i % k8sMetadata.podPrefix.length]}-${Math.random().toString(36).substring(2, 12)}`,
        kubernetes_container_name: k8sMetadata.container[i % k8sMetadata.container.length],
        kubernetes_host: k8sMetadata.host[i % k8sMetadata.host.length]
    });
}

// Pattern 3: HTTP request handling (1500 logs)
const endpoints = ['/api/v1/logs', '/api/v1/metrics', '/api/v1/traces', '/api/_search', '/api/_bulk'];
const methods = ['POST', 'GET', 'PUT', 'DELETE'];
const statusCodes = [200, 201, 204, 400, 401, 403, 404, 500, 503];
for (let i = 0; i < 1500; i++) {
    const endpoint = endpoints[i % endpoints.length];
    const method = methods[i % methods.length];
    const status = statusCodes[i % statusCodes.length];
    const duration = Math.floor(Math.random() * 500) + 1;
    logs.push({
        _timestamp: baseTimestamp + (4000000 + i * 1000),
        log: `[${isoTimestamp(4000000 + i * 1000)} INFO  actix_web::middleware::logger] ${method} ${endpoint} ${status} ${duration}ms`,
        stream: 'stderr',
        kubernetes_namespace_name: k8sMetadata.namespace[i % k8sMetadata.namespace.length],
        kubernetes_pod_name: `${k8sMetadata.podPrefix[i % k8sMetadata.podPrefix.length]}-${Math.random().toString(36).substring(2, 12)}`,
        kubernetes_container_name: k8sMetadata.container[i % k8sMetadata.container.length],
        kubernetes_host: k8sMetadata.host[i % k8sMetadata.host.length]
    });
}

// Pattern 4: Database/storage operations (1500 logs)
const dbOps = ['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MERGE'];
const tables = ['streams', 'users', 'organizations', 'alerts', 'dashboards'];
for (let i = 0; i < 1500; i++) {
    const op = dbOps[i % dbOps.length];
    const table = tables[i % tables.length];
    const rows = Math.floor(Math.random() * 1000) + 1;
    const duration = Math.floor(Math.random() * 100) + 1;
    logs.push({
        _timestamp: baseTimestamp + (5500000 + i * 1000),
        log: `[${isoTimestamp(5500000 + i * 1000)} DEBUG sqlx::query] ${op} FROM ${table} returned ${rows} rows in ${duration}ms`,
        stream: 'stderr',
        kubernetes_namespace_name: k8sMetadata.namespace[i % k8sMetadata.namespace.length],
        kubernetes_pod_name: `${k8sMetadata.podPrefix[i % k8sMetadata.podPrefix.length]}-${Math.random().toString(36).substring(2, 12)}`,
        kubernetes_container_name: k8sMetadata.container[i % k8sMetadata.container.length],
        kubernetes_host: k8sMetadata.host[i % k8sMetadata.host.length]
    });
}

// Pattern 5: gRPC/connection events (1000 logs)
const grpcServices = ['ingester', 'querier', 'router', 'compactor', 'alertmanager'];
const grpcEvents = ['connected', 'disconnected', 'request_received', 'response_sent', 'stream_opened'];
for (let i = 0; i < 1000; i++) {
    const service = grpcServices[i % grpcServices.length];
    const event = grpcEvents[i % grpcEvents.length];
    const clientId = Math.random().toString(36).substring(2, 10);
    logs.push({
        _timestamp: baseTimestamp + (7000000 + i * 1000),
        log: `[${isoTimestamp(7000000 + i * 1000)} INFO  tonic::transport::server] grpc ${service} ${event} client_id=${clientId}`,
        stream: 'stderr',
        kubernetes_namespace_name: k8sMetadata.namespace[i % k8sMetadata.namespace.length],
        kubernetes_pod_name: `${k8sMetadata.podPrefix[i % k8sMetadata.podPrefix.length]}-${Math.random().toString(36).substring(2, 12)}`,
        kubernetes_container_name: k8sMetadata.container[i % k8sMetadata.container.length],
        kubernetes_host: k8sMetadata.host[i % k8sMetadata.host.length]
    });
}

// Pattern 6: Error/warning logs (1000 logs)
const errorTypes = ['ConnectionError', 'TimeoutError', 'ValidationError', 'AuthenticationError', 'RateLimitError'];
const errorMessages = [
    'failed to connect to upstream',
    'request timeout after 30s',
    'invalid request payload',
    'authentication token expired',
    'rate limit exceeded for client'
];
for (let i = 0; i < 1000; i++) {
    const errType = errorTypes[i % errorTypes.length];
    const errMsg = errorMessages[i % errorMessages.length];
    const level = i % 3 === 0 ? 'ERROR' : 'WARN';
    logs.push({
        _timestamp: baseTimestamp + (8000000 + i * 1000),
        log: `[${isoTimestamp(8000000 + i * 1000)} ${level} zinc_enl::handler::http] ${errType}: ${errMsg}`,
        stream: 'stderr',
        kubernetes_namespace_name: k8sMetadata.namespace[i % k8sMetadata.namespace.length],
        kubernetes_pod_name: `${k8sMetadata.podPrefix[i % k8sMetadata.podPrefix.length]}-${Math.random().toString(36).substring(2, 12)}`,
        kubernetes_container_name: k8sMetadata.container[i % k8sMetadata.container.length],
        kubernetes_host: k8sMetadata.host[i % k8sMetadata.host.length]
    });
}

// Pattern 7: Metrics/telemetry (500 logs)
const metricNames = ['http_requests_total', 'query_duration_seconds', 'ingestion_bytes_total', 'active_connections', 'memory_usage_bytes'];
for (let i = 0; i < 500; i++) {
    const metric = metricNames[i % metricNames.length];
    const value = Math.floor(Math.random() * 10000);
    logs.push({
        _timestamp: baseTimestamp + (9000000 + i * 1000),
        log: `[${isoTimestamp(9000000 + i * 1000)} DEBUG metrics::reporter] recorded metric ${metric} value=${value}`,
        stream: 'stderr',
        kubernetes_namespace_name: k8sMetadata.namespace[i % k8sMetadata.namespace.length],
        kubernetes_pod_name: `${k8sMetadata.podPrefix[i % k8sMetadata.podPrefix.length]}-${Math.random().toString(36).substring(2, 12)}`,
        kubernetes_container_name: k8sMetadata.container[i % k8sMetadata.container.length],
        kubernetes_host: k8sMetadata.host[i % k8sMetadata.host.length]
    });
}

// Pattern 8: Cache operations (500 logs)
const cacheOps = ['get', 'set', 'delete', 'expire', 'hit', 'miss'];
const cacheKeys = ['user:session', 'org:config', 'stream:schema', 'query:result', 'auth:token'];
for (let i = 0; i < 500; i++) {
    const op = cacheOps[i % cacheOps.length];
    const key = cacheKeys[i % cacheKeys.length];
    const keyId = Math.floor(Math.random() * 10000);
    logs.push({
        _timestamp: baseTimestamp + (9500000 + i * 1000),
        log: `[${isoTimestamp(9500000 + i * 1000)} TRACE cache::redis] cache ${op} key=${key}:${keyId}`,
        stream: 'stderr',
        kubernetes_namespace_name: k8sMetadata.namespace[i % k8sMetadata.namespace.length],
        kubernetes_pod_name: `${k8sMetadata.podPrefix[i % k8sMetadata.podPrefix.length]}-${Math.random().toString(36).substring(2, 12)}`,
        kubernetes_container_name: k8sMetadata.container[i % k8sMetadata.container.length],
        kubernetes_host: k8sMetadata.host[i % k8sMetadata.host.length]
    });
}

// Shuffle logs to mix patterns
for (let i = logs.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [logs[i], logs[j]] = [logs[j], logs[i]];
}

// Re-assign timestamps after shuffle to maintain time ordering
logs.forEach((log, index) => {
    log._timestamp = baseTimestamp + (index * 1000);
});

console.log(`Generated ${logs.length} logs with 8 distinct patterns`);
console.log('Patterns:');
console.log('1. AWS credentials provider (2000 logs)');
console.log('2. Search/query operations (2000 logs)');
console.log('3. HTTP request handling (1500 logs)');
console.log('4. Database/storage operations (1500 logs)');
console.log('5. gRPC/connection events (1000 logs)');
console.log('6. Error/warning logs (1000 logs)');
console.log('7. Metrics/telemetry (500 logs)');
console.log('8. Cache operations (500 logs)');
console.log(`Total: ${logs.length} logs`);

// Write to JSON file
const outputPath = path.join(__dirname, 'patterns_test_data.json');
fs.writeFileSync(outputPath, JSON.stringify(logs, null, 2));
console.log(`\nWritten to: ${outputPath}`);
