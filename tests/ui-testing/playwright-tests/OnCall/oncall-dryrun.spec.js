/**
 * On-Call — proving the configuration before it matters (TS-13)
 *
 * Plan: docs/test_generator/test-plans/oncall-ui-test-plan.md, Tier 1 —
 *   TS-13.01 the routing simulator agrees with a real firing, and changes nothing
 *   TS-13.02 the escalation preview names real people from the CURRENT schedule
 *   TS-13.03 a test page goes down the real path and leaves no trace
 *   TS-13.06 every link in every page email resolves to a real route (the W-01 guard)
 *
 * ENTERPRISE-GATED (@enterprise); skips with a reason via `isOnCallAvailable()`.
 *
 * WHY THESE FOUR ARE ONE FILE. They are the same claim from four directions: a
 * dry run has to be TRUE and has to be FREE. A preview that lies converts a
 * proven configuration into a false one, and a preview with side effects wakes
 * somebody who was not on call. Both halves are asserted on every case here.
 *
 * WHAT IS DELIBERATELY *NOT* ASSERTED HERE:
 *   - The specificity tag. `oncall-simulator-specificity` renders only when
 *     there is something to explain — a second rule that matched and lost — so
 *     on a single-rule fixture its absence is correct, and asserting it would
 *     make the case about seeding competition rather than about agreement.
 *   - The rendered ladder, rung by rung, against the firing. The simulator
 *     draws a summary line per stage, not a table, so the comparison is made on
 *     the fields it actually renders — matched path, team, responder — plus the
 *     engine's own `/routing/preview` answer, which is the payload the screen
 *     itself draws.
 *   - MTTA and team-load movement after a test page. Both are windowed
 *     aggregates over an org that carries fixture litter from earlier runs, so
 *     they cannot be read as a clean before/after. What IS asserted is the
 *     thing MTTA is computed FROM: the record count for the team, the pages
 *     list, and the cause analytics are all unchanged.
 *   - The HTTP status of an emailed link. A SPA answers 200 and still renders a
 *     not-found view, so the assertion is on the rendered page — the route
 *     mounting its own screen — exactly as the plan requires.
 *
 * Self-cleaning, worker-scoped prefix. Every test owns its team, its service
 * dimension and its alert, because the `default` org on this environment
 * carries leftover teams and unrouted signals from earlier pytest runs.
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
  listResponses,
  sendTestPage,
  createCover,
  getTeamSchedule,
  orgId,
  uniqueName,
  baseUrl,
  deleteOnCallFixturesByPrefix,
  MICROS,
  HOUR_MICROS,
} = require('../utils/oncall-seed.js');
const {
  createOrgUsers,
  simulateRouting,
  getEscalationPreview,
  getCauseAnalytics,
  waitForMail,
  extractLinks,
} = require('../utils/oncall-seed-ext.js');

const PREFIX = 'e2e_oncall_dryrun';

const workerPrefix = (testInfo) => `${PREFIX}_w${testInfo.workerIndex}`;

/** The semantic group id the seeded rows' `service` column belongs to. */
const SERVICE_DIMENSION = 'service';

const gate = { checked: false, available: false, reason: '' };

test.describe.configure({ mode: 'parallel' });

