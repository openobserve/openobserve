/**
 * Service Graph Trace Generator for E2E Tests
 *
 * Purpose-built trace generator covering all 25 QA test cases from the
 * Service Graph QA Guide. Uses page.request.post (secure, Node.js context)
 * for all API calls.
 *
 * Covers:
 * - Basic CLIENT/SERVER pairing with peer.service (TC-002)
 * - Out-of-order span delivery (TC-004)
 * - Concurrent span processing (TC-005)
 * - PRODUCER/CONSUMER pairing (TC-006)
 * - Orphan CLIENT/SERVER spans (TC-007, TC-008)
 * - Clock skew (TC-009)
 * - Missing parentSpanId (TC-010)
 * - Root span handling (TC-011)
 * - Request count accuracy (TC-012)
 * - Failed request tracking (TC-013)
 * - Latency histogram accuracy (TC-014)
 * - Connection type classification (TC-015)
 * - High cardinality (TC-022)
 * - Multi-org isolation (TC-024)
 * - Self-loops, circular deps, multi-hop topologies
 */

const crypto = require('crypto');
const testLogger = require('./test-logger.js');

// ============================================================================
// CONSTANTS
// ============================================================================

const SpanKind = {
  INTERNAL: 1,
  SERVER: 2,
  CLIENT: 3,
  PRODUCER: 4,
  CONSUMER: 5,
};

const StatusCode = {
  UNSET: 0,
  OK: 1,
  ERROR: 2,
};

const ConnectionType = {
  HTTP: 'http',
  GRPC: 'grpc',
  DATABASE: 'database',
  MESSAGING: 'messaging',
};

// Production-grade service configuration matching telemetry-generator.py
const SERVICES = {
  'frontend-app':           { version: '2.1.0', environment: 'production' },
  'api-gateway':            { version: '3.0.1', environment: 'production' },
  'auth-service':           { version: '1.5.2', environment: 'production' },
  'user-service':           { version: '2.0.0', environment: 'production' },
  'order-service':          { version: '1.8.3', environment: 'production' },
  'payment-service':        { version: '1.2.1', environment: 'production' },
  'inventory-service':      { version: '1.4.0', environment: 'production' },
  'notification-service':   { version: '1.1.5', environment: 'production' },
  'email-service':          { version: '1.0.8', environment: 'production' },
  'search-service':         { version: '2.2.0', environment: 'production' },
  'elasticsearch':          { version: '8.11.0', environment: 'production' },
  'analytics-service':      { version: '1.3.2', environment: 'production' },
  'data-warehouse':         { version: '1.0.0', environment: 'production' },
  'recommendation-service': { version: '1.6.1', environment: 'production' },
  'ml-service':             { version: '2.0.3', environment: 'production' },
  'cache':                  { version: '7.2.0', environment: 'production' },
  'database':               { version: '15.4.0', environment: 'production' },
};

// ============================================================================
// CORE UTILITIES
// ============================================================================

function generateHexId(bytes) {
  return crypto.randomBytes(bytes).toString('hex');
}

function generateTraceId() {
  return generateHexId(16);
}

function generateSpanId() {
  return generateHexId(8);
}

function getTimestampNs() {
  return String(Date.now() * 1_000_000);
}

function msToNs(ms) {
  return ms * 1_000_000;
}

function getHeaders() {
  const basicAuthCredentials = Buffer.from(
    `${process.env['ZO_ROOT_USER_EMAIL']}:${process.env['ZO_ROOT_USER_PASSWORD']}`
  ).toString('base64');

  return {
    Authorization: `Basic ${basicAuthCredentials}`,
    'Content-Type': 'application/json',
  };
}

function getBaseUrl() {
  const url = process.env.INGESTION_URL || process.env.ZO_BASE_URL;
  if (!url) throw new Error('Neither INGESTION_URL nor ZO_BASE_URL is set');
  return url.endsWith('/') ? url.slice(0, -1) : url;
}

function getOrgId() {
  return process.env['ORGNAME'] || 'default';
}

// ============================================================================
// SPAN & RESOURCE BUILDERS
// ============================================================================

/**
 * Build a single OTLP span object
 */
function buildSpan({
  traceId,
  spanId,
  parentSpanId,
  name,
  kind,
  startTimeNs,
  endTimeNs,
  attributes = [],
  status = { code: StatusCode.OK },
  events = [],
}) {
  const span = {
    traceId,
    spanId,
    name,
    kind,
    startTimeUnixNano: String(startTimeNs),
    endTimeUnixNano: String(endTimeNs),
    attributes,
    status,
  };

  if (parentSpanId) {
    span.parentSpanId = parentSpanId;
  }
  if (events.length > 0) {
    span.events = events;
  }

  return span;
}

/**
 * Build a key-value attribute
 */
function attr(key, value) {
  if (typeof value === 'number') {
    return { key, value: { intValue: value } };
  }
  return { key, value: { stringValue: String(value) } };
}

/**
 * Build a resourceSpans entry for a single service
 * Uses production-grade service config (versions, environments) and k8s attributes
 */
function buildResourceSpans(serviceName, spans, extraResourceAttrs = []) {
  const config = SERVICES[serviceName] || { version: '1.0.0', environment: 'production' };

  return {
    resource: {
      attributes: [
        attr('service.name', serviceName),
        attr('service.version', config.version),
        attr('environment', config.environment),
        ...extraResourceAttrs,
      ],
    },
    scopeSpans: [
      {
        scope: {
          name: 'opentelemetry-instrumentation',
          version: '1.0.0',
        },
        spans,
      },
    ],
  };
}

/**
 * Build k8s span-level attributes (matches telemetry-generator.py production data)
 */
function k8sAttrs(serviceName) {
  return [
    attr('k8s_cluster', 'production-cluster'),
    attr('k8s_namespace', 'ecommerce'),
    attr('k8s_deployment', serviceName),
  ];
}

/**
 * Wrap resourceSpans into a complete OTLP trace payload
 */
function buildTracePayload(resourceSpansArray) {
  return { resourceSpans: resourceSpansArray };
}

/**
 * Build error events for a span
 */
function buildErrorEvents(startTimeNs, errorType, errorMessage) {
  return [
    {
      timeUnixNano: String(startTimeNs + msToNs(1)),
      name: 'exception',
      attributes: [
        attr('exception.type', errorType),
        attr('exception.message', errorMessage),
      ],
    },
  ];
}

// ============================================================================
// SCENARIO GENERATORS
// ============================================================================

/**
 * TC-002: Basic CLIENT→SERVER span pairing
 * Generates a standard HTTP trace with:
 * - CLIENT span (kind=3) with peer.service
 * - SERVER span (kind=2) with matching parentSpanId
 *
 * Also covers: TC-011 (root span), TC-012 (request count)
 */
function generateBasicTrace({
  clientService = 'api-gateway',
  serverService = 'order-service',
  operationName = 'get_orders',
  latencyMs = 150,
  httpStatus = 200,
  extraClientAttrs = [],
  extraServerAttrs = [],
} = {}) {
  const traceId = generateTraceId();
  const clientSpanId = generateSpanId();
  const serverSpanId = generateSpanId();
  const now = Date.now();
  const startNs = now * 1_000_000;

  const clientSpan = buildSpan({
    traceId,
    spanId: clientSpanId,
    name: `HTTP POST /${operationName}`,
    kind: SpanKind.CLIENT,
    startTimeNs: startNs,
    endTimeNs: startNs + msToNs(latencyMs + 5),
    attributes: [
      attr('http.method', 'POST'),
      attr('http.url', `http://${serverService}:8080/v1/${operationName}`),
      attr('http.status_code', httpStatus),
      attr('peer.service', serverService),
      ...k8sAttrs(clientService),
      ...extraClientAttrs,
    ],
    status: { code: httpStatus >= 400 ? StatusCode.ERROR : StatusCode.OK },
  });

  const serverSpan = buildSpan({
    traceId,
    spanId: serverSpanId,
    parentSpanId: clientSpanId,
    name: `POST /${operationName}`,
    kind: SpanKind.SERVER,
    startTimeNs: startNs + msToNs(2),
    endTimeNs: startNs + msToNs(latencyMs + 2),
    attributes: [
      attr('http.method', 'POST'),
      attr('http.target', `/v1/${operationName}`),
      attr('http.status_code', httpStatus),
      ...k8sAttrs(serverService),
      ...extraServerAttrs,
    ],
    status: { code: httpStatus >= 400 ? StatusCode.ERROR : StatusCode.OK },
  });

  return {
    payload: buildTracePayload([
      buildResourceSpans(clientService, [clientSpan]),
      buildResourceSpans(serverService, [serverSpan]),
    ]),
    metadata: { traceId, clientService, serverService, latencyMs, httpStatus },
  };
}

