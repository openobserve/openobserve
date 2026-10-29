// O2 reaches the Slack mock through O2_SLACK_API_BASE_URL; ids and names here are synthetic (T0PW*, U0DANA, acme.test).

const { getAuthHeaders } = require('../../playwright-tests/utils/cloud-auth.js');

const BASE = () => process.env.ZO_BASE_URL || 'http://localhost:5080';
const MOCK = () => process.env.SLACK_MOCK_URL || 'http://127.0.0.1:5099';

const uniq = () => `${Date.now().toString(36).slice(-5)}${Math.random().toString(36).slice(2, 5)}`;

/** The `mock.` code the mock's oauth.v2.access / openid.connect.token decode (claims fold nonce and state). */
function mockCode(claims) {
  return `mock.${Buffer.from(JSON.stringify(claims)).toString('base64url')}`;
}

async function call(request, method, path, data) {
  const opts = { headers: getAuthHeaders(), failOnStatusCode: false };
  if (data !== undefined) opts.data = data;
  const response = await request[method](`${BASE()}${path}`, opts);
  const text = await response.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch (_) {
    body = text;
  }
  return { status: response.status(), body, text };
}

async function ok(request, method, path, data) {
  const r = await call(request, method, path, data);
  if (r.status >= 300) throw new Error(`${method.toUpperCase()} ${path} -> ${r.status}: ${r.text}`);
  return r.body;
}

/** A fresh org owned by the root user, so parallel spec files never share an installation. */
async function createOrg(request, prefix = 'slack_pw') {
  const name = `${prefix}_${uniq()}`;
  const body = await ok(request, 'post', '/api/organizations', { name });
  return { name, id: body.identifier };
}

async function orgConfig(request, org) {
  return ok(request, 'get', `/api/${org}/config`);
}

async function listInstallations(request, org) {
  return ok(request, 'get', `/api/${org}/slack/installations`);
}

async function prerequisites(request, org) {
  return ok(request, 'get', `/api/${org}/slack/prerequisites`);
}

/** Row 6 on the main path: the mock rotates the token and creates the app; the install stays pending. */
async function createPendingInstall(request, org, { mode = 'socket', channelHistory = false } = {}) {
  return ok(request, 'post', `/api/${org}/slack/installations`, {
    mode,
    config_refresh_token: `xoxe-1-pw-${uniq()}`,
    channel_history: channelHistory,
  });
}

function authorizeParams(url) {
  const q = new URL(url).searchParams;
  return {
    state: q.get('state'),
    nonce: q.get('nonce'),
    redirectUri: q.get('redirect_uri') || `${BASE()}/web/slack/oauth/callback`,
  };
}

/** Rows 7 and 2: what Allow in the popup does, done over the API. */
async function finishInstall(request, org, installationId, { teamId, teamName }) {
  const { authorize_url: url } = await ok(
    request,
    'post',
    `/api/${org}/slack/installations/${encodeURIComponent(installationId)}/install-url`,
  );
  const { state } = authorizeParams(url);
  const code = mockCode({ team_id: teamId, team_name: teamName, state });
  return ok(request, 'post', `/api/${org}/slack/install/exchange`, { code, state });
}

/** An app-level token of `appId`: O2 refuses a token whose xapp-1-<app id>- segment names another app. */
const appToken = (appId) => `xapp-1-${appId}-1-pw${uniq()}`;

async function saveAppToken(request, org, installationId, appId) {
  return ok(request, 'put', `/api/${org}/slack/installations/${encodeURIComponent(installationId)}/credentials`, {
    app_token: appToken(appId),
  });
}

/** A stored Socket Mode install in `org` for a workspace of its own; returns the InstallationView. */
async function storedInstall(request, org, { teamId = `T0PW${uniq().toUpperCase()}`, teamName = 'Acme PW Workspace' } = {}) {
  const created = await createPendingInstall(request, org);
  const { installation } = await finishInstall(request, org, created.installation.id, { teamId, teamName });
  return saveAppToken(request, org, created.installation.id, installation.app_id);
}

/** Rows 14 and 15: connects another org to an installation by a Sign in with Slack proof. */
async function connectOrg(request, org, installationId, teamId) {
  const { url } = await ok(
    request,
    'post',
    `/api/${org}/slack/installations/${encodeURIComponent(installationId)}/connection/start`,
    { purpose: 'connect' },
  );
  const { state, nonce } = authorizeParams(url);
  const oidc_code = mockCode({ team_id: teamId, user_id: 'U0DANA', email: 'dana@acme.test', nonce, state });
  return ok(request, 'post', `/api/${org}/slack/connection/confirm`, { oidc_code, oidc_state: state });
}

