/**
 * RUM Sessions Data Ingestion Helper
 *
 * Generates synthetic RUM session events (actions, views, errors) and session replay
 * metadata, then ingests them to OpenObserve so the Sessions Dashboard can render.
 *
 * Follows the pattern established by rum-error-ingestion.js.
 *
 * Usage:
 *   const { ingestRumSessionsData } = require('../utils/rum-sessions-data.js');
 *   await ingestRumSessionsData(page);
 */

const testLogger = require('./test-logger.js');

// ---------------------------------------------------------------------------
// Session definitions — designed to cover every health / type / device path
// ---------------------------------------------------------------------------

const BROWSERS = {
  desktop: [
    { family: 'Chrome', version: '120.0.0', os: 'Mac OS', os_version: '14.0', device: 'Desktop' },
    { family: 'Firefox', version: '119.0', os: 'Windows', os_version: '11', device: 'Desktop' },
    { family: 'Edge', version: '120.0.0', os: 'Windows', os_version: '10', device: 'Desktop' },
  ],
  mobile: [
    { family: 'Chrome Mobile', version: '120.0.0', os: 'Android', os_version: '14', device: 'Mobile' },
    { family: 'Safari', version: '17.0', os: 'iOS', os_version: '17.1', device: 'Mobile' },
  ],
  tablet: [
    { family: 'Safari', version: '17.0', os: 'iPadOS', os_version: '17.1', device: 'Tablet' },
  ],
};

const LOCATIONS = [
  { city: 'San Francisco', country: 'United States', iso: 'us' },
  { city: 'London', country: 'United Kingdom', iso: 'gb' },
  { city: 'Tokyo', country: 'Japan', iso: 'jp' },
  { city: 'Berlin', country: 'Germany', iso: 'de' },
  { city: 'Sydney', country: 'Australia', iso: 'au' },
];

/**
 * A single session definition that the generator turns into one _rumdata event
 * plus one _sessionreplay event.
 *
 * @typedef {Object} SessionDef
 * @property {string} id         - unique session_id
 * @property {string} user       - user email
 * @property {string} userName   - display name
 * @property {string} userId     - user id
 * @property {number} errorCount     - how many errors in this session
 * @property {number} frustrationCount - how many frustrations
 * @property {boolean} isBounce      - bounce session (duration < 10s / 1 event)
 * @property {boolean} isActive      - end_time within 5 min of now (active label)
 * @property {string} deviceClass    - 'desktop' | 'mobile' | 'tablet'
 * @property {string} [errorMessage] - specific error message for error-cluster insight
 * @property {string} [frustrationTarget] - target element for frustration cluster
 * @property {number} events         - how many events this session has (for bounce calc)
 */

/**
 * Build 15 sessions covering all combinations needed for:
 * - P0.2  segment filter (health: errors / frustrated / clean)
 * - P1.1  multiple-segment compose (type + device)
 * - P1.2  segment-empty state
 * - P2.1  bounce label
 * - P2.2  active label
 * - P2.3  health cell badges (error / frustration / clean)
 * - P2.4  insight banner (frustration cluster)
 * - P2.5  insight banner (error cluster)
 *
 * The map below describes each session by its key behavioural properties; the
 * generator expands each row into the full event + replay payload.
 */
