/**
 * Base URL for data ingestion calls only: ZO_INGEST_URL when set, else the caller's own base.
 * @param {string} [fallback] the base the call site used before ZO_INGEST_URL existed
 * @returns {string} base URL without a trailing slash
 */
function ingestBase(fallback) {
  return (process.env.ZO_INGEST_URL || fallback || '').replace(/\/+$/, '');
}

module.exports = { ingestBase };
