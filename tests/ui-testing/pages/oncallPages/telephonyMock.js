const { createHash, randomBytes } = require('node:crypto');
const { request: playwrightRequest } = require('@playwright/test');
const testLogger = require('../../playwright-tests/utils/test-logger.js');
const { getAuthHeaders } = require('../../playwright-tests/utils/cloud-auth.js');
const {
  addTeamMembers,
  api,
  baseUrl,
  createOrg,
  createOwnershipRule,
  createTeam,
  deleteOnCallFixturesByPrefix,
  firePageAndWait,
  orgId,
  rotation,
  rungPagingRotation,
  seedOnCallStream,
  setTeamPolicy,
  setTeamSchedule,
  withOrg,
} = require('../../playwright-tests/utils/oncall-seed.js');
const { createOrgUser, loginAs, oncallUserEmail } = require('../../playwright-tests/utils/oncall-seed-ext.js');

const DEFAULT_MOCK_URL = 'http://127.0.0.1:5097';

// Above the server's 15 s limit per send, so a slow retry is not read as nothing sent.
const DEFAULT_WAIT_MS = 45_000;
const POLL_MS = 200;
const FIRE_WAIT_MS = 180_000;

const PHONE_DIGITS = 11;
const SMS_ACK_LINK = /Acknowledge: (\S+)/;
// createOrgUser gives everyone this name, and the screens draw it instead of the address.
const SEEDED_PERSON_NAME = 'OnCall E2E';

const gateCache = new Map();

class TwilioMockError extends Error {
  constructor(message, status = null, body = null) {
    super(message);
    this.name = 'TwilioMockError';
    this.status = status;
    this.body = body;
  }
}

/** Same method names as the pytest client; every refusal throws, so a helper cannot turn nothing happening into a pass. */
class TelephonyMock {
  constructor(request, base = process.env.TWILIO_MOCK_URL || DEFAULT_MOCK_URL) {
    this.request = request;
    this.base = base.replace(/\/+$/, '');
  }

  async call(method, path, { body, query } = {}) {
    const clean = Object.entries(query ?? {}).filter(([, value]) => value !== undefined && value !== null);
    const search = clean.length ? `?${new URLSearchParams(clean.map(([k, v]) => [k, String(v)]))}` : '';
    const options = { method, failOnStatusCode: false };
    if (body !== undefined) options.data = body;
    const res = await this.request.fetch(`${this.base}${path}${search}`, options);
    const text = await res.text();
    if (!res.ok()) throw new TwilioMockError(`${method} ${path}: HTTP ${res.status()}: ${text}`, res.status(), text);
    return JSON.parse(text);
  }

  async health() {
    return await this.call('GET', '/_mock/health');
  }

  async reachable() {
    try {
      return (await this.health()).ok === true;
    } catch (error) {
      testLogger.warn('Twilio mock is not reachable', { base: this.base, error: error.message });
      return false;
    }
  }

  async addAccount(sid, token, { status = 'active', type = 'Full', numbers = [] } = {}) {
    await this.call('POST', '/_mock/accounts', { body: { sid, token, status, type, numbers } });
  }

  async fail(rule) {
    return (await this.call('POST', '/_mock/fail', { body: rule })).rule_id;
  }

  async clearFail(ruleId) {
    await this.call('DELETE', `/_mock/fail/${ruleId}`);
  }

  async requests({ to, sid, kind, sinceSeq, accepted } = {}) {
    const query = { to, sid, kind, since_seq: sinceSeq, accepted };
    return (await this.call('GET', '/_mock/requests', { query })).requests;
  }

  /** Accepted requests only by default, because a request the fake refused never reached a phone. */
  async waitFor(to, kind, { count = 1, timeout = DEFAULT_WAIT_MS, sid, sinceSeq, accepted = true } = {}) {
    const deadline = Date.now() + timeout;
    for (;;) {
      const found = await this.requests({ to, sid, kind, sinceSeq, accepted });
      if (found.length >= count) return found;
      if (Date.now() >= deadline) {
        const answers = (await this.requests({ to, sid, kind, sinceSeq })).map((record) => record.response_status);
        throw new TwilioMockError(
          `${kind} to ${to}: saw ${found.length} of ${count} with accepted=${accepted} after ${timeout} ms; every answer so far: ${JSON.stringify(answers)}`,
          null,
          found,
        );
      }
      await new Promise((resolve) => {
        setTimeout(resolve, POLL_MS);
      });
    }
  }

