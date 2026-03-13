/**
 * Trace ingestion utility for E2E tests
 * Generates and ingests distributed traces for testing purposes
 */

const crypto = require('crypto');
const testLogger = require('./test-logger.js');

/**
 * Generate a random hex string of specified byte length
 * @param {number} bytes - Number of bytes
 * @returns {string} Hex string
 */
function generateHexId(bytes) {
  return crypto.randomBytes(bytes).toString('hex');
}

/**
 * Get current timestamp in nanoseconds
 * @returns {string} Timestamp in nanoseconds
 */
function getTimestampNs() {
  return String(Date.now() * 1000000);
}

/**
 * Generate a single distributed trace
 * @param {number} iteration - Trace iteration number
 * @returns {Object} OTLP trace data
 */
function generateTrace(iteration) {
  // Generate IDs
  const traceId = generateHexId(16);
  const rootSpanId = generateHexId(8);
  const clientSpanId = generateHexId(8);
  const serverSpanId = generateHexId(8);

  const startTime = getTimestampNs();

  // Randomly choose scenario
  const scenarios = [
    {
      scenario: "success",
      httpStatus: 200,
      spanStatus: 1, // OK
      errorMessage: "",
      operationName: "get_orders",
      frontendService: "api-gateway",
      backendService: "order-service",
      duration: 150000000 // 150ms
    },
    {
      scenario: "success",
      httpStatus: 200,
      spanStatus: 1,
      errorMessage: "",
      operationName: "process_payment",
      frontendService: "api-gateway",
      backendService: "payment-service",
      duration: 800000000 // 800ms
    },
    {
      scenario: "database_error",
      httpStatus: 500,
      spanStatus: 2, // ERROR
      errorMessage: "Database connection failed",
      operationName: "database_query",
      frontendService: "api-gateway",
      backendService: "user-service",
      duration: 5000000000 // 5 seconds
    },
    {
      scenario: "not_found",
      httpStatus: 404,
      spanStatus: 2,
      errorMessage: "Resource not found",
      operationName: "get_user_profile",
      frontendService: "api-gateway",
      backendService: "profile-service",
      duration: 200000000 // 200ms
    },
    {
      scenario: "auth_error",
      httpStatus: 401,
      spanStatus: 2,
      errorMessage: "Invalid authentication token",
      operationName: "authenticate_user",
      frontendService: "api-gateway",
      backendService: "auth-service",
      duration: 500000000 // 500ms
    }
  ];

  const selected = scenarios[Math.floor(Math.random() * scenarios.length)];

  // Calculate timestamps for distributed trace spans
  const clientStart = Number(startTime) + 1000000;
  const serverStart = clientStart + 2000000;
  const serverEnd = serverStart + selected.duration;
  const clientEnd = serverEnd + 1000000;
  const rootEnd = clientEnd + 500000;

  // Build error events if it's an error scenario
  const errorEvents = selected.spanStatus === 2 ? [
    {
      timeUnixNano: String(serverStart + 1000000),
      name: "exception",
      attributes: [
        {
          key: "exception.type",
          value: { stringValue: selected.scenario }
        },
        {
          key: "exception.message",
          value: { stringValue: selected.errorMessage }
        }
      ]
    }
  ] : [];

  // Build status for errors
  const status = selected.spanStatus === 2
    ? { code: selected.spanStatus, message: selected.errorMessage }
    : { code: selected.spanStatus };

  // Create distributed trace payload
  const traceData = {
    resourceSpans: [
      {
        resource: {
          attributes: [
            { key: "service.name", value: { stringValue: selected.frontendService } },
            { key: "service.version", value: { stringValue: "1.0.0" } },
            { key: "environment", value: { stringValue: "test" } },
            { key: "test.iteration", value: { intValue: iteration } }
          ]
        },
        scopeSpans: [
          {
            scope: {
              name: "opentelemetry-instrumentation",
              version: "1.0.0"
            },
            spans: [
              {
                traceId: traceId,
                spanId: rootSpanId,
                name: `HTTP POST /${selected.operationName}`,
                kind: 2, // SERVER
                startTimeUnixNano: String(startTime),
                endTimeUnixNano: String(rootEnd),
                attributes: [
                  { key: "http.method", value: { stringValue: "POST" } },
                  { key: "http.url", value: { stringValue: `https://api.example.com/v1/${selected.operationName}` } },
                  { key: "http.status_code", value: { intValue: selected.httpStatus } },
                  { key: "user.id", value: { stringValue: `user_${Math.floor(Math.random() * 100)}` } },
                  { key: "request.id", value: { stringValue: `req_${generateHexId(8)}` } }
                ],
                status: status
              },
              {
                traceId: traceId,
                spanId: clientSpanId,
                parentSpanId: rootSpanId,
                name: `HTTP POST ${selected.backendService}/${selected.operationName}`,
                kind: 3, // CLIENT
                startTimeUnixNano: String(clientStart),
                endTimeUnixNano: String(clientEnd),
                attributes: [
                  { key: "http.method", value: { stringValue: "POST" } },
                  { key: "http.url", value: { stringValue: `http://${selected.backendService}:8080/v1/${selected.operationName}` } },
                  { key: "peer.service", value: { stringValue: selected.backendService } },
                  { key: "http.status_code", value: { intValue: selected.httpStatus } }
                ],
                status: status
              }
            ]
          }
        ]
      },
      {
        resource: {
          attributes: [
            { key: "service.name", value: { stringValue: selected.backendService } },
            { key: "service.version", value: { stringValue: "2.0.0" } },
            { key: "environment", value: { stringValue: "test" } }
          ]
        },
        scopeSpans: [
          {
            scope: {
              name: "opentelemetry-instrumentation",
              version: "1.0.0"
            },
            spans: [
              {
                traceId: traceId,
                spanId: serverSpanId,
                parentSpanId: clientSpanId,
                name: `POST /${selected.operationName}`,
                kind: 2, // SERVER
                startTimeUnixNano: String(serverStart),
                endTimeUnixNano: String(serverEnd),
                attributes: [
                  { key: "http.method", value: { stringValue: "POST" } },
                  { key: "http.target", value: { stringValue: `/v1/${selected.operationName}` } },
                  { key: "http.status_code", value: { intValue: selected.httpStatus } },
                  { key: "user.id", value: { stringValue: `user_${Math.floor(Math.random() * 100)}` } }
                ],
                events: errorEvents,
                status: status
              }
            ]
          }
        ]
      }
    ]
  };

  testLogger.debug(`Generated trace ${iteration}`, {
    traceId,
    scenario: selected.scenario,
    services: `${selected.frontendService} -> ${selected.backendService}`,
    status: selected.httpStatus
  });

  return traceData;
}

