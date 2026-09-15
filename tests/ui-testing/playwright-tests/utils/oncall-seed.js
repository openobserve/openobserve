// Copyright 2026 OpenObserve Inc.

/**
 * On-Call seeding + teardown helpers.
 *
 * Plan: docs/test_generator/features/oncall-test-plan.md
 *
 * On-Call is ENTERPRISE-GATED. Every route answers 404 (feature off) or 403
 * "Not Supported" (OSS build) when it is unavailable, and the product treats
 * both as the same calm fact rather than an error — so must we.
 * `isOnCallAvailable()` turns that into one boolean a spec can skip on, instead
 * of each spec failing thirty seconds into a timeout on an OSS runner.
 *
 * Three environment facts this module encodes, each of which fails QUIETLY if
 * you get it wrong:
 *
 *   ORG IDENTIFIER   Every route is `/api/{org_identifier}/oncall/...` and the
 *                    identifier is a ksuid. Passing the org's DISPLAY NAME
 *                    returns "Organization not found" — a 404 indistinguishable
 *                    from the feature being off.
 *   BASIC AUTH       Ingestion rejects the session cookie. Management routes
 *                    accept either. Everything here therefore carries Basic
 *                    auth, which is the one credential both halves take.
 *   MICROSECONDS     Every timestamp on every on-call route — `after_micros`,
 *                    `anchor_micros`, `shift_micros`, `opened_at`, `_timestamp`
 *                    on the logs ingest path — is MICROseconds. Milliseconds
 *                    ingest happily and land in 1970.
 *
 * Self-cleaning. Everything created here is named from a caller-supplied
 * prefix, and `deleteOnCallFixturesByPrefix` sweeps exactly that prefix, so
 * parallel workers never delete each other's fixtures. Specs scope the prefix
 * to the WORKER (`_w<index>_`) — see the docblock in SLO/slo-crud.spec.js.
 *
 * This module contains NO expect() calls: assertions belong in spec files.
 */

const testLogger = require('./test-logger.js');
const { getAuthHeaders, getOrgIdentifier } = require('./cloud-auth.js');

/** Every on-call timestamp is microseconds. Named so the call sites read. */
const MICROS = 1_000_000;

/** One hour and one day, in micros — the units rotations and ladders are built from. */
const HOUR_MICROS = 3600 * MICROS;
const DAY_MICROS = 24 * HOUR_MICROS;

/** Dimension values the seeded log rows carry, so ownership rules have something to match. */
const SEED_SERVICES = ['checkout', 'search', 'payments'];

/** Ladder delays for a two-rung policy: page now, escalate a minute later. */
const FIRST_RUNG_MICROS = 0;
const SECOND_RUNG_MICROS = 60 * MICROS;

/** How long a fired alert may take to become a page. Generous: the scheduler owns the cadence. */
const PAGE_WAIT_MS = 180_000;

function baseUrl() {
  const url = process.env.ZO_BASE_URL || 'http://localhost:5080';
  return url.endsWith('/') ? url.slice(0, -1) : url;
}

/**
 * Ingestion has its own base URL on cloud, and it is NOT interchangeable with
 * the management one — pointing ingest at the management host writes nothing
 * and still answers 200.
 */
function ingestUrl() {
  const url = process.env.INGESTION_URL || process.env.ZO_BASE_URL || baseUrl();
  return url.endsWith('/') ? url.slice(0, -1) : url;
}

/** The org KSUID. Never the display name — see the module note. */
function orgId() {
  return getOrgIdentifier();
}

/** Unique per call so parallel specs and repeat runs never collide on a name. */
function uniqueName(prefix) {
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

/** A transient meta-store error worth retrying rather than failing the test on. */
function isTransientStoreError(body) {
  return /database is locked|SqlxError|SeaORMError|Execution Error/i.test(String(body ?? ''));
}

/**
 * Both readings of "on-call is not here": the feature flag is off (404) or this
 * is an OSS build (403 "Not Supported"). The product collapses them deliberately
 * — §G.8.1 — because neither is something a reader can act on.
 */
function isUnavailableStatus(status, body) {
  if (status === 404) return true;
  return status === 403 && /not supported/i.test(String(body ?? ''));
}

/**
 * Authenticated request with a retry on a transient meta-store error.
 *
 * The single-node build keeps metadata in SQLite, which serialises writers.
 * Several Playwright workers creating teams, rotations and ownership rules at
 * once collide and get `database is locked` — a contention signal, not a
 * product failure. Without this the suite fails intermittently on an
 * environment characteristic and sends the reader hunting a bug that is not there.
 */
async function api(page, method, url, data, { attempts = 5, baseDelayMs = 400 } = {}) {
  const opts = { headers: getAuthHeaders() };
  if (data !== undefined) opts.data = data;

  let last = null;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    const res = await page.request[method](url, opts);
    if (res.ok()) return res;

    const body = await res.text().catch(() => '');
    last = { status: res.status(), body };
    if (!isTransientStoreError(body)) return res;

    await page.waitForTimeout(baseDelayMs * attempt);
    testLogger.debug('oncall seed: retrying after a transient store error', {
      url, attempt, status: res.status(),
    });
  }
  throw new Error(
    `Still failing after ${attempts} attempts on a transient store error.\n` +
    `  ${url}\n  last: HTTP ${last?.status} — ${String(last?.body).slice(0, 200)}`,
  );
}