/**
 * TC-013: Error trace with status=ERROR and exception events
 */
function generateErrorTrace({
  clientService = 'api-gateway',
  serverService = 'user-service',
  operationName = 'database_query',
  latencyMs = 5000,
  httpStatus = 500,
  errorType = 'DatabaseConnectionError',
  errorMessage = 'Database connection failed',
} = {}) {
  const traceId = generateTraceId();
  const clientSpanId = generateSpanId();
  const serverSpanId = generateSpanId();
  const now = Date.now();
  const startNs = now * 1_000_000;

  const clientSpan = buildSpan({
    traceId,
    spanId: clientSpanId,
    name: `HTTP POST /${operationName}`,
    kind: SpanKind.CLIENT,
    startTimeNs: startNs,
    endTimeNs: startNs + msToNs(latencyMs + 5),
    attributes: [
      attr('http.method', 'POST'),
      attr('http.url', `http://${serverService}:8080/v1/${operationName}`),
      attr('http.status_code', httpStatus),
      attr('peer.service', serverService),
      ...k8sAttrs(clientService),
    ],
    status: { code: StatusCode.ERROR, message: errorMessage },
  });

  const serverSpan = buildSpan({
    traceId,
    spanId: serverSpanId,
    parentSpanId: clientSpanId,
    name: `POST /${operationName}`,
    kind: SpanKind.SERVER,
    startTimeNs: startNs + msToNs(2),
    endTimeNs: startNs + msToNs(latencyMs + 2),
    attributes: [
      attr('http.method', 'POST'),
      attr('http.target', `/v1/${operationName}`),
      attr('http.status_code', httpStatus),
      ...k8sAttrs(serverService),
    ],
    status: { code: StatusCode.ERROR, message: errorMessage },
    events: buildErrorEvents(startNs + msToNs(2), errorType, errorMessage),
  });

  return {
    payload: buildTracePayload([
      buildResourceSpans(clientService, [clientSpan]),
      buildResourceSpans(serverService, [serverSpan]),
    ]),
    metadata: { traceId, clientService, serverService, errorType, errorMessage },
  };
}

/**
 * TC-015: Database connection type trace
 * CLIENT span with db.system attribute → connection_type = "database"
 */
function generateDatabaseTrace({
  clientService = 'order-service',
  dbService = 'database',
  dbSystem = 'postgresql',
  operationName = 'SELECT orders',
  latencyMs = 25,
} = {}) {
  const traceId = generateTraceId();
  const clientSpanId = generateSpanId();
  const serverSpanId = generateSpanId();
  const now = Date.now();
  const startNs = now * 1_000_000;

  const clientSpan = buildSpan({
    traceId,
    spanId: clientSpanId,
    name: operationName,
    kind: SpanKind.CLIENT,
    startTimeNs: startNs,
    endTimeNs: startNs + msToNs(latencyMs + 3),
    attributes: [
      attr('db.system', dbSystem),
      attr('db.name', 'orders_db'),
      attr('db.statement', operationName),
      attr('peer.service', dbService),
      ...k8sAttrs(clientService),
    ],
    status: { code: StatusCode.OK },
  });

  const serverSpan = buildSpan({
    traceId,
    spanId: serverSpanId,
    parentSpanId: clientSpanId,
    name: operationName,
    kind: SpanKind.SERVER,
    startTimeNs: startNs + msToNs(1),
    endTimeNs: startNs + msToNs(latencyMs + 1),
    attributes: [
      attr('db.system', dbSystem),
      attr('db.name', 'orders_db'),
      ...k8sAttrs(dbService),
    ],
    status: { code: StatusCode.OK },
  });

  return {
    payload: buildTracePayload([
      buildResourceSpans(clientService, [clientSpan]),
      buildResourceSpans(dbService, [serverSpan]),
    ]),
    metadata: { traceId, clientService, serverService: dbService, connectionType: ConnectionType.DATABASE },
  };
}

/**
 * TC-006, TC-015: Messaging trace with PRODUCER/CONSUMER spans
 * PRODUCER span (kind=4) + CONSUMER span (kind=5) with messaging.system
 */
function generateMessagingTrace({
  producerService = 'order-service',
  consumerService = 'notification-service',
  messagingSystem = 'kafka',
  destination = 'order.events',
  latencyMs = 50,
} = {}) {
  const traceId = generateTraceId();
  const producerSpanId = generateSpanId();
  const consumerSpanId = generateSpanId();
  const now = Date.now();
  const startNs = now * 1_000_000;

  const producerSpan = buildSpan({
    traceId,
    spanId: producerSpanId,
    name: `${destination} send`,
    kind: SpanKind.PRODUCER,
    startTimeNs: startNs,
    endTimeNs: startNs + msToNs(10),
    attributes: [
      attr('messaging.system', messagingSystem),
      attr('messaging.destination', destination),
      attr('messaging.destination_kind', 'topic'),
      attr('peer.service', consumerService),
      ...k8sAttrs(producerService),
    ],
    status: { code: StatusCode.OK },
  });

  const consumerSpan = buildSpan({
    traceId,
    spanId: consumerSpanId,
    parentSpanId: producerSpanId,
    name: `${destination} receive`,
    kind: SpanKind.CONSUMER,
    startTimeNs: startNs + msToNs(latencyMs),
    endTimeNs: startNs + msToNs(latencyMs + 30),
    attributes: [
      attr('messaging.system', messagingSystem),
      attr('messaging.destination', destination),
      attr('messaging.destination_kind', 'topic'),
      attr('messaging.operation', 'receive'),
      ...k8sAttrs(consumerService),
    ],
    status: { code: StatusCode.OK },
  });

  return {
    payload: buildTracePayload([
      buildResourceSpans(producerService, [producerSpan]),
      buildResourceSpans(consumerService, [consumerSpan]),
    ]),
    metadata: { traceId, producerService, consumerService, connectionType: ConnectionType.MESSAGING },
  };
}

/**
 * TC-015: gRPC connection type trace
 */
function generateGrpcTrace({
  clientService = 'api-gateway',
  serverService = 'auth-service',
  rpcMethod = 'AuthService/ValidateToken',
  latencyMs = 15,
} = {}) {
  const traceId = generateTraceId();
  const clientSpanId = generateSpanId();
  const serverSpanId = generateSpanId();
  const now = Date.now();
  const startNs = now * 1_000_000;

  const rpcService = rpcMethod.split('/')[0] || 'UnknownService';
  const rpcMethodName = rpcMethod.split('/')[1] || rpcMethod;

  const clientSpan = buildSpan({
    traceId,
    spanId: clientSpanId,
    name: rpcMethod,
    kind: SpanKind.CLIENT,
    startTimeNs: startNs,
    endTimeNs: startNs + msToNs(latencyMs + 3),
    attributes: [
      attr('rpc.system', 'grpc'),
      attr('rpc.service', rpcService),
      attr('rpc.method', rpcMethodName),
      attr('rpc.grpc.status_code', 0),
      attr('peer.service', serverService),
      ...k8sAttrs(clientService),
    ],
    status: { code: StatusCode.OK },
  });

  const serverSpan = buildSpan({
    traceId,
    spanId: serverSpanId,
    parentSpanId: clientSpanId,
    name: rpcMethod,
    kind: SpanKind.SERVER,
    startTimeNs: startNs + msToNs(1),
    endTimeNs: startNs + msToNs(latencyMs + 1),
    attributes: [
      attr('rpc.system', 'grpc'),
      attr('rpc.service', rpcService),
      attr('rpc.method', rpcMethodName),
      attr('rpc.grpc.status_code', 0),
      ...k8sAttrs(serverService),
    ],
    status: { code: StatusCode.OK },
  });

  return {
    payload: buildTracePayload([
      buildResourceSpans(clientService, [clientSpan]),
      buildResourceSpans(serverService, [serverSpan]),
    ]),
    metadata: { traceId, clientService, serverService, connectionType: ConnectionType.GRPC },
  };
}

/**
 * TC-007: Orphan CLIENT span — CLIENT with peer.service but NO matching SERVER
 * Tests: virtual/unknown node creation, wait_duration expiration
 */
function generateOrphanClientTrace({
  clientService = 'api-gateway',
  targetService = 'unknown-external-api',
  operationName = 'external_call',
  latencyMs = 300,
} = {}) {
  const traceId = generateTraceId();
  const clientSpanId = generateSpanId();
  const now = Date.now();
  const startNs = now * 1_000_000;

  const clientSpan = buildSpan({
    traceId,
    spanId: clientSpanId,
    name: `HTTP GET /${operationName}`,
    kind: SpanKind.CLIENT,
    startTimeNs: startNs,
    endTimeNs: startNs + msToNs(latencyMs),
    attributes: [
      attr('http.method', 'GET'),
      attr('http.url', `https://${targetService}/api/${operationName}`),
      attr('http.status_code', 200),
      attr('peer.service', targetService),
    ],
    status: { code: StatusCode.OK },
  });

  return {
    payload: buildTracePayload([
      buildResourceSpans(clientService, [clientSpan]),
    ]),
    metadata: { traceId, clientService, targetService, type: 'orphan_client' },
  };
}

