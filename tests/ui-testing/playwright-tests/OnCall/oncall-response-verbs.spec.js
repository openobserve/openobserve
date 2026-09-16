/**
 * On-Call — the six verbs a responder has, and who may use them (TS-17, TS-15.06, TS-02.01)
 *
 * Plan: docs/test_generator/test-plans/oncall-ui-test-plan.md, Tier 1 —
 *   TS-17.01 snooze quiets the ladder without claiming the record
 *   TS-17.03 handing off to a person actually pages them, and is not complete
 *            until they answer
 *   TS-17.04 handing off to a team re-resolves from THAT team's schedule
 *   TS-15.06 the Pages list: section counts match, and a rung reaching nobody
 *            renders as such rather than as a blank cell
 *   TS-02.01 a viewer can work a page end to end
 *
 * ENTERPRISE-GATED (@enterprise); skips with a reason via `isOnCallAvailable()`.
 *
 * SNOOZE IS NOT AN ACK, AND THAT IS THE WHOLE CASE. Naively implemented, a
 * snooze either claims the record (so nobody else picks it up and nobody is
 * working it) or releases every pending rung the instant it ends (so the whole
 * team is woken at once). Both have shipped in real pagers. The fast half of
 * TS-17.01 pins the first; the second needs a full 15-minute window — the
 * shortest duration the menu offers — so it is a separate `@slow` test,
 * excluded from the CI lane the way the plan excludes TS-10.07.
 *
 * WHAT IS DELIBERATELY *NOT* ASSERTED HERE:
 *   - That handing off to an UNSTAFFED team is refused. Verified on this build,
 *     15 Sep: it answers 200 and moves the record. Rather than assert the
 *     product's current answer (which would pin a possible gap as correct) or
 *     the plan's wished-for one (which would be a red test about a design
 *     decision nobody has taken), TS-17.04 asserts the part that is
 *     unambiguous: after such a handoff the page must not be SILENTLY
 *     stranded — the escalation state has to say nobody can be reached.
 *   - Delivery timing between rungs. That is TS-10's subject, not TS-17's.
 *
 * Self-cleaning, worker-scoped prefix. Every test owns its team and its alert.
 */

const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const PageManager = require('../../pages/page-manager.js');
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
  getDeliveries,
  getEscalationProgress,
  listResponses,
  orgId,
  uniqueName,
  deleteOnCallFixturesByPrefix,
} = require('../utils/oncall-seed.js');
const {
  createOrgUsers,
  createOrgUser,
  oncallUserEmail,
  shortenPolicyForSpeed,
  acknowledgeResponse,
  snoozeResponse,
  handoffResponse,
  getResponseDetail,
  getResponseRecord,
  escalateResponse,
  promoteResponse,
  eventsOfKind,
  waitForMail,
  loginAs,
  RESOLUTION_CAUSES,
} = require('../utils/oncall-seed-ext.js');

const PREFIX = 'e2e_oncall_verbs';

const workerPrefix = (testInfo) => `${PREFIX}_w${testInfo.workerIndex}`;

/** The shortest duration the snooze menu offers. There is nothing quicker. */
const SHORTEST_SNOOZE_MINUTES = 15;

const gate = { checked: false, available: false, reason: '' };

test.describe.configure({ mode: 'parallel' });