/** Throw with the payload attached — a 400 that names only a field is unreadable without it. */
async function must(res, what, payload) {
  if (res.ok()) return res.json().catch(() => ({}));
  const body = await res.text().catch(() => '<unreadable>');
  throw new Error(
    `${what} failed: HTTP ${res.status()} — ${body}` +
    (payload === undefined ? '' : `\nPayload: ${JSON.stringify(payload)}`),
  );
}

// ------------------------------------------------------------- capability probe

/**
 * Is on-call reachable in this deployment?
 *
 * Asks the teams list rather than `/config`: the list IS the capability probe
 * the UI itself uses (§G.8.1), so a spec that skips on this skips on exactly
 * what the screens react to. `/config`'s `oncall_enabled` is checked as well
 * because it distinguishes "off" from "OSS build" in the reason string, which
 * is the difference between a misconfigured runner and a correct skip.
 *
 * @returns {Promise<{available: boolean, reason: string}>}
 */
async function isOnCallAvailable(page) {
  const org = orgId();
  if (!org) return { available: false, reason: 'no org identifier — ORGNAME / cloud-config is unset' };

  let flag = null;
  try {
    const cfg = await page.request.get(`${baseUrl()}/config`, { headers: getAuthHeaders() });
    if (cfg.ok()) flag = (await cfg.json().catch(() => ({})))?.oncall_enabled ?? null;
  } catch {
    // A failed /config read is not itself a verdict; the teams probe below decides.
  }

  const res = await page.request.get(`${baseUrl()}/api/${org}/oncall/teams`, {
    headers: getAuthHeaders(),
  });
  if (res.ok()) return { available: true, reason: '' };

  const body = await res.text().catch(() => '');
  if (isUnavailableStatus(res.status(), body)) {
    return {
      available: false,
      reason: flag === false
        ? 'on-call is disabled on this deployment (config.oncall_enabled=false)'
        : `on-call is not available here (HTTP ${res.status()}) — OSS build or O2_ONCALL_ENABLED unset`,
    };
  }
  return { available: false, reason: `on-call probe failed: HTTP ${res.status()} — ${body.slice(0, 200)}` };
}

// -------------------------------------------------------------------- teams

/**
 * Create a team.
 *
 * A new team is auto-staffed with a `source: "default"` rotation covering the
 * whole roster weekly, so `GET /schedule` does NOT return null afterwards.
 * "Never configured" has to be read from `source`, not from absence.
 *
 * @returns {Promise<{id: string, name: string}>}
 */
async function createTeam(page, { name, timezone = 'UTC', description = null } = {}) {
  const payload = { name, timezone, description };
  const res = await api(page, 'post', `${baseUrl()}/api/${orgId()}/oncall/teams`, payload);
  const body = await must(res, `On-call team create "${name}"`, payload);
  const id = body?.id ?? body?.data?.id;
  if (!id) throw new Error(`Team created but no id returned: ${JSON.stringify(body)}`);
  testLogger.info('On-call team created', { id, name });
  return { id, name };
}

async function listTeams(page) {
  const res = await page.request.get(`${baseUrl()}/api/${orgId()}/oncall/teams`, {
    headers: getAuthHeaders(),
  });
  if (!res.ok()) return [];
  const body = await res.json().catch(() => ([]));
  return Array.isArray(body) ? body : (body?.list ?? []);
}

async function getTeam(page, teamId) {
  const res = await page.request.get(
    `${baseUrl()}/api/${orgId()}/oncall/teams/${encodeURIComponent(teamId)}`,
    { headers: getAuthHeaders() },
  );
  if (!res.ok()) return null;
  return await res.json().catch(() => null);
}

/**
 * Put people on the team.
 *
 * Membership carries no level: which rung somebody covers is a property of the
 * ROTATION, never of belonging. Seeding a member does not put them on call.
 */
async function addTeamMembers(page, teamId, userEmails) {
  const payload = { user_emails: userEmails };
  const res = await api(
    page, 'post',
    `${baseUrl()}/api/${orgId()}/oncall/teams/${encodeURIComponent(teamId)}/members`,
    payload,
  );
  const body = await must(res, `Add members to team ${teamId}`, payload);
  testLogger.info('On-call members added', { teamId, count: userEmails.length });
  return body;
}

async function listTeamMembers(page, teamId) {
  const res = await page.request.get(
    `${baseUrl()}/api/${orgId()}/oncall/teams/${encodeURIComponent(teamId)}/members`,
    { headers: getAuthHeaders() },
  );
  if (!res.ok()) return [];
  const body = await res.json().catch(() => ([]));
  return Array.isArray(body) ? body : (body?.list ?? []);
}

// ----------------------------------------------------------------- schedule

/**
 * One rotation, one shift rule, whole roster in turn.
 *
 * `anchor_micros` is the WHOLE of the secondary mechanism: two rotations with
 * the same roster and anchors one shift apart can never resolve to the same
 * person. Nothing at resolution time knows the two are related, so a secondary
 * is built by passing `anchorMicros` one shift earlier — not by a flag.
 *
 * A rotation with no shift rules is rejected (§8.6) and is the one state that
 * looks configured on a calendar and pages nobody.
 */
