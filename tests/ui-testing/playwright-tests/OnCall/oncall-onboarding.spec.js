/**
 * On-Call — Quick start actually writes a schedule (TS-06.07)
 *
 * Plan: docs/test_generator/test-plans/oncall-ui-test-plan.md, Tier 1 —
 *   TS-06.07 applying a preset must issue a real `PUT /teams/{id}/schedule`,
 *            and the stored schedule afterwards must be the preset's.
 *
 * ENTERPRISE-GATED (@enterprise); skips with a reason via `isOnCallAvailable()`.
 *
 * WHY THIS IS ITS OWN FILE AND NOT AN APPEND. `oncall-quickstart.spec.js` is
 * being repaired by another workstream in this same run, so it is off-limits.
 * This file takes the one Tier-1 case that would naturally have landed there
 * and is where the rest of TS-22 will go next.
 *
 * THE DEFECT CLASS THIS GUARDS. A Quick start that validates, closes the drawer
 * and issues NOTHING looks exactly like success: the drawer disappears, no
 * error is shown, and the team's schedule is whatever it was before. So the
 * assertion is not "the drawer closed" — it is that the request went out AND
 * that what came back is the preset's shape. `attemptQuickStartSave()` watches
 * the network for precisely this reason.
 *
 * WHAT IS DELIBERATELY *NOT* ASSERTED HERE:
 *   - The preset's exact restriction minutes. Those are the catalogue's
 *     business decision, read from `GET /oncall/schedule-presets` at runtime;
 *     pinning them here would make the test a copy of the catalogue rather than
 *     a check on it. What is asserted is that the two staffed groups became two
 *     rotations holding the people who were staffed into them, and that the
 *     rotations are no longer the auto-created `source: "default"` pair.
 *
 * Self-cleaning, worker-scoped prefix.
 */

const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const PageManager = require('../../pages/page-manager.js');
const {
  isOnCallAvailable,
  createTeam,
  addTeamMembers,
  getTeamSchedule,
  orgId,
  uniqueName,
  deleteOnCallFixturesByPrefix,
} = require('../utils/oncall-seed.js');
const { createOrgUsers } = require('../utils/oncall-seed-ext.js');

const PREFIX = 'e2e_oncall_onboarding';

const workerPrefix = (testInfo) => `${PREFIX}_w${testInfo.workerIndex}`;

/**
 * The preset with the fewest required inputs that still produces two rotations.
 *
 * `weekday_weekend` needs exactly two groups, both required, and no boundary
 * day or minute — so the case stays about "did the apply issue a request"
 * rather than about filling a form.
 */
const PRESET_ID = 'weekday_weekend';
const PRESET_ROWS = ['weekdays', 'weekend'];

const gate = { checked: false, available: false, reason: '' };

test.describe.configure({ mode: 'parallel' });

test.describe('On-call onboarding', {
  tag: ['@oncall', '@oncall-onboarding', '@enterprise'],
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

  // ------------------------------------------------------------------ TS-06.07

  /**
   * UNWIRED, and kept as a fixme with its real assertions intact.
   *
   * Reproduced on this build, 15 Sep: with the `weekday_weekend` preset chosen
   * and both required groups staffed, Apply is ENABLED (`disabled: false`),
   * clicking it issues NO request (`requestSeen: false`), and the screen says
   * nothing about why (`error: null`, `invalidFields: 0`). A Quick start that
   * validates, looks successful and writes nothing is indistinguishable from
   * one that worked, which is the entire reason this case exists.
   *
   * The body asserts the CORRECT behaviour — the apply issues
   * `PUT /teams/{id}/schedule` and the stored schedule is the preset's — so it
   * flips green the moment the handler is wired, and weakening it to assert the
   * no-op would pin the defect as correct.
   */
  test.fixme('applying a Quick start preset issues a real schedule write, not a silent no-op — not wired: Apply is enabled, issues no request and reports no error, verified 15 Sep on :5090', {
    tag: ['@P0'],
  }, async ({ page }, testInfo) => {
    const prefix = uniqueName(`${workerPrefix(testInfo)}_preset`);
    const emails = await createOrgUsers(page, prefix, 4);
    const team = await createTeam(page, { name: `${prefix}_team` });
    await addTeamMembers(page, team.id, emails);

    // The auto-staffed starting point, so "the schedule changed" is a real
    // before/after rather than an assumption about an empty team.
    const before = await getTeamSchedule(page, team.id);
    testLogger.info('TS-06.07 schedule before Quick start', {
      rotations: before.rotations.map((r) => ({ id: r.id, name: r.name, source: r.source })),
    });
    expect(before.rotations.every((r) => r.source === 'default'),
      'a new team starts on auto-created rotations — that is what Quick start replaces').toBe(true);

    await pm.oncallTeamDetailPage.goto(ORG, team.id, 'schedule');
    await pm.oncallTeamDetailPage.expectAvailable();
    await pm.oncallTeamDetailPage.openScheduleTab();
    await pm.oncallTeamDetailPage.openQuickStart();
    await pm.oncallTeamDetailPage.chooseQuickStartTemplate(PRESET_ID);

    // Two groups staffed with different people, so the stored rotations can be
    // told apart afterwards.
    const staffing = {
      weekdays: [emails[0], emails[1]],
      weekend: [emails[2], emails[3]],
    };
    // Only `members` is required on this preset — `name` is optional and takes
    // a sensible default — so staffing is the whole of filling it in.
    for (const row of PRESET_ROWS) {
      await pm.oncallTeamDetailPage.setQuickStartRegionMembers(row, staffing[row]);
    }

    // The network watch is the point: a Quick start that closes the drawer
    // without issuing a PUT looks identical to one that worked.
    const attempt = await pm.oncallTeamDetailPage.attemptQuickStartSave({ settleMs: 4000 });
    testLogger.info('TS-06.07 apply attempt', attempt);
    expect(attempt.disabled, 'a fully-filled Quick start must be applicable').toBe(false);
    expect(attempt.requestSeen, 'applying a preset must issue PUT /teams/{id}/schedule — a silent no-op is the defect')
      .toBe(true);
    expect(attempt.error, 'a valid preset must not be refused').toBeNull();

    // And the stored schedule has to actually be the preset's.
    await expect.poll(
      async () => (await getTeamSchedule(page, team.id)).rotations.some((r) => r.source !== 'default'),
      { timeout: 60000, intervals: [1000], message: 'the schedule never left its auto-created state' },
    ).toBe(true);

    const after = await getTeamSchedule(page, team.id);
    testLogger.info('TS-06.07 schedule after Quick start', {
      rotations: after.rotations.map((r) => ({
        id: r.id, name: r.name, source: r.source,
        members: r.shift_rules?.[0]?.members,
      })),
    });
    expect(after.rotations.length, 'a two-group preset stores two rotations').toBe(PRESET_ROWS.length);

    // Each staffed group became a rotation holding exactly the people put in it
    // — the strongest available statement that the preset, not something else,
    // is what got written.
    const storedMembers = after.rotations.map((r) => [...(r.shift_rules?.[0]?.members ?? [])].sort());
    for (const row of PRESET_ROWS) {
      expect(storedMembers, `the "${row}" group must be stored with the people staffed into it`)
        .toContainEqual([...staffing[row]].sort());
    }
  });
});