  async lastCode(to) {
    return (await this.call('GET', '/_mock/last_code', { query: { to } })).code;
  }

  async tokenHash(seq) {
    return (await this.call('GET', `/_mock/requests/${seq}/token_hash`)).sha256;
  }

  /** Throws when O2 refuses the press; pass `expectStatus: null` to read any answer. */
  async press({ to, callSid, digits, expectStatus = 200 } = {}) {
    const body = {};
    if (to !== undefined) body.to = to;
    if (callSid !== undefined) body.call_sid = callSid;
    if (digits !== undefined) body.digits = digits;
    const answer = await this.call('POST', '/_mock/press', { body });
    if (expectStatus !== null && answer.status !== expectStatus) {
      throw new TwilioMockError(`press: O2 answered ${answer.status}, wanted ${expectStatus}`, answer.status, answer);
    }
    if (expectStatus === 200 && answer.twiml_error) {
      throw new TwilioMockError(`press: O2's 200 is not TwiML: ${answer.twiml_error}`, 200, answer);
    }
    return answer;
  }

  /** Verifies as the person on the routes a person uses, because no API can mark another person's phone verified. */
  async verifyPhoneAs({ org, email, password, phone }) {
    const path = `/api/${org}/oncall/contacts/${encodeURIComponent(email)}`;
    await asPerson({ email, password }, async (person) => {
      await personCall(person, 'put', path, { phone }, 'Saving the phone');
      await personCall(person, 'post', `${path}/verify`, undefined, 'Sending the code');
      const code = await this.lastCode(phone);
      await personCall(person, 'post', `${path}/verify/confirm`, { code }, 'Confirming the code');
      const contact = await personCall(person, 'get', path, undefined, 'Reading the contact');
      if (contact?.phone_is_pageable !== true) {
        throw new Error(`Verifying ${phone} left ${email} not pageable: ${JSON.stringify(contact)}`);
      }
    });
    testLogger.info('Phone verified through the mock', { email });
  }

  async readAckLink(to, { sinceSeq }) {
    const texts = await this.waitFor(to, 'sms', { sinceSeq });
    const body = texts[texts.length - 1].body ?? '';
    const match = SMS_ACK_LINK.exec(body);
    if (!match) throw new Error(`The newest text to ${to} carries no Acknowledge link: ${body}`);
    return match[1];
  }
}

/** A number on the unassigned +999 code, so a misconfigured run cannot ring anyone, and unique so no test meets a daily cap. */
function uniquePhone() {
  const digits = BigInt(`0x${randomBytes(8).toString('hex')}`) % 10n ** BigInt(PHONE_DIGITS);
  return `+999${digits.toString().padStart(PHONE_DIGITS, '0')}`;
}

/** An account nobody else holds; the token carries the prefix CI sweeps the logs for. */
function newAccount({ extraNumbers = 0 } = {}) {
  const from = uniquePhone();
  const others = Array.from({ length: extraNumbers }, () => uniquePhone());
  return {
    sid: `AC${randomBytes(16).toString('hex')}`,
    token: `o2tok-canary-${randomBytes(16).toString('hex')}`,
    from,
    numbers: [from, ...others],
  };
}

function shortSid(sid) {
  return `${sid.slice(0, 4)}…${sid.slice(-4)}`;
}

function sha256(text) {
  return createHash('sha256').update(text).digest('hex');
}

async function registerAccount(mock, account) {
  const numbers = account.numbers.map((number) => ({ number, sms: true, voice: true }));
  await mock.addAccount(account.sid, account.token, { numbers });
}

