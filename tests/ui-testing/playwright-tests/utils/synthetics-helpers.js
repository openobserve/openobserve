// Copyright 2026 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

// Synthetics e2e helpers: API setup/teardown and result-stream seeding (plan: docs/test_generator/test-plans/synthetics-test-plan.md).

const fs = require('fs');
const path = require('path');
const testLogger = require('./test-logger.js');
const { getAuthHeaders, getOrgIdentifier } = require('./cloud-auth.js');
const { ingestCustomData, waitForFieldValueSearchable } = require('./data-ingestion.js');

const RESULTS_STREAM = 'synthetics_results';
const STEP_RESULTS_STREAM = 'synthetics_step_results';
// Every entity a spec creates carries this prefix so cleanup.spec.js can sweep it.
const E2E_PREFIX = 'synth_e2e_';
// Shared infra: created once if no enabled public location exists, never deleted.
const E2E_LOCATION = {
  kind: 'public',
  id: 'e2e-us-east-1',
  provider: 'e2e',
  region: 'us-east-1',
  label: 'E2E Public',
  enabled: true,
};
const FIXTURE_DIR = path.join(__dirname, '..', '..', 'fixtures', 'synthetics');
const SEED_WAIT_MS = 60000;

let cachedLocationId = null;

function baseUrl() {
  const url = process.env.INGESTION_URL || process.env.ZO_BASE_URL || '';
  return url.endsWith('/') ? url.slice(0, -1) : url;
}

function apiBase(org = getOrgIdentifier()) {
  return `${baseUrl()}/api/${org}/synthetics`;
}

function workerPrefix(testInfo) {
  return `${E2E_PREFIX}w${testInfo.workerIndex}_`;
}

function uniqueName(kind, testInfo) {
  return `${workerPrefix(testInfo)}${kind}_${Math.random().toString(36).slice(2, 8)}`;
}

// The single-node meta store is SQLite; parallel workers writing checks can hit "database is locked".
function isTransientStoreError(status, body) {
  return status !== 200 && /database is locked|SqlxError|SeaORMError/i.test(JSON.stringify(body ?? ''));
}

async function request(page, method, url, data, { attempts = 5, baseDelayMs = 400 } = {}) {
  let last = null;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    const res = await page.request[method](url, { headers: getAuthHeaders(), data });
    const body = await res.json().catch(() => null);
    testLogger.apiCall(method.toUpperCase(), url, res.status(), 0);
    last = { status: res.status(), body };
    if (!isTransientStoreError(last.status, body)) return last;
    await new Promise((r) => setTimeout(r, baseDelayMs * attempt));
  }
  return last;
}

async function getConfig(page) {
  const org = getOrgIdentifier();
  const { status, body } = await request(page, 'get', `${baseUrl()}/api/${org}/config`);
  if (status !== 200) throw new Error(`GET /api/${org}/config failed: HTTP ${status}`);
  return body;
}

// Throws rather than skips: a silently skipped shard would hide a broken flag.
async function assertSyntheticsEnabled(page) {
  const config = await getConfig(page);
  if (config?.synthetics_enabled !== true) {
    throw new Error(
      'This spec requires ZO_SYNTHETICS_ENABLED=true — check `synthetics_enabled` on the ' +
        'Synthetics shard in ci-matrix/ci_matrix.json',
    );
  }
  return config;
}

async function listLocations(page, org = getOrgIdentifier()) {
  const { status, body } = await request(page, 'get', `${apiBase(org)}/locations`);
  if (status !== 200) throw new Error(`GET synthetics/locations failed: HTTP ${status}`);
  return body?.locations ?? [];
}

async function createLocation(page, payload, org = getOrgIdentifier()) {
  return request(page, 'post', `${apiBase(org)}/locations`, payload);
}

async function deleteLocation(page, id, org = getOrgIdentifier()) {
  return request(page, 'delete', `${apiBase(org)}/locations/${id}`);
}