/** A webhook destination carrying the workspace metadata the Slack OAuth form stores. */
async function createSlackDestination(request, org, { name, teamId, teamName }) {
  await ok(request, 'post', `/api/${org}/alerts/destinations`, {
    name,
    url: `${MOCK()}/services/${teamId}/B0PW${uniq().toUpperCase()}`,
    method: 'post',
    type: 'http',
    headers: {},
    metadata: {
      prebuilt_type: 'slack',
      setup_method: 'oauth',
      slack_team_id: teamId,
      slack_team_name: teamName,
      slack_channel_id: 'C0ALERTS',
    },
  });
  return name;
}

/** True once commit 10 registers the §7.3 link routes; a missing route answers 404 with no body. */
async function linkRoutesExist(request, org) {
  const r = await call(request, 'get', `/api/${org}/slack/links/me`);
  return !(r.status === 404 && !r.text);
}

async function mockRequests(request, method) {
  const r = await request.get(`${MOCK()}/_mock/requests${method ? `?method=${encodeURIComponent(method)}` : ''}`);
  return (await r.json()).requests;
}

async function mockApps(request) {
  const r = await request.get(`${MOCK()}/_mock/state`);
  return (await r.json()).apps;
}

/** Stands in for Slack after Allow: redirects to redirect_uri with a mock code folding in state and nonce (spec 3.3). */
async function routeSlackAuthorize(context, claims = {}) {
  const handler = async (route) => {
    const { state, nonce, redirectUri } = authorizeParams(route.request().url());
    const code = mockCode({ ...claims, state, ...(nonce ? { nonce } : {}) });
    const target = new URL(redirectUri);
    target.searchParams.set('code', code);
    target.searchParams.set('state', state);
    await route.fulfill({ status: 302, headers: { location: target.toString() } });
  };
  await context.route('https://slack.com/oauth/v2/authorize**', handler);
  await context.route('https://slack.com/openid/connect/authorize**', handler);
  return async () => {
    await context.unroute('https://slack.com/oauth/v2/authorize**', handler);
    await context.unroute('https://slack.com/openid/connect/authorize**', handler);
  };
}

/** A stored HTTP-mode install (inbound arrives by signed POST); returns the view and the mock app's signing secret. */
async function storedHttpInstall(request, org, { teamId, teamName }) {
  const created = await ok(request, 'post', `/api/${org}/slack/installations`, {
    mode: 'http',
    config_refresh_token: `xoxe-1-pw-${uniq()}`,
    channel_history: false,
  });
  const { installation } = await finishInstall(request, org, created.installation.id, { teamId, teamName });
  const app = (await mockApps(request)).find((a) => a.app_id === installation.app_id);
  return { installation, signingSecret: app ? app.signing_secret : '' };
}

/** POSTs a Slack event to the inbound route with a valid X-Slack-Signature (section 7.1). */
async function sendSlackEvent(request, { signingSecret, appId, teamId, event }) {
  const crypto = require('crypto');
  const body = JSON.stringify({
    token: 'unused',
    team_id: teamId,
    api_app_id: appId,
    type: 'event_callback',
    event_id: `Ev0PW${uniq().toUpperCase()}`,
    event_time: Math.floor(Date.now() / 1000),
    event,
  });
  const ts = String(Math.floor(Date.now() / 1000));
  const sig = `v0=${crypto.createHmac('sha256', signingSecret).update(`v0:${ts}:${body}`).digest('hex')}`;
  const response = await request.post(`${BASE()}/api/slack/events`, {
    headers: { 'content-type': 'application/json', 'x-slack-request-timestamp': ts, 'x-slack-signature': sig },
    data: body,
    failOnStatusCode: false,
  });
  return response.status();
}

/** Polls the mock for a bot message carrying a /web/slack/link?r= URL sent after `since` (epoch seconds). */
async function waitForLinkRequest(request, since, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const calls = [
      ...(await mockRequests(request, 'chat.postEphemeral')),
      ...(await mockRequests(request, 'chat.postMessage')),
    ].filter((c) => c.at >= since);
    for (const c of calls) {
      const match = JSON.stringify(c.form).match(/\/web\/slack\/link\?r=([A-Za-z0-9._~%-]+)/);
      if (match) return decodeURIComponent(match[1]);
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error('no link request URL reached the Slack mock');
}

module.exports = {
  storedHttpInstall,
  sendSlackEvent,
  waitForLinkRequest,
  BASE,
  MOCK,
  uniq,
  mockCode,
  call,
  ok,
  createOrg,
  orgConfig,
  listInstallations,
  prerequisites,
  createPendingInstall,
  finishInstall,
  appToken,
  saveAppToken,
  storedInstall,
  connectOrg,
  createSlackDestination,
  linkRoutesExist,
  mockRequests,
  mockApps,
  routeSlackAuthorize,
};
