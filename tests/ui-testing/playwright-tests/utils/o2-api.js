/**
 * Thin authenticated REST client for the destination/template/user endpoints.
 * Used by the DL suite to verify what the UI actually persisted — the form can
 * echo your input while the stored value differs (trimming, lowercasing,
 * empty entries), so every storage assertion reads the API, not the field.
 */
const BASE = process.env.ZO_BASE_URL || 'http://localhost:5080';
const ORG = process.env.ORGNAME || 'default';
const USER = process.env.ZO_ROOT_USER_EMAIL || 'root@example.com';
// The repo's documented default for local runs — the same value playwright.yml
// commits publicly. Not a secret; CI and any real environment override it.
const PASS = process.env.ZO_ROOT_USER_PASSWORD || 'Complexpass#123';
const AUTH = 'Basic ' + Buffer.from(`${USER}:${PASS}`).toString('base64');

async function req(method, path, body) {
  const res = await fetch(`${BASE}/api/${ORG}${path}`, {
    method,
    headers: { Authorization: AUTH, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch (_) { /* non-JSON body */ }
  return { status: res.status, body: json, text };
}

const getDestination = (name) => req('GET', `/alerts/destinations/${name}`);
const listDestinations = () => req('GET', '/alerts/destinations');
const createDestination = (payload) => req('POST', '/alerts/destinations', payload);
const deleteDestination = (name) => req('DELETE', `/alerts/destinations/${name}`);
const testDestination = (payload) => req('POST', '/alerts/destinations/test', payload);
const listTemplates = () => req('GET', '/alerts/templates');

/**
 * A destination recipient must be a user of the org — see the membership gate in
 * alerts/destinations.rs. A distribution-list alias is not a person, so the DL
 * fan-out case has to enrol the alias before it can be addressed at all.
 *
 * role MUST be 'admin': UserRoleRequest::from() (common/src/meta/user.rs) matches
 * the requested role string against get_roles() and, on no match, treats it as a
 * CUSTOM role — which core/src/users.rs::post_user rejects outright with 400 when
 * OpenFGA/RBAC is off (the OSS CI topology this suite actually runs in restricts
 * the standard-role set to Admin only). A lower role 400s the create outright,
 * which is worse for the "stray privileged account" concern this once tried to
 * avoid — cleanup being flag-gated (see dlUserCreated below) is the real mitigation.
 */
const createOrgUser = (email) => req('POST', '/users', {
  email, first_name: 'dl', last_name: 'alias',
  password: PASS,
  role: 'admin',
});
const deleteOrgUser = (email) => req('DELETE', `/users/${encodeURIComponent(email)}`);
const getTemplate = (name) => req('GET', `/alerts/templates/${name}`);

/** Stored recipients for a destination, or null when it does not exist. */
async function storedRecipients(name) {
  const r = await getDestination(name);
  if (r.status !== 200 || !r.body) return null;
  return r.body.emails;
}

module.exports = {
  BASE, ORG, req, getDestination, listDestinations, createDestination,
  deleteDestination, testDestination, listTemplates, getTemplate, storedRecipients,
  createOrgUser, deleteOrgUser,
};
