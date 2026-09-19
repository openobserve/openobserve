/**
 * On-Call — the responder's own screen: duty, inbox and prior causes
 * (Tier 2, TS-19.03 / TS-19.04 / TS-20.01)
 *
 * Plan: docs/test_generator/test-plans/oncall-ui-test-plan.md, Tier 2.
 *
 * THE SCREEN NOBODY LINKS TO. `/web/oncall/me` is a registered route with no
 * nav entry and no in-app link — navGroups registers only responses, teams and
 * routing, and the Pages list's "mine" control is a FILTER, not a link. So the
 * URL is typed here on purpose, not as a test shortcut. That is a product
 * observation and it is in the generation report.
 *
 * "NOT ON CALL" MUST NEVER BE A GUESS. `GET /oncall/my/teams` answers
 * `on_call_now: true | false | null`, the null meaning the schedule could not
 * be resolved, and it carries `schedule_resolved` alongside. The three states
 * render through ONE data-test (`oncall-mine-duty-{teamId}`), separated only by
 * their words — "On call" / "Not on call" / "Could not resolve". The unknown
 * state turns out to be UNREACHABLE from outside, because the schedule write
 * path refuses every malformed shape that could make resolution fail; see the
 * long note on TS-19.04, which therefore asserts the invariant behind the
 * three states rather than pretending to drive the third.
 *
 * ONE REQUEST, FOR THE DUTY HALF. The claim in the plan is about N+1: `my/teams`
 * folds the per-team `/on-call` reads into a single HTTP call rather than one
 * per team. The SCREEN as a whole still makes two calls, because the inbox is a
 * separate component with its own fetch — so this counts `/oncall/my/teams`
 * calls and asserts one, rather than counting all requests and asserting a
 * number that would be wrong for an honest reason.
 *
 * ISOLATION IS STRUCTURAL, NOT A FILTER. The inbox takes no user parameter at
 * all: the recipient is the auth header, server-side, and read markers live in
 * their own table keyed (org, user, event). The cross-user half of TS-19.03 is
 * parked — see its fixme — because every non-root identity on this deployment
 * gets 403 on everything.
 */

const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const PageManager = require('../../pages/page-manager.js');
const {
  MICROS,
  isOnCallAvailable,
  createTeam,
  addTeamMembers,
  setTeamSchedule,
  rotation,
  detachPolicyFromRotations,
  createOwnershipRule,
  seedOnCallStream,
  waitForStreamSearchable,
  seedNotificationDestination,
  firePageAndWait,
  triggerAlertOrLetSchedulerFire,
  listResponses,
  orgId,
  uniqueName,
  deleteOnCallFixturesByPrefix,
} = require('../utils/oncall-seed.js');
const {
  createOrgUsers,
  loginAs,
  myDeliveries,
  markDeliveriesRead,
  getPriorCauses,
  myOnCall,
  getResponseRecord,
  resolveResponse,
  RESOLUTION_CAUSES,
} = require('../utils/oncall-seed-ext.js');

const PREFIX = 'e2e_oncall_mine';
const workerPrefix = (testInfo) => `${PREFIX}_w${testInfo.workerIndex}`;

const gate = { checked: false, available: false, reason: '' };

test.describe.configure({ mode: 'parallel' });

