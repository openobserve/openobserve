const { expect } = require('@playwright/test');
const testLogger = require('../../playwright-tests/utils/test-logger.js');
const { getAuthHeaders, getOrgIdentifier } = require('../../playwright-tests/utils/cloud-auth.js');

/**
 * SDR (Sensitive Data Redaction) verification.
 *
 * Verification reads the Search API (`/_search`) directly instead of scraping the
 * logs results table. The search response IS the source of truth for SDR:
 *   - query-time redaction/hashing/drop is applied server-side in the search
 *     pipeline, so the API hits already contain `[REDACTED]` / `[REDACTED:hash]`
 *     or omit dropped fields — exactly what the UI would render;
 *   - ingestion-time transforms are baked into the stored record, so they show up
 *     in the hits too.
 *
 * Every ingest tags its records with a unique `sdr_test_id` marker (see
 * `logsPage.ingestMultipleFields` / the specs' `ingestSingleLog`). Verification
 * queries by that marker, so it inspects ONLY the batch under test and never races
 * against stale rows, virtualization, or highlight-HTML in the DOM table. Readiness
 * is a precise count gate (we know exactly how many records we ingested), not a
 * best-effort retry against the rendered table.
 */
export class SDRVerificationPage {
  constructor(page) {
    this.page = page;
  }

  /**
   * Field-state predicates over a single search hit (a record object).
   * `[REDACTED:<32 hex>]` is the hash marker; a bare `[REDACTED]` is a redaction.
   * Note `'[REDACTED:abc]'.includes('[REDACTED]')` is false, so redact and hash
   * never alias each other.
   */
  static _fieldValue(hit, fieldName) {
    const value = hit?.[fieldName];
    return value === undefined || value === null ? null : String(value);
  }
  static _isPresent(hit, fieldName) {
    return SDRVerificationPage._fieldValue(hit, fieldName) !== null;
  }
  static _isRedacted(value) {
    return typeof value === 'string' && value.includes('[REDACTED]');
  }
  static _isHashed(value) {
    return typeof value === 'string' && /\[REDACTED:[0-9a-f]{32}\]/i.test(value);
  }
  static _looksRedactedOrHashed(value) {
    return typeof value === 'string' && /\[REDACTED/.test(value);
  }

  /**
   * Poll the Search API for records tagged with `marker` until at least `minCount`
   * are searchable. Records are returned newest-first. The poll only waits out async
   * ingestion indexing for THIS batch — once `minCount` records appear, any SDR
   * transform on them is already final, so the result is deterministic.
   *
   * @returns {Promise<Object[]>} hit objects (may be fewer than minCount on timeout)
   */
  async fetchRecordsByMarker(streamName, marker, minCount = 1) {
    expect(marker, 'SDR verification requires an ingest marker — pass the value returned by ingestMultipleFields/ingestSingleLog').toBeTruthy();

    const headers = getAuthHeaders();
    const baseUrl = process.env['ZO_BASE_URL'];
    const orgName = getOrgIdentifier();
    const sql = `SELECT * FROM "${streamName}" WHERE sdr_test_id = '${marker}' ORDER BY _timestamp DESC`;

    const maxAttempts = 20; // ~60s ceiling at 3s/attempt — generous for CI index lag
    let hits = [];

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const endTime = (Date.now() + 60000) * 1000; // +1m future buffer (microseconds)
      const startTime = endTime - 60 * 60 * 1000 * 1000; // 60-minute lookback window

      const searchPayload = {
        query: { sql, start_time: startTime, end_time: endTime, from: 0, size: 1000 },
      };

      try {
        const response = await this.page.request.post(
          `${baseUrl}/api/${orgName}/_search?type=logs`,
          { headers, data: searchPayload, timeout: 15000 }
        );
        if (!response.ok()) {
          // A non-2xx is a real failure (auth/server error), not indexing lag —
          // surface it distinctly instead of silently treating it as "no records yet".
          const body = await response.text().catch(() => '');
          testLogger.warn(`fetchRecordsByMarker attempt ${attempt}: search returned HTTP ${response.status()} — ${body.slice(0, 200)}`);
          hits = [];
        } else {
          const data = await response.json().catch(() => null);
          hits = data?.hits || [];
        }
      } catch (error) {
        testLogger.warn(`fetchRecordsByMarker attempt ${attempt}: search request failed: ${error.message}`);
        hits = [];
      }

      if (hits.length >= minCount) {
        testLogger.info(`fetchRecordsByMarker: ${hits.length} record(s) for marker ${marker} (need ${minCount})`);
        return hits;
      }

      testLogger.info(`fetchRecordsByMarker attempt ${attempt}/${maxAttempts}: ${hits.length}/${minCount} records for marker ${marker}, waiting for indexing...`);
      if (attempt < maxAttempts) {
        await this.page.waitForTimeout(3000);
      }
    }

    testLogger.warn(`fetchRecordsByMarker: returning ${hits.length} record(s) for marker ${marker} after ${maxAttempts} attempts (needed ${minCount})`);
    return hits;
  }