function rotation({
  id,
  name = id,
  members,
  shiftMicros = DAY_MICROS,
  anchorMicros = null,
  priority = 0,
  restrictions = null,
} = {}) {
  const rule = {
    name: `${name} shift`,
    members,
    shift_micros: shiftMicros,
    // Anchored in the past so somebody is already on call when the spec reads it.
    anchor_micros: anchorMicros ?? (Date.now() * 1000 - shiftMicros),
    priority,
  };
  if (restrictions) rule.restrictions = restrictions;
  return { id, name, shift_rules: [rule] };
}

/**
 * An all-day restriction.
 *
 * Minute 1440, never 0, for the closing edge: a restriction ending at minute 0
 * applies at no instant at all and the server 400s it (§8.2), while the UI must
 * render this one as `00:00 / 24:00` rather than `00:00 / 00:00` (§8.1).
 */
function allDayRestriction(days = [0, 1, 2, 3, 4, 5, 6]) {
  return { days, start_minute: 0, end_minute: 1440 };
}

/**
 * Replace the team's schedule.
 *
 * A FULL REPLACE, not a merge. Replacing a schedule whose rotation the
 * escalation policy names is refused with a 400 telling the caller to keep the
 * rotation or edit the policy first (§8.5), so order matters: set the schedule
 * BEFORE the policy that points at it, and when changing rotation ids, clear
 * the policy first.
 *
 * AND `addTeamMembers` IS ONE OF THE WRITERS THAT NAMES A ROTATION. Putting the
 * first member on a team that has no rotation auto-provisions a `source:
 * "default"` rotation AND rewrites rungs P1..P3 to page it by id — so a seed
 * that creates a team, adds members and only then writes its schedule hits the
 * §8.5 refusal every time, on a policy nothing in the spec ever wrote. Two ways
 * out, both verified against the live API:
 *   - write the schedule FIRST, then add members; the auto-write then binds to
 *     the rotation already there rather than inventing one, or
 *   - `detachPolicyFromRotations()` first — the server's own instruction —
 *     which is the only option when the schedule being written is EMPTY, since
 *     an existing-but-rotationless schedule auto-provisions just the same.
 */
async function setTeamSchedule(page, teamId, { timezone = 'UTC', rotations }) {
  const payload = { timezone, rotations };
  const res = await api(
    page, 'put',
    `${baseUrl()}/api/${orgId()}/oncall/teams/${encodeURIComponent(teamId)}/schedule`,
    payload,
  );
  const body = await must(res, `Set schedule for team ${teamId}`, payload);
  testLogger.info('On-call schedule set', { teamId, rotations: rotations.length });
  return body;
}

async function getTeamSchedule(page, teamId) {
  const res = await page.request.get(
    `${baseUrl()}/api/${orgId()}/oncall/teams/${encodeURIComponent(teamId)}/schedule`,
    { headers: getAuthHeaders() },
  );
  if (!res.ok()) return null;
  return await res.json().catch(() => null);
}

/** Who the engine says is on call, optionally at a future instant (micros). */
async function whoIsOnCall(page, teamId, atMicros = undefined) {
  const query = atMicros === undefined ? '' : `?at=${atMicros}`;
  const res = await page.request.get(
    `${baseUrl()}/api/${orgId()}/oncall/teams/${encodeURIComponent(teamId)}/on-call${query}`,
    { headers: getAuthHeaders() },
  );
  if (!res.ok()) return [];
  const body = await res.json().catch(() => ([]));
  return Array.isArray(body) ? body : (body?.list ?? []);
}

/**
 * Hand one rotation's shift to somebody else for a window.
 *
 * `start_at` / `end_at`, NOT the plural `starts_at` / `ends_at` — the server
 * rejects the plural form with a 422. `end_at` is exclusive, so a cover ending
 * exactly when the next begins does not overlap it. `reason`, never `note`: a
 * `note` key is dropped in silence.
 *
 * `rotation_id` must be populated on the stored record (§8.3) — a cover with a
 * null rotation is the `oncall_overrides.rotation_id` outage this suite
 * smoke-tests for. Omitting it targets the team's PRIMARY, which on a
 * multi-rotation team silently evicts whoever held it.
 */
async function createCover(page, teamId, {
  userEmail, rotationId, fromMicros, toMicros, coveringFor = undefined, reason = undefined,
}) {
  const payload = {
    user_email: userEmail,
    rotation_id: rotationId,
    start_at: fromMicros,
    end_at: toMicros,
  };
  if (coveringFor !== undefined) payload.covering_for = coveringFor;
  if (reason !== undefined) payload.reason = reason;
  const res = await api(
    page, 'post',
    `${baseUrl()}/api/${orgId()}/oncall/teams/${encodeURIComponent(teamId)}/overrides`,
    payload,
  );
  return await must(res, `Create cover on team ${teamId}`, payload);
}

// ------------------------------------------------------------------- policy

