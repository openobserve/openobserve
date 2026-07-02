// RUM token API helper
// --------------------------------------------------------------------------
// Thin wrappers over the RUM token REST API used by the RUM E2E specs.
//   GET  /api/{org}/rumtoken  -> read current token
//   POST /api/{org}/rumtoken  -> create / reset token
// Auth uses the root user's Basic auth (same pattern as rum-error-ingestion.js)
// so it works regardless of the browser storageState.

const testLogger = require('./test-logger.js');

function ctx() {
  return {
    orgId: process.env['ORGNAME'] || 'default',
    baseUrl: process.env['ZO_BASE_URL'] || 'http://localhost:5080',
    email: process.env['ZO_ROOT_USER_EMAIL'],
    password: process.env['ZO_ROOT_USER_PASSWORD'],
  };
}

function authHeader(email, password) {
  return `Basic ${Buffer.from(`${email}:${password}`).toString('base64')}`;
}

function extractToken(body) {
  // GET returns { data: { rum_token } }; POST returns { data: { new_key } }.
  return (
    body?.data?.rum_token ||
    body?.rum_token ||
    body?.data?.new_key ||
    body?.new_key ||
    null
  );
}

/** Read the current RUM token, or null if none exists yet. */
async function getRumToken(page) {
  const { orgId, baseUrl, email, password } = ctx();
  const res = await page.request
    .get(`${baseUrl}/api/${orgId}/rumtoken`, {
      headers: { Authorization: authHeader(email, password) },
    })
    .catch((e) => {
      testLogger.warn('getRumToken request failed', { error: e.message });
      return null;
    });
  if (!res || !res.ok()) return null;
  const body = await res.json().catch(() => null);
  return extractToken(body);
}

/** Create / reset the RUM token and return the new token string. */
async function resetRumToken(page) {
  const { orgId, baseUrl, email, password } = ctx();
  const res = await page.request.post(`${baseUrl}/api/${orgId}/rumtoken`, {
    headers: { Authorization: authHeader(email, password) },
  });
  if (!res.ok()) {
    throw new Error(`resetRumToken failed: HTTP ${res.status()}`);
  }
  const body = await res.json().catch(() => null);
  const token = extractToken(body);
  if (!token) throw new Error('resetRumToken: no token in response');
  return token;
}

/** Read the current token, creating one if it does not exist yet. */
async function getOrCreateRumToken(page) {
  const existing = await getRumToken(page);
  if (existing) return existing;
  return resetRumToken(page);
}

module.exports = { getRumToken, resetRumToken, getOrCreateRumToken };