async function ensureSyntheticsLocation(page) {
  if (cachedLocationId) return cachedLocationId;
  // Only the shared row counts: any other public row may be a settings test's short-lived fixture.
  const existing = (await listLocations(page)).find((l) => l.id === E2E_LOCATION.id && l.enabled);
  if (existing) {
    cachedLocationId = existing.id;
    return cachedLocationId;
  }
  const { status, body } = await createLocation(page, E2E_LOCATION);
  // A parallel worker may have won the race; the row it created is the one we want.
  const lostRace = status === 400 && /already exists/i.test(String(body?.message ?? ''));
  if (status !== 200 && !lostRace) {
    throw new Error(`Could not create the e2e public location: HTTP ${status} — ${JSON.stringify(body)}`);
  }
  // A pre-existing but disabled shared row would pass the race check yet fail every check create.
  if (lostRace) {
    const row = (await listLocations(page)).find((l) => l.id === E2E_LOCATION.id);
    if (!row?.enabled) throw new Error(`Shared location ${E2E_LOCATION.id} exists but is disabled; enable it in Settings`);
  }
  cachedLocationId = lostRace ? E2E_LOCATION.id : body.location.id;
  testLogger.info('Synthetics public location ready', { id: cachedLocationId, created: !lostRace });
  return cachedLocationId;
}

function typeConfig(type) {
  switch (type) {
    case 'http':
      return {
        method: 'GET',
        timeout_ms: 10000,
        follow_redirects: true,
        headers: [],
        assertions: [{ field: 'status_code', operator: 'eq', value: 200 }],
      };
    case 'tcp':
      return { port: 443, timeout_ms: 10000 };
    case 'tls':
      return {
        port: 443,
        timeout_ms: 10000,
        min_days_until_expiry: 30,
        verify_chain: true,
        verify_hostname: true,
      };
    case 'ssh':
      return {
        port: 22,
        username: 'e2e',
        auth: { type: 'password', secret: 'synth-e2e-secret' },
        timeout_ms: 10000,
      };
    case 'browser':
      return {
        steps: [
          { id: 'step-navigate', action: 'navigate', url: 'https://example.com' },
          { id: 'step-title', action: 'assert', assertion: { kind: 'page_title', expected: 'Example Domain' } },
          { id: 'step-url', action: 'assert', assertion: { kind: 'url_matches', expected: 'example.com' } },
        ],
        browser_devices: [{ browser: 'chromium', device: 'desktop' }],
        timeout_ms: 30000,
        capture: { screenshot: 'on-fail', trace: 'on-fail', video: 'off' },
      };
    default:
      throw new Error(`Unknown synthetics check type "${type}"`);
  }
}

function checkPayload(type, name, locationId, overrides = {}) {
  return {
    name,
    type,
    target: type === 'http' || type === 'browser' ? 'https://example.com' : 'example.com',
    // Disabled by default: an enabled check is claimed by the scheduler within 5 s.
    enabled: false,
    retries: 0,
    locations: [locationId],
    frequency: { type: 'minutes', interval: 5, cron: '' },
    config: typeConfig(type),
    ...overrides,
  };
}

// Run-now tests pass this as `start` so the scheduler does not claim the check early.
function startOneHourAhead() {
  return Date.now() * 1000 + 3_600_000_000;
}

async function createCheck(page, type, testInfo, overrides = {}) {
  const locationId = overrides.locations?.[0] ?? (await ensureSyntheticsLocation(page));
  const name = overrides.name ?? uniqueName(type, testInfo);
  const payload = checkPayload(type, name, locationId, overrides);
  const { status, body } = await request(page, 'post', `${apiBase()}?folder=default`, payload);
  if (status !== 200 && status !== 201) {
    throw new Error(`Synthetics check create failed: HTTP ${status} — ${JSON.stringify(body)}`);
  }
  testLogger.info('Synthetics check created via API', { id: body.id, name, type });
  return { id: body.id, name, type, locationId };
}

async function getCheck(page, id) {
  return request(page, 'get', `${apiBase()}/${id}`);
}

async function listChecks(page, folder = 'default') {
  const { status, body } = await request(page, 'get', `${apiBase()}?folder=${folder}`);
  if (status !== 200) throw new Error(`GET synthetics list failed: HTTP ${status}`);
  return body?.checks ?? [];
}

async function findCheckByName(page, name) {
  return (await listChecks(page)).find((c) => c.name === name) ?? null;
}

async function listAllChecks(page) {
  const { status, body } = await request(page, 'get', apiBase());
  if (status !== 200) throw new Error(`GET synthetics list failed: HTTP ${status}`);
  return body?.checks ?? [];
}