const SESSION_DEFS = [
  // --- clean / engaged / desktop ---
  { id: 'sess-clean-eng-desk-01', user: 'alice@test.com', errorCount: 0, frustrationCount: 0, isBounce: false, isActive: true,  deviceClass: 'desktop', events: 12 },
  { id: 'sess-clean-eng-desk-02', user: 'bob@test.com',   errorCount: 0, frustrationCount: 0, isBounce: false, isActive: false, deviceClass: 'desktop', events: 8 },
  // --- clean / engaged / mobile ---
  { id: 'sess-clean-eng-mob-01',  user: 'carol@test.com', errorCount: 0, frustrationCount: 0, isBounce: false, isActive: false, deviceClass: 'mobile',  events: 6 },
  // --- clean / bounced / desktop ---
  { id: 'sess-clean-bnc-desk-01', user: 'dave@test.com',  errorCount: 0, frustrationCount: 0, isBounce: true,  isActive: false, deviceClass: 'desktop', events: 1 },
  { id: 'sess-clean-bnc-desk-02', user: 'eve@test.com',   errorCount: 0, frustrationCount: 0, isBounce: true,  isActive: false, deviceClass: 'desktop', events: 0 },
  // --- clean / bounced / tablet ---
  { id: 'sess-clean-bnc-tab-01',  user: 'frank@test.com', errorCount: 0, frustrationCount: 0, isBounce: true,  isActive: false, deviceClass: 'tablet',  events: 1 },
  // --- errors / engaged / desktop ---
  { id: 'sess-err-eng-desk-01',   user: 'grace@test.com', errorCount: 3, frustrationCount: 0, isBounce: false, isActive: false, deviceClass: 'desktop', events: 15, errorMessage: 'TypeError: Cannot read property of undefined' },
  { id: 'sess-err-eng-desk-02',   user: 'heidi@test.com', errorCount: 1, frustrationCount: 0, isBounce: false, isActive: false, deviceClass: 'desktop', events: 7,  errorMessage: 'TypeError: Cannot read property of undefined' }, // same msg for cluster (needs 3, will combine with sess-err-eng-mob-01)
  // --- errors / bounced / mobile ---
  { id: 'sess-err-bnc-mob-01',    user: 'ivan@test.com',  errorCount: 2, frustrationCount: 0, isBounce: true,  isActive: false, deviceClass: 'mobile',  events: 1,  errorMessage: 'ReferenceError: x is not defined' },
  // --- errors / engaged / mobile ---
  { id: 'sess-err-eng-mob-01',    user: 'judy@test.com',  errorCount: 1, frustrationCount: 0, isBounce: false, isActive: false, deviceClass: 'mobile',  events: 9,  errorMessage: 'TypeError: Cannot read property of undefined' }, // same error message → cluster
  // --- frustrated / engaged / desktop ---
  { id: 'sess-frus-eng-desk-01',  user: 'karl@test.com',  errorCount: 0, frustrationCount: 2, isBounce: false, isActive: false, deviceClass: 'desktop', events: 11, frustrationTarget: '#submit-btn' },
  { id: 'sess-frus-eng-desk-02',  user: 'lisa@test.com',  errorCount: 0, frustrationCount: 1, isBounce: false, isActive: false, deviceClass: 'desktop', events: 5,  frustrationTarget: '#checkout-btn' },
  // --- frustrated / engaged / mobile / active ---
  { id: 'sess-frus-eng-mob-01',   user: 'mike@test.com',  errorCount: 0, frustrationCount: 2, isBounce: false, isActive: true,  deviceClass: 'mobile',  events: 20, frustrationTarget: '#submit-btn' }, // same target for cluster
  // --- frustrated+errors / engaged / desktop ---
  { id: 'sess-errfrus-eng-desk',  user: 'nina@test.com',  errorCount: 1, frustrationCount: 2, isBounce: false, isActive: false, deviceClass: 'desktop', events: 14, errorMessage: 'RangeError: Maximum call stack', frustrationTarget: '#submit-btn' },
  // --- clean / engaged / desktop (extra for query count stability) ---
  { id: 'sess-clean-eng-desk-03', user: 'olga@test.com',  errorCount: 0, frustrationCount: 0, isBounce: false, isActive: false, deviceClass: 'desktop', events: 10 },
];

// ---------------------------------------------------------------------------
// Payload builders
// ---------------------------------------------------------------------------

/**
 * Build _rumdata events for one session.
 * Each session gets one primary "action" event per definition row; bounces get fewer.
 */
function buildRumdataEvents(sessionDef) {
  const now = Date.now();
  const loc = LOCATIONS[Math.floor(Math.random() * LOCATIONS.length)];
  const browser = pickBrowser(sessionDef.deviceClass);
  const sessionStart = now - 120_000; // 2 min ago
  const events = [];

  // Always emit at least one "action" event to represent the session summary row.
  // The query in AppSessions uses aggregations grouped by session_id, so one event
  // per session is sufficient for the table.
  events.push({
    _timestamp: sessionStart,
    type: 'action',
    session_id: sessionDef.id,
    session_has_replay: true,
    error_count: sessionDef.errorCount,
    action_frustration_type: sessionDef.frustrationCount > 0 ? ['rage_click', 'dead_click'][sessionDef.frustrationCount % 2] : null,
    action_target_name: sessionDef.frustrationTarget || null,
    error_message: sessionDef.errorMessage || null,
    view_url: `http://example.com/page${Math.floor(Math.random() * 5) + 1}`,
    view_id: `view-${sessionDef.id}`,
    resource_url: `http://example.com/page${Math.floor(Math.random() * 5) + 1}`,
    geo_info_city: loc.city,
    geo_info_country: loc.country,
    geo_info_country_iso_code: loc.iso,
    usr_email: sessionDef.user,
    usr_name: sessionDef.user.split('@')[0],
    usr_id: `usr-${sessionDef.id}`,
    application_id: 'rum-e2e-test-app',
    env: 'production',
    service: 'web',
    source: 'rum',
    api: 'v1',
    user_agent_browser: browser.family,
    user_agent_os: browser.os,
    user_agent_device: browser.device,
    user_agent_browser_version: browser.version,
    user_agent_os_version: browser.os_version,
  });

  return events;
}