/**
 * A ladder rung that pages whoever a rotation puts on call.
 *
 * `rotation_id`, never the rotation's NAME: a rotation is renameable, and a
 * stored policy that keyed on the name would start paging a different position
 * the moment somebody fixed a typo on a calendar.
 *
 * `mode` is omitted when it is `on_call` so a rung written without it
 * round-trips unchanged — never send `"on_call"` explicitly.
 */
function rungPagingRotation(priority, rotationId, { afterMicros = FIRST_RUNG_MICROS, channels = ['email'] } = {}) {
  return {
    priority,
    steps: [{ after_micros: afterMicros, targets: [{ kind: 'rotation', rotation_id: rotationId }] }],
    channels,
  };
}

/** A two-step ladder: the rotation now, then everybody a minute later. Exhausts fast enough to assert on. */
function rungEscalatingToTeam(priority, rotationId, { channels = ['email'] } = {}) {
  return {
    priority,
    steps: [
      { after_micros: FIRST_RUNG_MICROS, targets: [{ kind: 'rotation', rotation_id: rotationId }] },
      { after_micros: SECOND_RUNG_MICROS, targets: [{ kind: 'whole_team' }] },
    ],
    channels,
  };
}

/**
 * Write the escalation policy.
 *
 * `l0` is deliberately omitted unless a caller passes it: absent means
 * unchanged, and sending it on an ordinary rung edit would silently
 * un-configure the AI-SRE gate.
 */
async function setTeamPolicy(page, teamId, {
  rungs,
  destinations = undefined,
  repeatCount = undefined,
  finalAction = undefined,
  l0 = undefined,
} = {}) {
  const payload = { rungs };
  if (destinations !== undefined) payload.destinations = destinations;
  if (repeatCount !== undefined) payload.repeat_count = repeatCount;
  if (finalAction !== undefined) payload.final_action = finalAction;
  if (l0 !== undefined) payload.l0 = l0;

  const res = await api(
    page, 'put',
    `${baseUrl()}/api/${orgId()}/oncall/teams/${encodeURIComponent(teamId)}/policy`,
    payload,
  );
  const body = await must(res, `Set policy for team ${teamId}`, payload);
  testLogger.info('On-call policy set', { teamId, rungs: rungs.length });
  return body;
}

/**
 * Point the policy at the team instead of at any rotation, so the schedule can
 * then be replaced.
 *
 * This is the server's own advice — "keep the rotation, or edit the policy
 * first" — made callable, and it is a SEEDING primitive, not an assertion
 * helper: it exists so a spec can reach the state it wants to test, never so a
 * §8.5 refusal can be swallowed. `setTeamSchedule` still surfaces a real 400.
 *
 * A single whole-team rung is the smallest policy the route accepts and names
 * no rotation, which is the whole point.
 */
async function detachPolicyFromRotations(page, teamId) {
  return await setTeamPolicy(page, teamId, {
    rungs: [{
      priority: 1,
      steps: [{ after_micros: FIRST_RUNG_MICROS, targets: [{ kind: 'whole_team' }] }],
      channels: ['email'],
    }],
  });
}

async function getTeamPolicy(page, teamId) {
  const res = await page.request.get(
    `${baseUrl()}/api/${orgId()}/oncall/teams/${encodeURIComponent(teamId)}/policy`,
    { headers: getAuthHeaders() },
  );
  if (!res.ok()) return null;
  return await res.json().catch(() => null);
}

// ---------------------------------------------------------------- ownership

/**
 * Claim an identity path for a team.
 *
 * `dimensions` is `{name: value}` and EVERY pair must match for the rule to
 * apply — which is also what makes one rule more specific than another, and so
 * what decides which team is woken when two match (§5.5).
 *
 * A 409 means another team already owns this exact path. Repointing is a PUT on
 * the existing rule, never delete-then-create: creating the replacement while
 * the original still holds the path is a duplicate, and the server refuses it.
 */
async function createOwnershipRule(page, { teamId, dimensions }) {
  const payload = { team_id: teamId, dimensions };
  const res = await api(page, 'post', `${baseUrl()}/api/${orgId()}/oncall/ownership`, payload);
  const body = await must(res, 'Create ownership rule', payload);
  const id = body?.id ?? body?.rule_id;
  testLogger.info('Ownership rule created', { id, teamId, dimensions });
  return { id, teamId, dimensions };
}

async function listOwnershipRules(page, teamId = undefined) {
  const query = teamId ? `?team_id=${encodeURIComponent(teamId)}` : '';
  const res = await page.request.get(`${baseUrl()}/api/${orgId()}/oncall/ownership${query}`, {
    headers: getAuthHeaders(),
  });
  if (!res.ok()) return [];
  const body = await res.json().catch(() => ([]));
  return Array.isArray(body) ? body : (body?.list ?? []);
}

/**
 * Rules plus what each one CAUGHT — and the server's shadowing verdict.
 *
 * The analysis compares every rule against every other, so only the server can
 * make it: a client that can see one team's rules cannot know another team's
 * rule outranks it. A spec asserting "shadowed" must read `health` from here
 * rather than recomputing it.
 */
async function ownershipStats(page, { teamId = undefined, days = undefined } = {}) {
  const params = new URLSearchParams();
  if (teamId) params.set('team_id', teamId);
  if (days !== undefined) params.set('days', String(days));
  const query = params.toString() ? `?${params}` : '';
  const res = await page.request.get(
    `${baseUrl()}/api/${orgId()}/oncall/ownership/stats${query}`, { headers: getAuthHeaders() },
  );
  if (!res.ok()) return null;
  return await res.json().catch(() => null);
}