test.describe('On-call dry runs', {
  tag: ['@oncall', '@oncall-dryrun', '@enterprise'],
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
   * A team that can be paged and a signal identity that routes to it.
   *
   * Every test gets its own, so no assertion here depends on an org-wide count
   * and two workers can never claim the same identity path — a 409 on an
   * ownership rule means somebody else already owns that path.
   */
  async function seedRoutableTeam(page, testInfo, tag) {
    const prefix = uniqueName(`${workerPrefix(testInfo)}_${tag}`);
    const emails = await createOrgUsers(page, prefix, 3);
    const team = await createTeam(page, { name: `${prefix}_team` });
    await addTeamMembers(page, team.id, emails);
    const service = `${prefix}_svc`;
    await createOwnershipRule(page, { teamId: team.id, dimensions: { [SERVICE_DIMENSION]: service } });
    return { prefix, emails, team, service };
  }

  // ------------------------------------------------------------------ TS-13.01

  test('the routing simulator agrees with a real firing and changes nothing', {
    tag: ['@P0'],
  }, async ({ page }, testInfo) => {
    const f = await seedRoutableTeam(page, testInfo, 'sim');

    // What the screen draws, read from the drawer.
    await pm.oncallRoutingPage.goto(ORG);
    await pm.oncallRoutingPage.expectAvailable();
    await pm.oncallRoutingPage.openSignalTester();
    await pm.oncallRoutingPage.addSimulatorDimension(SERVICE_DIMENSION, f.service);
    await pm.oncallRoutingPage.runSimulator();
    await pm.oncallRoutingPage.expectSimulatorTeamNames(f.team.name);
    const rendered = await pm.oncallRoutingPage.readSimulatorResult();
    testLogger.info('TS-13.01 rendered simulator verdict', rendered);

    // The engine's own answer, which is the payload the screen draws.
    const predicted = await simulateRouting(page, { dimensions: { [SERVICE_DIMENSION]: f.service } });
    testLogger.info('TS-13.01 engine verdict', { decision: predicted.decision, team: predicted.team_id });
    expect(predicted.team_id, 'the preview must resolve to the team whose rule claims the path')
      .toBe(f.team.id);

    // The screen has to say WHICH rule won and on what — "this team" without
    // the path is not a verdict a reader can check.
    expect(rendered.matched, 'the verdict names the identity path the winning rule matched on')
      .toContain(f.service);
    const predictedResponder = predicted.current_responder?.user_email
      ?? predicted.ladder?.[0]?.recipients?.[0]?.user_email ?? null;
    expect(predictedResponder, 'a preview that does not name a person has predicted nothing').toBeTruthy();
    expect(rendered.responder, 'the screen names the same person the engine does')
      .toContain(predictedResponder);

    // Simulating must cost nothing: no record, no unrouted entry, no page.
    const before = await listResponses(page, { teamId: f.team.id, includeResolved: true });
    expect(before.length, 'running the simulator must not open a record').toBe(0);

    // Now fire for real, carrying exactly the dimensions that were simulated.
    const stream = f.prefix.toLowerCase();
    const seeded = await seedOnCallStream(page, stream, { minutes: 30, services: [f.service] });
    await waitForStreamSearchable(page, stream, seeded.records);
    const destination = await seedNotificationDestination(page, f.prefix.toLowerCase());
    const { pages } = await firePageAndWait(page, {
      alertOptions: { name: `${f.prefix}_alert`, stream, destinations: [destination] },
    });

    // The prediction and the firing have to agree on the team AND on the person.
    expect(pages[0].team_id, 'the real firing must land on the team the preview named')
      .toBe(predicted.team_id);
    // The resolver is asked until it answers, not once: it reads the schedule
    // the fixture has just written, and an empty answer immediately after the
    // firing is it still catching up rather than a team with nobody on it. Read
    // once, this indexed `onCall[0]` on an empty array and died with
    // `Cannot read properties of undefined` — which reports a TypeError where
    // the interesting fact was "the resolver named nobody". The line above
    // already used `onCall[0]?.`, so the emptiness was known to be possible.
    //
    // Bounded, and the comparison below is untouched: a resolver that genuinely
    // never names anybody still fails here, now saying exactly that.
    await expect
      .poll(async () => (await whoIsOnCall(page, f.team.id)).length, {
        timeout: 60000,
        intervals: [1000],
        message: 'the resolver must name somebody on call for a team the preview just staffed',
      })
      .toBeGreaterThan(0);

    const onCall = await whoIsOnCall(page, f.team.id);
    testLogger.info('TS-13.01 responder', { predictedResponder, actual: onCall[0]?.user_email });
    expect(predictedResponder, 'the preview and the resolver must name the same person')
      .toBe(onCall[0].user_email);
  });

  // ------------------------------------------------------------------ TS-13.02

  test('the escalation preview names people from the current schedule and follows a cover', {
    tag: ['@P0'],
  }, async ({ page }, testInfo) => {
    const f = await seedRoutableTeam(page, testInfo, 'prev');

    const healthy = await getEscalationPreview(page, f.team.id, 1);
    testLogger.info('TS-13.02 preview on a healthy team', {
      pagesAnyone: healthy.pages_anyone,
      first: healthy.rungs?.[0]?.recipients?.map((r) => r.user_email),
    });
    expect(healthy.pages_anyone, 'a staffed team previews as pageable').toBe(true);

    const firstRung = healthy.rungs[0].recipients.map((r) => r.user_email);
    const onCall = (await whoIsOnCall(page, f.team.id)).map((slot) => slot.user_email);
    expect(firstRung, 'the preview names the people the engine currently resolves, not the roster')
      .toEqual(expect.arrayContaining([onCall[0]]));
    for (const email of firstRung) {
      expect(f.emails, 'every previewed recipient is somebody actually on this team').toContain(email);
    }

    // Hand the primary's shift to the third person for a live window. The
    // preview reads the CURRENT schedule, so it must move.
    const schedule = await getTeamSchedule(page, f.team.id);
    const primaryRotation = schedule.rotations[0].id;
    const stand_in = f.emails.find((e) => !onCall.includes(e)) ?? f.emails[2];
    const now = Date.now() * 1000;
    await createCover(page, f.team.id, {
      userEmail: stand_in,
      rotationId: primaryRotation,
      fromMicros: now - 5 * 60 * MICROS,
      toMicros: now + HOUR_MICROS,
      reason: 'dry-run cover',
    });

    const covered = await getEscalationPreview(page, f.team.id, 1);
    const coveredFirst = covered.rungs[0].recipients.map((r) => r.user_email);
    testLogger.info('TS-13.02 preview under a live cover', { coveredFirst, stand_in });
    expect(coveredFirst, 'a live cover must move the preview — otherwise it previews a schedule nobody is on')
      .toContain(stand_in);

    // Previewing sends nothing and opens nothing.
    const records = await listResponses(page, { teamId: f.team.id, includeResolved: true });
    expect(records.length, 'previewing must not open a record').toBe(0);

    // And the engine and the resolver must not disagree about who holds the slot.
    const resolvedNow = (await whoIsOnCall(page, f.team.id)).map((slot) => slot.user_email);
    expect(resolvedNow, 'the preview and "who is on call" answer the same question the same way')
      .toContain(stand_in);
  });

  // ------------------------------------------------------------------ TS-13.03

  test('a test page reaches a real mailbox and leaves no record behind', {
    tag: ['@P0'],
  }, async ({ page }, testInfo) => {
    const f = await seedRoutableTeam(page, testInfo, 'test');

    const recordsBefore = await listResponses(page, { teamId: f.team.id, includeResolved: true });
    const causesBefore = await getCauseAnalytics(page, { teamId: f.team.id });
    const since = Date.now() - 2000;

    const result = await sendTestPage(page, f.team.id);
    testLogger.info('TS-13.03 test-page result', result);
    expect(result.reached_anyone, `a test page on a staffed team must land: ${result.not_sent_because}`)
      .toBe(true);
    const attempted = (result.attempts ?? []).map((a) => a.recipient);
    const onCall = (await whoIsOnCall(page, f.team.id)).map((slot) => slot.user_email);
    expect(attempted, 'the test goes to whoever is really on call, not to the roster')
      .toContain(onCall[0]);

    // A real message, through the real transport, clearly marked a test — a
    // test page a reader cannot tell from a live incident is worse than none.
    const mail = await waitForMail({ to: onCall[0], sinceMs: since, timeout: 90000 });
    expect(mail, 'the test page must actually arrive in the mail sink').not.toBeNull();
    testLogger.info('TS-13.03 test mail', { subject: mail.subject, to: mail.to });
    expect(mail.subject, 'a test page must announce itself as one in the subject line')
      .toMatch(/test/i);

    // Free: no record, nothing on the Pages list, no cause recorded.
    const recordsAfter = await listResponses(page, { teamId: f.team.id, includeResolved: true });
    expect(recordsAfter.length, 'a test page must not open a record — MTTA is computed from these')
      .toBe(recordsBefore.length);
    const causesAfter = await getCauseAnalytics(page, { teamId: f.team.id });
    expect(causesAfter.total, 'a test page has no cause, so it must not appear in cause analytics')
      .toBe(causesBefore.total);

    await pm.oncallPagesListPage.goto(ORG);
    await pm.oncallPagesListPage.expectAvailable();
    await pm.oncallPagesListPage.filterByTeam(f.team.id);

    // NOT expectListVisible() here. This test's whole point is that a test page
    // opens no record, so on an org where nothing has ever paged the product
    // draws the setup checklist INSTEAD of the table — correctly, and there is
    // then no table to wait for. On a used instance it only renders because some
    // other test left a page behind. Both shapes are the same answer: no row.
    expect(
      await pm.oncallPagesListPage.countRowsOnPage(),
      'the Pages list is what still needs somebody — a test page never does',
    ).toBe(0);
  });

  // ------------------------------------------------------------------ TS-13.06

  test('every link in a page email resolves to a route that renders its own screen', {
    tag: ['@P0'],
  }, async ({ page }, testInfo) => {
    const f = await seedRoutableTeam(page, testInfo, 'links');
    const onCall = (await whoIsOnCall(page, f.team.id)).map((slot) => slot.user_email);

    // Both emails the module sends on a healthy team: the test page — the one
    // whose entire purpose is to prove the configuration works, and the one
    // W-01 broke — and a real first-rung page.
    const testSince = Date.now() - 2000;
    await sendTestPage(page, f.team.id);
    const testMail = await waitForMail({ to: onCall[0], sinceMs: testSince, timeout: 90000 });
    expect(testMail, 'the test page must arrive before its links can be checked').not.toBeNull();

    const stream = f.prefix.toLowerCase();
    const seeded = await seedOnCallStream(page, stream, { minutes: 30, services: [f.service] });
    await waitForStreamSearchable(page, stream, seeded.records);
    const destination = await seedNotificationDestination(page, f.prefix.toLowerCase());
    const pageSince = Date.now() - 2000;
    const { pages } = await firePageAndWait(page, {
      alertOptions: { name: `${f.prefix}_alert`, stream, destinations: [destination] },
    });
    const pageMail = await waitForMail({ to: onCall[0], sinceMs: pageSince, subject: /\[P\d\]/, timeout: 120000 });
    expect(pageMail, 'a fired page must produce a page email').not.toBeNull();

    // W-01 was a MISSING PATH SEGMENT — `/web/oncall?...` instead of
    // `/web/oncall/responses/{id}?...` — so the link the reader is invited to
    // click is checked as a route, not as a string.
    const links = [...new Set([...extractLinks(testMail), ...extractLinks(pageMail)])];
    testLogger.info('TS-13.06 links found in page email', { links });
    expect(links.length, 'a page email with no link gives the reader nowhere to go').toBeGreaterThan(0);

    const appLinks = links.filter((u) => u.includes('/web/'));
    expect(appLinks.length, 'at least one link must take the reader into the product').toBeGreaterThan(0);

    for (const link of appLinks) {
      expect(link, 'every emailed link must be absolute and carry the org it belongs to')
        .toContain('org_identifier=');
      expect(link.startsWith(baseUrl()), `an emailed link must be absolute: ${link}`).toBe(true);
    }

    // Assert on the RENDERED page, not the status code: a SPA answers 200 and
    // still draws a not-found view, which is exactly how W-01 survived.
    for (const link of appLinks) {
      await page.goto(link);
      await page.waitForLoadState('domcontentloaded');
      const title = await page.title();
      testLogger.info('TS-13.06 emailed link rendered', { link, title });
      expect(title, `an emailed link must not land on not-found: ${link}`).not.toMatch(/404|not found/i);
    }

    // The record link specifically has to reach the record it names, with its
    // own screen mounted — the strongest form of "this link works".
    const recordLink = appLinks.find((u) => u.includes(`/oncall/responses/${pages[0].id}`));
    expect(recordLink, 'the page email must link to the record it is about').toBeTruthy();
    await page.goto(recordLink);
    await pm.oncallResponseDetailPage.expectDetailVisible();
  });

  /**
   * TS-13.04 (W-09) — the simulator names what is broken, and never renders a
   * confident answer for a configuration that cannot deliver.
   *
   * The whole point of a dry run is that somebody trusts it INSTEAD of firing a
   * real alert. So the one thing it must never do is look successful when it is
   * not: an empty "Matched rule" element reads as "matched nothing in
   * particular, carry on" when the truth is "nothing matched at all".
   *
   * W-09 is exactly that — the matched-rule slot renders an empty element
   * rather than the word "none". Asserted here against a signal deliberately
   * built to match nothing: the result must either say so in words, or not
   * claim a match at all. An element that exists and is blank fails both ways.
   */
  test('TS-13.04 a signal that matches nothing is named as unmatched, not rendered as a blank answer', {
    tag: ['@P1'],
  }, async ({ page }, testInfo) => {
    const name = uniqueName(`${workerPrefix(testInfo)}_nomatch`);
    // A dimension value nothing in this org could have claimed.
    const orphan = `${name}_never_claimed`;

    // The engine's own answer first, so the screen is compared against truth.
    const engine = await simulateRouting(page, {
      dimensions: { [SERVICE_DIMENSION]: orphan },
    });
    expect(engine, 'the preview endpoint must answer even when nothing matches').toBeTruthy();

    await pm.oncallRoutingPage.goto(ORG);
    await pm.oncallRoutingPage.expectAvailable();
    await pm.oncallRoutingPage.openSignalTester();
    await pm.oncallRoutingPage.addSimulatorDimension(SERVICE_DIMENSION, orphan);
    await pm.oncallRoutingPage.runSimulator();

    const rendered = await pm.oncallRoutingPage.readSimulatorResult();
    testLogger.info('TS-13.04 unmatched verdict as rendered', rendered);

    expect(rendered.matched,
      'a result panel that renders empty is the failure mode this case exists to catch')
      .toBeTruthy();

    // The matched-rule slot: either absent, or carrying words. Never present
    // and blank — that is a confident answer to a question with no answer.
    if (rendered.specificity !== null) {
      expect(
        rendered.specificity,
        'W-09: the matched-rule slot renders an empty element instead of saying nothing matched',
      ).not.toBe('');
    }

    // And the panel must say, in words a human can act on, that nothing claimed it.
    expect(
      String(rendered.matched).toLowerCase(),
      'an unmatched signal must be described as unmatched — defaulted, unclaimed or nobody — not left to be inferred from a gap',
    ).toMatch(/no |none|nobody|default|unmatched|unclaimed|not match/);
  });

});
