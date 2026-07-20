// RUM token API helper
// --------------------------------------------------------------------------
// Thin wrappers over the RUM token REST API used by the RUM E2E specs.
//   GET  /api/{org}/rumtoken  -> read current token
//   POST /api/{org}/rumtoken  -> create / reset token
// Auth works regardless of the browser storageState. Credential selection,
// org-id validation and the plain-HTTP guard live in rum-env.js — prefer a
// dedicated least-privilege account via ZO_RUM_TEST_EMAIL/PASSWORD.

const testLogger = require('./test-logger.js');
const { rumTestContext, basicAuthHeader } = require('./rum-env.js');

const ctx = rumTestContext;
const authHeader = basicAuthHeader;

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