/**
 * TC-008: Orphan SERVER span — SERVER with NO matching CLIENT
 * Tests: service appears as node but no inbound edge from specific client
 */
function generateOrphanServerTrace({
  serverService = 'inventory-service',
  operationName = 'scheduled_sync',
  latencyMs = 200,
} = {}) {
  const traceId = generateTraceId();
  const serverSpanId = generateSpanId();
  const now = Date.now();
  const startNs = now * 1_000_000;

  const serverSpan = buildSpan({
    traceId,
    spanId: serverSpanId,
    name: operationName,
    kind: SpanKind.SERVER,
    startTimeNs: startNs,
    endTimeNs: startNs + msToNs(latencyMs),
    attributes: [
      attr('http.method', 'POST'),
      attr('http.target', `/v1/${operationName}`),
      attr('http.status_code', 200),
    ],
    status: { code: StatusCode.OK },
  });

  return {
    payload: buildTracePayload([
      buildResourceSpans(serverService, [serverSpan]),
    ]),
    metadata: { traceId, serverService, type: 'orphan_server' },
  };
}

/**
 * TC-009: Clock skew — SERVER timestamps START BEFORE CLIENT
 * Tests: negative latency handling, daemon robustness
 */
function generateClockSkewTrace({
  clientService = 'api-gateway',
  serverService = 'payment-service',
  operationName = 'process_payment',
  skewMs = 50,
} = {}) {
  const traceId = generateTraceId();
  const clientSpanId = generateSpanId();
  const serverSpanId = generateSpanId();
  const now = Date.now();
  const clientStartNs = now * 1_000_000;

  // Server starts BEFORE client (clock skew)
  const serverStartNs = clientStartNs - msToNs(skewMs);

  const clientSpan = buildSpan({
    traceId,
    spanId: clientSpanId,
    name: `HTTP POST /${operationName}`,
    kind: SpanKind.CLIENT,
    startTimeNs: clientStartNs,
    endTimeNs: clientStartNs + msToNs(200),
    attributes: [
      attr('http.method', 'POST'),
      attr('http.url', `http://${serverService}:8080/v1/${operationName}`),
      attr('http.status_code', 200),
      attr('peer.service', serverService),
    ],
    status: { code: StatusCode.OK },
  });

  const serverSpan = buildSpan({
    traceId,
    spanId: serverSpanId,
    parentSpanId: clientSpanId,
    name: `POST /${operationName}`,
    kind: SpanKind.SERVER,
    startTimeNs: serverStartNs,
    endTimeNs: serverStartNs + msToNs(180),
    attributes: [
      attr('http.method', 'POST'),
      attr('http.target', `/v1/${operationName}`),
      attr('http.status_code', 200),
    ],
    status: { code: StatusCode.OK },
  });

  return {
    payload: buildTracePayload([
      buildResourceSpans(clientService, [clientSpan]),
      buildResourceSpans(serverService, [serverSpan]),
    ]),
    metadata: { traceId, clientService, serverService, skewMs, type: 'clock_skew' },
  };
}

/**
 * TC-010: Missing parentSpanId on SERVER span
 * Tests: span pairing fallback behavior
 */
function generateMissingParentIdTrace({
  serverService = 'orphan-handler',
  operationName = 'cron_job',
  latencyMs = 100,
} = {}) {
  const traceId = generateTraceId();
  const serverSpanId = generateSpanId();
  const now = Date.now();
  const startNs = now * 1_000_000;

  // SERVER span with NO parentSpanId
  const serverSpan = buildSpan({
    traceId,
    spanId: serverSpanId,
    // parentSpanId intentionally omitted
    name: operationName,
    kind: SpanKind.SERVER,
    startTimeNs: startNs,
    endTimeNs: startNs + msToNs(latencyMs),
    attributes: [
      attr('http.method', 'POST'),
      attr('http.target', `/v1/${operationName}`),
      attr('http.status_code', 200),
    ],
    status: { code: StatusCode.OK },
  });

  return {
    payload: buildTracePayload([
      buildResourceSpans(serverService, [serverSpan]),
    ]),
    metadata: { traceId, serverService, type: 'missing_parent_id' },
  };
}

/**
 * TC-014: Configurable latency trace for histogram bucket testing
 * Generates a trace with an exact latency value
 */
function generateLatencyTrace({
  clientService = 'api-gateway',
  serverService = 'order-service',
  operationName = 'latency_test',
  latencyMs,
} = {}) {
  return generateBasicTrace({
    clientService,
    serverService,
    operationName,
    latencyMs,
    httpStatus: 200,
  });
}

/**
 * Self-loop: service A calls itself (edge case)
 */
function generateSelfLoopTrace({
  serviceName = 'recursive-service',
  operationName = 'self_call',
  latencyMs = 100,
} = {}) {
  const traceId = generateTraceId();
  const clientSpanId = generateSpanId();
  const serverSpanId = generateSpanId();
  const now = Date.now();
  const startNs = now * 1_000_000;

  const clientSpan = buildSpan({
    traceId,
    spanId: clientSpanId,
    name: `HTTP POST /${operationName}`,
    kind: SpanKind.CLIENT,
    startTimeNs: startNs,
    endTimeNs: startNs + msToNs(latencyMs + 5),
    attributes: [
      attr('http.method', 'POST'),
      attr('http.url', `http://${serviceName}:8080/v1/${operationName}`),
      attr('http.status_code', 200),
      attr('peer.service', serviceName), // points back to itself
    ],
    status: { code: StatusCode.OK },
  });

  const serverSpan = buildSpan({
    traceId,
    spanId: serverSpanId,
    parentSpanId: clientSpanId,
    name: `POST /${operationName}`,
    kind: SpanKind.SERVER,
    startTimeNs: startNs + msToNs(2),
    endTimeNs: startNs + msToNs(latencyMs + 2),
    attributes: [
      attr('http.method', 'POST'),
      attr('http.target', `/v1/${operationName}`),
      attr('http.status_code', 200),
    ],
    status: { code: StatusCode.OK },
  });

  // Both spans belong to the SAME service
  return {
    payload: buildTracePayload([
      buildResourceSpans(serviceName, [clientSpan, serverSpan]),
    ]),
    metadata: { traceId, serviceName, type: 'self_loop' },
  };
}

/**
 * Circular dependency: A→B→C→A (edge case)
 * Each hop is a CLIENT→SERVER pair
 */
function generateCircularDependencyTrace({
  services = ['service-a', 'service-b', 'service-c'],
  latencyMs = 50,
} = {}) {
  const traceId = generateTraceId();
  const now = Date.now();
  let currentTimeNs = now * 1_000_000;
  const resourceSpansArray = [];
  const hopCount = services.length;

  for (let i = 0; i < hopCount; i++) {
    const clientService = services[i];
    const serverService = services[(i + 1) % hopCount]; // wraps around
    const clientSpanId = generateSpanId();
    const serverSpanId = generateSpanId();

    const clientSpan = buildSpan({
      traceId,
      spanId: clientSpanId,
      name: `HTTP POST /${clientService}_to_${serverService}`,
      kind: SpanKind.CLIENT,
      startTimeNs: currentTimeNs,
      endTimeNs: currentTimeNs + msToNs(latencyMs + 5),
      attributes: [
        attr('http.method', 'POST'),
        attr('http.url', `http://${serverService}:8080/v1/call`),
        attr('http.status_code', 200),
        attr('peer.service', serverService),
      ],
      status: { code: StatusCode.OK },
    });

    const serverSpan = buildSpan({
      traceId,
      spanId: serverSpanId,
      parentSpanId: clientSpanId,
      name: `POST /call`,
      kind: SpanKind.SERVER,
      startTimeNs: currentTimeNs + msToNs(2),
      endTimeNs: currentTimeNs + msToNs(latencyMs + 2),
      attributes: [
        attr('http.method', 'POST'),
        attr('http.target', '/v1/call'),
        attr('http.status_code', 200),
      ],
      status: { code: StatusCode.OK },
    });

    resourceSpansArray.push(buildResourceSpans(clientService, [clientSpan]));
    resourceSpansArray.push(buildResourceSpans(serverService, [serverSpan]));

    currentTimeNs += msToNs(latencyMs + 10);
  }

  return {
    payload: buildTracePayload(resourceSpansArray),
    metadata: { traceId, services, type: 'circular_dependency' },
  };
}