/**
 * Ingest traces into OpenObserve
 * @param {import('@playwright/test').Page} page - Playwright page object
 * @param {number} traceCount - Number of traces to generate and ingest
 * @returns {Promise<Object>} Ingestion result
 */
async function ingestTraces(page, traceCount = 10) {
  testLogger.info(`Starting trace ingestion`, { traceCount });

  const orgId = process.env["ORGNAME"] || "default";
  const basicAuthCredentials = Buffer.from(
    `${process.env["ZO_ROOT_USER_EMAIL"]}:${process.env["ZO_ROOT_USER_PASSWORD"]}`
  ).toString('base64');

  const headers = {
    "Authorization": `Basic ${basicAuthCredentials}`,
    "Content-Type": "application/json",
  };

  const results = [];
  const traceIds = [];

  for (let i = 1; i <= traceCount; i++) {
    const traceData = generateTrace(i);
    traceIds.push(traceData.resourceSpans[0].scopeSpans[0].spans[0].traceId);

    try {
      const response = await page.evaluate(async ({ url, headers, orgId, traceData }) => {
        const baseUrl = url.endsWith('/') ? url.slice(0, -1) : url;
        const fetchResponse = await fetch(`${baseUrl}/api/${orgId}/v1/traces`, {
          method: 'POST',
          headers: headers,
          body: JSON.stringify(traceData)
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
        url: process.env.ZO_BASE_URL || process.env.INGESTION_URL,
        headers: headers,
        orgId: orgId,
        traceData: traceData
      });

      results.push(response);

      if (response.status !== 200) {
        testLogger.warn(`Trace ${i} ingestion returned non-200 status`, {
          status: response.status,
          response: response.data
        });
      }
    } catch (error) {
      testLogger.error(`Failed to ingest trace ${i}`, { error: error.message });
      results.push({ status: 'error', error: error.message });
    }

    // Small delay between traces
    await page.waitForTimeout(100);
  }

  const successCount = results.filter(r => r.status === 200).length;
  const failureCount = results.length - successCount;

  testLogger.info('Trace ingestion completed', {
    total: traceCount,
    successful: successCount,
    failed: failureCount,
    sampleTraceIds: traceIds.slice(0, 5)
  });

  return {
    total: traceCount,
    successful: successCount,
    failed: failureCount,
    traceIds: traceIds,
    results: results
  };
}

module.exports = {
  generateTrace,
  ingestTraces,
  generateHexId,
  getTimestampNs
};