test.describe('On-call — my duty, my inbox, my history', {
  tag: ['@oncall', '@oncall-mine', '@enterprise'],
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
   * TS-19.04 — my duty is answered in one request, and "not on call" is never a
   * guess.
   *
   * ONE REQUEST is the N+1 claim: `my/teams` folds the per-team `/on-call`
   * resolution into a single HTTP call instead of one per team. Counted on
   * `/oncall/my/teams` specifically, because the SCREEN honestly makes two
   * calls — the inbox below is a separate component with its own fetch — and
   * asserting "one request total" would be asserting a wrong number.
   *
   * THE SECOND HALF, AND WHY IT IS SHAPED THIS WAY. The design rule is that an
   * unresolvable schedule reads as UNKNOWN (`on_call_now: null`,
   * `schedule_resolved: false`, rendered "Could not resolve") rather than as
   * off duty — "not on call" must never be a guess. I tried to seed that state
   * and could not: every malformed schedule is refused at WRITE time with its
   * own plain-words message — an empty roster ("a shift rule must have at least
   * one member"), a rotation with no rules, a shift length of zero, a
   * restriction spanning no instant, even a non-IANA timezone. Verified 16 Sep
   * on :5090. A team with no rotations at all resolves perfectly well and
   * answers `on_call_now: false, schedule_resolved: true` — genuinely off duty,
   * which is the correct answer and not the one under test.
   *
   * So the unknown state is a defensive branch the write path makes
   * unreachable. What IS checkable, and is the actual substance of the case, is
   * the INVARIANT: nothing may report "not on call" unless its schedule
   * actually resolved. That holds over every row the endpoint returns, and it
   * fails the moment somebody makes a resolution failure fall through to
   * `false` — which is the regression the design is defending against.
   */
  test('TS-19.04 my duty loads in one request, and nothing reports "not on call" without having resolved', {
    tag: ['@P1'],
  }, async ({ page }, testInfo) => {
    const name = uniqueName(`${workerPrefix(testInfo)}_duty`);
    const me = process.env.ZO_ROOT_USER_EMAIL;
    expect(me, 'the suite runs as a real identity and the duty list is keyed on it').toBeTruthy();

    // One team that resolves and puts the caller on call.
    const staffed = await createTeam(page, { name: `${name}_ok`, timezone: 'UTC' });
    await setTeamSchedule(page, staffed.id, {
      timezone: 'UTC',
      rotations: [rotation({ id: 'Primary', members: [me] })],
    });
    await addTeamMembers(page, staffed.id, [me]);

    // And one the caller is on that staffs nobody — genuinely off duty, which
    // must be reported as such and NOT as unknown.
    const idle = await createTeam(page, { name: `${name}_idle`, timezone: 'UTC' });
    await addTeamMembers(page, idle.id, [me]);
    await detachPolicyFromRotations(page, idle.id);
    await setTeamSchedule(page, idle.id, { timezone: 'UTC', rotations: [] });

    const duty = await myOnCall(page);
    expect(duty, 'the duty endpoint must answer').toBeTruthy();

    // The invariant, over every row: a definite "no" requires a resolution.
    for (const team of duty.teams ?? []) {
      if (team.on_call_now === false) {
        expect(
          team.schedule_resolved,
          `${team.team_name} reports "not on call" — which is only honest if its schedule actually resolved`,
        ).toBe(true);
      }
      if (team.schedule_resolved === false) {
        expect(
          team.on_call_now,
          `${team.team_name} could not resolve, so its duty must be unknown rather than a guess`,
        ).toBeNull();
      }
    }

    const idleRow = (duty.teams ?? []).find((t) => t.team_id === idle.id);
    expect(idleRow, 'a team the caller is on must appear on their duty list').toBeTruthy();
    expect(idleRow.schedule_resolved,
      'a team with no rotations resolves fine — it simply staffs nobody')
      .toBe(true);
    expect(idleRow.on_call_now, 'and so its answer is a definite no, not an unknown').toBe(false);

    // Count only the duty call: the inbox is a separate component with a fetch
    // of its own, so counting every request would assert a wrong number.
    let dutyCalls = 0;
    await page.route('**/oncall/my/teams*', (route) => {
      dutyCalls += 1;
      return route.continue();
    });

    await pm.oncallMinePage.goto(ORG);
    await pm.oncallMinePage.expectTeamsCardVisible();
    await pm.oncallMinePage.expectTeamRowVisible(staffed.id);
    await pm.oncallMinePage.expectTeamRowVisible(idle.id);

    expect(
      dutyCalls,
      'the duty list must be answered by ONE request, not one per team',
    ).toBe(1);

    const staffedDuty = await pm.oncallMinePage.readDutyText(staffed.id);
    expect(staffedDuty.toLowerCase(), 'a resolvable team must give a definite answer')
      .toMatch(/on call/);
    expect(staffedDuty.toLowerCase(), 'and it must not be the unknown state')
      .not.toContain('could not');

    const idleDuty = await pm.oncallMinePage.readDutyText(idle.id);
    expect(idleDuty.toLowerCase(),
      'a team that resolved and staffs nobody says so plainly, rather than claiming it could not tell')
      .not.toContain('could not');
  });

  /**
   * TS-19.03 — my inbox remembers what I have read, on the server.
   *
   * Read state is not a client convenience: it lives in `oncall_delivery_reads`
   * keyed (org, user, event) behind a unique index, so a badge is the same on
   * the phone that acked and the laptop that did not. This proves it by marking
   * through the API and reading back through the SCREEN on a fresh load, then
   * toggling through the screen and reading back through the API — a
   * localStorage implementation passes neither direction.
   *
   * IT SEEDS ITS OWN PAGE. An earlier draft read whatever the caller's inbox
   * already held and skipped when it was empty, which made the case
   * coverage-by-luck: green on a deployment that had happened to page root,
   * skipped on a fresh one, and genuinely exercised on neither. So the fixture
   * puts the caller on a rotation and fires a real alert at it. That the
   * caller's address is undeliverable does not matter, and is rather the point:
   * the ledger records the ATTEMPT, failures included, so an inbox row exists
   * either way.
   */
  test('TS-19.03 marking a page read is remembered server-side and survives a reload', {
    tag: ['@P1'],
  }, async ({ page }, testInfo) => {
    // One real firing plus ingestion; the 180s default is not enough.
    test.setTimeout(420_000);
    const prefix = uniqueName(`${workerPrefix(testInfo)}_inbox`);
    const me = process.env.ZO_ROOT_USER_EMAIL;
    const team = await createTeam(page, { name: `${prefix}_team`, timezone: 'UTC' });
    await setTeamSchedule(page, team.id, {
      timezone: 'UTC',
      rotations: [rotation({ id: 'Primary', members: [me] })],
    });
    await addTeamMembers(page, team.id, [me]);

    const service = `${prefix}_svc`;
    const stream = prefix.toLowerCase();
    const seeded = await seedOnCallStream(page, stream, { minutes: 30, services: [service] });
    await waitForStreamSearchable(page, stream, seeded.records);
    await createOwnershipRule(page, { teamId: team.id, dimensions: { service } });
    const destination = await seedNotificationDestination(page, stream);
    await firePageAndWait(page, {
      // P1: the parallel rung. A lower priority walks the ladder one slot at a time.
      alertOptions: { name: `${prefix}_alert`, stream, destinations: [destination], priority: 1 },
    });

    // The inbox is keyed on the caller server-side, so the row arrives without
    // the client asking for it by name.
    await expect
      .poll(async () => {
        const box = await myDeliveries(page, { limit: 200 });
        return (box?.deliveries ?? []).some((d) => String(d.title ?? '').includes(prefix));
      }, {
        timeout: 120000,
        intervals: [3000],
        message: "a page addressed to the caller must reach the caller's own inbox",
      })
      .toBe(true);

    const inbox = await myDeliveries(page, { limit: 200 });
    expect(typeof inbox.unread, 'the inbox must carry an unread count for the badge').toBe('number');
    const mine = (inbox.deliveries ?? []).filter((d) => String(d.title ?? '').includes(prefix));
    const eventId = mine[0].event_id;

    // Start from a known state rather than whatever a shard left behind.
    expect((await markDeliveriesRead(page, { eventIds: [eventId], read: false })).status).toBe(200);
    const unreadBefore = (await myDeliveries(page, { limit: 1 })).unread;

    const marked = await markDeliveriesRead(page, { eventIds: [eventId], read: true });
    expect(marked.status, 'marking read must be accepted').toBe(200);
    expect(marked.body.unread,
      'the write returns the new unread count so a badge is right without a second request')
      .toBe(unreadBefore - 1);

    // Read it back through the SCREEN, on a fresh load: a client-side flag
    // would not survive this.
    await pm.oncallMinePage.goto(ORG);
    await pm.oncallMinePage.expectDeliveriesVisible();
    await pm.oncallMinePage.expectDeliveryRowVisible(eventId);
    await pm.oncallMinePage.expectDeliveryRead(eventId);

    // And unread again, through the screen this time, confirmed at the API.
    await pm.oncallMinePage.toggleDeliveryRead(eventId);
    await expect
      .poll(async () => {
        const after = await myDeliveries(page, { limit: 200 });
        return (after.deliveries ?? []).find((r) => r.event_id === eventId)?.read;
      }, { timeout: 30000, message: "the screen's toggle must write through to the server" })
      .toBeFalsy();
  });

  /**
   * The other half of TS-19.03: one person's read marker is invisible to another.
   *
   * PARKED. The isolation is structural and I read it — `list_my_deliveries`
   * takes the recipient from the auth header with the comment "the caller,
   * never a parameter", the SQL filters `Recipient.eq(user_email)`, and the
   * read join is scoped to the caller's email ("joining on the event alone
   * reads a row a colleague read") — but proving it needs a SECOND identity
   * that can call the endpoint, and on this deployment no non-root identity
   * can. A freshly created **admin** gets 403 on `/oncall/my/deliveries`,
   * `/oncall/teams` and even `/streams`; role tuples are not being written, so
   * it is the environment, not the product. Verified 16 Sep on :5090.
   */
  /**
   * TS-19.03b — read markers are per person, and that is the whole point of the
   * inbox: it answers "what have I not looked at", not "what has anyone looked at".
   *
   * PARKED on a seeding gap, not on a missing assertion. What is written below is
   * correct and runs; what is missing is a way to get one page into two inboxes.
   *
   * Measured on :5090 rather than assumed:
   *   - a rotation is a SEQUENCE, so two members on one rotation yields ONE page
   *   - adding members to a rotationless team leaves NOBODY on call: the mail that
   *     goes out is "<team> has nobody on call", not a page, so no delivery row is
   *     written for anyone. A staffed rotation is required before any of this works
   *   - with a staffed rotation the inbox is fine — one member, one delivery row
   *
   * So the gap is purely the two-recipient seed: a page has to reach two people at
   * once, and neither one rotation with two members nor an auto-staffed team does
   * that. Two staffed rotations on one parallel rung is the shape to try next.
   *
   * Asserting isolation with ONE actor proves nothing — marking a row read and
   * reading it back as the same person is true by construction, which is what the
   * original stub here did.
   */
  test.fixme('TS-19.03b one responder\'s read markers are invisible to another — not wired: no seeding shape found that puts ONE page in TWO inboxes, see the note above. o2-enterprise#2481.', {
    tag: ['@P1'],
  }, async ({ page, browser }, testInfo) => {
    const prefix = uniqueName(`${workerPrefix(testInfo)}_iso`);
    // createOrgUsers returns ADDRESSES, not user objects.
    const [mine, theirs] = await createOrgUsers(page, prefix, 2);

    // No schedule is written on purpose. A rotation is a SEQUENCE — only one of
    // its members is on call at a time — so two people on one rotation produces
    // one page, not two. Adding members to a rotationless team auto-staffs the
    // primary and secondary slots and builds a P1 rung that pages both in
    // parallel, which is the only default shape that reaches two inboxes at once.
    const team = await createTeam(page, { name: `${prefix}_team` });
    await addTeamMembers(page, team.id, [mine, theirs]);

    const service = `${prefix}_svc`;
    const stream = prefix.toLowerCase();
    const seeded = await seedOnCallStream(page, stream, { minutes: 30, services: [service] });
    await waitForStreamSearchable(page, stream, seeded.records);
    await createOwnershipRule(page, { teamId: team.id, dimensions: { service } });
    const destination = await seedNotificationDestination(page, stream);
    await firePageAndWait(page, {
      alertOptions: { name: `${prefix}_alert`, stream, destinations: [destination] },
    });

    const first = await loginAs(browser, { email: mine });
    const second = await loginAs(browser, { email: theirs });
    try {
      const rowFor = async (session) => {
        let found;
        await expect.poll(async () => {
          const box = await myDeliveries(session.page, { limit: 200 });
          found = (box?.deliveries ?? []).find((d) => String(d.title ?? '').includes(prefix));
          return Boolean(found);
        }, {
          timeout: 120000,
          intervals: [3000],
          message: 'both responders on the rotation must receive the page',
        }).toBe(true);
        return found;
      };

      const ourRow = await rowFor(first);
      const theirRow = await rowFor(second);
      testLogger.info('TS-19.03b both inboxes hold the page', {
        ours: ourRow.event_id, theirs: theirRow.event_id,
      });

      // One person reads it. Their own marker is the only thing that may move.
      expect((await markDeliveriesRead(first.page, {
        eventIds: [ourRow.event_id], read: true,
      })).status).toBe(200);

      await expect.poll(async () => {
        const box = await myDeliveries(first.page, { limit: 200 });
        return (box?.deliveries ?? []).find((d) => d.event_id === ourRow.event_id)?.read;
      }, {
        timeout: 30000, intervals: [1000],
        message: 'the reader\'s own marker must actually move',
      }).toBeTruthy();

      const theirBox = await myDeliveries(second.page, { limit: 200 });
      const stillTheirs = (theirBox.deliveries ?? []).find((d) => d.event_id === theirRow.event_id);
      testLogger.info('TS-19.03b the other inbox after the read', { read: stillTheirs?.read });
      expect(
        stillTheirs?.read,
        'a colleague reading a page must not mark it read for me',
      ).toBeFalsy();
    } finally {
      await first.context.close().catch(() => {});
      await second.context.close().catch(() => {});
    }
  });

  /**
   * TS-20.01 — what this rule turned out to be last time, on the next firing.
   *
   * Matched on the EXACT rule, not on similarity: the query is
   * `subject_type == this && subject_id starts_with "{source_id}#"`, anchored
   * on the separator so `al_ck` cannot match `al_ckt`. So the assertion is both
   * halves — a cause recorded against this rule comes back, and a record from a
   * DIFFERENT rule does not inherit it.
   *
   * Two rules of its own, deliberately. An earlier draft borrowed whatever
   * closed records the deployment already had and resolved one of them to
   * create the history — which would have mutated another spec's live fixture
   * the moment two shards overlapped. A history case has to own both firings it
   * reasons about.
   *
   * Records with no cause are skipped by `group_causes`, which is why the first
   * firing is resolved WITH one.
   *
   * WHY IT IS SLOW, AND WHY THAT IS THE PRODUCT BEING RIGHT. A second record for
   * one source cannot be opened until the FLAP-DAMPENING WINDOW has passed —
   * `O2_ONCALL_FLAP_DAMPENING_SECS`, default 300s. Inside it, a re-firing is
   * recorded as a flap on the record that already paged rather than waking
   * anybody again (`page_decision_for` -> `PageDecision::Flap`). That is exactly
   * the behaviour you want from an unstable alert, and it puts a hard floor of
   * five minutes under any test that needs two firings of one rule. My first
   * version polled for 240s and could never have passed. Tagged `@slow` so a
   * fast lane can exclude it.
   */
  test('TS-20.01 a prior cause surfaces on the next firing of the same rule, and only that rule', {
    tag: ['@P1', '@slow'],
  }, async ({ page }, testInfo) => {
    // Three real firings on two rules, plus a mandatory five-minute wait for
    // the flap-dampening window between the two firings of the first rule.
    // Measured, not padded.
    test.setTimeout(900_000);
    const prefix = uniqueName(`${workerPrefix(testInfo)}_hist`);
    const emails = await createOrgUsers(page, prefix, 2);
    const team = await createTeam(page, { name: `${prefix}_team` });
    await setTeamSchedule(page, team.id, {
      timezone: 'UTC',
      rotations: [rotation({ id: 'Primary', members: emails })],
    });
    await addTeamMembers(page, team.id, emails);

    const service = `${prefix}_svc`;
    const stream = prefix.toLowerCase();
    const seeded = await seedOnCallStream(page, stream, { minutes: 30, services: [service] });
    await waitForStreamSearchable(page, stream, seeded.records);
    await createOwnershipRule(page, { teamId: team.id, dimensions: { service } });
    const destination = await seedNotificationDestination(page, stream);

    // Firing one, closed with a distinctive cause: this is the history.
    const first = await firePageAndWait(page, {
      alertOptions: { name: `${prefix}_alert`, stream, destinations: [destination] },
    });
    const earlier = first.pages[0];
    const cause = RESOLUTION_CAUSES[6]; // genuine_defect — distinctive on purpose
    const closed = await resolveResponse(page, earlier.id, {
      cause, causeNote: 'e2e prior cause',
    });
    expect(closed.status, 'the first firing must close with a cause to become history').toBe(200);
    await expect
      .poll(async () => (await getResponseRecord(page, earlier.id))?.cause, { timeout: 60000 })
      .toBe(cause);

    // The dampening window has to elapse before the same source can open a
    // SECOND record; inside it the re-firing lands on the record just closed.
    // Waited explicitly rather than hidden inside a long poll, so the reason a
    // reader sees in the log is the real one.
    const FLAP_DAMPENING_MS = 300_000;
    testLogger.info('TS-20.01 waiting out the flap-dampening window before re-firing', {
      seconds: FLAP_DAMPENING_MS / 1000,
    });
    await page.waitForTimeout(FLAP_DAMPENING_MS + 15_000);

    // Firing two, from the SAME alert — a second firing of one rule.
    await triggerAlertOrLetSchedulerFire(page, first.alert.id);
    await expect
      .poll(async () => {
        const all = await listResponses(page, { teamId: team.id, includeResolved: true });
        return all.some((r) => r.id !== earlier.id);
      }, {
        timeout: 240000,
        intervals: [3000],
        message: 'the rule never fired a second time, so there is no "next firing" to read history on',
      })
      .toBe(true);
    const all = await listResponses(page, { teamId: team.id, includeResolved: true });
    const later = all.find((r) => r.id !== earlier.id);

    const priors = await getPriorCauses(page, later.id);
    expect(priors.map((p) => p.cause),
      'the earlier firing of this same rule must be offered as history')
      .toContain(cause);

    // A record from a different rule must not inherit this one's causes.
    const otherPrefix = uniqueName(`${workerPrefix(testInfo)}_other`);
    const otherService = `${otherPrefix}_svc`;
    const otherStream = otherPrefix.toLowerCase();
    const otherSeeded = await seedOnCallStream(page, otherStream, {
      minutes: 30, services: [otherService],
    });
    await waitForStreamSearchable(page, otherStream, otherSeeded.records);
    await createOwnershipRule(page, { teamId: team.id, dimensions: { service: otherService } });
    const otherFire = await firePageAndWait(page, {
      alertOptions: { name: `${otherPrefix}_alert`, stream: otherStream, destinations: [destination] },
    });
    const otherPriors = await getPriorCauses(page, otherFire.pages[0].id);
    expect(
      otherPriors.map((p) => p.last_response_id ?? p.response_id),
      'history is matched on the exact rule — a different rule must not inherit this one\'s causes',
    ).not.toContain(earlier.id);

    // And the screen shows it where a responder would look for it.
    await pm.oncallResponseDetailPage.goto(ORG, later.id);
    await pm.oncallResponseDetailPage.openTab('causes');
    await expect(
      pm.oncallResponseDetailPage.getPriorCause(cause),
      'the Causes tab must name the cause this rule turned out to be last time',
    ).toBeVisible({ timeout: 30000 });
  });
});