/** Nominate the org's catch-all team, or clear it with null. */
async function setDefaultTeam(page, teamId) {
  const payload = { default_team_id: teamId };
  const res = await api(page, 'put', `${baseUrl()}/api/${orgId()}/oncall/routing/config`, payload);
  return await must(res, 'Set default routing team', payload);
}

async function getRoutingConfig(page) {
  const res = await page.request.get(`${baseUrl()}/api/${orgId()}/oncall/routing/config`, {
    headers: getAuthHeaders(),
  });
  if (!res.ok()) return null;
  return await res.json().catch(() => null);
}

// ------------------------------------------------------------------ log data

/**
 * Ingest rows carrying the dimensions ownership rules match on.
 *
 * Basic auth, not the cookie: the ingest endpoint rejects the session. Recent
 * rather than backdated — an alert evaluates a trailing window, so unlike the
 * SLO seed there is nothing to gain from reaching days back, and
 * `ZO_INGEST_ALLOWED_UPTO` (default 5 hours) would drop it while still
 * answering 200.
 *
 * @returns {Promise<{streamName: string, records: number}>}
 */
async function seedOnCallStream(page, streamName, {
  minutes = 60,
  services = SEED_SERVICES,
  extraDimensions = {},
} = {}) {
  const nowSecs = Math.floor(Date.now() / 1000);
  const rows = [];
  for (let i = 0; i < minutes; i++) {
    rows.push({
      _timestamp: (nowSecs - i * 60) * MICROS,
      service: services[i % services.length],
      latency: 100 + (i % 10) * 100,
      status_code: i % 5 === 0 ? 500 : 200,
      job: 'e2e-oncall',
      ...extraDimensions,
    });
  }

  const res = await api(page, 'post', `${ingestUrl()}/api/${orgId()}/${streamName}/_json`, rows);
  await must(res, `On-call stream ingest "${streamName}"`);
  await waitForStreamSearchable(page, streamName, rows.length);
  testLogger.info('On-call stream seeded', { streamName, records: rows.length });
  return { streamName, records: rows.length };
}

/** Block until the rows are queryable, so an alert created next can actually match them. */
async function waitForStreamSearchable(page, streamName, expected, { timeout = 120_000 } = {}) {
  const nowSecs = Math.floor(Date.now() / 1000);
  const deadline = Date.now() + timeout;

  while (Date.now() < deadline) {
    const res = await page.request.post(`${baseUrl()}/api/${orgId()}/_search?type=logs`, {
      headers: getAuthHeaders(),
      data: {
        query: {
          sql: `SELECT COUNT(*) AS c FROM "${streamName}"`,
          start_time: (nowSecs - 86400) * MICROS,
          end_time: (nowSecs + 3600) * MICROS,
          size: 1,
        },
      },
    });
    if (res.ok()) {
      const body = await res.json().catch(() => ({}));
      // 90% is enough: demanding an exact count stalls on ordinary indexing lag.
      if (Number(body?.hits?.[0]?.c ?? 0) >= expected * 0.9) return;
    }
    await page.waitForTimeout(3000);
  }
  throw new Error(`Seeded rows for "${streamName}" never became searchable within ${timeout}ms.`);
}

// -------------------------------------------------------------- destinations

/**
 * A notification template + destination pointed at this instance's OWN ingest.
 *
 * Delivery is then self-contained and needs no external service, and a page's
 * delivery ledger still records real attempts. Same trick
 * `slo-seed.seedNotificationDestination` uses.
 *
 * @returns {Promise<string>} the destination name
 */
async function seedNotificationDestination(page, baseName) {
  const v1 = `${baseUrl()}/api/${orgId()}`;
  const template = `${baseName}_tmpl`;
  const destination = `${baseName}_dest`;

  const tmplRes = await api(page, 'post', `${v1}/alerts/templates`, {
    name: template,
    body: '{"text":"{alert_name} {alert_level}"}',
    type: 'http',
    title: '',
  });
  if (!tmplRes.ok() && tmplRes.status() !== 409) {
    await must(tmplRes, `Create alert template "${template}"`);
  }

  const destRes = await api(page, 'post', `${v1}/alerts/destinations`, {
    name: destination,
    url: `${v1}/${baseName}_sink/_json`,
    method: 'post',
    template,
    type: 'http',
    headers: getAuthHeaders(),
  });
  if (!destRes.ok() && destRes.status() !== 409) {
    await must(destRes, `Create alert destination "${destination}"`);
  }

  testLogger.info('On-call notification destination seeded', { destination });
  return destination;
}

// ------------------------------------------------------------------- alerts

/**
 * A scheduled alert that pages a team.
 *
 * `oncall_team` is an on-call team's **id**. It is a destination in its own
 * right (§4.1): an alert carrying it saves with `destinations: []` and
 * `workflows: []`, where an alert carrying none of the three is rejected
 * `400 Alert destination or workflows is required` (§4.2).
 *
 * `multiAlert` is the §5 distinction and it is NOT cosmetic. With
 * `aggregation.multi_alert: true` a result set spanning two owning teams opens
 * one page PER group; with `aggregation: null` — Simple — the groups are
 * collapsed into a single result and exactly one page is correct. Both halves
 * are pinned so the distinction cannot rot.
 *
 * @returns {Promise<{id: string, name: string}>}
 */