/**
 * TC-016, TC-017: Multi-hop trace across multiple services
 * Builds a linear chain: A→B→C→D→...
 */
function generateMultiHopTrace({
  services = ['frontend', 'api-gateway', 'order-service', 'inventory-service', 'warehouse-service'],
  latencyMs = 50,
  errorAtHop = -1, // -1 = no error, 0-indexed hop to fail
} = {}) {
  const traceId = generateTraceId();
  const now = Date.now();
  let currentTimeNs = now * 1_000_000;
  const resourceSpansArray = [];

  for (let i = 0; i < services.length - 1; i++) {
    const clientService = services[i];
    const serverService = services[i + 1];
    const clientSpanId = generateSpanId();
    const serverSpanId = generateSpanId();
    const isError = i === errorAtHop;
    const hopLatency = latencyMs + Math.floor(Math.random() * 20);

    const clientSpan = buildSpan({
      traceId,
      spanId: clientSpanId,
      name: `HTTP POST /${serverService}/process`,
      kind: SpanKind.CLIENT,
      startTimeNs: currentTimeNs,
      endTimeNs: currentTimeNs + msToNs(hopLatency + 5),
      attributes: [
        attr('http.method', 'POST'),
        attr('http.url', `http://${serverService}:8080/v1/process`),
        attr('http.status_code', isError ? 500 : 200),
        attr('peer.service', serverService),
      ],
      status: isError
        ? { code: StatusCode.ERROR, message: `Error at ${serverService}` }
        : { code: StatusCode.OK },
    });

    const serverSpan = buildSpan({
      traceId,
      spanId: serverSpanId,
      parentSpanId: clientSpanId,
      name: `POST /process`,
      kind: SpanKind.SERVER,
      startTimeNs: currentTimeNs + msToNs(2),
      endTimeNs: currentTimeNs + msToNs(hopLatency + 2),
      attributes: [
        attr('http.method', 'POST'),
        attr('http.target', '/v1/process'),
        attr('http.status_code', isError ? 500 : 200),
      ],
      status: isError
        ? { code: StatusCode.ERROR, message: `Error at ${serverService}` }
        : { code: StatusCode.OK },
      events: isError
        ? buildErrorEvents(currentTimeNs + msToNs(2), 'InternalError', `Error at ${serverService}`)
        : [],
    });

    resourceSpansArray.push(buildResourceSpans(clientService, [clientSpan]));
    resourceSpansArray.push(buildResourceSpans(serverService, [serverSpan]));

    currentTimeNs += msToNs(hopLatency + 10);
  }

  return {
    payload: buildTracePayload(resourceSpansArray),
    metadata: { traceId, services, hopCount: services.length - 1, type: 'multi_hop' },
  };
}

/**
 * TC-022: High cardinality — many unique service names
 * Generates N traces with dynamically created service names
 */
function generateHighCardinalityTraces({
  count = 100,
  clientPrefix = 'hc-client',
  serverPrefix = 'hc-server',
} = {}) {
  const traces = [];
  for (let i = 0; i < count; i++) {
    traces.push(
      generateBasicTrace({
        clientService: `${clientPrefix}-${i}`,
        serverService: `${serverPrefix}-${i}`,
        operationName: `op_${i}`,
        latencyMs: 10 + Math.floor(Math.random() * 200),
      })
    );
  }
  return traces;
}

// ============================================================================
// INGESTION FUNCTIONS
// ============================================================================

/**
 * Send a single trace payload via OTLP /v1/traces endpoint
 * Uses page.request.post (secure, keeps credentials in Node.js context)
 */
async function ingestTrace(page, traceData, orgId) {
  const headers = getHeaders();
  const baseUrl = getBaseUrl();
  const org = orgId || getOrgId();
  const payload = traceData.payload || traceData;

  try {
    const response = await page.request.post(`${baseUrl}/api/${org}/v1/traces`, {
      headers,
      data: payload,
    });

    const status = response.status();
    let responseData = null;
    try {
      responseData = await response.json();
    } catch {
      responseData = { text: await response.text().catch(() => '') };
    }

    testLogger.debug('Trace ingestion response', {
      status,
      traceId: traceData.metadata?.traceId,
    });

    return { status, data: responseData };
  } catch (e) {
    testLogger.debug('Trace ingestion error', { error: e.message });
    return { status: 500, data: { error: e.message } };
  }
}

/**
 * Ingest multiple traces sequentially
 */