async function connectOrgAccount(page, mock, account) {
  await registerAccount(mock, account);
  const res = await api(page, 'put', `${baseUrl()}/api/${orgId()}/telephony`, {
    provider: 'twilio',
    account_sid: account.sid,
    auth_token: account.token,
    from_number: account.from,
  });
  if (!res.ok()) {
    throw new Error(`Connecting ${account.sid} failed: HTTP ${res.status()}: ${await res.text()}`);
  }
}

async function readTelephony(page) {
  const res = await page.request.get(`${baseUrl()}/api/${orgId()}/telephony`, { headers: getAuthHeaders() });
  if (!res.ok()) throw new Error(`GET /telephony failed: HTTP ${res.status()}: ${await res.text()}`);
  return await res.json();
}

/** A context with no cookies: a root session beside a person's Basic header would make the identity a precedence question. */
async function asPerson({ email, password }, fn) {
  const basic = Buffer.from(`${email}:${password}`).toString('base64');
  const person = await playwrightRequest.newContext({
    extraHTTPHeaders: { Authorization: `Basic ${basic}` },
  });
  try {
    return await fn(person);
  } finally {
    await person.dispose();
  }
}

async function personCall(person, method, path, data, what) {
  const options = data === undefined ? {} : { data };
  const res = await person[method](`${baseUrl()}${path}`, options);
  const text = await res.text();
  if (!res.ok()) throw new Error(`${what} (${method} ${path}) failed: HTTP ${res.status()}: ${text}`);
  return text.trim() ? JSON.parse(text) : null;
}

/** The status a person gets for writing someone's contact; a refusal is the answer here, so it never throws. */
async function putContactStatusAs({ org, email, password }, targetEmail, phone) {
  return await asPerson({ email, password }, async (person) => {
    const res = await person.put(`${baseUrl()}/api/${org}/oncall/contacts/${encodeURIComponent(targetEmail)}`, {
      data: { phone },
    });
    return res.status();
  });
}

/** Texts a code to each number as the person would, so the caps count them; none of them is confirmed. */
async function sendCodesAs({ org, email, password }, phones) {
  const path = `/api/${org}/oncall/contacts/${encodeURIComponent(email)}`;
  await asPerson({ email, password }, async (person) => {
    for (const phone of phones) {
      await personCall(person, 'put', path, { phone }, 'Saving the phone');
      await personCall(person, 'post', `${path}/verify`, undefined, 'Sending the code');
    }
  });
}

async function readContactAs({ org, email, password }) {
  return await asPerson(
    { email, password },
    async (person) =>
      await personCall(person, 'get', `/api/${org}/oncall/contacts/${encodeURIComponent(email)}`, undefined, 'Reading the contact'),
  );
}

/** Throws on anything but the server config the shard names, because a skip here once hid the whole on-call suite. */
async function requireTelephony(page, mode) {
  if (gateCache.get(mode) === true) return;
  const mock = new TelephonyMock(page.request);
  if (!(await mock.reachable())) {
    throw new Error(`The Twilio mock is not reachable at ${mock.base}. Start it and set TWILIO_MOCK_URL.`);
  }
  const health = await mock.health();
  const wantsDeployment = mode === 'deployment';
  if (wantsDeployment !== health.protected_sids.length > 0) {
    throw new Error(
      `The Twilio mock has protected SIDs ${JSON.stringify(health.protected_sids)}, wrong for the ${mode} shard: check --deployment-account.`,
    );
  }
  if (!wantsDeployment && !health.callback_host) {
    throw new Error('The Twilio mock has no callback host, so no key can be pressed: start it with --callback-host.');
  }

  const org = await createOrg(page, 'e2e_tel_canary');
  await withOrg(org.id, async () => {
    const view = await readTelephony(page);
    if (view.deployment_account_present !== wantsDeployment || view.press4_available === wantsDeployment) {
      throw new Error(
        `GET /telephony says deployment_account_present=${view.deployment_account_present}, ` +
          `press4_available=${view.press4_available}, wrong for the ${mode} shard: ` +
          'check O2_TELEPHONY_PROVIDER, O2_TELEPHONY_ACCOUNT_SID and O2_TELEPHONY_CALLBACK_URL.',
      );
    }
    const account = newAccount();
    await connectOrgAccount(page, mock, account);
    const checks = await mock.requests({ sid: account.sid, kind: 'account' });
    if (!checks.some((check) => check.auth_ok === true)) {
      throw new Error('Saving an account never reached the Twilio mock: check O2_TELEPHONY_API_BASE_URL.');
    }
    await deleteOrgAccount(page);
  });
  gateCache.set(mode, true);
}

