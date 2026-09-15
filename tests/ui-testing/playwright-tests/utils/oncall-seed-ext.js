// Copyright 2026 OpenObserve Inc.

/**
 * On-Call seeding helpers, part two — the response verbs, dry runs, absences,
 * org users and the mail sink.
 *
 * Plan: docs/test_generator/test-plans/oncall-ui-test-plan.md, Tier 1.
 *
 * WHY A SECOND MODULE. `oncall-seed.js` covers teams, schedules, policies,
 * ownership rules, alerts and firing, and it is owned by another workstream
 * this run. Everything the Tier-1 UI cases additionally need lives here and
 * imports from there, so the two never argue about a shared file. Nothing is
 * duplicated: `baseUrl`, `orgId`, `uniqueName` and the availability probe all
 * come from the original.
 *
 * FOUR ENVIRONMENT FACTS THAT FAIL QUIETLY IF YOU GET THEM WRONG:
 *
 *   RESERVED DOMAINS   `@test.invalid`, `@example.com` and friends are
 *                      recognised by the product as undeliverable and a page to
 *                      them is DISCARDED, not sent — reachability reports
 *                      `deliverable: false` and config risks raise
 *                      `unreachable_on_rung`. A spec that wants a real email in
 *                      the sink must seed users on a routable-looking domain;
 *                      `oncallUserEmail()` is the one place that decides it.
 *   MICROSECONDS       Every timestamp on every on-call route is microseconds.
 *   PLURAL vs SINGULAR Covers take `start_at`/`end_at`; absences take the same
 *                      pair on `/oncall/unavailability`.
 *   ESCALATE'S BODY    `POST /responses/{id}/escalate` extracts
 *                      `Json<Option<..>>`, which refuses a request with no JSON
 *                      content type BEFORE looking at the body — so the body is
 *                      always sent, even when empty.
 *
 * This module contains NO expect() calls: assertions belong in spec files.
 */

const testLogger = require('./test-logger.js');
const { getAuthHeaders } = require('./cloud-auth.js');
const { baseUrl, orgId } = require('./oncall-seed.js');
const sink = require('./mail-sink.js');

/**
 * The domain seeded users get.
 *
 * NOT `.test.invalid` and NOT `example.com`: the product classifies both as
 * reserved-for-documentation and refuses to send to them, which turns every
 * mail assertion into a silent zero. `o2-qa.com` is the domain the existing
 * fixtures on this environment already use and Mailpit is a catch-all sink, so
 * nothing actually leaves the host.
 */
const SEED_MAIL_DOMAIN = process.env.ONCALL_SEED_MAIL_DOMAIN || 'o2-qa.com';

/** The eight causes, wire values, in the order `RESOLUTION_CAUSES` declares them
 * in web/src/ts/interfaces/oncall.ts — a fixed list, because free text fragments
 * into near-duplicates and never groups. */
const RESOLUTION_CAUSES = [
  'config_change_or_deploy',
  'capacity_or_load',
  'dependency_failure',
  'expected_or_maintenance',
  'noisy_threshold',
  'data_or_ingestion_issue',
  'genuine_defect',
  'still_unknown',
];

function url(path) {
  return `${baseUrl()}/api/${orgId()}${path}`;
}

/**
 * Request + parse, returning the status alongside the body.
 *
 * Several Tier-1 cases are ABOUT a status code (a refused member payload, a
 * rule that should be rejected), so this deliberately does not throw on a
 * non-2xx the way `oncall-seed.js`'s `must()` does.
 */
