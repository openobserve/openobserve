# Metrics Ingestion for OpenObserve Tests

## Overview
The metrics ingestion module provides a unified way to send OTLP (OpenTelemetry Protocol) format metrics to OpenObserve for testing purposes.

## File Location
- **Main Module**: `playwright-tests/utils/metrics-ingestion.js`
  - Works both as a module for tests and as a standalone CLI tool

## Usage

### As a Module in Tests
```javascript
const metricsIngestion = require('./utils/metrics-ingestion');

// Ingest test metrics
await metricsIngestion.ingestTestMetrics({
  iterations: 10,
  delay: 1000
});
```

### As a CLI Tool
```bash
# From ui-testing directory

# Send 5 batches (default)
node playwright-tests/utils/metrics-ingestion.js

# Send 100 batches
node playwright-tests/utils/metrics-ingestion.js --iterations=100

# Continuous mode for 60 seconds
node playwright-tests/utils/metrics-ingestion.js --continuous --duration=60000

# Send to external instance
node playwright-tests/utils/metrics-ingestion.js --external
```

## Metrics Generated
The module generates the following dynamic metrics:
1. **up** - Service availability (0 or 1, 90% probability of being up)
2. **cpu_usage** - CPU usage percentage (25-75%)
3. **memory_usage** - Memory usage in MB (4096-8192)
4. **request_count** - Request counter (100-1000)
5. **request_duration** - Request duration in ms (50-500)

## Dynamic Attributes
Each metric includes dynamic attributes that change with each batch:
- **Service Names**: api-gateway, auth-service, payment-processor, user-service, etc.
- **Regions**: us-east-1, us-west-2, eu-central-1, ap-southeast-1, etc.
- **Environments**: production, staging, development, qa
- **Host Names**: server-01, server-02, node-01, instance-01, etc.
- **Jobs**: api-server, web-server, background-worker, scheduler, etc.

## Configuration
The module uses environment variables from the test environment:
- `ZO_BASE_URL` - OpenObserve base URL (default: http://localhost:5080)
- `ORGNAME` - Organization name (default: default)
- `ZO_ROOT_USER_EMAIL` - Authentication username
- `ZO_ROOT_USER_PASSWORD` - Authentication password

## Features
- **Automatic URL normalization** - Prevents double slash issues
- **Integer-only values** - All metric values are integers to ensure compatibility
- **Retry logic** - Built-in retry mechanism for failed requests
- **Progress tracking** - Shows ingestion progress for batch operations
- **Graceful shutdown** - Handles SIGINT and SIGTERM signals