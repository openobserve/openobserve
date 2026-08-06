const crypto = require('crypto');
const testLogger = require('../../playwright-tests/utils/test-logger.js');
const { getAuthHeaders, getOrgIdentifier } = require('../../playwright-tests/utils/cloud-auth.js');

/**
 * Traces-flavoured ingestion for SDR (Sensitive Data Redaction) tests.
 *
 * This is the traces analogue of `logsPage.ingestMultipleFields`. The SDR specs
 * are stream-type agnostic above the ingest/verify seam — they create regex
 * patterns, associate them with a stream's field, ingest a batch, then assert
 * the field is redacted/hashed/dropped. Only two things differ per stream type:
 *   1) how the batch is written (this file, for traces), and
 *   2) how it is read back (`sdrVerificationPage`, via `?type=traces`).
 *
 * Each descriptor `{ fieldName, fieldValue }` is written as its OWN span, so the
 * traces stream ends up with one record per field — exactly mirroring the logs
 * helper's one-record-per-field shape, which is what `verifyMultipleFields`
 * (minCount = number of fields) expects.
 *
 * The test field is carried as a span ATTRIBUTE. OpenObserve flattens span
 * attributes to top-level string fields at ingest (`span_attribute_key` +
 * `flatten::format_key`), so a plain snake_case attribute key with no dots and
 * no reserved-field collision (e.g. `user_email`) lands as the identical
 * top-level field name — the same field the pattern engine matches on and the
 * same field the specs assert on. Every span also carries the per-batch
 * `sdr_test_id` marker attribute so verification can query ONLY this batch.
 */
export class SDRTracesIngestionPage {
  constructor(page) {
    this.page = page;
  }

  static _hexId(bytes) {
    return crypto.randomBytes(bytes).toString('hex');
  }

  /**
   * Ingest one span per `{ fieldName, fieldValue }` into a TRACES stream via the
   * OTLP JSON endpoint (`/api/{org}/v1/traces`, `stream-name` header). Retries on
   * the transient "stream is being deleted" race, mirroring the logs helper.
   *
   * @param {string} streamName - target traces stream (set via `stream-name` header)
   * @param {Array<{fieldName: string, fieldValue: string}>} dataObjects
   * @param {number} maxRetries
   * @returns {Promise<string>} the per-batch `sdr_test_id` marker
   */
  async ingestMultipleFields(streamName, dataObjects, maxRetries = 5) {
    const orgId = getOrgIdentifier();
    // OTLP traces are ingested via /v1/traces with the target stream in the
    // `stream-name` header (config: ZO_GRPC_STREAM_HEADER_KEY, default stream-name).
    const headers = { ...getAuthHeaders(), 'stream-name': streamName };

    const baseUrl = (process.env.INGESTION_URL || process.env.ZO_BASE_URL).replace(/\/$/, '');

    // Unique per-batch marker. Verification queries the traces search API by this
    // exact value (WHERE sdr_test_id = '<marker>'), so it inspects ONLY the records
    // this call ingested — never stale rows from an earlier batch on the same stream.
    const marker = `sdr-${crypto.randomUUID()}`;

    // OTLP timestamps are nanoseconds. Space spans 1ms apart so they are distinct
    // records with a stable order, matching the logs helper's per-entry timestamps.
    const baseTimeNs = Date.now() * 1000000;

    const spans = dataObjects.map(({ fieldName, fieldValue }, index) => {
      const startNs = baseTimeNs + index * 1000000;
      return {
        traceId: SDRTracesIngestionPage._hexId(16),
        spanId: SDRTracesIngestionPage._hexId(8),
        name: `sdr-test-span-${index}`,
        kind: 2, // SERVER
        startTimeUnixNano: String(startNs),
        endTimeUnixNano: String(startNs + 1000000),
        attributes: [
          // The field under test — becomes the top-level field `fieldName`.
          { key: fieldName, value: { stringValue: String(fieldValue) } },
          // Per-batch isolation marker — becomes the top-level field `sdr_test_id`.
          { key: 'sdr_test_id', value: { stringValue: marker } },
        ],
        status: { code: 1 }, // OK
      };
    });

    const traceData = {
      resourceSpans: [
        {
          resource: {
            attributes: [
              { key: 'service.name', value: { stringValue: 'sdr-test-service' } },
            ],
          },
          scopeSpans: [
            {
              scope: { name: 'sdr-e2e', version: '1.0.0' },
              spans,
            },
          ],
        },
      ],
    };

    testLogger.info(`Preparing to ingest ${spans.length} trace span(s) to stream ${streamName} (marker: ${marker})`);

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const response = await this.page.request.post(`${baseUrl}/api/${orgId}/v1/traces`, {
          headers,
          data: traceData,
        });

        const status = response.status();
        const responseBody = await response.json().catch(() => ({ error: 'Failed to parse JSON' }));
        testLogger.info(`Traces ingestion response (attempt ${attempt}/${maxRetries}) - Status: ${status}, Body:`, responseBody);

        // OTLP returns 200 on full success and 206 on partial success.
        if (status === 200 || status === 206) {
          testLogger.info('Traces ingestion successful, waiting for indexing...');
          // Small head start to reduce poll iterations — verification polls the
          // traces search API for this marker, so this is not the readiness gate.
          await this.page.waitForTimeout(5000);
          return marker;
        }

        const errorMessage = responseBody?.message || JSON.stringify(responseBody);
        if (errorMessage.includes('being deleted') && attempt < maxRetries) {
          const waitTime = attempt * 5000;
          testLogger.info(`Stream is being deleted, waiting ${waitTime / 1000}s before retry...`);
          await this.page.waitForTimeout(waitTime);
          continue;
        }

        testLogger.error(`Traces ingestion failed! Status: ${status}, Response:`, responseBody);
        throw new Error(`Traces ingestion failed with status ${status}: ${JSON.stringify(responseBody)}`);
      } catch (e) {
        if (attempt === maxRetries) {
          testLogger.error(`Traces ingestion failed after ${maxRetries} attempts:`, e.message);
          throw e;
        }
        testLogger.info(`Traces ingestion attempt ${attempt} failed, retrying...`);
        await this.page.waitForTimeout(attempt * 5000);
      }
    }
  }
}
