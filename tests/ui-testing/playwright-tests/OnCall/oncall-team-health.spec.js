/**
 * On-Call — is this team actually able to wake somebody (TS-21.02, TS-19.01)
 *
 * Plan: docs/test_generator/test-plans/oncall-ui-test-plan.md, Tier 1 —
 *   TS-21.02 config risks are DERIVED on read, named in plain words, and clear
 *            the moment the configuration is fixed
 *   TS-19.01 the delivery ledger records every attempt, one row per
 *            (run, rung, recipient, channel)
 *
 * ENTERPRISE-GATED (@enterprise); skips with a reason via `isOnCallAvailable()`.
 *
 * WHY "DERIVED ON READ" IS THE WHOLE OF TS-21.02. A stored risk list would
 * argue with the configuration beside it the instant somebody fixed something,
 * and the reader would have no way to tell which was right. So the assertion is
 * not only that a risk appears — it is that fixing the cause makes it disappear
 * on the next read, with nothing invalidated and no manual refresh.
 *
 * WHAT IS DELIBERATELY *NOT* ASSERTED HERE:
 *   - All eight risk kinds the book names. Four are derivable against this
 *     build — `coverage_gap`, `single_member_rotation`, `unreachable_on_rung`
 *     and `ladder_last_rung_is_not_the_whole_team` —
 *     and a member who is on the roster but on NO rotation raises nothing at
 *     all (verified 15 Sep; see oncall-members.spec.js TS-04.02 and the
 *     generation report). Constructing the rest needs product behaviour that
 *     does not exist yet, and asserting their absence would pin the gap as
 *     correct.
 *   - A SECOND channel. Only `email` is transport-configured on this
 *     deployment, so the ledger's per-channel row is proven per recipient
 *     rather than per channel; the book's "six rows for three people on two
 *     channels" is three here, for the same reason.
 *   - The SMTP-outage half of TS-19.01 (break the transport, watch the recorded
 *     failure row, restore, watch the retry). That needs transport control and
 *     belongs to the conditional `@oncall-transport` lane, not to a CI shard.
 *
 * Self-cleaning, worker-scoped prefix. Every test owns its team.
 */

const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const PageManager = require('../../pages/page-manager.js');
const {
  isOnCallAvailable,
  createTeam,
  addTeamMembers,
  setTeamSchedule,
  setTeamPolicy,
  detachPolicyFromRotations,
  rotation,
  allDayRestriction,
  seedOnCallStream,
  waitForStreamSearchable,
  seedNotificationDestination,
  createOwnershipRule,
  firePageAndWait,
  getDeliveries,
  getEscalationProgress,
  orgId,
  uniqueName,
  deleteOnCallFixturesByPrefix,
  DAY_MICROS,
  MICROS,
} = require('../utils/oncall-seed.js');
const {
  createOrgUser,
  createOrgUsers,
  getConfigRisks,
} = require('../utils/oncall-seed-ext.js');

const PREFIX = 'e2e_oncall_health';

const workerPrefix = (testInfo) => `${PREFIX}_w${testInfo.workerIndex}`;

/**
 * A domain the product recognises as undeliverable.
 *
 * `unreachable_on_rung` is raised from the ADDRESS, not from a failed send, so
 * this is how a reachability risk is constructed without breaking SMTP.
 */
const UNREACHABLE_DOMAIN = 'test.invalid';

const gate = { checked: false, available: false, reason: '' };

test.describe.configure({ mode: 'parallel' });

