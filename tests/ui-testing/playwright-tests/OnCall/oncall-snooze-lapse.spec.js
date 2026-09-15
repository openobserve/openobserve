/**
 * On-Call — a lapsed snooze must resume the ladder, not consume it (TS-17.01, slow half)
 *
 * Plan: docs/test_generator/test-plans/oncall-ui-test-plan.md, Tier 1, TS-17.01.
 *
 * SEPARATE FILE ON PURPOSE, AND OUT OF THE CI LANE. Fifteen minutes is the
 * shortest snooze the product offers, so watching one LAPSE cannot be done
 * quickly: this test sleeps past the whole window plus two shortened rung
 * delays. It is registered in `ci-matrix/ci_matrix.json` under the OnCall
 * shard's `disabled` list with that reason, the way the plan keeps TS-10.07 out
 * of the fast lane, and is meant to be run deliberately:
 *
 *   npx playwright test playwright-tests/OnCall/oncall-snooze-lapse.spec.js
 *
 * WHAT IT IS FOR. On this build the record's `exhausted_at` is stamped while
 * the snooze is still running — observed 15 Sep: a record snoozed for 15
 * minutes had its ladder marked exhausted about 35 seconds in, having delivered
 * nothing after the first rung. If that stamp means what it says, rung 2 never
 * fires after the snooze lapses and the snooze has silently consumed the
 * ladder, which is the worst outcome the verb has: the pager goes quiet and
 * stays quiet. This test is how that gets an answer rather than a suspicion.
 *
 * The fast half of TS-17.01 — snooze is not an ack, and nothing is delivered
 * while it is quiet — lives in `oncall-response-verbs.spec.js` and does run in
 * CI.
 *
 * ENTERPRISE-GATED (@enterprise); skips with a reason via `isOnCallAvailable()`.
 * Self-cleaning, worker-scoped prefix.
 */

const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const {
  isOnCallAvailable,
  createTeam,
  addTeamMembers,
  createOwnershipRule,
  seedOnCallStream,
  waitForStreamSearchable,
  seedNotificationDestination,
  firePageAndWait,
  getDeliveries,
  getEscalationProgress,
  orgId,
  uniqueName,
  deleteOnCallFixturesByPrefix,
} = require('../utils/oncall-seed.js');
const {
  createOrgUsers,
  shortenPolicyForSpeed,
  snoozeResponse,
  getResponseRecord,
} = require('../utils/oncall-seed-ext.js');

const PREFIX = 'e2e_oncall_snoozelapse';

const workerPrefix = (testInfo) => `${PREFIX}_w${testInfo.workerIndex}`;

/** The shortest duration the snooze menu offers. There is nothing quicker. */
const SHORTEST_SNOOZE_MINUTES = 15;

const gate = { checked: false, available: false, reason: '' };

test.describe.configure({ mode: 'parallel' });

test.describe('On-call snooze expiry', {
  tag: ['@oncall', '@oncall-verbs', '@slow', '@enterprise'],
}, () => {
  let ORG;

  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    await navigateToBase(page);
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
    return { prefix, emails, team, alert, record: pages[0] };
  }

  test('a lapsed snooze resumes the ladder instead of consuming it', {
    tag: ['@P0', '@slow'],
  }, async ({ page }, testInfo) => {
    test.setTimeout(20 * 60 * 1000);
    const f = await seedOpenPage(page, testInfo, 'snoozelapse', { delaysSeconds: [0, 45, 90] });
    const id = f.record.id;

    const before = await getDeliveries(page, id);
    await snoozeResponse(page, id, SHORTEST_SNOOZE_MINUTES);
    const snoozedUntil = (await getResponseRecord(page, id)).snoozed_until;
    expect(snoozedUntil, 'the snooze must be on the record before its expiry can be watched').toBeTruthy();

    // Sleep past the end of the snooze plus two of the shortened rung delays,
    // so a ladder that resumes has had time to actually fire.
    await page.waitForTimeout((SHORTEST_SNOOZE_MINUTES * 60 + 180) * 1000);

    const after = await getDeliveries(page, id);
    const progress = await getEscalationProgress(page, id);
    testLogger.info('TS-17.01-slow ledger after the snooze lapsed', {
      before: before.total, after: after.total, progress,
    });
    expect(after.total, 'once the snooze lapses the ladder must page the next rung')
      .toBeGreaterThan(before.total);

    const laterRungs = after.deliveries.filter((row) => row.rung_micros > 0);
    expect(laterRungs.length, 'at least one rung beyond the first must fire after the snooze lapses')
      .toBeGreaterThan(0);

    // Nothing may be released EARLY either: a rung that fired before the snooze
    // ended was never actually silenced.
    for (const row of laterRungs) {
      expect(row.at, `rung ${row.rung_micros} fired before the snooze ended — it was not silenced`)
        .toBeGreaterThanOrEqual(snoozedUntil);
    }

    // And not all at once. Rungs are 45 seconds apart in this ladder, so two
    // different rungs landing at the same second is the burst this case is for.
    const byRung = new Map();
    for (const row of laterRungs) {
      const second = Math.round(row.at / 1_000_000);
      if (!byRung.has(row.rung_micros)) byRung.set(row.rung_micros, second);
    }
    const instants = [...byRung.values()];
    testLogger.info('TS-17.01-slow post-snooze rung instants', { instants: [...byRung] });
    expect(new Set(instants).size, 'each rung keeps its own instant — the remainder is delayed, not released together')
      .toBe(instants.length);
  });

});
