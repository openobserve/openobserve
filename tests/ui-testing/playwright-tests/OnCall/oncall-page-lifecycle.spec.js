/**
 * On-Call — the golden path of one page, end to end (TS-15, TS-29.07)
 *
 * Plan: docs/test_generator/test-plans/oncall-ui-test-plan.md, Tier 1 —
 *   TS-15.01 an alert fires, the right person is paged, the mail carries a
 *            working link, ack stops the ladder, resolve captures a cause, and
 *            all four surfaces agree
 *   TS-15.03 a recovery closes the record without a human, and an un-acked
 *            recovery stays distinguishable from one somebody answered
 *   TS-15.04 a rule that keeps firing wakes somebody ONCE
 *   TS-15.05 resolve offers the eight documented causes, "still unknown" among
 *            them, and does not silently invent one
 *   TS-29.07 console and network hygiene on every on-call route
 *
 * ENTERPRISE-GATED (@enterprise); skips with a reason via `isOnCallAvailable()`.
 *
 * FOUR SURFACES, ONE TRUTH. A page record is described in four places — the
 * record itself, the human timeline, the delivery ledger and the cause
 * analytics — and each is written by a different part of the engine. TS-15.01
 * reads all four for the same firing and asserts they agree; that is the whole
 * point of the case, and it is why it does not stop at "the ack button worked".
 *
 * WHAT IS DELIBERATELY *NOT* ASSERTED HERE:
 *   - The flapping half of TS-15.04 that needs a quiet window. Re-firing inside
 *     the dampening window is asserted (verified: four minutes of continuous
 *     re-evaluation leaves exactly one record and one first-rung delivery). The
 *     other half — that a firing AFTER the window opens a NEW record — needs
 *     the alert's evaluation window to drain, which at the shortest usable
 *     period is longer than a CI lane should hold a worker. Recorded in the
 *     generation report, not faked here.
 *   - Any assertion on a count across the whole org. The `default` org on this
 *     environment carries fixture litter from earlier pytest runs, so every
 *     count here is scoped to the team the test created.
 *
 * Self-cleaning, worker-scoped prefix. `afterAll` runs PER WORKER in parallel
 * mode, so the prefix carries the worker index — a file-wide prefix would let
 * an early-finishing worker sweep a still-running worker's team out from under
 * it, which shows up as "the owning team was deleted" in the escalation state.
 */

const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const PageManager = require('../../pages/page-manager.js');
const path = require('path');

/** The signed-in state global-setup writes; see enhanced-baseFixtures.js. */
const AUTH_STATE_FILE = path.join(__dirname, '..', 'utils', 'auth', 'user.json');
const {
  isOnCallAvailable,
  createTeam,
  addTeamMembers,
  whoIsOnCall,
  createOwnershipRule,
  seedOnCallStream,
  waitForStreamSearchable,
  seedNotificationDestination,
  firePageAndWait,
  listResponses,
  getDeliveries,
  getEscalationProgress,
  orgId,
  uniqueName,
  deleteOnCallFixturesByPrefix,
} = require('../utils/oncall-seed.js');
const {
  createOrgUsers,
  shortenPolicyForSpeed,
  getResponseDetail,
  getResponseRecord,
  getCauseAnalytics,
  eventsOfKind,
  getResponseHistory,
  waitForMail,
  waitForResponseState,
  RESOLUTION_CAUSES,
} = require('../utils/oncall-seed-ext.js');

const PREFIX = 'e2e_oncall_lifecycle';

const workerPrefix = (testInfo) => `${PREFIX}_w${testInfo.workerIndex}`;

/** The cause used wherever the case needs one but is not about which one. */
const A_CAUSE = 'noisy_threshold';

const gate = { checked: false, available: false, reason: '' };

test.describe.configure({ mode: 'parallel' });