async function deleteChecksByPrefix(page, prefix) {
  try {
    const ids = (await listAllChecks(page))
      .filter((c) => typeof c?.name === 'string' && c.name.startsWith(prefix))
      .map((c) => c.id);
    if (ids.length === 0) return;
    await request(page, 'delete', apiBase(), { ids });
    testLogger.info('Synthetics checks swept', { prefix, count: ids.length });
  } catch (e) {
    testLogger.debug('Synthetics prefix cleanup failed (non-fatal)', { prefix, error: e.message });
  }
}

// Polls GET /synthetics/{id} until `predicate(check)` holds or the deadline passes.
async function waitForCheck(page, id, predicate, { timeoutMs = 20000, intervalMs = 2000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  let last = null;
  while (Date.now() < deadline) {
    const { status, body } = await getCheck(page, id);
    last = body;
    if (status === 200 && predicate(body)) return body;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error(`Check ${id} never reached the expected state; last: ${JSON.stringify(last)}`);
}

async function createSyntheticsFolder(page, name) {
  const org = getOrgIdentifier();
  const { status, body } = await request(page, 'post', `${baseUrl()}/api/v2/${org}/folders/synthetics`, {
    name,
    description: 'synthetics e2e',
  });
  if (status !== 200) throw new Error(`Folder create failed: HTTP ${status} — ${JSON.stringify(body)}`);
  return body.folderId;
}

async function deleteSyntheticsFoldersByPrefix(page, prefix) {
  const org = getOrgIdentifier();
  try {
    const { body } = await request(page, 'get', `${baseUrl()}/api/v2/${org}/folders/synthetics`);
    for (const f of body?.list ?? []) {
      if (typeof f?.name === 'string' && f.name.startsWith(prefix)) {
        await request(page, 'delete', `${baseUrl()}/api/v2/${org}/folders/synthetics/${f.folderId}`);
      }
    }
  } catch (e) {
    testLogger.debug('Synthetics folder cleanup failed (non-fatal)', { prefix, error: e.message });
  }
}

async function listTokens(page) {
  const { status, body } = await request(page, 'get', `${apiBase()}/agent-tokens`);
  if (status !== 200) throw new Error(`GET agent-tokens failed: HTTP ${status}`);
  return body?.tokens ?? [];
}

async function disableTokensByPrefix(page, prefix) {
  try {
    for (const t of await listTokens(page)) {
      if (typeof t?.name === 'string' && t.name.startsWith(prefix) && t.enabled) {
        await request(page, 'patch', `${apiBase()}/agent-tokens/${t.name}`, { enabled: false });
      }
    }
  } catch (e) {
    testLogger.debug('Synthetics token cleanup failed (non-fatal)', { prefix, error: e.message });
  }
}

function loadFixture(file) {
  return JSON.parse(fs.readFileSync(path.join(FIXTURE_DIR, file), 'utf-8'));
}

function randomId(prefix) {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
}

// Scenario → ordered list of fixture template keys; index order fixes timestamps.
function scenarioPlan(scenario) {
  switch (scenario) {
    case 'mixed':
      return [
        ...Array(30).fill('browser_passed'),
        ...Array(6).fill('browser_failed'),
        ...Array(2).fill('browser_retried'),
        'error_dispatch',
        'error_quota',
      ];
    case 'http-mixed':
      return ['http_passed', 'http_passed', 'http_passed', 'http_passed', 'http_failed'];
    default:
      throw new Error(`Unknown seed scenario "${scenario}"`);
  }
}

// Builds one result row (plus its step rows) from a fixture template.
function materialize(template, stepTemplates, check, tsMicros) {
  const org = getOrgIdentifier();
  const hasIds = template.run_id !== '';
  const runId = hasIds ? randomId('run') : '';
  const executionId = hasIds ? randomId('exec') : '';
  const jobId = hasIds ? randomId('job') : '';
  const row = {
    ...template,
    _timestamp: tsMicros,
    scheduled_ts: template.scheduled_ts === 0 ? 0 : tsMicros - 20_000_000,
    started_ts: template.started_ts === 0 ? 0 : tsMicros - 15_000_000,
    completed_ts: template.completed_ts === 0 ? 0 : tsMicros,
    org_id: org,
    synthetics_id: check.id,
    synthetics_name: check.name,
    run_id: runId,
    execution_id: executionId,
    job_id: jobId,
  };
  const steps = (stepTemplates[template.step_template] ?? []).map((s) => ({
    ...s,
    _timestamp: tsMicros,
    synthetics_id: check.id,
    run_id: runId,
    execution_id: executionId,
    job_id: jobId,
  }));
  return { row, steps };
}

// The ingest endpoint answers 200 even when every record is rejected; the per-stream status carries the failure.
async function ingestOrThrow(page, stream, records) {
  const res = await ingestCustomData(page, stream, records);
  const failed = res.data?.status?.find((s) => Number(s.failed) > 0);
  if (res.status !== 200 || failed) {
    throw new Error(`Seeding ${stream} failed: HTTP ${res.status} — ${JSON.stringify(failed ?? res.data)}`);
  }
}

// Seeds both result streams for one check; row i lands at offsetsMin[i % length] minutes ago with a sub-second spread.
async function seedResults(page, check, scenario, offsetsMin = [-1, -2, -3]) {
  const templates = loadFixture('results.json');
  const stepTemplates = loadFixture('step-results.json');
  // passed-only seeds exactly one row per offset so a test can place rows across windows.
  const plan = scenario === 'passed-only' ? offsetsMin.map(() => 'browser_passed') : scenarioPlan(scenario);
  const rows = [];
  const steps = [];
  const nowMs = Date.now();
  plan.forEach((key, i) => {
    const template = templates[key];
    if (!template) throw new Error(`fixtures/synthetics/results.json has no "${key}" template`);
    const tsMicros = (nowMs + offsetsMin[i % offsetsMin.length] * 60_000 - i * 250) * 1000;
    const built = materialize(template, stepTemplates, check, tsMicros);
    rows.push({ key, ...built.row });
    steps.push(...built.steps);
  });

  const ingestRows = rows.map(({ key: _key, step_template: _st, ...r }) => r);
  await ingestOrThrow(page, RESULTS_STREAM, ingestRows);
  if (steps.length) await ingestOrThrow(page, STEP_RESULTS_STREAM, steps);

  // Resolves on count >= 1, which covers the whole batch because each stream is one ingest call; false is a hard failure.
  const searchable = await waitForFieldValueSearchable(page, RESULTS_STREAM, 'synthetics_id', check.id, SEED_WAIT_MS);
  if (!searchable) throw new Error(`Seeded rows for ${check.id} never became searchable in ${RESULTS_STREAM}`);
  if (steps.length) {
    const stepsSearchable = await waitForFieldValueSearchable(page, STEP_RESULTS_STREAM, 'synthetics_id', check.id, SEED_WAIT_MS);
    if (!stepsSearchable) throw new Error(`Seeded step rows for ${check.id} never became searchable in ${STEP_RESULTS_STREAM}`);
  }

  const pick = (key) => rows.find((r) => r.key === key) ?? null;
  const ref = (r) => r && { runId: r.run_id, executionId: r.execution_id, timestamp: r._timestamp };
  const failed = pick('browser_failed') ?? pick('http_failed');
  const seeded = {
    rows,
    counts: {
      passed: rows.filter((r) => r.status === 'passed').length,
      failed: rows.filter((r) => r.status === 'failed').length,
      warning: rows.filter((r) => r.status === 'warning').length,
      error: rows.filter((r) => r.status === 'error').length,
    },
    passedRun: ref(pick('browser_passed') ?? pick('http_passed')),
    failedRun: failed && { ...ref(failed), failedStepIndex: (failed.failure_detail?.step_index ?? -1) + 1 },
    retriedRun: ref(pick('browser_retried')),
    dispatchErrorRun: ref(pick('error_dispatch')),
    quotaErrorRow: ref(pick('error_quota')),
  };
  testLogger.info('Synthetics results seeded', { checkId: check.id, scenario, counts: seeded.counts });
  return seeded;
}

module.exports = {
  apiBase,
  request,
  workerPrefix,
  uniqueName,
  assertSyntheticsEnabled,
  listLocations,
  createLocation,
  deleteLocation,
  ensureSyntheticsLocation,
  checkPayload,
  startOneHourAhead,
  createCheck,
  getCheck,
  listChecks,
  findCheckByName,
  deleteChecksByPrefix,
  waitForCheck,
  createSyntheticsFolder,
  deleteSyntheticsFoldersByPrefix,
  listTokens,
  disableTokensByPrefix,
  seedResults,
};