/** The no-fake shards' gate: fails instead of skipping when the server has a provider, or no on-call at all. */
async function requireNoProvider(page) {
  const view = await readTelephony(page);
  if (view.deployment_account_present || view.org) {
    throw new Error(`This spec needs a server with no phone provider, and GET /telephony says ${JSON.stringify(view)}`);
  }
}

async function deleteOrgAccount(page) {
  await page.request.delete(`${baseUrl()}/api/${orgId()}/telephony`, { headers: getAuthHeaders() });
}

async function createPerson(page, prefix, suffix = 'person') {
  const user = await createOrgUser(page, { email: oncallUserEmail(prefix, suffix) });
  return { email: user.email, password: user.password, name: SEEDED_PERSON_NAME };
}

async function createSignedInPerson(page, browser, prefix, suffix = 'person') {
  const person = await createPerson(page, prefix, suffix);
  const session = await loginAs(browser, { email: person.email, password: person.password });
  return { ...person, ...session };
}

async function stageTeamWithPerson(page, mock, prefix, { channels = ['email', 'sms', 'voice'] } = {}) {
  const person = await createPerson(page, prefix);
  const phone = uniquePhone();
  await mock.verifyPhoneAs({ org: orgId(), ...person, phone });
  const verifiedAt = await mock.requests({ to: phone });
  const seq = verifiedAt[verifiedAt.length - 1].seq;
  const team = await createTeam(page, { name: `${prefix}_team`, timezone: 'UTC' });
  await addTeamMembers(page, team.id, [person.email]);
  await setTeamSchedule(page, team.id, {
    timezone: 'UTC',
    rotations: [rotation({ id: 'Primary', members: [person.email] })],
  });
  await setTeamPolicy(page, team.id, { rungs: [rungPagingRotation(1, 'Primary', { channels })] });
  return { team, person, phone, seq };
}

async function routeServiceToTeam(page, teamId, prefix) {
  const service = `${prefix}_svc`;
  await createOwnershipRule(page, { teamId, dimensions: { service } });
  return service;
}

/** A real alert fired by the scheduler at P1, since a manual trigger opens a page that routes to no team. */
async function firePage(page, prefix, teamId) {
  const stream = prefix.toLowerCase();
  await seedOnCallStream(page, stream, { minutes: 30, services: [`${prefix}_svc`] });
  const { alert, pages } = await firePageAndWait(page, {
    alertOptions: { name: `${prefix}_alert`, stream, teamId, priority: 1 },
    timeout: FIRE_WAIT_MS,
  });
  return { alert, record: pages[0] };
}

/** Teardown deletes the alert, else the shared scheduler keeps firing it; it must never mask a test's result. */
async function clearOrgFixtures(page, org, prefix) {
  await withOrg(org.id, async () => {
    await deleteOnCallFixturesByPrefix(page, `${prefix}_`);
    await deleteOrgAccount(page);
  }).catch((error) => testLogger.warn('Telephony teardown failed', { org: org.id, error: error.message }));
}

module.exports = {
  TelephonyMock,
  TwilioMockError,
  clearOrgFixtures,
  connectOrgAccount,
  createPerson,
  createSignedInPerson,
  firePage,
  newAccount,
  putContactStatusAs,
  readContactAs,
  sendCodesAs,
  readTelephony,
  registerAccount,
  requireNoProvider,
  requireTelephony,
  routeServiceToTeam,
  sha256,
  shortSid,
  stageTeamWithPerson,
  uniquePhone,
};