async function createPagingAlert(page, {
  name,
  stream,
  teamId = undefined,
  priority = undefined,
  destinations = [],
  multiAlert = false,
  groupBy = ['service'],
  aggregateFunction = 'avg',
  having = { column: 'latency', operator: '>', value: 0 },
  frequencyMinutes = 1,
  periodMinutes = 10,
  folder = 'default',
} = {}) {
  const payload = {
    name,
    stream_type: 'logs',
    stream_name: stream,
    is_real_time: false,
    query_condition: {
      type: 'custom',
      conditions: {
        version: 2,
        conditions: { filterType: 'group', logicalOperator: 'AND', conditions: [] },
      },
      sql: null, promql: null, promql_condition: null,
      aggregation: multiAlert
        ? { group_by: groupBy, function: aggregateFunction, having, multi_alert: true }
        : null,
      vrl_function: null, search_event_type: null, multi_time_range: [],
    },
    trigger_condition: {
      period: periodMinutes,
      operator: '>=',
      // 1 is the "any breaching group" gate a multi-alert needs; a simple alert
      // is happy with it too, and a higher threshold would make the fire flaky.
      threshold: 1,
      frequency: frequencyMinutes,
      frequency_type: 'minutes',
      cron: '',
      // No silence: a silenced alert fires once and then goes quiet for the
      // rest of the run, which reads exactly like the ladder failing to fire.
      silence: 0,
      timezone: 'UTC',
      align_time: true,
    },
    destinations,
    context_attributes: {},
    row_template: '',
    enabled: true,
  };
  if (teamId) payload.oncall_team = teamId;
  // An alert with no priority opens its page at the server's default, not P1, so a
  // severity-specific assertion has to name one or it silently tests another rung.
  if (priority !== undefined) payload.priority = priority;

  const res = await api(
    page, 'post',
    `${baseUrl()}/api/v2/${orgId()}/alerts?folder=${encodeURIComponent(folder)}`,
    payload,
  );
  const body = await must(res, `Create paging alert "${name}"`, payload);
  const id = body?.id ?? body?.alert_id;
  if (!id) throw new Error(`Alert created but no id returned: ${JSON.stringify(body)}`);
  testLogger.info('Paging alert created', { id, name, teamId, priority, multiAlert });
  return { id, name };
}

/**
 * Fire an alert now instead of waiting for its schedule.
 *
 * PATCH, not POST — the route is `PATCH /api/v2/{org}/alerts/{id}/trigger`.
 * Without this a spec waits a whole frequency window for the scheduler.
 */
async function triggerAlert(page, alertId, { folder = 'default' } = {}) {
  const res = await api(
    page, 'patch',
    `${baseUrl()}/api/v2/${orgId()}/alerts/${encodeURIComponent(alertId)}/trigger?folder=${encodeURIComponent(folder)}`,
  );
  return await must(res, `Trigger alert ${alertId}`);
}

/**
 * Fire now if the route will, otherwise let the scheduler do it.
 *
 * THE MANUAL TRIGGER IS BROKEN FOR EXACTLY THE ALERT SHAPE ON-CALL USES, and
 * the failure is a bare `500 {"code":500,"message":""}` with nothing to read.
 * Reproduced against this build, smallest case: an alert carrying
 * `oncall_team` and `destinations: []` — which `POST /api/v2/{org}/alerts`
 * ACCEPTS with 200, and which the scheduler then fires correctly, opening its
 * page within ~15s — 500s on `PATCH .../trigger`. Add any destination to that
 * same alert and the same PATCH answers 200. So the create route, the
 * scheduler and the trigger route disagree about whether the shape is legal,
 * and only the trigger route is wrong.
 *
 * Firing is SCAFFOLDING for the UI cases here — none of them assert on the
 * trigger route — so a spec must not die on it. This swallows the 500 and
 * falls through to `waitForPages`, which still proves the page opened; a
 * scheduler that then never fires fails the spec with its own message rather
 * than this one. The swallow is deliberately narrow: any other failure is
 * re-thrown, so a trigger route that breaks generally still fails loudly.
 *
 * @returns {Promise<boolean>} whether the manual trigger actually took
 */
async function triggerAlertOrLetSchedulerFire(page, alertId, { folder = 'default' } = {}) {
  try {
    await triggerAlert(page, alertId, { folder });
    return true;
  } catch (e) {
    if (!/failed: HTTP 500/.test(String(e?.message))) throw e;
    testLogger.warn(
      'Manual alert trigger 500ed; waiting for the scheduler instead. This is the known ' +
      'trigger-route defect for an on-call alert with no notification destinations — the ' +
      'alert itself saved fine and the scheduler fires it.',
      { alertId },
    );
    return false;
  }
}

// -------------------------------------------------------------------- pages

/**
 * Read the pages list.
 *
 * `include_resolved` is off by default server-side — the screen is what still
 * needs somebody — so a spec looking for a page it already closed must ask for
 * it. The endpoint has NO total count and caps at 200: never present the
 * returned length as the total (§G.5).
 */
