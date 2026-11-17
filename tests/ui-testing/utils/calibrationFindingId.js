// Copyright 2026 OpenObserve Inc.

const crypto = require('crypto');

/**
 * The server's finding identity (ENT autoobserve/insight.rs `finding_identity`):
 * SHA-256 over org, rule family, scope kind and scope key, each prefixed by its
 * byte length as a big-endian u64, so a dismissal outlives the run that found it.
 */
function calibrationFindingId(org, ruleFamily, scopeKind, scopeKey) {
  const hash = crypto.createHash('sha256');
  for (const part of [org, ruleFamily, scopeKind, scopeKey]) {
    const bytes = Buffer.from(part, 'utf8');
    const length = Buffer.alloc(8);
    length.writeBigUInt64BE(BigInt(bytes.length));
    hash.update(length);
    hash.update(bytes);
  }
  return hash.digest('hex');
}

/** The server's own pin (insight.rs tests), so a drift fails here before any fixture is built. */
const PINNED_ID = 'f49d3499f38e5e8a374debbca25af38c40c34d9b6c9e96ba68746e17883073f9';

function assertCalibrationFindingIdPin() {
  const id = calibrationFindingId('acme', 'noise', 'alert', 'a1');
  if (id !== PINNED_ID) {
    throw new Error(`calibrationFindingId drifted from the server: ${id}`);
  }
}

module.exports = { calibrationFindingId, assertCalibrationFindingIdPin, PINNED_ID };