test.describe('On-call response verbs', {
  tag: ['@oncall', '@oncall-verbs', '@enterprise'],
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

  /** A staffed team, a routable identity and an open page on it. */
  async function seedOpenPage(page, testInfo, tag, { delaysSeconds = [0, 45, 90] } = {}) {
    const prefix = uniqueName(`${workerPrefix(testInfo)}_${tag}`);
    const emails = await createOrgUsers(page, prefix, 3);
    const team = await createTeam(page, { name: `${prefix}_team` });
    await addTeamMembers(page, team.id, emails);
    // An alert opens at P2 unless told otherwise, so P2 is the ladder to shorten.
    await shortenPolicyForSpeed(page, team.id, 2, delaysSeconds);

    const service = `${prefix}_svc`;
    const stream = prefix.toLowerCase();
    const seeded = await seedOnCallStream(page, stream, { minutes: 30, services: [service] });
    await waitForStreamSearchable(page, stream, seeded.records);
    await createOwnershipRule(page, { teamId: team.id, dimensions: { service } });
    const destination = await seedNotificationDestination(page, prefix.toLowerCase());
    const { alert, pages } = await firePageAndWait(page, {
      alertOptions: { name: `${prefix}_alert`, stream, destinations: [destination] },
    });
    return { prefix, emails, team, service, stream, alert, record: pages[0] };
  }

  // ------------------------------------------------------------------ TS-17.01

  test('snooze quiets the ladder without claiming the record', {
    tag: ['@P0'],
  }, async ({ page }, testInfo) => {
    const f = await seedOpenPage(page, testInfo, 'quiet');
    const id = f.record.id;

    // `firePageAndWait` waits for the RECORD, not for a delivery: `waitForPages`
    // polls `/oncall/responses` and returns the moment the row exists, while the
    // first rung's ledger entry is written afterwards by the escalation engine.
    // Reading the ledger straight after the seed therefore races it — this test
    // lost that race on a full-shard run and reported total 0. Polled, not
    // slept: the assertion is unchanged, it is only given time to become true,
    // and the same file already reads the ledger this way twice below.
    await expect
      .poll(async () => (await getDeliveries(page, id))?.total ?? 0, {
        timeout: 90000,
        intervals: [1000],
        message: 'the first rung must have fired before a snooze means anything',
      })
      .toBeGreaterThan(0);
    const beforeLedger = await getDeliveries(page, id);

    await pm.oncallResponseDetailPage.goto(ORG, id);
    await pm.oncallResponseDetailPage.expectDetailVisible();
    const offered = await pm.oncallResponseDetailPage.readSnoozeOptions();
    testLogger.info('TS-17.01 snooze durations offered', { offered });
    expect(offered, 'the shortest offered snooze is what a responder reaches for first')
      .toContain(SHORTEST_SNOOZE_MINUTES);

    await pm.oncallResponseDetailPage.snoozeFor(SHORTEST_SNOOZE_MINUTES);
    await pm.oncallResponseDetailPage.expectSnoozedBannerVisible();

    await expect.poll(
      async () => Boolean((await getResponseRecord(page, id))?.snoozed_until),
      { timeout: 45000, intervals: [1000], message: 'the snooze never reached the record' },
    ).toBe(true);
    const snoozed = await getResponseRecord(page, id);

    // Snooze is not an ack: the record stays open and stays UNOWNED, so
    // somebody else can still pick it up.
    testLogger.info('TS-17.01 record after snooze', { state: snoozed.state, ackedBy: snoozed.acked_by });
    expect(snoozed.state, 'a snoozed record is still open — it is quiet, not handled').toBe('triggered');
    expect(snoozed.acked_by ?? null, 'snoozing must not claim the page on the snoozer\'s behalf').toBeNull();
    expect(snoozed.snoozed_until, 'the snooze has to have an end the reader can see').toBeGreaterThan(Date.now() * 1000);

    // The ladder anchor moves to the end of the snooze rather than staying put:
    // that is the mechanism by which the remaining rungs are DELAYED rather
    // than cancelled or released together.
    expect(snoozed.ladder_anchor, 'the ladder is re-anchored to the end of the snooze')
      .toBeGreaterThanOrEqual(snoozed.snoozed_until - 5 * 1_000_000);

    // The timeline records who, when and for how long.
    const events = (await getResponseDetail(page, id)).events;
    // Anchored at the start of the body on purpose: a loose /snooz/ also matches
    // the opening and routing entries, which quote the ALERT NAME — and the
    // fixture name contains whatever tag this test seeded under.
    const snoozeEvents = events.filter((e) => /^snoozed for/i.test(String(e.body ?? '')));
    testLogger.info('TS-17.01 snooze timeline', { snoozeEvents });
    expect(snoozeEvents.length, 'a snooze that leaves no trace cannot be reviewed afterwards').toBe(1);
    expect(snoozeEvents[0].body, 'the entry has to say how long the pager was silenced')
      .toContain(String(SHORTEST_SNOOZE_MINUTES));
    expect(snoozeEvents[0].actor, 'the entry has to name who silenced it').toBeTruthy();

    // Nothing is delivered while it is quiet. Both later rungs of the shortened
    // ladder are due inside this window, so silence here is the assertion.
    await page.waitForTimeout(100_000);
    const during = await getDeliveries(page, id);
    testLogger.info('TS-17.01 ledger across the snooze window', {
      before: beforeLedger.total, during: during.total,
    });
    expect(during.total, 'a snoozed page must not deliver anything while it is snoozed')
      .toBe(beforeLedger.total);

    // The bound is enforced, and the message names it.
    const tooLong = await snoozeResponse(page, id, 99999);
    expect(tooLong.status, 'a snooze outside the allowed range is refused').toBe(400);
    expect(String(tooLong.text), 'the refusal names the bound so the caller can fix it')
      .toMatch(/1440|minutes/i);
  });

  // ------------------------------------------------------------------ TS-17.03

  test('handing off to a person pages them, and is not settled until they answer', {
    tag: ['@P0'],
  }, async ({ page }, testInfo) => {
    const f = await seedOpenPage(page, testInfo, 'hop', { delaysSeconds: [0, 600] });
    const id = f.record.id;
    const onCall = (await whoIsOnCall(page, f.team.id)).map((slot) => slot.user_email);
    const receiver = f.emails.find((e) => !onCall.includes(e)) ?? f.emails[2];

    const ack = await acknowledgeResponse(page, id);
    expect(ack.status, 'the handoff case starts from a claimed page').toBe(200);

    const since = Date.now() - 2000;
    await pm.oncallResponseDetailPage.goto(ORG, id);
    await pm.oncallResponseDetailPage.expectDetailVisible();
    await pm.oncallResponseDetailPage.openHandoffDrawer();
    await pm.oncallResponseDetailPage.chooseHandoffMode('person');
    const hint = await pm.oncallResponseDetailPage.readHandoffHint();
    testLogger.info('TS-17.03 handoff hint', { hint });
    expect(hint, 'the drawer has to say what handing off will do before it is done').not.toBe('');
    await pm.oncallResponseDetailPage.selectHandoffPerson(receiver);
    await pm.oncallResponseDetailPage.fillHandoffNote('taking a break — over to you');
    await pm.oncallResponseDetailPage.submitHandoff();

    // The receiver is really paged. A handoff that moves a name and no pager is
    // the failure both handoff paths have had.
    const mail = await waitForMail({ to: receiver, sinceMs: since, timeout: 120000 });
    expect(mail, `handing off to ${receiver} must actually page them`).not.toBeNull();
    testLogger.info('TS-17.03 receiver paged', { subject: mail.subject, to: mail.to });

    const detail = await getResponseDetail(page, id);
    testLogger.info('TS-17.03 record after handoff', {
      state: detail.response.state, ackedBy: detail.response.acked_by, run: detail.response.ladder_run,
    });

    // Before the receiver acks, the record must not read as settled on them —
    // a handoff is an offer until it is answered.
    expect(detail.response.acked_by ?? null, 'a pending handoff must not show a settled new owner').toBeNull();
    expect(detail.response.state, 'the record is open again, waiting for the receiver').toBe('triggered');

    // The ladder restarts for the receiver rather than continuing the sender's
    // — this is the observed contract, asserted explicitly so it cannot drift.
    expect(detail.response.ladder_run, 'handing off starts a fresh ladder run aimed at the receiver')
      .toBeGreaterThan(f.record.ladder_run ?? 1);

    // The timeline records from, to, the note and the time.
    const handoffs = eventsOfKind(detail.events, 'handoff');
    expect(handoffs.length, 'a handoff must leave exactly one timeline entry').toBe(1);
    expect(handoffs[0].body, 'the entry names who received the page').toContain(receiver);
    expect(handoffs[0].body, 'the entry carries the note the sender wrote').toContain('over to you');

    // And it settles once the receiver answers.
    const receiverAck = await acknowledgeResponse(page, id);
    expect(receiverAck.status, 'the receiver must be able to claim what was handed to them').toBe(200);
    const settled = await getResponseRecord(page, id);
    expect(settled.acked_by, 'once answered, the record shows an owner again').toBeTruthy();
  });

  // ------------------------------------------------------------------ TS-17.04

  test('handing off to another team re-resolves from that team\'s own schedule', {
    tag: ['@P0'],
  }, async ({ page }, testInfo) => {
    const a = await seedOpenPage(page, testInfo, 'hot', { delaysSeconds: [0, 600] });
    const id = a.record.id;

    // Team B: its own people, its own rotation, nobody shared with A.
    const bPrefix = uniqueName(`${workerPrefix(testInfo)}_hotb`);
    const bEmails = await createOrgUsers(page, bPrefix, 3);
    const teamB = await createTeam(page, { name: `${bPrefix}_team` });
    await addTeamMembers(page, teamB.id, bEmails);

    const aOnCall = (await whoIsOnCall(page, a.team.id)).map((slot) => slot.user_email);
    const bOnCall = (await whoIsOnCall(page, teamB.id)).map((slot) => slot.user_email);
    testLogger.info('TS-17.04 slots', { aOnCall, bOnCall });

    const since = Date.now() - 2000;
    await pm.oncallResponseDetailPage.goto(ORG, id);
    await pm.oncallResponseDetailPage.expectDetailVisible();
    await pm.oncallResponseDetailPage.openHandoffDrawer();
    await pm.oncallResponseDetailPage.chooseHandoffMode('team');
    await pm.oncallResponseDetailPage.selectHandoffTeam(teamB.id, teamB.name);
    await pm.oncallResponseDetailPage.fillHandoffNote('this is yours');
    await pm.oncallResponseDetailPage.submitHandoff();

    // Ownership moved, and it moved to the TEAM — the record is B's now.
    await expect.poll(
      async () => (await getResponseRecord(page, id))?.team_id,
      { timeout: 60000, intervals: [1000], message: 'the record never moved team' },
    ).toBe(teamB.id);

    // The person paged is resolved from B's schedule under B's policy — not
    // carried over from A.
    const mail = await waitForMail({ to: bOnCall[0], sinceMs: since, timeout: 120000 });
    expect(mail, `the receiving team's own on-call (${bOnCall[0]}) must be the one paged`).not.toBeNull();
    for (const address of mail.to) {
      expect(aOnCall, 'nobody from the handing-off team may be paged by the receiving team\'s ladder')
        .not.toContain(address);
    }

    // History survives the boundary: the record still carries what happened
    // before it changed hands.
    const detail = await getResponseDetail(page, id);
    const kinds = detail.events.map((e) => e.kind);
    testLogger.info('TS-17.04 timeline after the team handoff', { kinds });
    expect(kinds, 'the original paging must survive the move — a record that forgets is a record nobody can review')
      .toContain('page');
    expect(eventsOfKind(detail.events, 'handoff').length, 'the move itself is on the timeline').toBe(1);
    expect(eventsOfKind(detail.events, 'handoff')[0].body, 'the entry names the receiving team')
      .toContain(teamB.name);

    // Handing off to a team that can page nobody must not strand the page in
    // silence. This build accepts the move (200), so what is asserted is that
    // the state says so out loud.
    const bare = await createTeam(page, { name: `${bPrefix}_bare` });
    const stranded = await handoffResponse(page, id, { toTeamId: bare.id, note: 'nobody here' });
    testLogger.info('TS-17.04 handoff to an unstaffed team', { status: stranded.status });
    const progress = await getEscalationProgress(page, id);
    testLogger.info('TS-17.04 escalation state on the unstaffed team', { progress });
    const reachedNobody = (progress.fired ?? []).some((rung) => rung.reached_nobody === true)
      || (progress.next_recipients ?? []).length === 0;
    expect(
      reachedNobody,
      'a page handed to a team with nobody on it must read as reaching nobody, never as quietly owned',
    ).toBe(true);
  });

  // ------------------------------------------------------------------ TS-15.06

  test('the Pages list section counts match the records, and a rung reaching nobody says so', {
    tag: ['@P0'],
  }, async ({ page }, testInfo) => {
    const f = await seedOpenPage(page, testInfo, 'list', { delaysSeconds: [0, 600] });

    await pm.oncallPagesListPage.goto(ORG);
    await pm.oncallPagesListPage.expectAvailable();
    await pm.oncallPagesListPage.filterByTeam(f.team.id);
    await pm.oncallPagesListPage.expectListVisible();
    await pm.oncallPagesListPage.waitForRows();

    // What the server says this team has open, and what the screen drew.
    const open = await listResponses(page, { teamId: f.team.id });
    const counts = await pm.oncallPagesListPage.readSectionCounts();
    const rows = await pm.oncallPagesListPage.countRowsOnPage();
    testLogger.info('TS-15.06 sections', { counts, rows, open: open.length });

    expect(rows, 'the list draws every open record for the filtered team').toBe(open.length);
    const claimed = Object.values(counts).reduce((sum, n) => sum + (n ?? 0), 0);
    expect(claimed, 'a section heading claiming more than it drew is the defect this case exists for')
      .toBe(rows);

    // The cause filter belongs on the list, not only on the record — narrowing
    // by cause is how "has this happened before" gets asked.
    await pm.oncallPagesListPage.expectCauseFilterVisible();

    // Every cause the list offers must be one the resolve dialog can actually
    // set, or the filter narrows to nothing forever.
    await pm.oncallPagesListPage.filterByCause(RESOLUTION_CAUSES[0]);
    await pm.oncallPagesListPage.expectListVisible();

    // A rung that reached NOBODY must render as such. An empty responder cell
    // and "this rung reached nobody" look identical to somebody scanning the
    // list and mean opposite things, so it gets its own element and its own
    // assertion — built from a team with no roster at all, which is the
    // cheapest honest way to make a rung resolve to no one.
    const barePrefix = uniqueName(`${workerPrefix(testInfo)}_nobody`);
    const bareTeam = await createTeam(page, { name: `${barePrefix}_team` });
    const bareService = `${barePrefix}_svc`;
    const bareStream = barePrefix.toLowerCase();
    const bareSeeded = await seedOnCallStream(page, bareStream, { minutes: 30, services: [bareService] });
    await waitForStreamSearchable(page, bareStream, bareSeeded.records);
    await createOwnershipRule(page, { teamId: bareTeam.id, dimensions: { service: bareService } });
    const bareDestination = await seedNotificationDestination(page, barePrefix.toLowerCase());
    const bare = await firePageAndWait(page, {
      alertOptions: { name: `${barePrefix}_alert`, stream: bareStream, destinations: [bareDestination] },
    });

    const bareProgress = await getEscalationProgress(page, bare.pages[0].id);
    testLogger.info('TS-15.06 escalation on an unstaffed team', { bareProgress });
    expect(
      (bareProgress.fired ?? []).some((rung) => rung.reached_nobody === true),
      'a rung on a team with no roster has to be recorded as having reached nobody',
    ).toBe(true);

    await pm.oncallPagesListPage.goto(ORG);
    await pm.oncallPagesListPage.filterByTeam(bareTeam.id);
    await pm.oncallPagesListPage.waitForRows();
    await pm.oncallPagesListPage.expectResponderNobodyVisible();
  });

  // ------------------------------------------------------------------ TS-02.01

  /**
   * UNWIRED, and kept as a fixme with its real assertions intact.
   *
   * Verified on this build, 15 Sep: a freshly-created org user with role
   * `viewer` is refused the on-call API outright —
   * `GET /api/default/oncall/responses` and `GET .../oncall/teams` both answer
   * **403 Unauthorized Access** — so the detail screen renders its empty state
   * and there is no page for a viewer to work at all, let alone six verbs to
   * use on it. The screen is not hiding the controls; the data never arrives.
   *
   * WHICH OF TWO THINGS THIS IS NEEDS A HUMAN. Either the viewer role is
   * missing its on-call OpenFGA grants on this deployment (an environment
   * gap), or a viewer is deliberately not an on-call responder and the book's
   * premise — "all six response verbs belong to a viewer" — is the thing that
   * is wrong. Both are plausible and a test cannot decide it; the body asserts
   * the book's contract so it flips green if the grants land, and the question
   * is written down in the generation report rather than answered here.
   */
  test.fixme('a viewer can work a page end to end, with no verb hidden or disabled — not wired: role viewer gets 403 on GET /oncall/responses and /oncall/teams, verified 15 Sep on :5090', {
    tag: ['@P0'],
  }, async ({ browser, page }, testInfo) => {
    const f = await seedOpenPage(page, testInfo, 'viewer', { delaysSeconds: [0, 600] });
    const id = f.record.id;

    const viewerEmail = oncallUserEmail(uniqueName(`${workerPrefix(testInfo)}_v`), 'viewer');
    const viewer = await createOrgUser(page, { email: viewerEmail, role: 'viewer' });

    const session = await loginAs(browser, { email: viewer.email, password: viewer.password });
    try {
      const viewerPm = new PageManager(session.page);
      await viewerPm.oncallResponseDetailPage.goto(ORG, id);
      await viewerPm.oncallResponseDetailPage.expectDetailVisible();

      // The permission split must not be undone by the UI: working a page is a
      // viewer's job, so none of the verbs may be hidden or greyed for them.
      await viewerPm.oncallResponseDetailPage.expectAllVerbControlsEnabled();

      // And the verbs must actually work for them — every one writes a timeline
      // entry attributed to the viewer, not to whoever seeded the fixture.
      await viewerPm.oncallResponseDetailPage.acknowledge();
      await expect.poll(
        async () => (await getResponseRecord(page, id))?.acked_by ?? null,
        { timeout: 45000, intervals: [1000], message: 'the viewer\'s acknowledgement never landed' },
      ).toBe(viewer.email);

      await viewerPm.oncallResponseDetailPage.openResolveDialog();
      const causes = await viewerPm.oncallResponseDetailPage.readCauseOptions();
      testLogger.info('TS-02.01 causes offered to a viewer', { causes });
      expect(causes, 'a viewer is offered the same causes as anybody else')
        .toEqual(expect.arrayContaining([RESOLUTION_CAUSES[RESOLUTION_CAUSES.length - 1]]));
      await viewerPm.oncallResponseDetailPage.selectCause('noisy_threshold');
      await viewerPm.oncallResponseDetailPage.fillCauseNote('handled by a viewer');
      await viewerPm.oncallResponseDetailPage.confirmResolve();

      await expect.poll(
        async () => (await getResponseRecord(page, id))?.state,
        { timeout: 45000, intervals: [1000], message: 'the viewer\'s resolve never landed' },
      ).toBe('resolved');

      const detail = await getResponseDetail(page, id);
      const attributed = detail.events.filter((e) => e.actor === viewer.email);
      testLogger.info('TS-02.01 events attributed to the viewer', { attributed });
      expect(attributed.length, 'every verb a viewer used is recorded as theirs, not as the system\'s')
        .toBeGreaterThanOrEqual(2);
      expect(detail.response.cause, 'a viewer\'s resolve captures a cause like anybody else\'s')
        .toBe('noisy_threshold');
    } finally {
      await session.context.close();
    }
  });

  /**
   * TS-17.02 — the snooze menu offers round numbers, and each one means what it
   * says.
   *
   * A snooze is chosen by somebody half awake, so the options are deliberately
   * round and few. The bound that matters is the one on the OTHER side: the
   * value the button sends must produce an until-time that actually matches the
   * label, because a "30 min" that quiets the ladder for three hours is how a
   * page gets lost between shifts.
   */
  test('TS-17.02 every offered snooze duration is round, and the one chosen is the one applied', {
    tag: ['@P1'],
  }, async ({ page }, testInfo) => {
    // A real firing has to clear ingestion, the scheduler and the ladder; the
    // 3-minute default is for screens, not for this.
    test.setTimeout(600_000);
    const f = await seedOpenPage(page, testInfo, 'snoozeopts');
    const id = f.record.id;

    await pm.oncallResponseDetailPage.goto(ORG, id);
    await pm.oncallResponseDetailPage.expectDetailVisible();

    const offered = await pm.oncallResponseDetailPage.readSnoozeOptions();
    expect(offered.length, 'the menu must offer something to pick').toBeGreaterThan(0);
    expect(
      offered.filter((m) => !Number.isInteger(m) || m <= 0),
      'every offered duration must be a positive whole number of minutes',
    ).toEqual([]);
    expect(
      [...offered].sort((a, b) => a - b),
      'the options must be offered shortest-first, so the common choice is the nearest one',
    ).toEqual(offered);

    const chosen = offered[0];
    const before = Date.now();
    await pm.oncallResponseDetailPage.snoozeFor(chosen);
    await pm.oncallResponseDetailPage.expectSnoozedBannerVisible();

    const record = await getResponseRecord(page, id);
    // "Snoozed" is NOT a state. `ResponseState` is Triggered | Triaged |
    // Acknowledged | Resolved, and a snooze is derived from `snoozed_until` —
    // the record stays TRIGGERED because it is quiet, not handled. I asserted
    // `state === 'snoozed'` first and the source says otherwise, as does the
    // Tier-1 case above.
    expect(record.state, 'a snooze quiets the record without claiming or closing it')
      .toBe('triggered');
    expect(record.acked_by ?? null, 'and without claiming it on the snoozer\'s behalf')
      .toBeNull();

    const untilMicros = record.snoozed_until;
    expect(untilMicros, 'a snoozed record must carry the instant it wakes up').toBeTruthy();
    const actualMinutes = (untilMicros / 1000 - before) / 60000;
    expect(
      actualMinutes,
      `choosing ${chosen} minutes must quiet it for about ${chosen} minutes, not another figure`,
    ).toBeGreaterThan(chosen - 2);
    expect(actualMinutes, `and not materially longer than ${chosen} minutes either`)
      .toBeLessThan(chosen + 2);

    // The API refuses a duration the menu would never offer, rather than
    // storing a snooze that never ends.
    const absurd = await snoozeResponse(page, id, 0);
    expect(absurd.status, 'a zero-minute snooze is not a snooze and must be refused')
      .toBeGreaterThanOrEqual(400);
  });

  /**
   * TS-17.05 — escalating by hand advances exactly one rung, and five frantic
   * clicks are still one escalation.
   *
   * The debounce exists for a specific human moment: two people in the same
   * call reaching for the same button, or one double-tapped phone. That must
   * mean "wake the next rung", never "wake the next two" — skipping a rung
   * means the person who would have been woken never is.
   *
   * `MANUAL_ESCALATION_DEBOUNCE_MICROS` is 30s and is a DE-DUPLICATION of one
   * intent, not a rate limit: a genuine later press does advance again. Five
   * clicks inside the window are therefore the test.
   */
  test('TS-17.05 manual escalation advances one rung, and five rapid presses still advance only one', {
    tag: ['@P1'],
  }, async ({ page }, testInfo) => {
    // A real firing has to clear ingestion, the scheduler and the ladder; the
    // 3-minute default is for screens, not for this.
    test.setTimeout(600_000);
    // A ladder with room to climb, so "one rung" is observable.
    const f = await seedOpenPage(page, testInfo, 'escal', { delaysSeconds: [0, 600, 1200, 1800] });
    const id = f.record.id;

    const rungOf = async () => (await getEscalationProgress(page, id))?.reached_rung_micros
      ?? (await getResponseRecord(page, id))?.reached_rung_micros;

    await expect.poll(async () => (await getDeliveries(page, id))?.total, { timeout: 90000 })
      .toBeGreaterThan(0);
    const startRung = await rungOf();

    const first = await escalateResponse(page, id, { note: 'e2e manual escalate' });
    expect(first.status, 'escalating by hand must be accepted').toBe(200);

    await expect
      .poll(rungOf, { timeout: 60000, message: 'a manual escalation must advance the ladder' })
      .toBeGreaterThan(startRung);
    const afterOne = await rungOf();

    // Four more presses, as fast as they can be issued — inside the 30s window.
    const rapid = await Promise.all(
      [1, 2, 3, 4].map(() => escalateResponse(page, id, { note: 'e2e rapid' })),
    );
    for (const r of rapid) {
      expect(r.status,
        'a debounced press is de-duplicated, not rejected — the responder did nothing wrong')
        .toBe(200);
    }

    // Give the engine room to get it wrong before concluding it did not.
    await page.waitForTimeout(5000);
    expect(
      await rungOf(),
      'five presses inside the debounce window are one intent, and must advance one rung — not five',
    ).toBe(afterOne);
  });

  /**
   * TS-17.06 — promoting is a promotion, not a second copy.
   *
   * The failure this guards against is duplication: a promote that opened a
   * NEW record would leave two live rows for one problem, and everyone who
   * already acknowledged the first would be paged again by the second — at the
   * exact moment the problem was judged serious enough to escalate.
   *
   * So: the same record id survives, and nobody already reached is re-paged.
   */
  test('TS-17.06 promoting a page keeps the same record and does not re-page whoever already had it', {
    tag: ['@P1'],
  }, async ({ page }, testInfo) => {
    // A real firing has to clear ingestion, the scheduler and the ladder; the
    // 3-minute default is for screens, not for this.
    test.setTimeout(600_000);
    const f = await seedOpenPage(page, testInfo, 'promote');
    const id = f.record.id;

    await expect.poll(async () => (await getDeliveries(page, id))?.total, { timeout: 90000 })
      .toBeGreaterThan(0);

    const beforeCount = (await listResponses(page, { teamId: f.team.id, includeResolved: true })).length;
    const beforeLedger = await getDeliveries(page, id);
    const alreadyReached = new Set(
      (beforeLedger.deliveries ?? beforeLedger.rows ?? []).map((d) => d.recipient),
    );
    expect(alreadyReached.size, 'somebody must already have been paged for this to mean anything')
      .toBeGreaterThan(0);

    const promoted = await promoteResponse(page, id, { title: `${f.prefix} promoted` });
    test.skip(
      promoted.status === 404 || promoted.status === 501,
      `promotion is not available on this deployment — HTTP ${promoted.status}`,
    );
    expect(promoted.status, 'promoting an open page must be accepted').toBe(200);

    const after = await listResponses(page, { teamId: f.team.id, includeResolved: true });
    expect(after.length,
      'promoting must not open a second record — that is duplication, not promotion')
      .toBe(beforeCount);
    expect(after.map((r) => r.id), 'and the original record must still be the one that exists')
      .toContain(id);

    const record = await getResponseRecord(page, id);
    expect(record, 'the promoted record must still be readable under its own id').toBeTruthy();

    // Only the delta: whoever was already reached must not be paged again by
    // the promotion itself.
    await page.waitForTimeout(5000);
    const afterLedger = await getDeliveries(page, id);
    const rows = afterLedger.deliveries ?? afterLedger.rows ?? [];
    const counts = new Map();
    for (const d of rows) counts.set(d.recipient, (counts.get(d.recipient) ?? 0) + 1);
    const beforeCounts = new Map();
    for (const d of (beforeLedger.deliveries ?? beforeLedger.rows ?? [])) {
      beforeCounts.set(d.recipient, (beforeCounts.get(d.recipient) ?? 0) + 1);
    }
    for (const recipient of alreadyReached) {
      expect(
        counts.get(recipient),
        `${recipient} already had this page; promoting it must not wake them a second time`,
      ).toBe(beforeCounts.get(recipient));
    }
  });

  /**
   * TS-15.07 — a bulk action is settled, not all-or-nothing.
   *
   * Selecting ninety-nine pages and having one of them fail must not abandon
   * the other ninety-eight, and must not report success either. The
   * implementation is `Promise.allSettled` with a partial-failure toast, so
   * both halves are observable: the ones that could be acted on ARE, and the
   * count that could not is reported.
   */
  test('TS-15.07 a bulk action applies to every record it can and reports the ones it could not', {
    tag: ['@P1'],
  }, async ({ page }, testInfo) => {
    // A real firing has to clear ingestion, the scheduler and the ladder; the
    // 3-minute default is for screens, not for this.
    test.setTimeout(600_000);
    const f = await seedOpenPage(page, testInfo, 'bulk');

    await pm.oncallPagesListPage.goto(ORG);
    await pm.oncallPagesListPage.filterByTeam(f.team.id);

    const keys = await pm.oncallPagesListPage.readRowKeys();
    test.skip(keys.length === 0, 'no rows for this team reached the list to act on in bulk');

    // Select everything on the page and acknowledge it in one go.
    await pm.oncallPagesListPage.getSelectAll().click();
    const bulkAck = pm.oncallPagesListPage.getBulkAck();
    await expect(bulkAck, 'selecting rows must offer a bulk acknowledge').toBeVisible({ timeout: 20000 });
    await bulkAck.click();

    await expect
      .poll(async () => {
        const rows = await listResponses(page, { teamId: f.team.id, includeResolved: true });
        // `[].every()` is TRUE, and `listResponses` returns `[]` on any non-OK
        // response — so without the length guard this poll goes green the
        // instant the API stops answering, having checked nothing at all.
        return rows.length > 0 && rows.every((r) => r.state !== 'triggered' || r.acked_by);
      }, {
        timeout: 60000,
        message: 'a bulk acknowledge must reach every record it selected, not just the first',
      })
      .toBe(true);

    const record = await getResponseRecord(page, f.record.id);
    expect(record.acked_by, 'the seeded record must carry who acknowledged it').toBeTruthy();
  });

  /**
   * The other half of TS-15.07: bulk resolve captures a cause.
   *
   * PARKED, because it is a real gap rather than a flaky assertion.
   *
   * Resolving ONE page forces a cause: `oncall-resolve-dialog` will not confirm
   * without one of the eight, and the whole cause-analytics surface
   * (`/oncall/analytics/causes`, the "this alert, before" card) is built on
   * them. Resolving FIFTY captures nothing — `bulkResolve` in
   * views/OnCall/OnCallResponses.vue calls
   * `oncallService.resolveResponse({ org_identifier, response_id })` with no
   * `cause` at all, and the server's `ResolveRequest.cause` is
   * `#[serde(default)] Option<..>`, so the records close with a null cause and
   * are skipped by `group_causes` forever.
   *
   * The bulk path is how a noisy morning gets cleaned up, so it is precisely
   * the path whose causes would have been most worth having. Left as a failing
   * expectation: it goes green when bulk resolve asks for a cause the way the
   * single-record dialog does.
   */
  test.fixme('TS-15.07b bulk resolve captures a cause the way resolving one page does — not wired: OnCallResponses.vue bulkResolve calls resolveResponse with no cause, and ResolveRequest.cause is Option<_> with serde(default), so every bulk-resolved record stores a null cause and is dropped from cause analytics, verified 16 Sep on :5090', {
    tag: ['@P1'],
  }, async ({ page }, testInfo) => {
    const f = await seedOpenPage(page, testInfo, 'bulkcause');

    await pm.oncallPagesListPage.goto(ORG);
    await pm.oncallPagesListPage.filterByTeam(f.team.id);
    await pm.oncallPagesListPage.getSelectAll().click();
    await pm.oncallPagesListPage.getBulkResolve().click();
    await pm.oncallPagesListPage.getConfirmOk().click();

    await expect
      .poll(async () => (await getResponseRecord(page, f.record.id))?.cause, { timeout: 60000 })
      .toBeTruthy();
  });

});