async function listResponses(page, {
  teamId = undefined,
  includeResolved = false,
  cause = undefined,
  subjectType = undefined,
  sourceId = undefined,
  ownershipPath = undefined,
  limit = 200,
  offset = undefined,
} = {}) {
  const params = new URLSearchParams();
  if (teamId) params.set('team_id', teamId);
  if (includeResolved) params.set('include_resolved', 'true');
  if (cause) params.set('cause', cause);
  if (subjectType) params.set('subject_type', subjectType);
  if (sourceId) params.set('source_id', sourceId);
  if (ownershipPath) params.set('ownership_path', ownershipPath);
  if (limit !== undefined) params.set('limit', String(limit));
  if (offset !== undefined) params.set('offset', String(offset));

  const query = params.toString() ? `?${params}` : '';
  const res = await page.request.get(`${baseUrl()}/api/${orgId()}/oncall/responses${query}`, {
    headers: getAuthHeaders(),
  });
  if (!res.ok()) return [];
  const body = await res.json().catch(() => ([]));
  return Array.isArray(body) ? body : (body?.list ?? []);
}

async function getResponse(page, responseId) {
  const res = await page.request.get(
    `${baseUrl()}/api/${orgId()}/oncall/responses/${encodeURIComponent(responseId)}`,
    { headers: getAuthHeaders() },
  );
  if (!res.ok()) return null;
  return await res.json().catch(() => null);
}

/**
 * Wait for a page to exist, matching on the alert that opened it.
 *
 * Matching on `source_id` rather than a title: a record is keyed
 * `(subject_type, source_id, firing)` and each firing is its own record, so the
 * alert id is the only handle that survives a re-fire.
 *
 * @returns {Promise<object[]>} every page opened by this alert, newest first
 */
async function waitForPages(page, {
  alertId,
  expected = 1,
  teamId = undefined,
  timeout = PAGE_WAIT_MS,
  pollMs = 3000,
} = {}) {
  const deadline = Date.now() + timeout;
  let seen = [];

  while (Date.now() < deadline) {
    seen = await listResponses(page, {
      subjectType: 'alert', sourceId: alertId, teamId, includeResolved: true,
    });
    if (seen.length >= expected) {
      testLogger.info('On-call page(s) observed', { alertId, count: seen.length });
      return seen;
    }
    await page.waitForTimeout(pollMs);
  }

  throw new Error(
    `Alert ${alertId} never opened ${expected} on-call page(s) within ${timeout}ms (saw ${seen.length}).\n` +
    `Causes, in the order worth checking: the alert has no oncall_team AND no ownership rule matches\n` +
    `its identity (a teamless page is still opened, so zero pages means the alert never FIRED);\n` +
    `the alert's window holds no rows (seed the stream first); or the scheduler is not running.`,
  );
}

/**
 * Create the alert, fire it, and wait for the page it opens.
 *
 * The one helper a UI spec that just needs "a page on screen" should call.
 *
 * @returns {Promise<{alert: {id: string, name: string}, pages: object[]}>}
 */
async function firePageAndWait(page, { alertOptions, expected = 1, timeout = PAGE_WAIT_MS } = {}) {
  const alert = await createPagingAlert(page, alertOptions);
  await triggerAlertOrLetSchedulerFire(page, alert.id);
  const pages = await waitForPages(page, {
    alertId: alert.id, expected, teamId: alertOptions.teamId, timeout,
  });
  return { alert, pages };
}

/**
 * Send a REAL page to whoever the ladder would reach, and report who it got to.
 *
 * `reached_anyone: false` carries `not_sent_because` — the honest answer to
 * "would a page actually land", which is not otherwise knowable without waiting
 * for an incident. Cheaper than firePageAndWait when the subject is coverage
 * rather than a record on the pages list.
 */
async function sendTestPage(page, teamId, { priority = undefined } = {}) {
  const payload = priority === undefined ? {} : { priority };
  const res = await api(
    page, 'post',
    `${baseUrl()}/api/${orgId()}/oncall/teams/${encodeURIComponent(teamId)}/test-page`,
    payload,
  );
  return await must(res, `Test page for team ${teamId}`, payload);
}

/**
 * How far the ladder got, who it reached, and whether it is exhausted (§2, §3).
 *
 * The route is `/escalation`, not `/progress` — the shape it returns is named
 * `EscalationProgress`, which is the trap.
 */
async function getEscalationProgress(page, responseId) {
  const res = await page.request.get(
    `${baseUrl()}/api/${orgId()}/oncall/responses/${encodeURIComponent(responseId)}/escalation`,
    { headers: getAuthHeaders() },
  );
  if (!res.ok()) return null;
  return await res.json().catch(() => null);
}

/** The delivery ledger — the ground truth `progress.reached` must agree with (§2.1). */
async function getDeliveries(page, responseId) {
  const res = await page.request.get(
    `${baseUrl()}/api/${orgId()}/oncall/responses/${encodeURIComponent(responseId)}/deliveries`,
    { headers: getAuthHeaders() },
  );
  if (!res.ok()) return null;
  return await res.json().catch(() => null);
}