test.describe('On-call team health', {
  tag: ['@oncall', '@oncall-health', '@enterprise'],
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

  /** The kinds the server derived, which is the handle a spec asserts on. */
  const kindsOf = (risks) => (risks?.risks ?? []).map((r) => r.kind);

  // ------------------------------------------------------------------ TS-21.02

  test('config risks are named in plain words and clear on the next read once fixed', {
    tag: ['@P0'],
  }, async ({ page }, testInfo) => {
    const prefix = uniqueName(`${workerPrefix(testInfo)}_risk`);
    const emails = await createOrgUsers(page, prefix, 3);
    const team = await createTeam(page, { name: `${prefix}_team` });
    await addTeamMembers(page, team.id, emails);

    // A healthy team raises nothing. Without this the later assertions could
    // be reading somebody else's mess rather than the one this test built.
    const baseline = await getConfigRisks(page, team.id);
    expect(baseline.total, 'a fully-staffed 24x7 team starts with no risks').toBe(0);

    // RISK 1 — an address no page can reach. Raised from the address itself, so
    // it is detected before anybody is woken rather than after a failed send.
    const unreachable = `${prefix}_bad@${UNREACHABLE_DOMAIN}`;
    await createOrgUser(page, { email: unreachable });
    await addTeamMembers(page, team.id, [unreachable]);

    // RISK 2 and 3 — a rotation of one, covering one hour of one day, and that
    // one person is the unreachable address. All three findings then come from
    // the SAME rotation, which is what makes the later per-finding clear/keep
    // assertion meaningful.
    //
    // The unreachable address has to be ON the ladder for RISK 1 to hold:
    // `unreachable_on_rung` is about a rung, so a person merely on the roster
    // raises nothing. Detaching the policy first is the server's own
    // instruction — replacing a schedule whose rotations the policy names is
    // refused — and a rotation without an `id` is a 422.
    await detachPolicyFromRotations(page, team.id);
    const anchor = Math.floor(Date.now() / 1000) * MICROS;
    await setTeamSchedule(page, team.id, {
      timezone: 'UTC',
      rotations: [rotation({
        id: 'Narrow',
        members: [unreachable],
        shiftMicros: DAY_MICROS,
        anchorMicros: anchor,
        restrictions: [{ days: [0], start_minute: 0, end_minute: 60 }],
      })],
    });
    await setTeamPolicy(page, team.id, {
      rungs: [{
        priority: 1,
        steps: [{ after_micros: 0, targets: [{ kind: 'rotation', rotation_id: 'Narrow' }] }],
        channels: ['email'],
      }],
    });

    const broken = await getConfigRisks(page, team.id);
    testLogger.info('TS-21.02 derived risks', { kinds: kindsOf(broken), total: broken.total });
    expect(kindsOf(broken), 'a schedule that covers one hour a week leaves the team unpageable')
      .toContain('coverage_gap');
    expect(kindsOf(broken), 'a rotation of one has nobody to fall back to')
      .toContain('single_member_rotation');
    expect(kindsOf(broken), 'an address the transport discards is a person who is not really on call')
      .toContain('unreachable_on_rung');

    // Plain words, not a kind string: the message is what a reader acts on.
    for (const risk of broken.risks) {
      expect(risk.message, `risk ${risk.kind} must be a finished sentence, not an enum`)
        .toMatch(/\s/);
      expect(risk.severity, `risk ${risk.kind} must carry a severity a reader can triage on`)
        .toMatch(/high|medium|low/);
    }
    const gap = broken.risks.find((r) => r.kind === 'coverage_gap');
    expect(gap.message, 'a coverage gap must say WHEN it bites — a warning about an unnamed time is not actionable')
      .toMatch(/\d/);

    // The team screen carries the server's count, not one of its own.
    await pm.oncallTeamDetailPage.goto(ORG, team.id, 'overview');
    await pm.oncallTeamDetailPage.expectAvailable();
    await pm.oncallTeamDetailPage.expectConfigRiskTagVisible();
    expect(
      await pm.oncallTeamDetailPage.readConfigRiskCount(),
      'the screen states the number of risks the server derived, never a stored one',
    ).toBe(broken.total);

    // FIX TWO OF THE THREE — the whole roster on an unrestricted rotation. The
    // unreachable address is left ON the ladder deliberately: a read that
    // clears the fixed findings while KEEPING the unfixed one is the proof that
    // the list is derived rather than remembered. A stored list would either
    // keep all three or drop all three.
    await detachPolicyFromRotations(page, team.id);
    await setTeamSchedule(page, team.id, {
      timezone: 'UTC',
      rotations: [rotation({
        id: 'Full',
        members: [...emails, unreachable],
        shiftMicros: DAY_MICROS,
        anchorMicros: anchor,
        restrictions: [allDayRestriction()],
      })],
    });
    await setTeamPolicy(page, team.id, {
      rungs: [{ priority: 1, steps: [{ after_micros: 0, targets: [{ kind: 'rotation', rotation_id: 'Full' }] }], channels: ['email'] }],
    });

    const fixed = await getConfigRisks(page, team.id);
    testLogger.info('TS-21.02 risks after the fix', { kinds: kindsOf(fixed), total: fixed.total });
    expect(kindsOf(fixed), 'the coverage gap is gone the moment the schedule covers the week')
      .not.toContain('coverage_gap');
    expect(kindsOf(fixed), 'a rotation with four people is no longer a rotation of one')
      .not.toContain('single_member_rotation');
    expect(kindsOf(fixed), 'the finding nobody fixed must survive — risks are derived, not swept')
      .toContain('unreachable_on_rung');

    // And the screen agrees on the same load, without being told to re-read.
    // Polled rather than read once: the tag is drawn from the team fetch, which
    // is still in flight when the route first mounts.
    await pm.oncallTeamDetailPage.goto(ORG, team.id, 'overview');
    await pm.oncallTeamDetailPage.expectDetailVisible();
    await expect.poll(
      async () => await pm.oncallTeamDetailPage.readConfigRiskCount(),
      { timeout: 30000, intervals: [1000], message: 'the risk tag never settled on the fixed count' },
    ).toBe(fixed.total);
  });

  // ------------------------------------------------------------------ TS-19.01

  test('the delivery ledger records one row per recipient of a fanned-out rung', {
    tag: ['@P0'],
  }, async ({ page }, testInfo) => {
    const prefix = uniqueName(`${workerPrefix(testInfo)}_ledger`);
    const emails = await createOrgUsers(page, prefix, 3);
    const team = await createTeam(page, { name: `${prefix}_team` });
    await addTeamMembers(page, team.id, emails);

    // A first rung that wakes the WHOLE team: the ledger's per-recipient row is
    // only observable when one rung reaches more than one person.
    await setTeamPolicy(page, team.id, {
      rungs: [{ priority: 2, steps: [{ after_micros: 0, targets: [{ kind: 'whole_team' }] }], channels: ['email'] }],
    });

    const service = `${prefix}_svc`;
    const stream = prefix.toLowerCase();
    const seeded = await seedOnCallStream(page, stream, { minutes: 30, services: [service] });
    await waitForStreamSearchable(page, stream, seeded.records);
    await createOwnershipRule(page, { teamId: team.id, dimensions: { service } });
    const destination = await seedNotificationDestination(page, prefix.toLowerCase());

    const { pages } = await firePageAndWait(page, {
      alertOptions: { name: `${prefix}_alert`, stream, destinations: [destination] },
    });
    const record = pages[0];

    // One row per (run, rung, recipient, channel) — the whole team, on the
    // first rung, in one run.
    await expect.poll(
      async () => (await getDeliveries(page, record.id))?.total ?? 0,
      { timeout: 90000, intervals: [3000], message: 'the ledger never recorded the fan-out' },
    ).toBe(emails.length);
    const ledger = await getDeliveries(page, record.id);

    testLogger.info('TS-19.01 ledger', { total: ledger.total, rows: ledger.deliveries });
    const first = ledger.deliveries.filter((row) => row.rung_micros === 0);
    expect(first.length, 'a rung that wakes three people writes three rows, not one').toBe(emails.length);
    expect(new Set(first.map((r) => r.recipient)).size, 'every recipient gets their own row').toBe(emails.length);
    expect(new Set(first.map((r) => r.ladder_run)), 'the original firing is one run').toEqual(new Set([1]));
    for (const row of first) {
      expect(row.channel, 'a row without a channel cannot answer "did their phone ring"').toBe('email');
      expect(emails, 'the ledger names only people the rung actually targeted').toContain(row.recipient);
    }

    // The ledger IS the ground truth: what the escalation progress claims it
    // reached must be exactly what the ledger recorded as delivered.
    const progress = await getEscalationProgress(page, record.id);
    const delivered = new Set(ledger.deliveries.filter((r) => r.delivered === true).map((r) => r.recipient));
    const claimed = new Set((progress.fired ?? []).flatMap((rung) => rung.reached ?? []));
    testLogger.info('TS-19.01 reached vs ledger', { claimed: [...claimed], delivered: [...delivered] });
    expect(claimed, 'the ladder must not claim it reached somebody the ledger has no delivery for')
      .toEqual(delivered);

    // And the screen has to draw it — grouped by run, so a replay is
    // distinguishable from the original firing.
    await pm.oncallResponseDetailPage.goto(ORG, record.id);
    await pm.oncallResponseDetailPage.expectDetailVisible();
    await pm.oncallResponseDetailPage.openTab('deliveries');
    await pm.oncallResponseDetailPage.expectLedgerVisible();
    await pm.oncallResponseDetailPage.waitForDeliveryRows();
    const runs = await pm.oncallResponseDetailPage.readDeliveryRuns();
    testLogger.info('TS-19.01 rendered runs', { runs });
    expect(runs.length, 'one firing renders as exactly one run group').toBe(1);
    expect(
      await pm.oncallResponseDetailPage.countDeliveryRows(runs[0]),
      'the screen draws every ledger row, not a summary of them',
    ).toBe(ledger.total);
  });
});