/**
 * Build _sessionreplay events — one per session.
 */
function buildReplayEvents(sessionDef) {
  const now = Date.now();
  const browser = pickBrowser(sessionDef.deviceClass);

  // For active sessions, end_time is within 5 min of now
  const endTime = sessionDef.isActive ? now - 60_000 : now - 360_000;
  const startTime = endTime - (sessionDef.isBounce ? 5_000 : 120_000);

  return [{
    session_id: sessionDef.id,
    start: startTime,
    end: endTime,
    user_agent_user_agent_family: browser.family,
    user_agent_os_family: browser.os,
    user_agent_device_family: browser.device,
    ip: '192.168.1.1',
    source: 'rum',
  }];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function pickBrowser(deviceClass) {
  const list = BROWSERS[deviceClass] || BROWSERS.desktop;
  return list[Math.floor(Math.random() * list.length)];
}

/**
 * Ingest an array of events to a stream via the _json bulk endpoint.
 * Reuses the exact auth pattern from rum-error-ingestion.js.
 */
async function ingestToStream(page, baseUrl, orgId, streamName, events, email, password) {
  const basicAuth = Buffer.from(`${email}:${password}`).toString('base64');
  let fetchResponse;

  try {
    fetchResponse = await page.request.post(`${baseUrl}/api/${orgId}/${streamName}/_json`, {
      headers: {
        'Authorization': `Basic ${basicAuth}`,
        'Content-Type': 'application/json',
      },
      data: events,
    });
  } catch (requestError) {
    return { success: false, stream: streamName, error: requestError.message };
  }

  const status = fetchResponse.status();
  if (fetchResponse.ok()) {
    return { success: true, stream: streamName, ingested: events.length, status };
  }

  let body = '';
  try { body = await fetchResponse.text(); } catch (_) { /* ignore */ }
  return { success: false, stream: streamName, status, error: body };
}

// ---------------------------------------------------------------------------
// Public entry-point
// ---------------------------------------------------------------------------

/**
 * Ingest synthetic RUM sessions data to both _rumdata and _sessionreplay streams.
 *
 * @param {import('@playwright/test').Page} page - Playwright page for API calls
 * @returns {Promise<{success: boolean, sessions: number, details: Array}>}
 */
async function ingestRumSessionsData(page) {
  testLogger.info('Starting RUM sessions data ingestion');

  const orgId = process.env.ORGNAME || 'default';
  const baseUrl = process.env.ZO_BASE_URL || 'http://localhost:5080';
  const email = process.env.ZO_ROOT_USER_EMAIL;
  const password = process.env.ZO_ROOT_USER_PASSWORD;

  const rumdataEvents = [];
  const replayEvents = [];

  for (const def of SESSION_DEFS) {
    rumdataEvents.push(...buildRumdataEvents(def));
    replayEvents.push(...buildReplayEvents(def));
  }

  testLogger.info(`Generated ${rumdataEvents.length} _rumdata events and ${replayEvents.length} _sessionreplay events for ${SESSION_DEFS.length} sessions`);

  const results = [];

  // Ingest _rumdata
  const rumResult = await ingestToStream(page, baseUrl, orgId, '_rumdata', rumdataEvents, email, password);
  results.push(rumResult);
  if (rumResult.success) {
    testLogger.info(`_rumdata ingested: ${rumResult.ingested} events`);
  } else {
    testLogger.warn(`_rumdata ingestion issue: ${rumResult.error || rumResult.status}`);
  }

  // Wait briefly for stream auto-creation
  await new Promise(r => setTimeout(r, 2000));

  // Ingest _sessionreplay
  const replayResult = await ingestToStream(page, baseUrl, orgId, '_sessionreplay', replayEvents, email, password);
  results.push(replayResult);
  if (replayResult.success) {
    testLogger.info(`_sessionreplay ingested: ${replayResult.ingested} events`);
  } else {
    testLogger.warn(`_sessionreplay ingestion issue: ${replayResult.error || replayResult.status}`);
  }

  const allOk = results.every(r => r.success);
  testLogger.info(`RUM sessions data ingestion ${allOk ? 'complete' : 'partially complete'}`);

  return {
    success: allOk,
    sessions: SESSION_DEFS.length,
    details: results,
  };
}

module.exports = { ingestRumSessionsData };