// ------------------------------------------------------------------ teardown

/**
 * Remove everything a run created under one prefix.
 *
 * Best-effort throughout: cleanup must never mask a test result, and a
 * half-deleted fixture is better than a failed teardown hiding a real failure.
 *
 * ORDER IS LOAD-BEARING:
 *   1. Alerts, because a scheduled alert whose stream is gone is retried every
 *      scheduler cycle forever and starves the same worker budget the on-call
 *      escalation lane runs on — leaving them behind breaks LATER runs.
 *   2. Ownership rules, before the teams they point at.
 *   3. Teams.
 *   4. Streams, destinations, then templates — a template in use by a
 *      destination cannot be removed.
 */
async function deleteOnCallFixturesByPrefix(page, prefix) {
  const org = orgId();
  const base = baseUrl();
  const headers = getAuthHeaders();

  const tryDelete = async (url) => {
    try { await page.request.delete(url, { headers }); } catch { /* best effort */ }
  };

  try {
    const res = await page.request.get(
      `${base}/api/v2/${org}/alerts?folder=default&page_size=200`, { headers },
    );
    if (res.ok()) {
      const body = await res.json().catch(() => ({}));
      for (const a of body?.list ?? []) {
        if (typeof a?.name === 'string' && a.name.startsWith(prefix)) {
          const id = a.alert_id ?? a.id;
          if (id) await tryDelete(`${base}/api/v2/${org}/alerts/${id}`);
        }
      }
    }
  } catch { /* best effort */ }

  // Rules are keyed by id and carry no name, so they are swept by the team they
  // point at — which is why teams must be identified before they are deleted.
  let doomedTeamIds = [];
  try {
    const teams = await listTeams(page);
    doomedTeamIds = teams
      .filter((t) => typeof t?.name === 'string' && t.name.startsWith(prefix))
      .map((t) => t.id);
  } catch { /* best effort */ }

  try {
    const rules = await listOwnershipRules(page);
    for (const rule of rules) {
      const id = rule?.id ?? rule?.rule_id;
      if (id && doomedTeamIds.includes(rule?.team_id)) {
        await tryDelete(`${base}/api/${org}/oncall/ownership/${encodeURIComponent(id)}`);
      }
    }
  } catch { /* best effort */ }

  for (const teamId of doomedTeamIds) {
    await tryDelete(`${base}/api/${org}/oncall/teams/${encodeURIComponent(teamId)}`);
  }

  try {
    const res = await page.request.get(`${base}/api/${org}/streams?type=logs`, { headers });
    if (res.ok()) {
      const body = await res.json().catch(() => ({}));
      for (const stream of body?.list ?? []) {
        if (typeof stream?.name === 'string' && stream.name.startsWith(prefix)) {
          await tryDelete(`${base}/api/${org}/streams/${stream.name}?type=logs`);
        }
      }
    }
  } catch { /* best effort */ }

  for (const kind of ['destinations', 'templates']) {
    try {
      const res = await page.request.get(`${base}/api/${org}/alerts/${kind}`, { headers });
      if (!res.ok()) continue;
      const body = await res.json().catch(() => ([]));
      for (const item of (Array.isArray(body) ? body : body.list ?? [])) {
        if (typeof item?.name === 'string' && item.name.startsWith(prefix)) {
          await tryDelete(`${base}/api/${org}/alerts/${kind}/${item.name}`);
        }
      }
    } catch { /* best effort */ }
  }

  testLogger.debug('on-call fixture cleanup swept', { prefix, teams: doomedTeamIds.length });
}

/** Delete one team by id, tolerating an already-gone one. */
async function deleteTeamById(page, teamId) {
  try {
    await page.request.delete(
      `${baseUrl()}/api/${orgId()}/oncall/teams/${encodeURIComponent(teamId)}`,
      { headers: getAuthHeaders() },
    );
  } catch (e) {
    testLogger.debug('On-call team cleanup failed (non-fatal)', { teamId, error: e.message });
  }
}

module.exports = {
  MICROS,
  HOUR_MICROS,
  DAY_MICROS,
  FIRST_RUNG_MICROS,
  SECOND_RUNG_MICROS,
  SEED_SERVICES,
  baseUrl,
  ingestUrl,
  orgId,
  uniqueName,
  isOnCallAvailable,
  createTeam,
  listTeams,
  getTeam,
  addTeamMembers,
  listTeamMembers,
  rotation,
  allDayRestriction,
  setTeamSchedule,
  getTeamSchedule,
  whoIsOnCall,
  createCover,
  rungPagingRotation,
  rungEscalatingToTeam,
  setTeamPolicy,
  detachPolicyFromRotations,
  getTeamPolicy,
  createOwnershipRule,
  listOwnershipRules,
  ownershipStats,
  setDefaultTeam,
  getRoutingConfig,
  seedOnCallStream,
  waitForStreamSearchable,
  seedNotificationDestination,
  createPagingAlert,
  triggerAlert,
  triggerAlertOrLetSchedulerFire,
  listResponses,
  getResponse,
  waitForPages,
  firePageAndWait,
  sendTestPage,
  getEscalationProgress,
  getDeliveries,
  deleteOnCallFixturesByPrefix,
  deleteTeamById,
};
