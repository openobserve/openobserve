// Validated environment context for the RUM e2e utilities.
// --------------------------------------------------------------------------
// Centralizes how RUM helpers read ZO_BASE_URL / ORGNAME / credentials so the
// security constraints live in ONE place:
//
//   1. Credentials — prefers a dedicated least-privilege service account
//      (ZO_RUM_TEST_EMAIL / ZO_RUM_TEST_PASSWORD) when provided; falls back to
//      the root user, which is acceptable only for local & CI instances.
//   2. Transport — Basic auth is base64, NOT encryption. Plain http:// is
//      refused for non-loopback hosts unless ZO_ALLOW_INSECURE_HTTP=true is
//      set explicitly (isolated lab instances only — never production).
//   3. Org id — validated against a strict allowlist pattern before it is
//      interpolated into URL paths, so a hostile ORGNAME value cannot inject
//      path traversal ("../") or query/fragment characters.

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]', '0.0.0.0']);

// OpenObserve org identifiers are alphanumeric with `_` / `-` (e.g. "default",
// "org_2Ab3..."). Anything else is rejected rather than sanitized.
const ORG_ID_PATTERN = /^[A-Za-z0-9_-]+$/;

/** ORGNAME, validated for safe use inside a URL path segment. */
function validatedOrgId() {
  const orgId = process.env.ORGNAME || 'default';
  if (!ORG_ID_PATTERN.test(orgId)) {
    throw new Error(
      `ORGNAME "${orgId}" contains characters outside [A-Za-z0-9_-]; ` +
      'refusing to interpolate it into an API path',
    );
  }
  return orgId;
}

/** ZO_BASE_URL, validated and stripped of any trailing slash. */
function validatedBaseUrl() {
  const raw = process.env.ZO_BASE_URL || 'http://localhost:5080';
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`ZO_BASE_URL "${raw}" is not a valid URL`);
  }

  const insecureRemote = url.protocol === 'http:' && !LOOPBACK_HOSTS.has(url.hostname);
  if (insecureRemote && process.env.ZO_ALLOW_INSECURE_HTTP !== 'true') {
    throw new Error(
      `Refusing to send Basic auth over plain HTTP to non-local host "${url.hostname}". ` +
      'Use https://, or set ZO_ALLOW_INSECURE_HTTP=true ONLY for an isolated lab instance — never production.',
    );
  }
  return raw.replace(/\/$/, '');
}

/**
 * Test credentials. A dedicated service account (least privilege) wins over
 * the root user when configured.
 */
function credentials() {
  const email = process.env.ZO_RUM_TEST_EMAIL || process.env.ZO_ROOT_USER_EMAIL;
  const password = process.env.ZO_RUM_TEST_PASSWORD || process.env.ZO_ROOT_USER_PASSWORD;
  if (!email || !password) {
    throw new Error(
      'No test credentials configured — set ZO_RUM_TEST_EMAIL/ZO_RUM_TEST_PASSWORD ' +
      '(preferred, least-privilege) or ZO_ROOT_USER_EMAIL/ZO_ROOT_USER_PASSWORD',
    );
  }
  return { email, password };
}

/** Validated {orgId, baseUrl, email, password} for RUM API helpers. */
function rumTestContext() {
  const { email, password } = credentials();
  return { orgId: validatedOrgId(), baseUrl: validatedBaseUrl(), email, password };
}

function basicAuthHeader(email, password) {
  return `Basic ${Buffer.from(`${email}:${password}`).toString('base64')}`;
}

module.exports = { rumTestContext, basicAuthHeader, validatedOrgId, validatedBaseUrl };
