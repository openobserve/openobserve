const crypto = require('crypto');
const testLogger = require('../../playwright-tests/utils/test-logger.js');
const { getAuthHeaders, getOrgIdentifier } = require('../../playwright-tests/utils/cloud-auth.js');

/**
 * OTLP traces ingestion for the GenAI v5 `parts` rendering tests.
 *
 * Mirrors `sdrTracesIngestionPage.ingestMultipleFields` (the SDR traces helper):
 * one span per call, POSTed to `/api/{org}/v1/traces` with the target stream in
 * the `stream-name` header. The difference is the attribute payload: instead of a
 * single field under test, each span carries the OTel GenAI semconv v5 attributes
 * (`gen_ai.operation.name`, `gen_ai.input.messages`, `gen_ai.tool.call.*`, ...)
 * as DOTTED keys. OpenObserve flattens `.` → `_` at ingest
 * (`src/config/src/utils/flatten.rs::format_key`), so the component reads
 * `gen_ai_input_messages`, `gen_ai_tool_call_id`, etc. Messages/instructions
 * attribute values are JSON-encoded strings (the caller stringifies them) because
 * `TraceDetailsSidebar` passes the raw field straight into `LLMContentRenderer`,
 * which `JSON.parse`s string content.
 */
export class GenAiTracesIngestionPage {
  constructor(page) {
    this.page = page;
  }

  static _hexId(bytes) {
    return crypto.randomBytes(bytes).toString('hex');
  }

  /**
   * Ingest ONE OTLP span carrying the given `gen_ai.*` dotted attributes into a
   * traces stream. Each attribute value must already be a JSON-encoded string.
   *
   * @param {string} streamName - target traces stream (set via `stream-name` header)
   * @param {Object} spec
   * @param {string} spec.name - span name (unique per test; also the search marker)
   * @param {number} [spec.kind=2] - OTLP span kind (2 = SERVER)
   * @param {Object<string, string>} spec.attributes - dotted `gen_ai.*` keys → JSON-string values
   * @param {number} [maxRetries=5]
   * @returns {Promise<{ name: string }>} the span name (doubles as the poll marker)
   */
  async ingestGenAiSpan(streamName, { name, kind = 2, attributes = {} }, maxRetries = 5) {
    const orgId = getOrgIdentifier();
    const headers = { ...getAuthHeaders(), 'stream-name': streamName };
    const baseUrl = (process.env.INGESTION_URL || process.env.ZO_BASE_URL).replace(/\/$/, '');

    const startNs = Date.now() * 1000000;
    const attrList = Object.entries(attributes).map(([key, value]) => ({
      key,
      value: { stringValue: String(value) },
    }));

    const span = {
      traceId: GenAiTracesIngestionPage._hexId(16),
      spanId: GenAiTracesIngestionPage._hexId(8),
      name,
      kind,
      startTimeUnixNano: String(startNs),
      endTimeUnixNano: String(startNs + 1000000),
      attributes: attrList,
      status: { code: 1 },
    };

    const traceData = {
      resourceSpans: [
        {
          resource: {
            attributes: [
              { key: 'service.name', value: { stringValue: 'genai-test-service' } },
            ],
          },
          scopeSpans: [
            {
              scope: { name: 'genai-e2e', version: '1.0.0' },
              spans: [span],
            },
          ],
        },
      ],
    };

    testLogger.info(`Preparing to ingest GenAI span "${name}" to stream ${streamName}`);

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const response = await this.page.request.post(`${baseUrl}/api/${orgId}/v1/traces`, {
          headers,
          data: traceData,
        });

        const status = response.status();
        const responseBody = await response.json().catch(() => ({ error: 'Failed to parse JSON' }));
        testLogger.info(`GenAI traces ingestion response (attempt ${attempt}/${maxRetries}) - Status: ${status}`);

        if (status === 200 || status === 206) {
          testLogger.info('GenAI traces ingestion successful');
          return { name };
        }

        const errorMessage = responseBody?.message || JSON.stringify(responseBody);
        if (errorMessage.includes('being deleted') && attempt < maxRetries) {
          const waitTime = attempt * 5000;
          testLogger.info(`Stream is being deleted, waiting ${waitTime / 1000}s before retry...`);
          await this.page.waitForTimeout(waitTime);
          continue;
        }

        testLogger.error(`GenAI traces ingestion failed! Status: ${status}, Response:`, responseBody);
        throw new Error(`GenAI traces ingestion failed with status ${status}: ${JSON.stringify(responseBody)}`);
      } catch (e) {
        if (attempt === maxRetries) {
          testLogger.error(`GenAI traces ingestion failed after ${maxRetries} attempts:`, e.message);
          throw e;
        }
        testLogger.info(`GenAI traces ingestion attempt ${attempt} failed, retrying...`);
        await this.page.waitForTimeout(attempt * 5000);
      }
    }
  }

  /**
   * Poll the traces search API until the ingested span (matched by its unique
   * `operation_name`) is searchable, so the UI never runs a search before the
   * stream schema/index has hydrated the span.
   *
   * @param {string} streamName - traces stream the span was ingested into
   * @param {string} operationName - the span's unique `name` (the poll marker)
   * @param {number} [maxAttempts=20]
   * @returns {Promise<boolean>} true once the span is searchable
   * @throws if the span is not searchable within maxAttempts
   */
  async pollForSpan(streamName, operationName, maxAttempts = 20) {
    const headers = getAuthHeaders();
    const baseUrl = process.env['ZO_BASE_URL'];
    const orgName = getOrgIdentifier();
    const sql = `SELECT * FROM "${streamName}" WHERE operation_name = '${operationName}' ORDER BY _timestamp DESC`;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const endTime = (Date.now() + 60000) * 1000;
      const startTime = endTime - 60 * 60 * 1000 * 1000;
      const searchPayload = {
        query: { sql, start_time: startTime, end_time: endTime, from: 0, size: 1000 },
      };

      let hits = [];
      try {
        const response = await this.page.request.post(
          `${baseUrl}/api/${orgName}/_search?type=traces`,
          { headers, data: searchPayload, timeout: 15000 }
        );
        if (response.ok()) {
          const data = await response.json().catch(() => null);
          hits = data?.hits || [];
        }
      } catch (error) {
        hits = [];
      }

      if (hits.length >= 1) {
        testLogger.info(`pollForSpan: span "${operationName}" is searchable in stream ${streamName}`);
        return true;
      }

      testLogger.info(`pollForSpan attempt ${attempt}/${maxAttempts}: waiting for span "${operationName}" to index...`);
      if (attempt < maxAttempts) {
        // Poll interval between search-API attempts — not a UI-sync sleep; the
        // terminal condition is the search-API hit count below.
        await this.page.waitForTimeout(3000);
      }
    }

    throw new Error(
      `pollForSpan: span "${operationName}" not searchable in stream ${streamName} after ${maxAttempts} attempts`
    );
  }
}