async function ingestTraces(page, traceDataArray, { delayMs = 50, orgId } = {}) {
  const results = [];

  for (const traceData of traceDataArray) {
    const result = await ingestTrace(page, traceData, orgId);
    results.push(result);

    if (delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }

  const successCount = results.filter((r) => r.status === 200).length;
  testLogger.info('Batch trace ingestion completed', {
    total: traceDataArray.length,
    successful: successCount,
    failed: traceDataArray.length - successCount,
  });

  return { total: traceDataArray.length, successful: successCount, results };
}

/**
 * TC-004: Ingest spans out-of-order — sends SERVER span first, then CLIENT span
 * Each span is sent in a separate HTTP request with a delay between them
 */
async function ingestOutOfOrderSpans(page, {
  clientService = 'api-gateway',
  serverService = 'order-service',
  operationName = 'out_of_order_test',
  latencyMs = 150,
  delayBetweenMs = 2000,
} = {}) {
  const traceId = generateTraceId();
  const clientSpanId = generateSpanId();
  const serverSpanId = generateSpanId();
  const now = Date.now();
  const startNs = now * 1_000_000;

  // Build SERVER span (will be sent FIRST)
  const serverSpan = buildSpan({
    traceId,
    spanId: serverSpanId,
    parentSpanId: clientSpanId,
    name: `POST /${operationName}`,
    kind: SpanKind.SERVER,
    startTimeNs: startNs + msToNs(2),
    endTimeNs: startNs + msToNs(latencyMs + 2),
    attributes: [
      attr('http.method', 'POST'),
      attr('http.target', `/v1/${operationName}`),
      attr('http.status_code', 200),
    ],
    status: { code: StatusCode.OK },
  });

  // Build CLIENT span (will be sent SECOND)
  const clientSpan = buildSpan({
    traceId,
    spanId: clientSpanId,
    name: `HTTP POST /${operationName}`,
    kind: SpanKind.CLIENT,
    startTimeNs: startNs,
    endTimeNs: startNs + msToNs(latencyMs + 5),
    attributes: [
      attr('http.method', 'POST'),
      attr('http.url', `http://${serverService}:8080/v1/${operationName}`),
      attr('http.status_code', 200),
      attr('peer.service', serverService),
    ],
    status: { code: StatusCode.OK },
  });

  // Send SERVER first
  const serverPayload = buildTracePayload([
    buildResourceSpans(serverService, [serverSpan]),
  ]);
  const serverResult = await ingestTrace(page, { payload: serverPayload });
  testLogger.debug('Out-of-order: SERVER span sent first', { traceId });

  // Wait
  await new Promise((resolve) => setTimeout(resolve, delayBetweenMs));

  // Send CLIENT second
  const clientPayload = buildTracePayload([
    buildResourceSpans(clientService, [clientSpan]),
  ]);
  const clientResult = await ingestTrace(page, { payload: clientPayload });
  testLogger.debug('Out-of-order: CLIENT span sent second', { traceId });

  return {
    traceId,
    serverResult,
    clientResult,
    metadata: { clientService, serverService, type: 'out_of_order' },
  };
}

/**
 * TC-024: Ingest traces to a specific org (for multi-org isolation testing)
 */
async function ingestTraceToOrg(page, traceData, orgId) {
  return ingestTrace(page, traceData, orgId);
}

// ============================================================================
// COMPOSITE SCENARIOS — pre-built topologies for UI testing
// ============================================================================

// ============================================================================
// PRODUCTION FLOW GENERATORS
// Matches telemetry-generator.py flow scenarios exactly
// ============================================================================

/**
 * Error Flow: User profile fetch with potential errors at auth/service/db stages
 * frontend-app → api-gateway → auth-service
 *                api-gateway → user-service → database
 *
 * Matches telemetry-generator.py error_flow
 */
function generateErrorFlow({ errorStage = -1 } = {}) {
  const traceId = generateTraceId();
  const now = Date.now();
  const baseTime = now * 1_000_000;
  const resourceSpansArray = [];

  // Determine error stage: -1 = no error, 0 = auth, 1 = user-service, 2 = database
  const stage = errorStage >= 0 ? errorStage : (Math.random() < 0.2 ? Math.floor(Math.random() * 3) : -1);
  const authError = stage === 0;
  const userError = stage === 1;
  const dbError = stage === 2;

  // 1. Frontend → API Gateway (CLIENT)
  const spanId1 = generateSpanId();
  const frontendSpan = buildSpan({
    traceId, spanId: spanId1,
    name: '/api/users/profile',
    kind: SpanKind.CLIENT,
    startTimeNs: baseTime,
    endTimeNs: baseTime + msToNs(1200),
    attributes: [
      attr('http.method', 'GET'),
      attr('http.url', 'http://api-gateway:8080/api/users/profile'),
      attr('http.status_code', authError ? 401 : userError || dbError ? 500 : 200),
      attr('peer.service', 'api-gateway'),
      attr('user_id', `user_${Math.floor(Math.random() * 1000)}`),
      ...k8sAttrs('frontend-app'),
    ],
    status: { code: stage >= 0 ? StatusCode.ERROR : StatusCode.OK },
  });
  resourceSpansArray.push(buildResourceSpans('frontend-app', [frontendSpan]));

  // 2. API Gateway (SERVER)
  const spanId2 = generateSpanId();
  const gatewaySpan = buildSpan({
    traceId, spanId: spanId2, parentSpanId: spanId1,
    name: 'GET /users/profile',
    kind: SpanKind.SERVER,
    startTimeNs: baseTime + msToNs(10),
    endTimeNs: baseTime + msToNs(1150),
    attributes: [
      attr('http.method', 'GET'),
      attr('http.target', '/users/profile'),
      attr('http.status_code', authError ? 401 : userError || dbError ? 500 : 200),
      ...k8sAttrs('api-gateway'),
    ],
    status: { code: stage >= 0 ? StatusCode.ERROR : StatusCode.OK },
  });

  // 3. API Gateway → Auth (CLIENT)
  const spanId3 = generateSpanId();
  const authClientSpan = buildSpan({
    traceId, spanId: spanId3, parentSpanId: spanId2,
    name: 'auth.ValidateToken',
    kind: SpanKind.CLIENT,
    startTimeNs: baseTime + msToNs(20),
    endTimeNs: baseTime + msToNs(authError ? 550 : 150),
    attributes: [
      attr('http.method', 'POST'),
      attr('http.url', 'http://auth-service:8080/v1/ValidateToken'),
      attr('http.status_code', authError ? 401 : 200),
      attr('peer.service', 'auth-service'),
      ...k8sAttrs('api-gateway'),
    ],
    status: authError
      ? { code: StatusCode.ERROR, message: 'Invalid authentication token' }
      : { code: StatusCode.OK },
  });

  resourceSpansArray.push(buildResourceSpans('api-gateway', [gatewaySpan, authClientSpan]));

  // 4. Auth Service (SERVER)
  const spanId4 = generateSpanId();
  const authServerSpan = buildSpan({
    traceId, spanId: spanId4, parentSpanId: spanId3,
    name: 'ValidateToken',
    kind: SpanKind.SERVER,
    startTimeNs: baseTime + msToNs(30),
    endTimeNs: baseTime + msToNs(authError ? 520 : 130),
    attributes: [
      attr('http.method', 'POST'),
      attr('http.target', '/v1/ValidateToken'),
      attr('http.status_code', authError ? 401 : 200),
      ...k8sAttrs('auth-service'),
    ],
    status: authError
      ? { code: StatusCode.ERROR, message: 'Invalid authentication token' }
      : { code: StatusCode.OK },
    events: authError
      ? buildErrorEvents(baseTime + msToNs(30), 'AuthenticationError', 'Invalid authentication token')
      : [],
  });
  resourceSpansArray.push(buildResourceSpans('auth-service', [authServerSpan]));

  // Continue only if auth passed
  if (!authError) {
    // 5. API Gateway → User Service (CLIENT)
    const spanId5 = generateSpanId();
    const userClientSpan = buildSpan({
      traceId, spanId: spanId5, parentSpanId: spanId2,
      name: 'user.GetProfile',
      kind: SpanKind.CLIENT,
      startTimeNs: baseTime + msToNs(200),
      endTimeNs: baseTime + msToNs(900),
      attributes: [
        attr('http.method', 'GET'),
        attr('http.url', 'http://user-service:8080/v1/GetProfile'),
        attr('http.status_code', userError ? 500 : 200),
        attr('peer.service', 'user-service'),
        ...k8sAttrs('api-gateway'),
      ],
      status: userError
        ? { code: StatusCode.ERROR, message: 'User service error' }
        : { code: StatusCode.OK },
    });
    // Add to existing api-gateway resource or create new
    resourceSpansArray.push(buildResourceSpans('api-gateway', [userClientSpan]));

    // 6. User Service (SERVER)
    const spanId6 = generateSpanId();
    const userServerSpan = buildSpan({
      traceId, spanId: spanId6, parentSpanId: spanId5,
      name: 'GetProfile',
      kind: SpanKind.SERVER,
      startTimeNs: baseTime + msToNs(210),
      endTimeNs: baseTime + msToNs(880),
      attributes: [
        attr('http.method', 'GET'),
        attr('http.target', '/v1/GetProfile'),
        attr('http.status_code', userError ? 500 : 200),
        ...k8sAttrs('user-service'),
      ],
      status: userError
        ? { code: StatusCode.ERROR, message: 'Database error' }
        : { code: StatusCode.OK },
    });

    // 7. User Service → Database (CLIENT)
    const spanId7 = generateSpanId();
    const dbClientSpan = buildSpan({
      traceId, spanId: spanId7, parentSpanId: spanId6,
      name: 'db.Query',
      kind: SpanKind.CLIENT,
      startTimeNs: baseTime + msToNs(220),
      endTimeNs: baseTime + msToNs(850),
      attributes: [
        attr('db.system', 'postgresql'),
        attr('db.statement', 'SELECT * FROM users WHERE id = $1'),
        attr('peer.service', 'database'),
        ...k8sAttrs('user-service'),
      ],
      status: dbError
        ? { code: StatusCode.ERROR, message: 'Connection timeout' }
        : { code: StatusCode.OK },
    });
    resourceSpansArray.push(buildResourceSpans('user-service', [userServerSpan, dbClientSpan]));

    // 8. Database (SERVER)
    const spanId8 = generateSpanId();
    const dbServerSpan = buildSpan({
      traceId, spanId: spanId8, parentSpanId: spanId7,
      name: 'SELECT users',
      kind: SpanKind.SERVER,
      startTimeNs: baseTime + msToNs(230),
      endTimeNs: baseTime + msToNs(840),
      attributes: [
        attr('db.system', 'postgresql'),
        attr('http.status_code', dbError ? 500 : 200),
        ...k8sAttrs('database'),
      ],
      status: dbError
        ? { code: StatusCode.ERROR, message: 'Connection timeout' }
        : { code: StatusCode.OK },
      events: dbError
        ? buildErrorEvents(baseTime + msToNs(230), 'ConnectionTimeout', 'Connection timeout')
        : [],
    });
    resourceSpansArray.push(buildResourceSpans('database', [dbServerSpan]));
  }

  return {
    payload: buildTracePayload(resourceSpansArray),
    metadata: {
      traceId,
      flow: 'error_flow',
      errorStage: stage,
      services: authError
        ? ['frontend-app', 'api-gateway', 'auth-service']
        : ['frontend-app', 'api-gateway', 'auth-service', 'user-service', 'database'],
    },
  };
}

/**
 * Order Flow: Complex order creation with inventory check + payment + DB writes
 * frontend-app → api-gateway → order-service → inventory-service → database
 *                                order-service → payment-service
 *                                order-service → database
 *
 * Matches telemetry-generator.py order_flow
 */
function generateOrderFlow() {
  const traceId = generateTraceId();
  const now = Date.now();
  const baseTime = now * 1_000_000;
  const resourceSpansArray = [];

  // 1. Frontend (CLIENT)
  const spanId1 = generateSpanId();
  resourceSpansArray.push(buildResourceSpans('frontend-app', [buildSpan({
    traceId, spanId: spanId1,
    name: '/api/orders',
    kind: SpanKind.CLIENT,
    startTimeNs: baseTime,
    endTimeNs: baseTime + msToNs(3200),
    attributes: [
      attr('http.method', 'POST'),
      attr('http.url', 'http://api-gateway:8080/api/orders'),
      attr('http.status_code', 200),
      attr('peer.service', 'api-gateway'),
      attr('order_id', `order_${Math.floor(Math.random() * 90000) + 10000}`),
      ...k8sAttrs('frontend-app'),
    ],
    status: { code: StatusCode.OK },
  })]));

  // 2. API Gateway (SERVER)
  const spanId2 = generateSpanId();
  // 3. API Gateway → Order Service (CLIENT)
  const spanId3 = generateSpanId();
  resourceSpansArray.push(buildResourceSpans('api-gateway', [
    buildSpan({
      traceId, spanId: spanId2, parentSpanId: spanId1,
      name: 'POST /orders',
      kind: SpanKind.SERVER,
      startTimeNs: baseTime + msToNs(10),
      endTimeNs: baseTime + msToNs(3150),
      attributes: [
        attr('http.method', 'POST'), attr('http.target', '/orders'),
        attr('http.status_code', 200), ...k8sAttrs('api-gateway'),
      ],
      status: { code: StatusCode.OK },
    }),
    buildSpan({
      traceId, spanId: spanId3, parentSpanId: spanId2,
      name: 'order.Create',
      kind: SpanKind.CLIENT,
      startTimeNs: baseTime + msToNs(20),
      endTimeNs: baseTime + msToNs(3100),
      attributes: [
        attr('http.method', 'POST'),
        attr('http.url', 'http://order-service:8080/v1/Create'),
        attr('http.status_code', 200),
        attr('peer.service', 'order-service'),
        ...k8sAttrs('api-gateway'),
      ],
      status: { code: StatusCode.OK },
    }),
  ]));

  // 4. Order Service (SERVER)
  const spanId4 = generateSpanId();
  // 5. Order → Inventory (CLIENT)
  const spanId5 = generateSpanId();
  // 9. Order → Payment (CLIENT)
  const spanId9 = generateSpanId();
  // 11. Order → DB (CLIENT)
  const spanId11 = generateSpanId();
  resourceSpansArray.push(buildResourceSpans('order-service', [
    buildSpan({
      traceId, spanId: spanId4, parentSpanId: spanId3,
      name: 'CreateOrder',
      kind: SpanKind.SERVER,
      startTimeNs: baseTime + msToNs(30),
      endTimeNs: baseTime + msToNs(3080),
      attributes: [
        attr('http.method', 'POST'), attr('http.target', '/v1/Create'),
        attr('http.status_code', 200), ...k8sAttrs('order-service'),
      ],
      status: { code: StatusCode.OK },
    }),
    buildSpan({
      traceId, spanId: spanId5, parentSpanId: spanId4,
      name: 'inventory.Check',
      kind: SpanKind.CLIENT,
      startTimeNs: baseTime + msToNs(40),
      endTimeNs: baseTime + msToNs(600),
      attributes: [
        attr('http.method', 'GET'),
        attr('http.url', 'http://inventory-service:8080/v1/Check'),
        attr('http.status_code', 200),
        attr('peer.service', 'inventory-service'),
        ...k8sAttrs('order-service'),
      ],
      status: { code: StatusCode.OK },
    }),
    buildSpan({
      traceId, spanId: spanId9, parentSpanId: spanId4,
      name: 'payment.Process',
      kind: SpanKind.CLIENT,
      startTimeNs: baseTime + msToNs(650),
      endTimeNs: baseTime + msToNs(2100),
      attributes: [
        attr('http.method', 'POST'),
        attr('http.url', 'http://payment-service:8080/v1/Process'),
        attr('http.status_code', 200),
        attr('peer.service', 'payment-service'),
        ...k8sAttrs('order-service'),
      ],
      status: { code: StatusCode.OK },
    }),
    buildSpan({
      traceId, spanId: spanId11, parentSpanId: spanId4,
      name: 'db.Insert',
      kind: SpanKind.CLIENT,
      startTimeNs: baseTime + msToNs(2150),
      endTimeNs: baseTime + msToNs(3050),
      attributes: [
        attr('db.system', 'postgresql'),
        attr('db.statement', 'INSERT INTO orders VALUES ($1, $2, $3)'),
        attr('peer.service', 'database'),
        ...k8sAttrs('order-service'),
      ],
      status: { code: StatusCode.OK },
    }),
  ]));

  // 6. Inventory Service (SERVER)
  const spanId6 = generateSpanId();
  // 7. Inventory → DB (CLIENT)
  const spanId7 = generateSpanId();
  resourceSpansArray.push(buildResourceSpans('inventory-service', [
    buildSpan({
      traceId, spanId: spanId6, parentSpanId: spanId5,
      name: 'CheckStock',
      kind: SpanKind.SERVER,
      startTimeNs: baseTime + msToNs(50),
      endTimeNs: baseTime + msToNs(580),
      attributes: [
        attr('http.method', 'GET'), attr('http.target', '/v1/Check'),
        attr('http.status_code', 200), ...k8sAttrs('inventory-service'),
      ],
      status: { code: StatusCode.OK },
    }),
    buildSpan({
      traceId, spanId: spanId7, parentSpanId: spanId6,
      name: 'db.Query',
      kind: SpanKind.CLIENT,
      startTimeNs: baseTime + msToNs(60),
      endTimeNs: baseTime + msToNs(560),
      attributes: [
        attr('db.system', 'postgresql'),
        attr('db.statement', 'SELECT stock FROM inventory WHERE sku = $1'),
        attr('peer.service', 'database'),
        ...k8sAttrs('inventory-service'),
      ],
      status: { code: StatusCode.OK },
    }),
  ]));

  // 8. Database for inventory (SERVER)
  const spanId8 = generateSpanId();
  // 10. Payment Service (SERVER)
  const spanId10 = generateSpanId();
  // 12. Database for order insert (SERVER)
  const spanId12 = generateSpanId();
  resourceSpansArray.push(buildResourceSpans('database', [
    buildSpan({
      traceId, spanId: spanId8, parentSpanId: spanId7,
      name: 'SELECT inventory',
      kind: SpanKind.SERVER,
      startTimeNs: baseTime + msToNs(70),
      endTimeNs: baseTime + msToNs(550),
      attributes: [attr('db.system', 'postgresql'), attr('http.status_code', 200), ...k8sAttrs('database')],
      status: { code: StatusCode.OK },
    }),
    buildSpan({
      traceId, spanId: spanId12, parentSpanId: spanId11,
      name: 'INSERT orders',
      kind: SpanKind.SERVER,
      startTimeNs: baseTime + msToNs(2160),
      endTimeNs: baseTime + msToNs(3040),
      attributes: [attr('db.system', 'postgresql'), attr('http.status_code', 200), ...k8sAttrs('database')],
      status: { code: StatusCode.OK },
    }),
  ]));

  resourceSpansArray.push(buildResourceSpans('payment-service', [buildSpan({
    traceId, spanId: spanId10, parentSpanId: spanId9,
    name: 'ProcessPayment',
    kind: SpanKind.SERVER,
    startTimeNs: baseTime + msToNs(660),
    endTimeNs: baseTime + msToNs(2080),
    attributes: [
      attr('http.method', 'POST'), attr('http.target', '/v1/Process'),
      attr('http.status_code', 200),
      attr('amount', `${Math.floor(Math.random() * 490) + 10}.${String(Math.floor(Math.random() * 100)).padStart(2, '0')}`),
      ...k8sAttrs('payment-service'),
    ],
    status: { code: StatusCode.OK },
  })]));

  return {
    payload: buildTracePayload(resourceSpansArray),
    metadata: {
      traceId,
      flow: 'order_flow',
      services: ['frontend-app', 'api-gateway', 'order-service', 'inventory-service', 'payment-service', 'database'],
    },
  };
}

/**
 * Search Flow: Product search via Elasticsearch
 * frontend-app → api-gateway → search-service → elasticsearch
 *
 * Matches telemetry-generator.py search_flow
 */
function generateSearchFlow() {
  const traceId = generateTraceId();
  const now = Date.now();
  const baseTime = now * 1_000_000;
  const resourceSpansArray = [];

  const spanId1 = generateSpanId();
  resourceSpansArray.push(buildResourceSpans('frontend-app', [buildSpan({
    traceId, spanId: spanId1,
    name: '/api/search',
    kind: SpanKind.CLIENT,
    startTimeNs: baseTime,
    endTimeNs: baseTime + msToNs(900),
    attributes: [
      attr('http.method', 'GET'),
      attr('http.url', 'http://api-gateway:8080/api/search'),
      attr('http.status_code', 200),
      attr('peer.service', 'api-gateway'),
      attr('search_query', 'laptop'),
      ...k8sAttrs('frontend-app'),
    ],
    status: { code: StatusCode.OK },
  })]));

  const spanId2 = generateSpanId();
  const spanId3 = generateSpanId();
  resourceSpansArray.push(buildResourceSpans('api-gateway', [
    buildSpan({
      traceId, spanId: spanId2, parentSpanId: spanId1,
      name: 'GET /search',
      kind: SpanKind.SERVER,
      startTimeNs: baseTime + msToNs(10),
      endTimeNs: baseTime + msToNs(880),
      attributes: [
        attr('http.method', 'GET'), attr('http.target', '/search'),
        attr('http.status_code', 200), ...k8sAttrs('api-gateway'),
      ],
      status: { code: StatusCode.OK },
    }),
    buildSpan({
      traceId, spanId: spanId3, parentSpanId: spanId2,
      name: 'search.Query',
      kind: SpanKind.CLIENT,
      startTimeNs: baseTime + msToNs(20),
      endTimeNs: baseTime + msToNs(850),
      attributes: [
        attr('http.method', 'GET'),
        attr('http.url', 'http://search-service:8080/v1/Query'),
        attr('http.status_code', 200),
        attr('peer.service', 'search-service'),
        ...k8sAttrs('api-gateway'),
      ],
      status: { code: StatusCode.OK },
    }),
  ]));

  const spanId4 = generateSpanId();
  const spanId5 = generateSpanId();
  resourceSpansArray.push(buildResourceSpans('search-service', [
    buildSpan({
      traceId, spanId: spanId4, parentSpanId: spanId3,
      name: 'PerformSearch',
      kind: SpanKind.SERVER,
      startTimeNs: baseTime + msToNs(30),
      endTimeNs: baseTime + msToNs(830),
      attributes: [
        attr('http.method', 'GET'), attr('http.target', '/v1/Query'),
        attr('http.status_code', 200), ...k8sAttrs('search-service'),
      ],
      status: { code: StatusCode.OK },
    }),
    buildSpan({
      traceId, spanId: spanId5, parentSpanId: spanId4,
      name: 'es.Query',
      kind: SpanKind.CLIENT,
      startTimeNs: baseTime + msToNs(40),
      endTimeNs: baseTime + msToNs(800),
      attributes: [
        attr('db.system', 'elasticsearch'),
        attr('db.statement', '{"query":{"match":{"name":"laptop"}}}'),
        attr('peer.service', 'elasticsearch'),
        ...k8sAttrs('search-service'),
      ],
      status: { code: StatusCode.OK },
    }),
  ]));

  const spanId6 = generateSpanId();
  resourceSpansArray.push(buildResourceSpans('elasticsearch', [buildSpan({
    traceId, spanId: spanId6, parentSpanId: spanId5,
    name: 'search',
    kind: SpanKind.SERVER,
    startTimeNs: baseTime + msToNs(50),
    endTimeNs: baseTime + msToNs(790),
    attributes: [attr('db.system', 'elasticsearch'), attr('http.status_code', 200), ...k8sAttrs('elasticsearch')],
    status: { code: StatusCode.OK },
  })]));

  return {
    payload: buildTracePayload(resourceSpansArray),
    metadata: {
      traceId,
      flow: 'search_flow',
      services: ['frontend-app', 'api-gateway', 'search-service', 'elasticsearch'],
    },
  };
}

/**
 * Recommendation Flow: ML-based recommendations with cache layer
 * frontend-app → api-gateway → recommendation-service → ml-service → cache
 *
 * Matches telemetry-generator.py recommendation_flow
 */
function generateRecommendationFlow() {
  const traceId = generateTraceId();
  const now = Date.now();
  const baseTime = now * 1_000_000;
  const resourceSpansArray = [];

  const spanId1 = generateSpanId();
  resourceSpansArray.push(buildResourceSpans('frontend-app', [buildSpan({
    traceId, spanId: spanId1,
    name: '/api/recommendations',
    kind: SpanKind.CLIENT,
    startTimeNs: baseTime,
    endTimeNs: baseTime + msToNs(1800),
    attributes: [
      attr('http.method', 'GET'),
      attr('http.url', 'http://api-gateway:8080/api/recommendations'),
      attr('http.status_code', 200),
      attr('peer.service', 'api-gateway'),
      ...k8sAttrs('frontend-app'),
    ],
    status: { code: StatusCode.OK },
  })]));

  const spanId2 = generateSpanId();
  const spanId3 = generateSpanId();
  resourceSpansArray.push(buildResourceSpans('api-gateway', [
    buildSpan({
      traceId, spanId: spanId2, parentSpanId: spanId1,
      name: 'GET /recommendations',
      kind: SpanKind.SERVER,
      startTimeNs: baseTime + msToNs(10),
      endTimeNs: baseTime + msToNs(1780),
      attributes: [
        attr('http.method', 'GET'), attr('http.target', '/recommendations'),
        attr('http.status_code', 200), ...k8sAttrs('api-gateway'),
      ],
      status: { code: StatusCode.OK },
    }),
    buildSpan({
      traceId, spanId: spanId3, parentSpanId: spanId2,
      name: 'recommendation.Get',
      kind: SpanKind.CLIENT,
      startTimeNs: baseTime + msToNs(20),
      endTimeNs: baseTime + msToNs(1750),
      attributes: [
        attr('http.method', 'GET'),
        attr('http.url', 'http://recommendation-service:8080/v1/Get'),
        attr('http.status_code', 200),
        attr('peer.service', 'recommendation-service'),
        ...k8sAttrs('api-gateway'),
      ],
      status: { code: StatusCode.OK },
    }),
  ]));

  const spanId4 = generateSpanId();
  const spanId5 = generateSpanId();
  resourceSpansArray.push(buildResourceSpans('recommendation-service', [
    buildSpan({
      traceId, spanId: spanId4, parentSpanId: spanId3,
      name: 'GetRecommendations',
      kind: SpanKind.SERVER,
      startTimeNs: baseTime + msToNs(30),
      endTimeNs: baseTime + msToNs(1730),
      attributes: [
        attr('http.method', 'GET'), attr('http.target', '/v1/Get'),
        attr('http.status_code', 200), ...k8sAttrs('recommendation-service'),
      ],
      status: { code: StatusCode.OK },
    }),
    buildSpan({
      traceId, spanId: spanId5, parentSpanId: spanId4,
      name: 'ml.Predict',
      kind: SpanKind.CLIENT,
      startTimeNs: baseTime + msToNs(40),
      endTimeNs: baseTime + msToNs(1500),
      attributes: [
        attr('http.method', 'POST'),
        attr('http.url', 'http://ml-service:8080/v1/Predict'),
        attr('http.status_code', 200),
        attr('peer.service', 'ml-service'),
        ...k8sAttrs('recommendation-service'),
      ],
      status: { code: StatusCode.OK },
    }),
  ]));

  const spanId6 = generateSpanId();
  const spanId7 = generateSpanId();
  resourceSpansArray.push(buildResourceSpans('ml-service', [
    buildSpan({
      traceId, spanId: spanId6, parentSpanId: spanId5,
      name: 'RunInference',
      kind: SpanKind.SERVER,
      startTimeNs: baseTime + msToNs(50),
      endTimeNs: baseTime + msToNs(1480),
      attributes: [
        attr('http.method', 'POST'), attr('http.target', '/v1/Predict'),
        attr('http.status_code', 200), ...k8sAttrs('ml-service'),
      ],
      status: { code: StatusCode.OK },
    }),
    buildSpan({
      traceId, spanId: spanId7, parentSpanId: spanId6,
      name: 'cache.Get',
      kind: SpanKind.CLIENT,
      startTimeNs: baseTime + msToNs(60),
      endTimeNs: baseTime + msToNs(150),
      attributes: [
        attr('db.system', 'redis'),
        attr('db.statement', 'GET model_weights'),
        attr('peer.service', 'cache'),
        ...k8sAttrs('ml-service'),
      ],
      status: { code: StatusCode.OK },
    }),
  ]));

  const spanId8 = generateSpanId();
  resourceSpansArray.push(buildResourceSpans('cache', [buildSpan({
    traceId, spanId: spanId8, parentSpanId: spanId7,
    name: 'GET model_weights',
    kind: SpanKind.SERVER,
    startTimeNs: baseTime + msToNs(70),
    endTimeNs: baseTime + msToNs(140),
    attributes: [attr('db.system', 'redis'), attr('http.status_code', 200), ...k8sAttrs('cache')],
    status: { code: StatusCode.OK },
  })]));

  return {
    payload: buildTracePayload(resourceSpansArray),
    metadata: {
      traceId,
      flow: 'recommendation_flow',
      services: ['frontend-app', 'api-gateway', 'recommendation-service', 'ml-service', 'cache'],
    },
  };
}

/**
 * TC-016: Full production topology for UI testing
 * Generates the complete 17-service e-commerce platform topology
 * matching telemetry-generator.py with all 4 flow scenarios,
 * plus connection type variety (HTTP, gRPC, database, messaging)
 *
 * Architecture:
 *                        frontend-app
 *                             │
 *                        api-gateway
 *               ┌─────────┬──┴──┬──────────┐
 *          auth-service  order  search  recommendation
 *                        -svc   -svc      -svc
 *                    ┌────┼────┐           │
 *               inventory payment DB    ml-service
 *               -service  -svc           │
 *                    │                  cache
 *                 database
 *                    │
 *              elasticsearch
 *
 * Returns: Array of trace data objects
 */
function generateFullTopology({ tracesPerFlow = 3, errorRate = 0.2 } = {}) {
  const traces = [];

  // 4 production flow scenarios
  for (let i = 0; i < tracesPerFlow; i++) {
    traces.push(generateErrorFlow({ errorStage: Math.random() < errorRate ? Math.floor(Math.random() * 3) : -1 }));
    traces.push(generateOrderFlow());
    traces.push(generateSearchFlow());
    traces.push(generateRecommendationFlow());
  }

  // Additional connection types not in the flow scenarios
  for (let i = 0; i < tracesPerFlow; i++) {
    // gRPC: api-gateway → auth-service (token validation is often gRPC)
    traces.push(generateGrpcTrace({
      clientService: 'api-gateway',
      serverService: 'auth-service',
      rpcMethod: 'AuthService/ValidateToken',
      latencyMs: 10 + Math.floor(Math.random() * 20),
    }));

    // Kafka messaging: order-service → notification-service
    traces.push(generateMessagingTrace({
      producerService: 'order-service',
      consumerService: 'notification-service',
      messagingSystem: 'kafka',
      destination: 'order.events',
      latencyMs: 30 + Math.floor(Math.random() * 50),
    }));

    // Notification → Email via messaging
    traces.push(generateMessagingTrace({
      producerService: 'notification-service',
      consumerService: 'email-service',
      messagingSystem: 'kafka',
      destination: 'email.send',
      latencyMs: 20 + Math.floor(Math.random() * 30),
    }));

    // Analytics pipeline: order-service → analytics-service → data-warehouse
    traces.push(generateBasicTrace({
      clientService: 'order-service',
      serverService: 'analytics-service',
      operationName: 'event.Track',
      latencyMs: 50 + Math.floor(Math.random() * 30),
    }));
    traces.push(generateDatabaseTrace({
      clientService: 'analytics-service',
      dbService: 'data-warehouse',
      dbSystem: 'clickhouse',
      operationName: 'INSERT INTO events',
      latencyMs: 15 + Math.floor(Math.random() * 20),
    }));
  }

  const allServices = Object.keys(SERVICES);
  testLogger.info('Generated full production topology', {
    flowTypes: ['error_flow', 'order_flow', 'search_flow', 'recommendation_flow'],
    connectionTypes: ['http', 'grpc', 'database (postgresql/elasticsearch/redis/clickhouse)', 'messaging (kafka)'],
    totalTraces: traces.length,
    serviceCount: allServices.length,
    services: allServices,
  });

  return traces;
}

/**
 * Generate all edge case traces together
 */
function generateAllEdgeCases() {
  return [
    generateOrphanClientTrace(),
    generateOrphanServerTrace(),
    generateClockSkewTrace(),
    generateMissingParentIdTrace(),
    generateSelfLoopTrace(),
    generateCircularDependencyTrace(),
  ];
}

/**
 * TC-014: Generate traces targeting specific latency histogram buckets
 * Buckets: 5ms, 25ms, 100ms, 500ms, 2000ms
 */
function generateLatencyBucketTraces({
  clientService = 'api-gateway',
  serverService = 'order-service',
  tracesPerBucket = 5,
} = {}) {
  const buckets = [5, 25, 100, 500, 2000];
  const traces = [];

  for (const targetMs of buckets) {
    for (let i = 0; i < tracesPerBucket; i++) {
      // Small jitter within bucket
      const jitter = Math.floor(Math.random() * Math.max(1, targetMs * 0.1));
      traces.push(
        generateLatencyTrace({
          clientService,
          serverService,
          operationName: `latency_bucket_${targetMs}ms`,
          latencyMs: targetMs + jitter,
        })
      );
    }
  }

  return traces;
}

/**
 * TC-012: Generate N identical traces for request count accuracy
 */
function generateRequestCountTraces({
  clientService = 'api-gateway',
  serverService = 'order-service',
  count = 10,
} = {}) {
  const traces = [];
  for (let i = 0; i < count; i++) {
    traces.push(
      generateBasicTrace({
        clientService,
        serverService,
        operationName: 'count_test',
        latencyMs: 100 + Math.floor(Math.random() * 20),
      })
    );
  }
  return traces;
}

/**
 * TC-013: Generate mixed success/error traces for error rate accuracy
 */
function generateErrorRateTraces({
  clientService = 'api-gateway',
  serverService = 'order-service',
  totalCount = 20,
  errorCount = 4,
} = {}) {
  const traces = [];

  for (let i = 0; i < totalCount; i++) {
    if (i < errorCount) {
      traces.push(
        generateErrorTrace({
          clientService,
          serverService,
          operationName: 'error_rate_test',
          latencyMs: 1000,
          httpStatus: 500,
          errorType: 'InternalServerError',
          errorMessage: 'Simulated error for error rate testing',
        })
      );
    } else {
      traces.push(
        generateBasicTrace({
          clientService,
          serverService,
          operationName: 'error_rate_test',
          latencyMs: 100,
        })
      );
    }
  }

  // Shuffle so errors aren't all at the start
  for (let i = traces.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [traces[i], traces[j]] = [traces[j], traces[i]];
  }

  return traces;
}

// ============================================================================
// WAIT / POLLING UTILITIES
// ============================================================================

/**
 * Wait for the service graph daemon to process traces
 * Polls the topology API until edges appear or timeout
 */
async function waitForServiceGraphData(page, {
  maxWaitMs = 90000,
  pollIntervalMs = 5000,
  expectedMinEdges = 1,
} = {}) {
  const headers = getHeaders();
  const baseUrl = getBaseUrl();
  const orgId = getOrgId();
  const startTime = Date.now();

  while (Date.now() - startTime < maxWaitMs) {
    try {
      const response = await page.request.get(
        `${baseUrl}/api/${orgId}/traces/service_graph/topology/current`,
        { headers }
      );

      if (response.status() === 200) {
        const data = await response.json().catch(() => null);
        const edges = data?.edges || data?.data?.edges || [];

        if (edges.length >= expectedMinEdges) {
          testLogger.info('Service graph data available', {
            edgeCount: edges.length,
            waitedMs: Date.now() - startTime,
          });
          return { success: true, edges, waitedMs: Date.now() - startTime };
        }

        testLogger.debug('Polling service graph topology', {
          currentEdges: edges.length,
          expectedMinEdges,
        });
      }
    } catch (e) {
      testLogger.debug('Service graph poll error', { error: e.message });
    }

    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }

  testLogger.warn('Service graph poll timed out', { maxWaitMs });
  return { success: false, edges: [], waitedMs: maxWaitMs };
}

/**
 * Get current service graph topology
 */
async function getTopology(page) {
  const headers = getHeaders();
  const baseUrl = getBaseUrl();
  const orgId = getOrgId();

  try {
    const response = await page.request.get(
      `${baseUrl}/api/${orgId}/traces/service_graph/topology/current`,
      { headers }
    );

    const data = await response.json().catch(() => null);
    return { status: response.status(), data };
  } catch (e) {
    return { status: 500, data: { error: e.message } };
  }
}

// ============================================================================
// EXPORTS
// ============================================================================

module.exports = {
  // Constants
  SpanKind,
  StatusCode,
  ConnectionType,
  SERVICES,

  // Core utilities
  generateHexId,
  generateTraceId,
  generateSpanId,
  getTimestampNs,
  getHeaders,
  getBaseUrl,
  getOrgId,

  // Builders
  buildSpan,
  attr,
  k8sAttrs,
  buildResourceSpans,
  buildTracePayload,

  // Scenario generators (single-edge)
  generateBasicTrace,
  generateErrorTrace,
  generateDatabaseTrace,
  generateMessagingTrace,
  generateGrpcTrace,
  generateOrphanClientTrace,
  generateOrphanServerTrace,
  generateClockSkewTrace,
  generateMissingParentIdTrace,
  generateLatencyTrace,
  generateSelfLoopTrace,
  generateCircularDependencyTrace,
  generateMultiHopTrace,
  generateHighCardinalityTraces,

  // Production flow generators (multi-hop, matching telemetry-generator.py)
  generateErrorFlow,
  generateOrderFlow,
  generateSearchFlow,
  generateRecommendationFlow,

  // Ingestion
  ingestTrace,
  ingestTraces,
  ingestOutOfOrderSpans,
  ingestTraceToOrg,

  // Composite scenarios
  generateFullTopology,
  generateAllEdgeCases,
  generateLatencyBucketTraces,
  generateRequestCountTraces,
  generateErrorRateTraces,

  // Wait / polling
  waitForServiceGraphData,
  getTopology,
};
