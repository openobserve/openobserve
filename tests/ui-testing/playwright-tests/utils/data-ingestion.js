const testLogger = require('./test-logger.js');
const logsdata = require("../../../test-data/logs_data.json");

/**
 * Ingest test data into a stream via API
 * @param {import('@playwright/test').Page} page - Playwright page object
 * @param {string} streamName - Name of the stream to ingest data into (default: "e2e_automate")
 * @returns {Promise<object>} - API response
 */
async function ingestTestData(page, streamName = "e2e_automate") {
  const orgId = process.env["ORGNAME"];
  const basicAuthCredentials = Buffer.from(
    `${process.env["ZO_ROOT_USER_EMAIL"]}:${process.env["ZO_ROOT_USER_PASSWORD"]}`
  ).toString('base64');

  const headers = {
    "Authorization": `Basic ${basicAuthCredentials}`,
    "Content-Type": "application/json",
  };

  const response = await page.evaluate(async ({ url, headers, orgId, streamName, logsdata }) => {
    const fetchResponse = await fetch(`${url}/api/${orgId}/${streamName}/_json`, {
      method: 'POST',
      headers: headers,
      body: JSON.stringify(logsdata)
    });
    return await fetchResponse.json();
  }, {
    url: process.env.INGESTION_URL,
    headers: headers,
    orgId: orgId,
    streamName: streamName,
    logsdata: logsdata
  });

  testLogger.debug('Test data ingestion response', { response, streamName });
  return response;
}

/**
 * Ingest metrics data for testing matrix charts and metrics visualization
 * Uses the correct _json?type=metrics endpoint as recommended for CI
 * @param {import('@playwright/test').Page} page - Playwright page object
 * @param {string} streamName - Name of the metric stream (default: "e2e_metrics")
 * @param {Array} metricsData - Optional custom metrics data array
 * @returns {Promise<object>} - API response
 */
async function ingestMetricsData(page, streamName = "e2e_metrics", metricsData = null) {
  const orgId = process.env["ORGNAME"];
  const basicAuthCredentials = Buffer.from(
    `${process.env["ZO_ROOT_USER_EMAIL"]}:${process.env["ZO_ROOT_USER_PASSWORD"]}`
  ).toString('base64');

  const headers = {
    "Authorization": `Basic ${basicAuthCredentials}`,
    "Content-Type": "application/json",
  };

  // Default metrics data if none provided
  const defaultMetricsData = generateDefaultMetricsData();
  const dataToIngest = metricsData || defaultMetricsData;

  const response = await page.evaluate(async ({ url, headers, orgId, streamName, metricsData }) => {
    const baseUrl = url.endsWith('/') ? url.slice(0, -1) : url;
    // IMPORTANT: Use ?type=metrics query parameter for metrics ingestion
    const fetchResponse = await fetch(`${baseUrl}/api/${orgId}/${streamName}/_json?type=metrics`, {
      method: 'POST',
      headers: headers,
      body: JSON.stringify(metricsData)
    });

    let data = null;
    const contentType = fetchResponse.headers.get('content-type');
    if (contentType && contentType.includes('application/json')) {
      try {
        const text = await fetchResponse.text();
        data = text ? JSON.parse(text) : null;
      } catch (e) {
        data = { error: 'Failed to parse JSON response', text: await fetchResponse.text() };
      }
    } else {
      data = { text: await fetchResponse.text() };
    }

    return {
      status: fetchResponse.status,
      data: data
    };
  }, {
    url: process.env.INGESTION_URL,
    headers: headers,
    orgId: orgId,
    streamName: streamName,
    metricsData: dataToIngest
  });

  testLogger.debug('Metrics data ingestion response', {
    response,
    streamName,
    metricsCount: dataToIngest.length
  });

  return response;
}

/**
 * Generate default metrics data for testing
 * Creates sample metrics with proper __name__, __type__, _timestamp, and value fields
 * Timestamps are in MICROSECONDS (not milliseconds) as required by OpenObserve
 * @returns {Array} - Array of metric objects
 */
function generateDefaultMetricsData() {
  const nowMicros = Date.now() * 1000; // Convert milliseconds to microseconds
  const metricsData = [];

  // Generate cpu_usage metrics
  for (let i = 0; i < 10; i++) {
    metricsData.push({
      "__name__": "cpu_usage",
      "__type__": "gauge",
      "namespace": "default",
      "pod_name": `pod-${i % 3}`,
      "container": `container-${i % 2}`,
      "environment": "ci",
      "host_name": "ci-runner-01",
      "_timestamp": nowMicros - (i * 60000000), // 1 minute intervals in microseconds
      "value": 50 + Math.random() * 50 // Random value between 50-100
    });
  }

  // Generate memory_usage metrics
  for (let i = 0; i < 10; i++) {
    metricsData.push({
      "__name__": "memory_usage",
      "__type__": "gauge",
      "namespace": "default",
      "pod_name": `pod-${i % 3}`,
      "container": `container-${i % 2}`,
      "environment": "ci",
      "host_name": "ci-runner-01",
      "_timestamp": nowMicros - (i * 60000000),
      "value": 100 + Math.random() * 100 // Random value between 100-200
    });
  }

  // Generate request_count metrics (counter)
  for (let i = 0; i < 10; i++) {
    metricsData.push({
      "__name__": "request_count",
      "__type__": "counter",
      "method": i % 2 === 0 ? "GET" : "POST",
      "status": i % 3 === 0 ? "200" : "404",
      "endpoint": `/api/v${i % 3 + 1}`,
      "environment": "ci",
      "service_name": "api",
      "_timestamp": nowMicros - (i * 60000000),
      "value": i * 10 // Monotonically increasing for counters
    });
  }

  // Generate cadvisor_version_info metric (for compatibility with existing tests)
  metricsData.push({
    "__name__": "cadvisor_version_info",
    "__type__": "gauge",
    "cadvisorRevision": "test-revision",
    "cadvisorVersion": "v0.47.0",
    "dockerVersion": "20.10.0",
    "kernelVersion": "5.10.0",
    "environment": "ci",
    "_timestamp": nowMicros,
    "value": 1
  });

  return metricsData;
}

/**
 * Generate custom metrics data with specific parameters
 * @param {string} metricName - Name of the metric (__name__ field)
 * @param {string} metricType - Type: gauge, counter, histogram, summary
 * @param {Object} labels - Key-value pairs for metric labels
 * @param {number} count - Number of data points to generate
 * @param {number} intervalMs - Time interval between points in milliseconds
 * @returns {Array} - Array of metric objects
 */
function generateCustomMetrics(metricName, metricType, labels = {}, count = 10, intervalMs = 60000) {
  const nowMicros = Date.now() * 1000; // Convert to microseconds
  const intervalMicros = intervalMs * 1000; // Convert interval to microseconds
  const metricsData = [];

  for (let i = 0; i < count; i++) {
    const metric = {
      "__name__": metricName,
      "__type__": metricType,
      ...labels,
      "environment": "ci", // Add CI tag
      "_timestamp": nowMicros - (i * intervalMicros),
      "value": metricType === "counter"
        ? i * 10 // Monotonically increasing for counters
        : Math.random() * 100 // Random for gauges
    };
    metricsData.push(metric);
  }

  return metricsData;
}

module.exports = {
  ingestTestData,
  ingestMetricsData,
  generateDefaultMetricsData,
  generateCustomMetrics
};