  /**
   * Verify a single field on the record just ingested with `marker`.
   * Used by sequential flows that re-ingest to the same stream and assert on the
   * latest write (and on query-time transforms applied to an existing record by
   * reusing that record's marker).
   *
   * @param {Object} logsPage - kept for call-site compatibility (unused; API-based)
   * @param {string} marker   - marker returned by the ingest that wrote this record
   */
  async verifySingleFieldInLatestLog(logsPage, streamName, fieldName, shouldBeDropped, shouldBeRedacted, marker) {
    testLogger.info(`Verifying field: ${fieldName}, shouldBeDropped: ${shouldBeDropped}, shouldBeRedacted: ${shouldBeRedacted}, marker: ${marker}`);

    const hits = await this.fetchRecordsByMarker(streamName, marker, 1);
    expect(hits.length, `No record found for marker ${marker} in stream ${streamName}`).toBeGreaterThan(0);

    const hit = hits[0];
    const value = SDRVerificationPage._fieldValue(hit, fieldName);

    if (shouldBeDropped) {
      expect(value, `Field ${fieldName} should have been DROPPED but was found: ${value}`).toBeNull();
      testLogger.info(`✓ Field ${fieldName} is correctly DROPPED (absent from record)`);
    } else if (shouldBeRedacted) {
      expect(value, `Field ${fieldName} should be present but was not found in record`).not.toBeNull();
      expect(SDRVerificationPage._isRedacted(value), `Field ${fieldName} should be REDACTED but value was: ${value}`).toBe(true);
      testLogger.info(`✓ Field ${fieldName} is correctly REDACTED`);
    } else {
      expect(value, `Field ${fieldName} should be visible but was not found in record`).not.toBeNull();
      expect(SDRVerificationPage._looksRedactedOrHashed(value), `Field ${fieldName} should be visible but appears redacted/hashed: ${value}`).toBe(false);
      testLogger.info(`✓ Field ${fieldName} is visible with actual value`);
    }
  }

  /**
   * Verify multiple fields written by one ingest batch (each field lives in its own
   * record). Each descriptor: { fieldName, shouldBeDropped?, shouldBeRedacted?, shouldBeHashed? }.
   * Default (all flags false/absent): field must be present and not redacted/hashed.
   *
   * @param {Object} logsPage - kept for call-site compatibility (unused; API-based)
   * @param {string} marker   - marker returned by the ingest under test
   */
  async verifyMultipleFields(logsPage, streamName, fieldsToVerify, marker) {
    testLogger.info(`Verifying ${fieldsToVerify.length} fields in stream: ${streamName} (marker: ${marker})`);

    const hits = await this.fetchRecordsByMarker(streamName, marker, fieldsToVerify.length);
    expect(hits.length, `Expected ${fieldsToVerify.length} records for marker ${marker} but found ${hits.length}`).toBeGreaterThanOrEqual(fieldsToVerify.length);

    for (const { fieldName, shouldBeDropped, shouldBeRedacted, shouldBeHashed } of fieldsToVerify) {
      testLogger.info(`Verifying field: ${fieldName}`);

      // The record carrying this field (present-and-non-null). For a dropped field
      // no record will carry it, which is exactly what we assert below.
      const carrier = hits.find((hit) => SDRVerificationPage._isPresent(hit, fieldName));
      const value = carrier ? SDRVerificationPage._fieldValue(carrier, fieldName) : null;

      if (shouldBeDropped) {
        expect(carrier, `Field ${fieldName} should be DROPPED but was found in a record: ${value}`).toBeFalsy();
        testLogger.info(`✓ Field ${fieldName} is correctly DROPPED`);
      } else if (shouldBeRedacted) {
        expect(carrier, `Field ${fieldName} should be present but was not found`).toBeTruthy();
        expect(SDRVerificationPage._isRedacted(value), `Field ${fieldName} should contain [REDACTED] marker but was: ${value}`).toBe(true);
        testLogger.info(`✓ Field ${fieldName} is correctly REDACTED`);
      } else if (shouldBeHashed) {
        expect(carrier, `Field ${fieldName} should be present but was not found`).toBeTruthy();
        expect(SDRVerificationPage._isHashed(value), `Field ${fieldName} should be in [REDACTED:hash] format but was: ${value}`).toBe(true);
        testLogger.info(`✓ Field ${fieldName} is correctly HASHED: ${value}`);
      } else {
        expect(carrier, `Field ${fieldName} should be visible but was not found`).toBeTruthy();
        expect(SDRVerificationPage._looksRedactedOrHashed(value), `Field ${fieldName} should be visible but appears redacted/hashed: ${value}`).toBe(false);
        testLogger.info(`✓ Field ${fieldName} is visible with actual value`);
      }
    }
  }

  /**
   * Verify that every field in `fieldNames` is absent from the batch tagged with
   * `marker`. Used for ingestion-time DROP, where the dropped fields never reach
   * storage for the post-pattern batch.
   *
   * @param {Object} logsPage - kept for call-site compatibility (unused; API-based)
   * @param {string} marker   - marker of the post-drop ingest batch
   */
  async verifyFieldsAreAbsent(logsPage, streamName, fieldNames, marker) {
    testLogger.info(`Verifying ${fieldNames.length} fields are ABSENT in stream ${streamName} (marker: ${marker})`);

    const hits = await this.fetchRecordsByMarker(streamName, marker, fieldNames.length);
    expect(hits.length, `Expected ${fieldNames.length} records for marker ${marker} but found ${hits.length}`).toBeGreaterThanOrEqual(fieldNames.length);

    for (const fieldName of fieldNames) {
      const carrier = hits.find((hit) => SDRVerificationPage._isPresent(hit, fieldName));
      const value = carrier ? SDRVerificationPage._fieldValue(carrier, fieldName) : null;
      expect(carrier, `Field ${fieldName} should be DROPPED but was found in a record: ${value}`).toBeFalsy();
      testLogger.info(`✓ Field ${fieldName} is correctly absent`);
    }
  }
}