async function call(page, method, path, data) {
  const opts = { headers: getAuthHeaders() };
  if (data !== undefined) opts.data = data;
  const res = await page.request[method](url(path), opts);
  const text = await res.text().catch(() => '');
  let body = null;
  try {
    body = text.trim() ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  return { status: res.status(), ok: res.ok(), body, text };
}

async function read(page, path) {
  const { ok, body } = await call(page, 'get', path);
  return ok ? body : null;
}

// ----------------------------------------------------------------- org users

/** A deliverable address under the seeded prefix. See SEED_MAIL_DOMAIN. */
function oncallUserEmail(prefix, suffix) {
  return `${prefix}_${suffix}@${SEED_MAIL_DOMAIN}`;
}

/**
 * Create an org user, or accept one that already exists.
 *
 * Membership on an on-call team requires org membership first — the members
 * route refuses a non-org address with "add them to the org before putting them
 * on call" — so every spec that needs a pageable human starts here.
 */
async function createOrgUser(page, { email, role = 'admin', password = 'Complexpass#123' }) {
  const payload = {
    email,
    password,
    first_name: 'OnCall',
    last_name: 'E2E',
    role,
    organization: orgId(),
  };
  const { status, ok, text } = await call(page, 'post', '/users', payload);
  if (!ok && !/already exist/i.test(text)) {
    throw new Error(`Creating org user ${email} failed: HTTP ${status} — ${text.slice(0, 200)}`);
  }
  testLogger.info('Org user seeded', { email, role });
  return { email, password, role };
}

/** Seed `count` deliverable users under one prefix, in a stable order. */
async function createOrgUsers(page, prefix, count, { role = 'admin' } = {}) {
  const users = [];
  for (let i = 0; i < count; i++) {
    users.push(await createOrgUser(page, { email: oncallUserEmail(prefix, `u${i}`), role }));
  }
  return users.map((u) => u.email);
}

/** Best-effort: teardown must never mask a test result. */
async function deleteOrgUser(page, email) {
  await call(page, 'delete', `/users/${encodeURIComponent(email)}`).catch(() => null);
}

/**
 * Sign a fresh context in as somebody who is not the global-setup root user.
 *
 * The harness authenticates once in `global-setup.js` and every spec inherits
 * that storage state, so a role case that must act AS another identity needs
 * its own context and its own sign-in. The selectors are the login screen's,
 * which is why this lives in a util rather than in a spec.
 */
async function loginAs(browser, { email, password = 'Complexpass#123' }) {
  const context = await browser.newContext({ viewport: { width: 1500, height: 1024 } });
  const page = await context.newPage();
  // The same entry point global-setup uses. An unauthenticated context is
  // redirected to the sign-in screen from here; `/web/login` is not a route.
  await page.goto(`${baseUrl()}?org_identifier=${orgId()}`);
  await page.waitForLoadState('domcontentloaded');
  const internal = page.locator('[data-test="login-as-internal-user"]');
  if (await internal.count()) {
    await internal.first().click().catch(() => {});
  }
  await page.locator('[data-test="login-user-id-field"]').waitFor({ state: 'visible', timeout: 30000 });
  await page.locator('[data-test="login-user-id-field"]').fill(email);
  await page.locator('[data-test="login-password-field"]').fill(password);
  await page.locator('[data-test="login-sign-in"]').click();
  await page.waitForURL(/\/web\//, { timeout: 60000 }).catch(() => {});
  testLogger.info('Signed in as a secondary identity', { email });
  return { context, page };
}

// ------------------------------------------------------------ response verbs

async function acknowledgeResponse(page, responseId) {
  return await call(page, 'post', `/oncall/responses/${encodeURIComponent(responseId)}/acknowledge`, {});
}

async function snoozeResponse(page, responseId, minutes) {
  return await call(page, 'post', `/oncall/responses/${encodeURIComponent(responseId)}/snooze`, { minutes });
}

async function addResponseNote(page, responseId, body) {
  return await call(page, 'post', `/oncall/responses/${encodeURIComponent(responseId)}/notes`, { body });
}

/** Exactly one of `to` (a person) or `toTeamId` (ownership moves team). */
async function handoffResponse(page, responseId, { to = undefined, toTeamId = undefined, note = undefined }) {
  const payload = {};
  if (to !== undefined) payload.to = to;
  if (toTeamId !== undefined) payload.to_team_id = toTeamId;
  if (note !== undefined) payload.note = note;
  return await call(page, 'post', `/oncall/responses/${encodeURIComponent(responseId)}/handoff`, payload);
}

async function resolveResponse(page, responseId, { cause = undefined, causeNote = undefined } = {}) {
  const payload = {};
  if (cause !== undefined) payload.cause = cause;
  if (causeNote !== undefined) payload.cause_note = causeNote;
  return await call(page, 'post', `/oncall/responses/${encodeURIComponent(responseId)}/resolve`, payload);
}

/** The body is always sent — an empty one still needs the JSON content type. */
async function escalateResponse(page, responseId, { note = undefined } = {}) {
  return await call(page, 'post', `/oncall/responses/${encodeURIComponent(responseId)}/escalate`,
    note ? { note } : {});
}

async function promoteResponse(page, responseId, { title = undefined, severity = undefined } = {}) {
  const payload = {};
  if (title !== undefined) payload.title = title;
  if (severity !== undefined) payload.severity = severity;
  return await call(page, 'post', `/oncall/responses/${encodeURIComponent(responseId)}/promote`, payload);
}

async function confirmRecovery(page, responseId, { note = undefined } = {}) {
  return await call(page, 'post', `/oncall/responses/${encodeURIComponent(responseId)}/confirm-recovery`,
    note ? { note } : {});
}

/**
 * The record and its timeline, in one read.
 *
 * `GET /oncall/responses/{id}` returns an ENVELOPE — `{ response, events }` —
 * not a bare record, and `events` is what the detail screen draws as its
 * activity timeline. `GET .../history` exists and answers `[]` on this build
 * even for a record with six events, so nothing reads it; see the generation
 * report. Anything asserting on the timeline goes through here.
 */
async function getResponseDetail(page, responseId) {
  const body = await read(page, `/oncall/responses/${encodeURIComponent(responseId)}`);
  return { response: body?.response ?? null, events: body?.events ?? [] };
}

/** Just the record: state, owner, cause, timings. */
async function getResponseRecord(page, responseId) {
  return (await getResponseDetail(page, responseId)).response;
}

/**
 * The human timeline, kinds included.
 *
 * `page` events ARE on this timeline; the delivery LEDGER is separate and
 * carries one row per (run, rung, recipient, channel) including failures.
 */
async function getResponseHistory(page, responseId) {
  return (await getResponseDetail(page, responseId)).events;
}

/** Timeline events of one kind — `ack`, `state`, `page`, `sys`, `note`, `handoff`. */
function eventsOfKind(events, kind) {
  return (events ?? []).filter((e) => e?.kind === kind);
}

async function getPriorCauses(page, responseId) {
  return (await read(page, `/oncall/responses/${encodeURIComponent(responseId)}/prior-causes`)) ?? [];
}

async function getCauseAnalytics(page, { teamId = undefined } = {}) {
  const query = teamId ? `?team_id=${encodeURIComponent(teamId)}` : '';
  return await read(page, `/oncall/analytics/causes${query}`);
}

/**
 * Poll a record until it reaches one of `states`, or give up with what it is.
 *
 * Recovery and snooze expiry are both SCHEDULER-driven, so the only honest way
 * to wait for them is to watch the record rather than sleep a fixed amount.
 */
async function waitForResponseState(page, responseId, states, { timeout = 180_000, pollMs = 3000 } = {}) {
  const wanted = Array.isArray(states) ? states : [states];
  const deadline = Date.now() + timeout;
  let last = null;
  while (Date.now() < deadline) {
    last = await getResponseRecord(page, responseId);
    if (last && wanted.includes(last.state)) return last;
    await page.waitForTimeout(pollMs);
  }
  return last;
}

// ----------------------------------------------------------------- dry runs

/**
 * What the router WOULD do, with no side effects.
 *
 * This is the endpoint `OnCallRoutingSimulator.vue` calls, so a spec comparing
 * the screen against the engine compares like with like.
 */
async function simulateRouting(page, { dimensions, oncallTeam = undefined }) {
  const payload = { dimensions };
  if (oncallTeam !== undefined) payload.oncall_team = oncallTeam;
  const { body } = await call(page, 'post', '/oncall/routing/preview', payload);
  return body;
}

/** "If a P{priority} fired right now" — real people, from the current schedule. */
async function getEscalationPreview(page, teamId, priority = undefined) {
  const query = priority === undefined ? '' : `?priority=${priority}`;
  return await read(page, `/oncall/teams/${encodeURIComponent(teamId)}/escalation-preview${query}`);
}

/** Risks are DERIVED on read, never stored — re-reading after a fix is the test. */
async function getConfigRisks(page, teamId) {
  return await read(page, `/oncall/teams/${encodeURIComponent(teamId)}/config-risks`);
}

async function getReachability(page, teamId) {
  return await read(page, `/oncall/teams/${encodeURIComponent(teamId)}/reachability`);
}

async function getCoverageGaps(page, { at = undefined } = {}) {
  const query = at === undefined ? '' : `?at=${at}`;
  return await read(page, `/oncall/coverage-gaps${query}`);
}

async function listUnroutedSignals(page, { includeDismissed = false, landing = undefined, limit = 200 } = {}) {
  const params = new URLSearchParams();
  if (includeDismissed) params.set('include_dismissed', 'true');
  if (landing) params.set('landing', landing);
  if (limit !== undefined) params.set('limit', String(limit));
  return (await read(page, `/oncall/unrouted?${params}`)) ?? [];
}

async function dismissUnroutedSignal(page, signalId) {
  return await call(page, 'delete', `/oncall/unrouted/${encodeURIComponent(signalId)}`);
}

async function myOnCall(page) {
  return await read(page, '/oncall/my/teams');
}

// ----------------------------------------------------- covers and absences

async function listCovers(page, teamId) {
  return (await read(page, `/oncall/teams/${encodeURIComponent(teamId)}/overrides`)) ?? [];
}

async function deleteCover(page, teamId, coverId) {
  return await call(page, 'delete',
    `/oncall/teams/${encodeURIComponent(teamId)}/overrides/${encodeURIComponent(coverId)}`);
}

/**
 * Mark somebody away.
 *
 * Org-wide by design: one absence covers every team the person is on, which is
 * why the route is not team-scoped. Omitting `userEmail` marks the CALLER away.
 */
async function createAbsence(page, { userEmail = undefined, fromMicros, toMicros, reason = undefined }) {
  const payload = { start_at: fromMicros, end_at: toMicros };
  if (userEmail !== undefined) payload.user_email = userEmail;
  if (reason !== undefined) payload.reason = reason;
  return await call(page, 'post', '/oncall/unavailability', payload);
}

async function listAbsences(page, { userEmail = undefined, from = undefined, to = undefined } = {}) {
  const params = new URLSearchParams();
  if (userEmail) params.set('user_email', userEmail);
  if (from !== undefined) params.set('from', String(from));
  if (to !== undefined) params.set('to', String(to));
  const query = params.toString() ? `?${params}` : '';
  return (await read(page, `/oncall/unavailability${query}`)) ?? [];
}

async function deleteAbsence(page, absenceId) {
  return await call(page, 'delete', `/oncall/unavailability/${encodeURIComponent(absenceId)}`);
}

// ----------------------------------------------------------------- ownership

async function deleteOwnershipRule(page, ruleId) {
  return await call(page, 'delete', `/oncall/ownership/${encodeURIComponent(ruleId)}`);
}

/**
 * Rewrite one priority's ladder to seconds so a timing case finishes.
 *
 * The real 5/15/30/60-minute ladder is correct and untestable in a CI lane; the
 * SHAPE being asserted — a rung per delay, in order, at the configured spacing
 * — is identical at 30/60/90s. Every other priority is left byte-for-byte alone
 * so this cannot silently un-configure the rest of the policy.
 */
async function shortenPolicyForSpeed(page, teamId, priority, delaysSeconds, { targets = null } = {}) {
  const policy = await read(page, `/oncall/teams/${encodeURIComponent(teamId)}/policy`);
  if (!policy) throw new Error(`No policy on team ${teamId} to shorten`);

  const existing = (policy.rungs ?? []).find((r) => r.priority === priority);
  const fallbackTargets = existing?.steps?.[0]?.targets ?? [{ kind: 'whole_team' }];
  const rungs = (policy.rungs ?? []).map((rung) => {
    if (rung.priority !== priority) return rung;
    return {
      priority,
      channels: rung.channels?.length ? rung.channels : ['email'],
      steps: delaysSeconds.map((secs, i) => ({
        after_micros: secs * 1_000_000,
        targets: targets?.[i] ?? (i === 0 ? fallbackTargets : [{ kind: 'whole_team' }]),
      })),
    };
  });

  const payload = { rungs, destinations: policy.destinations ?? [] };
  if (policy.l0) payload.l0 = policy.l0;
  const { status, ok, text } = await call(page, 'put',
    `/oncall/teams/${encodeURIComponent(teamId)}/policy`, payload);
  if (!ok) throw new Error(`Shortening P${priority} on ${teamId} failed: HTTP ${status} — ${text.slice(0, 300)}`);
  return rungs;
}

// ----------------------------------------------------------------- mail sink

const MAILPIT = process.env.MAILPIT_URL || 'http://localhost:8025';

/**
 * One message, fully fetched.
 *
 * `mail-sink.js` indexes messages (id, subject, timestamp) and can fetch the
 * NEWEST one, but a page fan-out puts several in the sink at once and the one a
 * case cares about is rarely the newest. This adds the per-id read on the
 * Mailpit backend only — the sink that exists on this environment — rather than
 * re-implementing the module's backend selection.
 */
async function fetchMessage(id) {
  const res = await fetch(`${MAILPIT}/api/v1/message/${id}`);
  if (!res.ok) return null;
  const m = await res.json();
  return {
    id,
    subject: m.Subject ?? '',
    from: m.From?.Address ?? '',
    to: (m.To ?? []).map((t) => String(t.Address).toLowerCase()),
    text: m.Text ?? '',
    html: m.HTML ?? '',
  };
}

/**
 * Wait for a message matching `to` and/or `subject`, newest first.
 *
 * `sinceMs` scopes to messages that arrived after a caller-recorded instant, so
 * a shared sink full of other workers' fixtures cannot satisfy the wait with
 * somebody else's page.
 */
async function waitForMail({ to = null, subject = null, sinceMs = 0, timeout = 120_000, pollMs = 2000 } = {}) {
  if (!(await sink.available())) return null;
  const wantTo = to ? String(to).toLowerCase() : null;
  const deadline = Date.now() + timeout;

  while (Date.now() < deadline) {
    const index = (await sink.list()).filter((m) => m.ts >= sinceMs);
    const candidates = subject
      ? index.filter((m) => (subject instanceof RegExp ? subject.test(m.subject) : String(m.subject).includes(subject)))
      : index;
    for (const row of [...candidates].sort((a, b) => b.ts - a.ts)) {
      const full = await fetchMessage(row.id);
      if (!full) continue;
      if (wantTo && !full.to.includes(wantTo)) continue;
      return full;
    }
    await new Promise((r) => setTimeout(r, pollMs));
  }
  return null;
}

/** Every message since an instant, fully fetched — for fan-out assertions. */
async function mailSince(sinceMs) {
  if (!(await sink.available())) return [];
  const index = (await sink.list()).filter((m) => m.ts >= sinceMs);
  const out = [];
  for (const row of index) {
    const full = await fetchMessage(row.id);
    if (full) out.push(full);
  }
  return out;
}

/** Every absolute URL in both MIME parts, de-duplicated. Trailing punctuation stripped. */
function extractLinks(message) {
  const blob = `${message?.text ?? ''}\n${message?.html ?? ''}`;
  const found = blob.match(/https?:\/\/[^\s"'<>)\]]+/g) ?? [];
  return [...new Set(found.map((u) => u.replace(/[.,;:]+$/, '')))];
}

module.exports = {
  SEED_MAIL_DOMAIN,
  RESOLUTION_CAUSES,
  oncallUserEmail,
  createOrgUser,
  createOrgUsers,
  deleteOrgUser,
  loginAs,
  acknowledgeResponse,
  snoozeResponse,
  addResponseNote,
  handoffResponse,
  resolveResponse,
  escalateResponse,
  promoteResponse,
  confirmRecovery,
  getResponseDetail,
  getResponseRecord,
  getResponseHistory,
  eventsOfKind,
  getPriorCauses,
  getCauseAnalytics,
  waitForResponseState,
  simulateRouting,
  getEscalationPreview,
  getConfigRisks,
  getReachability,
  getCoverageGaps,
  listUnroutedSignals,
  dismissUnroutedSignal,
  myOnCall,
  listCovers,
  deleteCover,
  createAbsence,
  listAbsences,
  deleteAbsence,
  deleteOwnershipRule,
  shortenPolicyForSpeed,
  waitForMail,
  mailSince,
  extractLinks,
};