test.describe('On-call page lifecycle', {
  tag: ['@oncall', '@oncall-lifecycle', '@enterprise'],
}, () => {
  let pm;
  let ORG;

  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    await navigateToBase(page);
    pm = new PageManager(page);
    ORG = orgId();

    if (!gate.checked) {
      const probe = await isOnCallAvailable(page);
      gate.checked = true;
      gate.available = probe.available;
      gate.reason = probe.reason;
    }
    test.skip(!gate.available, `On-call is not testable here — ${gate.reason}`);
  });

  test.afterAll(async ({ browser }, testInfo) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    await deleteOnCallFixturesByPrefix(page, `${workerPrefix(testInfo)}_`).catch(() => {});
    await context.close();
  });

  /**
   * A staffed team, a routable identity, and the pieces to fire it.
   *
   * The alert carries an HTTP destination rather than none: an alert with
   * neither a destination nor an `oncall_team` is refused outright, and the
   * team here is reached through the OWNERSHIP RULE — which is the path the
   * golden case is about — so the destination is what makes the alert legal
   * without short-circuiting the routing under test. It posts into a stream,
   * so it adds nothing to the mail sink.
   */
  async function seedRoutedAlert(page, testInfo, tag, alertOverrides = {}) {
    const prefix = uniqueName(`${workerPrefix(testInfo)}_${tag}`);
    const emails = await createOrgUsers(page, prefix, 3);
    const team = await createTeam(page, { name: `${prefix}_team` });
    await addTeamMembers(page, team.id, emails);

    const service = `${prefix}_svc`;
    const stream = prefix.toLowerCase();
    const seeded = await seedOnCallStream(page, stream, { minutes: 30, services: [service] });
    await waitForStreamSearchable(page, stream, seeded.records);
    await createOwnershipRule(page, { teamId: team.id, dimensions: { service } });
    const destination = await seedNotificationDestination(page, prefix.toLowerCase());

    return {
      prefix, emails, team, service, stream, destination,
      alertOptions: {
        name: `${prefix}_alert`, stream, destinations: [destination], ...alertOverrides,
      },
    };
  }

  // ------------------------------------------------------------------ TS-15.01

  test('the golden path: fire, page the right person, ack, resolve with a cause', {
    tag: ['@P0'],
  }, async ({ page }, testInfo) => {
    const f = await seedRoutedAlert(page, testInfo, 'golden');
    // Two later rungs inside a minute, so "the ack stopped the ladder" is a
    // claim about rungs that would otherwise have fired during the test.
    await shortenPolicyForSpeed(page, f.team.id, 2, [0, 45, 90]);

    const since = Date.now() - 2000;
    const { pages } = await firePageAndWait(page, { alertOptions: f.alertOptions });
    const record = pages[0];
    testLogger.info('TS-15.01 record opened', { id: record.id, team: record.team_id, priority: record.priority });
    expect(record.team_id, 'the ownership rule must put the page on the team that claims the service')
      .toBe(f.team.id);

    // SURFACE 1 — who the engine says is on call, and who was actually paged.
    const onCall = await whoIsOnCall(page, f.team.id);
    const primary = onCall[0].user_email;
    const mail = await waitForMail({ to: primary, sinceMs: since, subject: /\[P\d\]/, timeout: 150000 });
    expect(mail, `the primary on call (${primary}) must be the address that was paged`).not.toBeNull();
    testLogger.info('TS-15.01 page mail', { subject: mail.subject, to: mail.to });
    expect(mail.subject, 'the subject names the alert, so a phone notification is readable on its own')
      .toContain(f.alertOptions.name);
    expect(mail.subject, 'the subject names the team, so a person on several teams knows which pager rang')
      .toContain(f.team.name);
    expect(`${mail.text}${mail.html}`, 'the body must carry a link back into the record')
      .toContain(`/oncall/responses/${record.id}`);

    // SURFACE 2 — the ladder's own account of what it reached.
    const ladder = await getEscalationProgress(page, record.id);
    expect(ladder.fired[0].reached, 'the ladder must report reaching exactly the person it paged')
      .toEqual([primary]);

    // The UI says it is ringing, and says the ladder has started.
    await pm.oncallPagesListPage.goto(ORG);
    await pm.oncallPagesListPage.expectAvailable();
    await pm.oncallPagesListPage.filterByTeam(f.team.id);
    await pm.oncallPagesListPage.waitForRows();
    const rowKeys = await pm.oncallPagesListPage.readRowKeys();
    testLogger.info('TS-15.01 rows on the Pages list', { rowKeys });
    expect(rowKeys.length, 'the team this page belongs to has exactly this one open record').toBe(1);
    await pm.oncallPagesListPage.expectRowVisible(rowKeys[0]);

    // Ack from the record, which is where a responder actually is.
    await pm.oncallResponseDetailPage.goto(ORG, record.id);
    await pm.oncallResponseDetailPage.expectDetailVisible();
    await pm.oncallResponseDetailPage.acknowledge();

    await expect.poll(
      async () => (await getResponseRecord(page, record.id))?.acked_by ?? null,
      { timeout: 60000, intervals: [1000], message: 'the acknowledgement never reached the record' },
    ).not.toBeNull();
    const acked = await getResponseRecord(page, record.id);
    const ackedAt = acked.acked_at;
    const ledgerAtAck = await getDeliveries(page, record.id);

    // SURFACE 3 — exactly one Ack event, attributed to whoever clicked.
    const afterAck = await getResponseDetail(page, record.id);
    const ackEvents = eventsOfKind(afterAck.events, 'ack');
    expect(ackEvents.length, 'one click is one Ack event — a second would double-count MTTA').toBe(1);
    expect(ackEvents[0].actor, 'the Ack names who answered').toBe(acked.acked_by);

    // The ladder stops. Both remaining rungs were due inside this window, so
    // silence across it is the assertion rather than a pause.
    await page.waitForTimeout(100_000);
    const ledgerAfter = await getDeliveries(page, record.id);
    const afterTheAck = ledgerAfter.deliveries.filter((row) => row.at > ackedAt);
    testLogger.info('TS-15.01 deliveries around the ack', {
      atAck: ledgerAtAck.total, after: ledgerAfter.total, afterTheAck,
    });
    expect(afterTheAck, 'an acknowledged page must not wake anybody else — that is what ack MEANS')
      .toEqual([]);

    // Resolve with a cause, from the dialog, and check it lands everywhere.
    await pm.oncallResponseDetailPage.goto(ORG, record.id);
    await pm.oncallResponseDetailPage.expectDetailVisible();
    await pm.oncallResponseDetailPage.openResolveDialog();
    await pm.oncallResponseDetailPage.selectCause(A_CAUSE);
    await pm.oncallResponseDetailPage.fillCauseNote('closed by the golden-path test');
    await pm.oncallResponseDetailPage.confirmResolve();

    await expect.poll(
      async () => (await getResponseRecord(page, record.id))?.state,
      { timeout: 60000, intervals: [1000], message: 'the resolve never reached the record' },
    ).toBe('resolved');

    const resolved = await getResponseRecord(page, record.id);
    expect(resolved.cause, 'the cause is stored as a stable wire value, not as free text').toBe(A_CAUSE);
    expect(resolved.closed_at, 'a resolved record has a close time to measure against').toBeTruthy();

    // SURFACE 4 — cause analytics, which is the only reason the cause is asked for.
    const causes = await getCauseAnalytics(page, { teamId: f.team.id });
    testLogger.info('TS-15.01 cause analytics', causes);
    const entry = (causes.causes ?? []).find((c) => c.cause === A_CAUSE);
    expect(entry, `the cause captured on resolve must reach analytics as "${A_CAUSE}"`).toBeTruthy();
    expect(entry.last_response_id, 'analytics points back at the record it came from').toBe(record.id);
  });

  // ------------------------------------------------------------------ TS-15.03

  /**
   * UNWIRED, and kept as a fixme with its real assertions intact.
   *
   * Verified on this build, 15 Sep: an alert on a one-minute evaluation window
   * over a stream nothing is still writing to DOES notice it went healthy — the
   * record's timeline collects `recovery: the alert stopped firing`, once per
   * evaluation — and the record nevertheless stays `state: "triggered"` with no
   * `closed_at` eight minutes and seven recovery events later. The engine sees
   * the recovery and does not act on it.
   *
   * That is the worst shape this can take: the Pages list keeps showing a page
   * that needs somebody for a condition that has already cleared, so the screen
   * that exists to say "what still needs a human" fills up with things that do
   * not. The body asserts the correct behaviour — the record closes itself, no
   * acknowledgement is forged, and nothing is delivered afterwards — so it goes
   * green the moment the recovery is acted on.
   */
  test.fixme('a recovery closes the record without a human, and says nobody answered — not wired: the record collects repeated `recovery` events and stays triggered, verified 15 Sep on :5090', {
    tag: ['@P0'],
  }, async ({ page }, testInfo) => {
    test.setTimeout(15 * 60 * 1000);
    // A one-minute evaluation window over a stream nothing is still writing to:
    // the window drains on its own, which is what "the condition went healthy"
    // looks like from the engine's side.
    const f = await seedRoutedAlert(page, testInfo, 'recover', {
      periodMinutes: 1, frequencyMinutes: 1,
    });
    const { pages } = await firePageAndWait(page, { alertOptions: f.alertOptions });
    const record = pages[0];
    testLogger.info('TS-15.03 record opened', { id: record.id });

    // Nobody acks. The close must happen anyway.
    const closed = await waitForResponseState(page, record.id, ['resolved', 'recovered', 'closed'], {
      timeout: 10 * 60 * 1000, pollMs: 10000,
    });
    testLogger.info('TS-15.03 record after recovery', {
      state: closed.state, closedAt: closed.closed_at, ackedBy: closed.acked_by,
    });
    expect(closed.state, 'an alert that stops firing must close its own record — nobody is coming')
      .not.toBe('triggered');

    // "Nobody ever answered this" has to stay countable: an un-acked recovery
    // is a different fact from one a person handled, and MTTA depends on it.
    expect(closed.acked_by ?? null, 'a recovery must not forge an acknowledgement nobody made').toBeNull();

    // The timeline says WHY it closed, so a reader is not left guessing.
    const detail = await getResponseDetail(page, record.id);
    const closing = detail.events.filter((e) => /recover|resolv|clos/i.test(String(e.body ?? '')));
    testLogger.info('TS-15.03 closing events', { closing });
    expect(closing.length, 'a record that closes itself must say so on its own timeline').toBeGreaterThan(0);
    expect(closing[closing.length - 1].actor, 'an automatic close is the engine\'s act, not a person\'s')
      .not.toBe(closed.acked_by ?? 'never');

    // And the escalation stops with it: no delivery after the close.
    const ledger = await getDeliveries(page, record.id);
    const afterClose = ledger.deliveries.filter((row) => row.at > closed.closed_at);
    expect(afterClose, 'nothing may be delivered for a record that has already closed').toEqual([]);
  });

  /**
   * The header half of TS-15.01, UNWIRED, kept as a fixme with its real
   * assertions intact.
   *
   * Verified on this build, 15 Sep: on an open record whose
   * `oncall-response-detail-page` root, `oncall-response-stats` and
   * `oncall-response-elapsed` all render, the ENTIRE subtitle slot is absent —
   * `oncall-response-subtitle`, `oncall-response-team-link` and
   * `oncall-response-firing` each have a DOM count of 0. The component draws
   * them under `v-if="response"` inside the page header's `#subtitle` slot, and
   * that slot is not reaching the page.
   *
   * What it costs a responder: the record never says which team it belongs to,
   * never links to that team's rotation — `OnCallResponseDetail.vue` calls that
   * link "the next click a responder makes" in its own comment — and never
   * shows the firing count that distinguishes "again" from "first time". The
   * rest of the golden path works, which is why it is asserted green above and
   * this is a separate fixme rather than a failure hung on the whole case.
   */
  test.fixme('the record header names the team the page belongs to and links to it — not wired: the whole subtitle slot renders zero elements, verified 15 Sep on :5090', {
    tag: ['@P0'],
  }, async ({ page }, testInfo) => {
    const f = await seedRoutedAlert(page, testInfo, 'header');
    const { pages } = await firePageAndWait(page, { alertOptions: f.alertOptions });

    await pm.oncallResponseDetailPage.goto(ORG, pages[0].id);
    await pm.oncallResponseDetailPage.expectDetailVisible();
    await pm.oncallResponseDetailPage.expectTeamLinkNames(f.team.name);
    await pm.oncallResponseDetailPage.expectSubtitleContains(f.team.name);
  });

  // ------------------------------------------------------------------ TS-15.04

  test('a rule that keeps firing wakes somebody once', {
    tag: ['@P0'],
  }, async ({ page }, testInfo) => {
    test.setTimeout(10 * 60 * 1000);
    const f = await seedRoutedAlert(page, testInfo, 'flap');
    // Deliberately NOT shortened: the point is that nothing new fires, so the
    // default P2 ladder's five-minute second rung stays out of the window.
    const { alert, pages } = await firePageAndWait(page, { alertOptions: f.alertOptions });
    const record = pages[0];
    const firstLedger = await getDeliveries(page, record.id);
    expect(firstLedger.total, 'the first rung has to have fired for "once" to mean anything')
      .toBeGreaterThan(0);

    // The alert re-evaluates every minute over a window that still holds rows,
    // so it keeps firing for the whole of this wait.
    await page.waitForTimeout(240_000);

    const all = await listResponses(page, {
      subjectType: 'alert', sourceId: alert.id, includeResolved: true,
    });
    testLogger.info('TS-15.04 records after four minutes of re-firing', {
      count: all.length, states: all.map((r) => [r.state, r.subject.firing]),
    });
    expect(all.length, 'a rule that keeps firing must annotate ONE record, not open a queue of them')
      .toBe(1);
    expect(all[0].id, 'the surviving record is the one that was opened first').toBe(record.id);

    // And nobody is re-paged for the same firing.
    const ledger = await getDeliveries(page, record.id);
    const firstRung = ledger.deliveries.filter((row) => row.rung_micros === 0);
    testLogger.info('TS-15.04 first-rung deliveries', { firstRung });
    expect(firstRung.length, 'the first rung must fire once for the whole run, not once per evaluation')
      .toBe(firstLedger.deliveries.filter((row) => row.rung_micros === 0).length);
  });

  // ------------------------------------------------------------------ TS-15.05

  test('resolve offers the eight documented causes, still-unknown among them', {
    tag: ['@P0'],
  }, async ({ page }, testInfo) => {
    const f = await seedRoutedAlert(page, testInfo, 'cause');
    const { pages } = await firePageAndWait(page, { alertOptions: f.alertOptions });
    const record = pages[0];

    await pm.oncallResponseDetailPage.goto(ORG, record.id);
    await pm.oncallResponseDetailPage.expectDetailVisible();
    await pm.oncallResponseDetailPage.openResolveDialog();
    const offered = await pm.oncallResponseDetailPage.readCauseOptions();
    testLogger.info('TS-15.05 causes offered', { offered });

    // A FIXED list. Free text fragments into near-duplicates and never groups,
    // which is the same as recording nothing.
    expect([...offered].sort(), 'the dialog must offer exactly the documented causes')
      .toEqual([...RESOLUTION_CAUSES].sort());
    expect(offered, '"still unknown" has to be offered, or people pick a plausible lie')
      .toContain('still_unknown');

    // Resolving with "still unknown" must store "still unknown" — the one cause
    // that must never be quietly upgraded into something more useful-looking.
    await pm.oncallResponseDetailPage.selectCause('still_unknown');
    await pm.oncallResponseDetailPage.confirmResolve();

    await expect.poll(
      async () => (await getResponseRecord(page, record.id))?.state,
      { timeout: 60000, intervals: [1000], message: 'the resolve never reached the record' },
    ).toBe('resolved');

    const resolved = await getResponseRecord(page, record.id);
    expect(resolved.cause, '"still unknown" must be stored as itself, never mapped to a plausible cause')
      .toBe('still_unknown');

    const analytics = await getCauseAnalytics(page, { teamId: f.team.id });
    const entry = (analytics.causes ?? []).find((c) => c.cause === 'still_unknown');
    expect(entry, '"still unknown" is a real answer and has to be countable as one').toBeTruthy();
  });

  // ------------------------------------------------------------------ TS-29.07

  test('every on-call route loads without a console error or a 404 on its own API', {
    tag: ['@P0'],
  }, async ({ page }, testInfo) => {
    const f = await seedRoutedAlert(page, testInfo, 'hygiene');
    const { pages } = await firePageAndWait(page, { alertOptions: f.alertOptions });
    const record = pages[0];

    const consoleErrors = [];
    const vueWarnings = [];
    const notFound = [];
    const countCalls = [];

    // A failed request for a SHARED app-shell asset is not an on-call defect: it
    // fails identically on every screen in the product. `getImageURL` builds
    // `src/assets/...`, a path only a dev server has, so a frontend built with a
    // bare `vite build` 404s the header logo everywhere — CI does not reproduce
    // it because it installs a prebuilt frontend artifact. Anything else, including
    // a 404 raised by an on-call route's own API, still fails this test: those are
    // collected separately in `notFound` and asserted above.
    // The failing message's OWN location decides this, never a sighting of some
    // other shell 404 elsewhere on the page — that suppresses every resource
    // error on the route the moment one logo 404s.
    const sharedShellAsset = (message) =>
      /Failed to load resource/.test(message.text())
      && (message.location()?.url ?? '').includes('/web/src/assets/');

    page.on('console', (message) => {
      const text = message.text();
      if (message.type() === 'error' && !sharedShellAsset(message)) consoleErrors.push(text);
      if (/\[Vue warn\]/.test(text)) vueWarnings.push(text);
    });
    page.on('pageerror', (error) => consoleErrors.push(`uncaught: ${error.message}`));
    let apiCallsHere = 0;
    page.on('response', (response) => {
      const url = response.url();
      if (!/\/api\/.*\/oncall\//.test(url)) return;
      apiCallsHere += 1;
      if (response.status() === 404) notFound.push(`${response.status()} ${url}`);
      // G24: the Pages list once called a count endpoint that does not exist,
      // 404ing on every single load without anybody noticing.
      if (/\/oncall\/responses\/count/.test(url)) countCalls.push(url);
    });

    const routes = [
      `/web/oncall/responses?org_identifier=${ORG}`,
      `/web/oncall/responses/${record.id}?org_identifier=${ORG}`,
      `/web/oncall/me?org_identifier=${ORG}`,
      `/web/oncall/teams?org_identifier=${ORG}`,
      `/web/oncall/teams/${f.team.id}/overview?org_identifier=${ORG}`,
      `/web/oncall/policies?org_identifier=${ORG}`,
      `/web/oncall/routing?org_identifier=${ORG}`,
    ];

    // ANCHOR FIRST. Every assertion below is an absence, and a route that drew
    // nothing and called nothing satisfies all four — "no 404" is free if there
    // was no request. Each route must be shown to have reached its own API
    // before its silence counts as evidence.
    const silent = [];
    for (const route of routes) {
      apiCallsHere = 0;
      await page.goto(route);
      await page.waitForLoadState('domcontentloaded');
      // Give the screen's own fetches time to land — a 404 that arrives after
      // the assertion is a 404 nobody catches, which is exactly how G24 lived.
      await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
      if (apiCallsHere === 0) silent.push(route);
    }

    testLogger.info('TS-29.07 hygiene sweep', {
      routes: routes.length, consoleErrors, vueWarnings, notFound, countCalls, silent,
    });

    expect(silent, 'every on-call route must reach its own API — a route that asks for nothing passes the checks below for free')
      .toEqual([]);
    expect(notFound, 'no on-call screen may 404 on its own API — G24 hid here for a whole release')
      .toEqual([]);
    expect(countCalls, 'the retired /oncall/responses/count endpoint must not be called again')
      .toEqual([]);
    expect(consoleErrors, 'an on-call route must load without an uncaught error').toEqual([]);
    expect(vueWarnings, 'a Vue warning is a contract between components that has already broken')
      .toEqual([]);
  });

  /**
   * TS-15.08 — the page detail survives a cold deep link, and each panel loads
   * on its own.
   *
   * A page record is reached from an EMAIL, at 3am, in a browser with no app
   * state — never by clicking through the list. So the route has to stand up
   * cold, and one slow or failing panel must not take the screen with it: the
   * verbs have to be usable while the ledger is still loading, because the
   * whole point of the screen is the verbs.
   */
  test('TS-15.08 the record deep-links cold, and every panel loads independently', {
    tag: ['@P1'],
  }, async ({ page, browser }, testInfo) => {
    // A real firing has to clear ingestion, the scheduler and the ladder; the
    // 3-minute default is for screens, not for this.
    test.setTimeout(600_000);
    const f = await seedRoutedAlert(page, testInfo, 'deep');
    const { pages } = await firePageAndWait(page, { alertOptions: f.alertOptions });
    const id = pages[0].id;

    // A genuinely cold context: no history, no warmed store, no prior route —
    // but still signed in, because the case is about a cold DEEP LINK, not
    // about the login screen. The auth state is the one global-setup writes;
    // `project.use.storageState` is not it (the config does not set one — the
    // enhanced fixtures load `utils/auth/user.json` themselves), and passing
    // that undefined would have made this an anonymous context that simply
    // redirects to sign-in and proves nothing.
    const context = await browser.newContext({
      storageState: AUTH_STATE_FILE,
      viewport: { width: 1500, height: 1024 },
    });
    const cold = await context.newPage();
    const coldPm = new PageManager(cold);

    const failures = [];
    cold.on('response', (res) => {
      const url = res.url();
      if (url.includes('/oncall/') && res.status() >= 400) failures.push(`${res.status()} ${url}`);
    });

    await coldPm.oncallResponseDetailPage.goto(ORG, id);
    await coldPm.oncallResponseDetailPage.expectDetailVisible();

    // The verbs are the reason somebody opened the link; they must be live
    // without waiting on the panels below them.
    await expect(
      coldPm.oncallResponseDetailPage.getAckButton(),
      'the acknowledge control must be usable on a cold deep link',
    ).toBeEnabled({ timeout: 30000 });

    // The tab strip has to exist before a tab can be switched. `OTabPanels`
    // defaults to `keepAlive=false`, so only the ACTIVE panel is in the DOM at
    // all — clicking a trigger that has not rendered yet leaves every panel
    // absent and the wait below expires against a page that is merely still
    // arriving. This is the cold-load ordering the case is about, so it is
    // waited for explicitly rather than papered over with a longer timeout.
    await expect(
      coldPm.oncallResponseDetailPage.getTabs(),
      'the record must offer its detail tabs on a cold load',
    ).toBeVisible({ timeout: 30000 });

    // Each panel, opened in turn: one failing must not have taken the others.
    // The panel is addressed by the id OTabPanel builds, because the
    // `data-test` the view writes onto OTabPanel never reaches the DOM — see
    // the note on `tabPanel()` in the page object.
    for (const tab of ['activity', 'deliveries', 'causes']) {
      await coldPm.oncallResponseDetailPage.expectTabPanelVisible(tab);
    }

    expect(failures, 'a cold deep link must not 404 or 500 on any of its own API calls')
      .toEqual([]);

    await context.close();
  });

  /**
   * TS-15.10 — ledger-only events stay off the human timeline.
   *
   * REGRESSION GUARD, and the regression it guards is subtle. The set of people
   * "already notified" must be computed from the DELIVERY LEDGER, which holds
   * one row per (run, rung, recipient, channel) including failures. If it were
   * computed from the human timeline instead — which is filtered for
   * readability — then everyone the filter hid would be paged a second time on
   * the next rung.
   *
   * So two things are asserted together: the ledger holds strictly more than
   * the timeline shows, and nobody in the ledger is paged twice for one rung.
   * Either alone would pass a build that had merged the two.
   */
  test('TS-15.10 the delivery ledger is richer than the human timeline, and nobody is paged twice for one rung', {
    tag: ['@P1'],
  }, async ({ page }, testInfo) => {
    // A real firing has to clear ingestion, the scheduler and the ladder; the
    // 3-minute default is for screens, not for this.
    test.setTimeout(600_000);
    const f = await seedRoutedAlert(page, testInfo, 'ledger');
    const { pages } = await firePageAndWait(page, { alertOptions: f.alertOptions });
    const id = pages[0].id;

    await expect.poll(async () => (await getDeliveries(page, id))?.total, { timeout: 120000 })
      .toBeGreaterThan(0);

    const ledger = await getDeliveries(page, id);
    const rows = ledger.deliveries ?? ledger.rows ?? [];
    expect(rows.length, 'the ledger must hold rows to compare against').toBeGreaterThan(0);

    const events = await getResponseHistory(page, id);
    const pageEvents = eventsOfKind(events, 'page');

    // The timeline is a READING of the ledger, not the ledger itself: it must
    // never be the thing the engine counts.
    expect(
      rows.length,
      'the ledger must carry at least as much as the timeline shows — it is the record, the timeline is the summary',
    ).toBeGreaterThanOrEqual(pageEvents.length);

    // Nobody paged twice for the same (run, rung, channel).
    const seen = new Map();
    for (const row of rows) {
      const key = [row.ladder_run ?? row.run, row.rung ?? row.rung_micros, row.recipient, row.channel]
        .join('|');
      seen.set(key, (seen.get(key) ?? 0) + 1);
    }
    const doubled = [...seen.entries()].filter(([, n]) => n > 1).map(([k]) => k);
    expect(
      doubled,
      'a recipient paged twice for one rung means the already-notified set was read from the filtered timeline, not the ledger',
    ).toEqual([]);

    // And the screen draws the ledger as its own panel rather than folding it
    // into the activity list.
    await pm.oncallResponseDetailPage.goto(ORG, id);
    await pm.oncallResponseDetailPage.openTab('deliveries');
    await pm.oncallResponseDetailPage.expectLedgerVisible();
  });

  /**
   * TS-15.11 (G24) — the Pages screen asks for nothing that answers 404.
   *
   * G24 was a count request that 404ed on every load: harmless-looking, because
   * the screen still drew, and corrosive, because it trained everyone to ignore
   * red in the network tab on the one screen where a genuinely failing request
   * matters most.
   *
   * Written as a guard over the WHOLE screen rather than one URL, so it still
   * holds if the count moves to a different endpoint.
   */
  test('TS-15.11 the Pages screen issues no request that 404s, counts included', {
    tag: ['@P1'],
  }, async ({ page }, testInfo) => {
    // A real firing has to clear ingestion, the scheduler and the ladder; the
    // 3-minute default is for screens, not for this.
    test.setTimeout(600_000);
    const f = await seedRoutedAlert(page, testInfo, 'g24');
    await firePageAndWait(page, { alertOptions: f.alertOptions });

    // Scoped to on-call's OWN endpoints. G24 was an on-call count request that
    // did not exist; widening this to every `/api/` call on the screen would
    // make it fail on unrelated endpoints this deployment happens not to serve,
    // which is a different test and a worse one.
    const notFound = [];
    page.on('response', (res) => {
      if (res.status() === 404 && /\/oncall\//.test(res.url())) notFound.push(res.url());
    });

    await pm.oncallPagesListPage.goto(ORG);
    await pm.oncallPagesListPage.filterByTeam(f.team.id);

    // Exercise the grouped view too: the counts are what G24 was about, and
    // they are only fetched once sections are drawn.
    await pm.oncallPagesListPage.setGrouped(true);
    await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});

    // ANCHOR FIRST. "No 404s" is an absence, and an absence is satisfied just as
    // well by a screen that never loaded and asked for nothing at all. So prove
    // the screen actually did its work before reading anything into the silence.
    const rowKeys = await pm.oncallPagesListPage.readRowKeys();
    expect(
      rowKeys.length,
      'the Pages list must have drawn the seeded page — otherwise "no 404s" only means "no requests"',
    ).toBeGreaterThan(0);

    expect(
      notFound,
      'G24: the Pages screen asked for a count that did not exist — nothing it loads may 404',
    ).toEqual([]);
  });

});
